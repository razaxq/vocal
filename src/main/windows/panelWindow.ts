/**
 * 悬浮面板 —— 显示波形、实时文字、状态。
 *
 * 关键约束：这个窗口绝对不能抢焦点。一旦抢了，SendInput 就会打到面板自己身上。
 *  - focusable: false  → Windows 上会加 WS_EX_NOACTIVATE
 *  - showInactive()    → 显示但不激活
 *  - setIgnoreMouseEvents 在「纯展示」态打开，让点击穿透到下面的应用
 */
import { BrowserWindow, screen, app } from 'electron'
import { join } from 'node:path'
import { getCaretScreenRect } from '@main/win32/user32'

/**
 * 面板有两个尺寸。
 *
 * 宽的那个是给流式识别用的 —— 它要放得下一边说一边滚动的实时文本。
 * 一旦关掉流式模型，那块地方永远是空的（定稿文本直接进目标窗口了），
 * 420×92 就成了一个大部分面积都在装空气的浮窗。所以那种档位下收成
 * 「波形 + 一行状态」的小条：用户此刻只需要知道「它在听」。
 */
const SIZE = {
  full: { w: 420, h: 92 },
  compact: { w: 208, h: 64 }
} as const

/** 退场动画时长，和 styles.css 的 .panel-out 必须一致。 */
export const EXIT_MS = 150

/** 结束后让用户多看一眼最终文本的停留时间。 */
export const DWELL_MS = 500

export function panelSize(compact: boolean): { w: number; h: number } {
  return compact ? SIZE.compact : SIZE.full
}

export function createPanelWindow(compact: boolean): BrowserWindow {
  const { w, h } = panelSize(compact)
  const win = new BrowserWindow({
    width: w,
    height: h,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  // 让面板在全屏应用之上也能出现
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/panel/index.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/panel/index.html'))
  }

  return win
}

/**
 * 把面板放到光标附近；拿不到 caret 就退化到「当前屏幕底部居中偏上」。
 * 后者其实是多数场景的实际落点 —— Chrome / VS Code / 终端都不上报 caret。
 */
export function positionPanel(win: BrowserWindow, followCaret: boolean, compact: boolean): void {
  const { w: W, h: H } = panelSize(compact)
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea

  let x: number
  let y: number

  const caret = followCaret ? safeCaret() : null
  if (caret) {
    x = caret.x - W / 2
    y = caret.y + caret.h + 8
  } else {
    x = dx + (dw - W) / 2
    y = dy + dh - H - 96
  }

  // 夹到当前显示器工作区内
  x = Math.max(dx + 8, Math.min(x, dx + dw - W - 8))
  y = Math.max(dy + 8, Math.min(y, dy + dh - H - 8))

  win.setBounds({ x: Math.round(x), y: Math.round(y), width: W, height: H })
}

function safeCaret(): { x: number; y: number; w: number; h: number } | null {
  try { return getCaretScreenRect() } catch { return null }
}
