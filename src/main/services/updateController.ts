import type { UpdateStatus } from '../../shared/ipc'

export interface UpdateBackend {
  check(): Promise<string | null>
  download(onProgress: (percent: number) => void): Promise<void>
  install(): Promise<void>
}

/** 检查只发通知；用户点击后才下载、安装。两个发行方式共用这个状态机。 */
export class UpdateController {
  private status: UpdateStatus
  private checking: Promise<UpdateStatus> | null = null
  private installing: Promise<void> | null = null
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

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, message: undefined, ...patch }
    this.onStatus(this.status)
  }

  start(auto: boolean): void {
    this.stop()
    if (!this.packaged || !auto) return
    void this.check()
    this.timer = setInterval(() => void this.check(), 6 * 60 * 60 * 1000)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  check(): Promise<UpdateStatus> {
    if (!this.packaged || this.installing || this.status.state === 'ready') return Promise.resolve(this.status)
    if (this.checking) return this.checking
    this.set({ state: 'checking', percent: undefined })
    this.checking = (async () => {
      try {
        const latest = await this.backend.check()
        this.set({ state: latest ? 'available' : 'latest', latest: latest ?? undefined })
      } catch (e) {
        this.set({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      }
      return this.status
    })().finally(() => { this.checking = null })
    return this.checking
  }

  installNow(): Promise<void> {
    if (!this.packaged) return Promise.resolve()
    if (this.installing) return this.installing
    this.installing = (async () => {
      if (this.checking) await this.checking
      if (!this.status.latest) return
      try {
        if (this.status.state !== 'ready') {
          this.set({ state: 'downloading', percent: 0 })
          await this.backend.download((percent) => this.set({ state: 'downloading', percent }))
          this.set({ state: 'ready', percent: 100 })
        }
        this.set({ state: 'installing' })
        await this.backend.install()
      } catch (e) {
        this.set({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    })().finally(() => { this.installing = null })
    return this.installing
  }
}
