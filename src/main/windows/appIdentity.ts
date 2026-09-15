import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'

/** 与 electron-builder.yml 的 appId 保持一致，确保任务栏按 Vocal 分组。 */
export const APP_ID = 'net.dtft.vocal'

/** ICO 包含多个尺寸，同时用于窗口、Alt+Tab 和任务栏。 */
export function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(app.getAppPath(), 'build', 'icon.ico')
}

export function setWindowAppDetails(win: BrowserWindow): void {
  win.setAppDetails({
    appId: APP_ID,
    appIconPath: appIconPath(),
    appIconIndex: 0,
    relaunchDisplayName: 'Vocal',
    relaunchCommand: app.isPackaged
      ? `"${process.execPath}"`
      : `"${process.execPath}" "${app.getAppPath()}"`
  })
}
