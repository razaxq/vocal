/** 设置 / 历史窗口。普通窗口，可以抢焦点。 */
import { BrowserWindow, app, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { appIconPath, setWindowAppDetails } from './appIdentity'

let win: BrowserWindow | null = null

/**
 * 打开设置窗口。tab 指定初始页签 —— 首次启动没模型时直接开到「模型」页，
 * 比弹一个「缺模型，请去跑命令」的对话框有用得多。
 */
export function openSettingsWindow(tab?: string): BrowserWindow {
  if (win && !win.isDestroyed()) {
    win.show(); win.focus()
    if (tab) win.webContents.send('ui:goto-tab', tab)
    return win
  }

  win = new BrowserWindow({
    width: 880,
    height: 640,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'Vocal 设置',
    icon: appIconPath(),
    autoHideMenuBar: true,
    // 系统标题栏和自定义配色对不上，高度也不搭。自己画一条（见 ui.tsx 的 TitleBar）
    frame: false,
    // 不设的话 Electron 默认白底，深色模式下开窗会先闪一下白
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#242528' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  setWindowAppDetails(win)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'https://blog.dtft.net/about/' || url === 'https://github.com/iDvel/rime-ice') {
      void shell.openExternal(url).catch((e) => console.error('打开开发者主页失败', e))
    }
    return { action: 'deny' }
  })

  win.on('ready-to-show', () => {
    win?.show()
    if (tab) win?.webContents.send('ui:goto-tab', tab)
  })
  win.on('closed', () => { win = null })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings/index.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/settings/index.html'))
  }

  return win
}
