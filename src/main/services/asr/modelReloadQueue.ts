import type { AppConfig, AsrStatus } from '../../../shared/ipc'

type Targets = Partial<AppConfig['models']>
interface Options {
  getConfig(): AppConfig
  blocked(): boolean
  check(config: AppConfig): { ready: boolean; missing: string[] }
  downloading(config: AppConfig): boolean
  load(config: AppConfig): Promise<void>
  publish(status: AsrStatus): void
}

/** One reload at a time; merge pending slots and read the latest configuration at execution. */
export class ModelReloadQueue {
  running = false
  pending = false
  private targets: Targets = {}
  private activeTargets: Targets = {}
  private options: Options

  constructor(options: Options) { this.options = options }

  request(targets: Targets): Promise<void> {
    this.targets = { ...this.targets, ...targets }
    this.pending = true
    return this.resume()
  }

  async resume(): Promise<void> {
    if (!this.pending) return
    const o = this.options
    if (this.running || o.blocked()) {
      o.publish({ state: 'loading', targets: { ...this.activeTargets, ...this.targets },
        message: this.running ? '正在切换模型' : '当前任务结束后切换' })
      return
    }
    this.running = true
    try {
      while (this.pending && !o.blocked()) {
        const cfg = o.getConfig()
        this.activeTargets = this.targets
        this.targets = {}
        this.pending = false
        const status = o.check(cfg)
        if (!status.ready) {
          if (o.downloading(cfg)) {
            this.targets = { ...this.activeTargets, ...this.targets }
            this.pending = true
            o.publish({ state: 'loading', targets: this.targets, message: '等待模型下载完成' })
            break
          }
          o.publish({ state: 'error', targets: this.activeTargets, message: `缺少：${status.missing.join('、')}` })
          continue
        }
        o.publish({ state: 'loading', targets: this.activeTargets })
        try {
          await o.load(cfg)
          if (!this.pending) o.publish({ state: 'ready', targets: this.activeTargets })
        } catch (e) {
          // A stale load error must not mark the newer selection as failed.
          if (!this.pending) o.publish({ state: 'error', targets: this.activeTargets,
            message: e instanceof Error ? e.message : String(e) })
        }
      }
    } finally {
      this.running = false
      this.activeTargets = {}
    }
  }
}
