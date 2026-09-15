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
import { getCaretScreenRect, getForegroundWindowRect } from '@main/win32/user32'

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

/**
 * 从 show() 到把窗口不透明度还原之间留的两帧。
 *
 * 为什么需要：窗口在 hide 状态下合成器不会推新帧，show() 的那一刻
 * DWM 会先把交换链里**上一次留下的那一帧**present 出来，然后才轮到
 * 新内容。用户看到的就是「刚按下热键，面板先闪一下旧画面」。
 * CSS 动画救不了它 —— 那一帧根本没经过渲染进程。
 *
 * 所以改成：先把窗口整体不透明度压到 0 再 show（那帧旧画面照样被 present，
 * 但它是透明的，看不见），两帧之后再还原，此时 CSS 的进场动画已经在跑了。
 * 窗口级不透明度由 DWM 处理，和渲染进程画到哪一步无关，这是它可靠的原因。
 */
export const REVEAL_MS = 32

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
    // 透明窗口不写这个的话，Windows 下第一帧有机会是白的。
    // 全 0 的 alpha 才是「真的什么都不画」。
    backgroundColor: '#00000000',
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
      contextIsolation: true,
      // 这个渲染进程一直持有麦克风、还要跑进出动画，
      // 让 Chromium 因为「窗口不可见」去降频它没有好处
      backgroundThrottling: false
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
 * 把面板放到文字光标附近。
 *
 * 「拿得到光标」靠的是 Win32 的 caret —— 一个应用得真的调用 CreateCaret
 * 才有。记事本、Office、Win32 原生输入框有；Chrome、Electron 应用
 * （VS Code、各种 IM）、UWP、终端都是自己画光标，系统层面查不到。
 * 所以**在多数现代应用里拿不到是正常的，不是坏了**。
 *
 * 三级回落：文字光标 → 当前窗口底部居中 → 屏幕底部居中。
 * 跑 `npm run m0:caret` 可以看当前这个应用到底属于哪一类。
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
    // 拿不到光标就退到「当前窗口」底部居中，而不是「整块屏幕」底部居中。
    // 多显示器、或者窗口只占屏幕一角的时候，后者会把面板甩到另一块屏幕
    // 或者半个屏幕之外 —— 用户的视线根本不在那儿。
    const win32 = safeWindowRect()
    if (win32) {
      x = win32.x + (win32.w - W) / 2
      y = win32.y + win32.h - H - 48
    } else {
      x = dx + (dw - W) / 2
      y = dy + dh - H - 96
    }
  }

  // 夹到当前显示器工作区内
  x = Math.max(dx + 8, Math.min(x, dx + dw - W - 8))
  y = Math.max(dy + 8, Math.min(y, dy + dh - H - 8))

  win.setBounds({ x: Math.round(x), y: Math.round(y), width: W, height: H })
}

function safeCaret(): { x: number; y: number; w: number; h: number } | null {
  try { return getCaretScreenRect() } catch { return null }
}

function safeWindowRect(): { x: number; y: number; w: number; h: number } | null {
  try { return getForegroundWindowRect() } catch { return null }
}
