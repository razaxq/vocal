/** 始终自动检查；启用自动更新后下载并重启安装。 */
import { app } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { gt } from 'semver'
import type { UpdateStatus } from '@shared/ipc'
import { UpdateController, type UpdateBackend } from './updateController'
import { PortableUpdater } from './portableUpdater'

export class UpdaterService extends UpdateController {
  constructor(installed: boolean, onStatus: (s: UpdateStatus) => void, beforeInstall: () => void,
    canInstall: () => boolean = () => true) {
    const backend = installed ? installedBackend(beforeInstall) : new PortableUpdater(beforeInstall)
    super(app.getVersion(), app.isPackaged, backend, onStatus, canInstall)
    app.on('before-quit', () => this.stop())
  }
}

function installedBackend(beforeInstall: () => void): UpdateBackend {
  let loading: Promise<AppUpdater> | null = null
  const load = (): Promise<AppUpdater> => {
    loading ??= import('electron-updater').then((mod) => {
      const au = (mod.default ?? mod).autoUpdater
      au.autoDownload = false
      au.autoInstallOnAppQuit = false
      au.logger = null
      au.on('error', () => {})
      return au
    }).catch((e) => { loading = null; throw e })
    return loading
  }
  return {
    async check() {
      const result = await (await load()).checkForUpdates()
      const version = result?.updateInfo.version
      return version && gt(version, app.getVersion()) ? version : null
    },
    async download(onProgress) {
      const au = await load()
      const progress = (p: { percent: number }): void => onProgress(Math.round(p.percent))
      au.on('download-progress', progress)
      try { await au.downloadUpdate() } finally { au.off('download-progress', progress) }
    },
    async install(restart) {
      const au = await load()
      if (restart) beforeInstall()
      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => { au.off('error', failed); app.off('before-quit', exiting) }
        const failed = (error: Error): void => { cleanup(); reject(error) }
        const exiting = (): void => { cleanup(); resolve() }
        au.once('error', failed)
        app.once('before-quit', exiting)
        try { au.quitAndInstall(true, restart) } catch (e) { cleanup(); reject(e) }
      })
    }
  }
}
