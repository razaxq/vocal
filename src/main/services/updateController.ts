import type { UpdateStatus } from '../../shared/ipc'

export interface UpdateBackend {
  check(): Promise<string | null>
  download(onProgress: (percent: number) => void): Promise<void>
  install(restart: boolean): Promise<void>
}

/** 自动检查始终开启；自动更新开关只控制下载和安装。 */
export class UpdateController {
  private status: UpdateStatus
  private checking: Promise<UpdateStatus> | null = null
  private installing: Promise<void> | null = null
  private downloading: Promise<void> | null = null
  private downloaded = false
  private auto = false
  private timer: ReturnType<typeof setInterval> | null = null
  private backend: UpdateBackend
  private packaged: boolean
  private onStatus: (s: UpdateStatus) => void
  private canInstall: () => boolean

  constructor(version: string, packaged: boolean, backend: UpdateBackend, onStatus: (s: UpdateStatus) => void,
    canInstall: () => boolean = () => true) {
    this.status = { state: packaged ? 'idle' : 'dev', version }
    this.backend = backend
    this.packaged = packaged
    this.onStatus = onStatus
    this.canInstall = canInstall
  }

  get current(): UpdateStatus { return this.status }

  resumeAutoUpdate(): Promise<void> {
    if (!this.auto || this.status.state !== 'ready' || !this.canInstall()) return Promise.resolve()
    if (this.installing) return this.installing.then(() => this.resumeAutoUpdate())
    return this.install(true, true)
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, message: undefined, ...patch }
    this.onStatus(this.status)
  }

  start(auto: boolean): void {
    this.stop()
    this.auto = auto
    if (!this.packaged) return
    void this.check()
    this.timer = setInterval(() => void this.check(), 6 * 60 * 60 * 1000)
    this.timer.unref?.()
  }

  stop(): void {
    this.auto = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  check(): Promise<UpdateStatus> {
    if (this.checking) return this.checking
    if (!this.packaged || this.installing || this.downloading || this.status.state === 'installing') return Promise.resolve(this.status)
    if (this.downloaded) return this.resumeAutoUpdate().then(() => this.status)
    this.set({ state: 'checking', percent: undefined })
    this.checking = (async () => {
      try {
        const latest = await this.backend.check()
        this.set({ state: latest ? 'available' : 'latest', latest: latest ?? undefined })
        if (latest && this.auto) await this.install(true, true)
      } catch (e) {
        this.set({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      }
      return this.status
    })().finally(() => { this.checking = null })
    return this.checking
  }

  private download(): Promise<void> {
    if (this.downloaded) return Promise.resolve()
    if (this.downloading) return this.downloading
    this.set({ state: 'downloading', percent: 0 })
    this.downloading = Promise.resolve().then(async () => {
      await this.backend.download((percent) => this.set({ state: 'downloading', percent }))
      this.downloaded = true
      this.set({ state: 'ready', percent: 100 })
    }).finally(() => { this.downloading = null })
    return this.downloading
  }

  installNow(restart = true): Promise<void> {
    return this.install(restart, false)
  }

  private install(restart: boolean, automatic: boolean): Promise<void> {
    if (!this.packaged || this.status.state === 'installing') return Promise.resolve()
    // A manual install may already be waiting for this check; do not await it from the check itself.
    if (this.installing) return automatic ? Promise.resolve() : this.installing
    this.installing = Promise.resolve().then(async () => {
      if (!automatic && this.checking) await this.checking
      if (!this.status.latest || (automatic && !this.auto)) return
      try {
        await this.download()
        if (automatic && (!this.auto || !this.canInstall())) return
        this.set({ state: 'installing' })
        await this.backend.install(restart)
      } catch (e) {
        this.set({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    }).finally(() => { this.installing = null })
    return this.installing
  }
}
