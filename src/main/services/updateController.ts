import type { UpdateStatus } from '../../shared/ipc'

export interface UpdateBackend {
  check(): Promise<string | null>
  download(onProgress: (percent: number) => void): Promise<void>
  install(restart: boolean): Promise<void>
}

/** 自动更新在后台下载，退出时安装；手动更新可立即重启。 */
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

  constructor(version: string, packaged: boolean, backend: UpdateBackend, onStatus: (s: UpdateStatus) => void) {
    this.status = { state: packaged ? 'idle' : 'dev', version }
    this.backend = backend
    this.packaged = packaged
    this.onStatus = onStatus
  }

  get current(): UpdateStatus { return this.status }

  get installOnQuit(): boolean {
    return this.auto && this.downloaded && !this.installing && this.status.state === 'ready'
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, message: undefined, ...patch }
    this.onStatus(this.status)
  }

  start(auto: boolean): void {
    this.stop()
    this.auto = auto
    if (!this.packaged || !auto) return
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
    if (!this.packaged || this.installing || this.downloading || this.downloaded) return Promise.resolve(this.status)
    this.set({ state: 'checking', percent: undefined })
    this.checking = (async () => {
      try {
        const latest = await this.backend.check()
        this.set({ state: latest ? 'available' : 'latest', latest: latest ?? undefined })
        if (latest && this.auto) await this.download()
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
    if (!this.packaged) return Promise.resolve()
    if (this.installing) return this.installing
    this.installing = Promise.resolve().then(async () => {
      if (this.checking) await this.checking
      if (!this.status.latest) return
      try {
        await this.download()
        this.set({ state: 'installing' })
        await this.backend.install(restart)
      } catch (e) {
        this.set({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    }).finally(() => { this.installing = null })
    return this.installing
  }
}
