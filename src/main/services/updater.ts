/**
 * 自动更新。
 *
 * 只对**安装版**生效。便携版（zip 解压出来的那份）不更新 ——
 * electron-updater 在 Windows 上靠重跑 NSIS 安装器完成升级，
 * 而便携版的位置是用户自己定的、数据就放在 exe 旁边，
 * 让安装器往那儿覆盖是在拿用户的数据目录冒险。
 * 便携版只在设置里告诉用户「有新版本了，去下载」，不自己动手。
 *
 * 安装版走 GitHub Releases：后台静默下载，下完了不打断用户，
 * 等下次退出应用时自动装上（autoInstallOnAppQuit）。
 * 语音输入是个随时可能被按热键叫起来的工具，
 * 弹一个「立即重启更新」的框把人从正在写的东西里拽出来是最糟的做法。
 */
import { app } from 'electron'
import type { AppUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/ipc'

/** 启动多久后查一次。别和模型加载抢带宽和 CPU。 */
const FIRST_CHECK_MS = 20_000
/** 之后多久查一次。 */
const INTERVAL_MS = 6 * 60 * 60 * 1000

export class UpdaterService {
  private status: UpdateStatus = { state: 'idle', version: app.getVersion() }
  private timer: NodeJS.Timeout | null = null
  private updater: AppUpdater | null = null
  private loading: Promise<AppUpdater | null> | null = null

  constructor(
    /** 便携版为 false —— 只查不装 */
    private canInstall: boolean,
    private onStatus: (s: UpdateStatus) => void
  ) {}

  /**
   * electron-updater 只在打包后才有意义，所以按需 import。
   *
   * 顶层 import 的话，开发时忘了 npm install 会直接把主进程打挂
   * （ERR_MODULE_NOT_FOUND，应用根本起不来）—— 一个「有没有新版本」
   * 的附属功能，不该有能力阻止应用启动。
   */
  private async load(): Promise<AppUpdater | null> {
    if (this.updater) return this.updater
    if (!app.isPackaged) return null
    if (this.loading) return this.loading

    this.loading = (async () => {
      try {
        const mod = await import('electron-updater')
        const au = (mod.default ?? mod).autoUpdater
        au.autoDownload = this.canInstall
        au.autoInstallOnAppQuit = this.canInstall
        au.logger = null

        au.on('checking-for-update', () => this.set({ state: 'checking' }))
        au.on('update-not-available', () => this.set({ state: 'latest' }))
        au.on('update-available', (i) =>
          this.set({ state: this.canInstall ? 'downloading' : 'available', latest: i.version }))
        au.on('download-progress', (p) =>
          this.set({ state: 'downloading', percent: Math.round(p.percent) }))
        au.on('update-downloaded', (i) =>
          this.set({ state: 'ready', latest: i.version }))
        au.on('error', (e) =>
          this.set({ state: 'error', message: e instanceof Error ? e.message : String(e) }))

        this.updater = au
        return au
      } catch (e) {
        this.set({
          state: 'error',
          message: `更新组件没能加载：${e instanceof Error ? e.message : String(e)}`
        })
        return null
      } finally {
        this.loading = null
      }
    })()
    return this.loading
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch, version: app.getVersion() }
    this.onStatus(this.status)
  }

  get current(): UpdateStatus {
    return this.status
  }

  /** 按配置开始定期检查。auto = false 时只保留手动检查。 */
  start(auto: boolean): void {
    this.stop()
    if (!app.isPackaged || !auto) return
    this.timer = setTimeout(() => {
      void this.check()
      this.timer = setInterval(() => void this.check(), INTERVAL_MS)
      this.timer.unref?.()
    }, FIRST_CHECK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) { clearTimeout(this.timer); clearInterval(this.timer); this.timer = null }
  }

  async check(): Promise<UpdateStatus> {
    if (!app.isPackaged) {
      this.set({ state: 'dev' })
      return this.status
    }
    try {
      const au = await this.load()
      if (!au) return this.status
      await au.checkForUpdates()
    } catch (e) {
      this.set({ state: 'error', message: e instanceof Error ? e.message : String(e) })
    }
    return this.status
  }

  /** 用户主动要求「现在就装」。只有安装版、且已经下完才有效。 */
  installNow(): void {
    if (!this.canInstall || this.status.state !== 'ready' || !this.updater) return
    this.updater.quitAndInstall(false, true)
  }
}
