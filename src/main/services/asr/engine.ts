/**
 * ASR 引擎门面：管两个工作进程，对上层只暴露「实时文本」和「某段定稿了」。
 *
 * 进程布局：
 *   主进程            持有音频缓冲，按 endpoint 切段
 *     ├─ stream       OnlineRecognizer，只出实时文本和句子边界
 *     └─ finalize     OfflineRecognizer + 标点 + 规则清洗
 *
 * 两个工作进程完全并行，互不阻塞。定稿慢不会拖住实时显示。
 */
import { utilityProcess, app, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type {
  StreamCommand, StreamEvent, FinalizeCommand, FinalizeEvent,
  ModelPaths, AsrProfile, CleanupConfig
} from '@shared/types'
import { SessionAudioBuffer } from './audioBuffer'
import { SilenceSegmenter } from './silenceSegmenter'

export interface EngineEvents {
  /** 当前正在说的这段的实时文本 */
  onPartial: (segment: number, text: string) => void
  /** 某段定稿了，可以上屏 */
  onSegment: (segment: number, text: string, meta: {
    cleanedChars: number; latencyMs: number; fellBack: boolean
  }) => void
  /** 全部段落都已定稿，会话真正结束 */
  onSessionComplete: (sessionId: string) => void
  onError: (message: string, fatal: boolean) => void
}

/** 缓冲超过这么多采样点就回收一次已切走的部分（60s @16k）。 */
const COMPACT_EVERY = 16000 * 60

export class AsrEngine {
  private stream: UtilityProcess | null = null
  private finalize: UtilityProcess | null = null
  private ready: Promise<void> | null = null
  private restarts = 0
  /** dispose() 期间工作进程退出是预期行为，别触发崩溃重启 */
  private disposing = false
  private idleTimer: NodeJS.Timeout | null = null

  private audio = new SessionAudioBuffer()
  /**
   * final-only 档位没有流式模型来报 endpoint，主进程得自己按静音切段。
   * 其余档位由流式进程负责，这里是 null。
   */
  private segmenter: SilenceSegmenter | null = null
  private localSegment = 0
  private sessionId: string | null = null
  private stopped = false
  /** 已派发去定稿但还没回来的段 */
  private outstanding = new Set<number>()
  private expectedSegments: number | null = null
  private lastCompactAt = 0

  constructor(
    private models: ModelPaths,
    private profile: AsrProfile,
    private hotwords: string[],
    private cleanup: CleanupConfig,
    private endpointSilenceMs: number,
    private idleUnloadMin: number,
    private events: EngineEvents
  ) {}

  private entry(name: string): string {
    // 打包后 getAppPath() 指向 app.asar，Electron 能透过 asar 读到这些文件
    return join(app.getAppPath(), 'out', 'main', `${name}.js`)
  }

  /** 启动两个进程并等模型加载完。应用启动时就预热，别等用户按热键。 */
  start(): Promise<void> {
    if (this.ready) return this.ready

    // 流式进程在 final-only 档位下根本不 fork —— 空跑一个 Node 进程也要几十 MB，
    // 而换档位走 reload() 本来就会重开进程，没必要留着占位。
    //
    // 定稿进程则始终要起来：即使不重转写，标点和规则清洗也在它里面。
    // streaming-only 只是不加载 SenseVoice（省 ~230MB），标点模型照常加载 ——
    // 流式模型一个标点都不带，省掉它输出就是一长串连字。
    const needStream = this.profile !== 'final-only'
    const finalizeMode = this.profile === 'streaming-only' ? 'punct-only' as const : 'full' as const

    this.ready = new Promise<void>((resolve, reject) => {
      let streamReady = !needStream
      let finalizeReady = false
      const maybeDone = (): void => {
        if (streamReady && finalizeReady) { this.restarts = 0; resolve() }
      }
      const timer = setTimeout(() => reject(new Error('ASR 进程启动超时（45s）')), 45_000)
      const clearIfDone = (): void => { if (streamReady && finalizeReady) clearTimeout(timer) }

      if (needStream) {
        const sp = utilityProcess.fork(this.entry('stream'), [], {
          serviceName: 'vocal-asr-stream', stdio: 'inherit'
        })
        this.stream = sp
        sp.on('message', (e: StreamEvent) => {
          if (e.type === 'ready') { streamReady = true; clearIfDone(); maybeDone(); return }
          this.onStreamEvent(e)
        })
        sp.on('exit', (code) => this.onExit('stream', code, reject))
        sp.postMessage({
          type: 'init',
          models: this.models,
          hotwords: this.hotwords,
          enabled: true,
          endpointSilenceMs: this.endpointSilenceMs
        } satisfies StreamCommand)
      }

      {
        const fp = utilityProcess.fork(this.entry('finalize'), [], {
          serviceName: 'vocal-asr-finalize', stdio: 'inherit'
        })
        this.finalize = fp
        fp.on('message', (e: FinalizeEvent) => {
          if (e.type === 'ready') { finalizeReady = true; clearIfDone(); maybeDone(); return }
          this.onFinalizeEvent(e)
        })
        fp.on('exit', (code) => this.onExit('finalize', code, reject))
        fp.postMessage({
          type: 'init', models: this.models, cleanup: this.cleanup, mode: finalizeMode
        } satisfies FinalizeCommand)
      }

      if (streamReady && finalizeReady) { clearTimeout(timer); resolve() }
    })

    return this.ready
  }

  private onExit(which: string, code: number | undefined, reject: (e: Error) => void): void {
    if (this.disposing) return
    this.ready = null
    if (code === 0) return
    if (this.restarts < 3) {
      this.restarts++
      this.events.onError(`ASR ${which} 进程异常退出（code ${code}），正在重启`, false)
      void this.start()
    } else {
      const err = new Error(`ASR ${which} 进程反复崩溃，已停止重试`)
      this.events.onError(err.message, true)
      reject(err)
    }
  }

  /* ---------------- 会话 ---------------- */

  /**
   * 确保模型已加载。空闲卸载之后第一次说话会走到这里，
   * 多等的一两秒由面板的「准备中」状态兜着。
   */
  async ensureReady(): Promise<void> {
    this.cancelIdleTimer()
    await this.start()
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null }
  }

  /**
   * 空闲够久就把两个工作进程放掉，几百 MB 立刻还给系统。
   *
   * 常驻是为了「按下热键立刻能说」，但一个后台挂一整天的工具，
   * 为了那几次输入白占几百 MB，对大多数人换不回来。
   * 下次按热键重新 fork，代价是一两秒。
   */
  private scheduleIdleUnload(): void {
    this.cancelIdleTimer()
    if (this.idleUnloadMin <= 0 || !this.ready) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.sessionId) return          // 又开始说了，算了
      void this.dispose()
    }, this.idleUnloadMin * 60_000)
    this.idleTimer.unref?.()
  }

  startSession(sessionId: string): void {
    this.cancelIdleTimer()
    this.sessionId = sessionId
    this.stopped = false
    this.audio.reset()
    this.outstanding.clear()
    this.expectedSegments = null
    this.lastCompactAt = 0

    if (this.profile === 'final-only') {
      // 能量判据比声学判据敏感，不需要那么长的确认窗口，
      // 但口径要跟着用户设的断句阈值走，否则两个档位的手感对不上
      this.segmenter = new SilenceSegmenter({
        trailingSilenceMs: Math.max(400, this.endpointSilenceMs - 300)
      })
      this.localSegment = 0
    } else {
      this.segmenter = null
    }

    this.stream?.postMessage({ type: 'session:start', sessionId } satisfies StreamCommand)
  }

  pushAudio(samples: Float32Array): void {
    if (!this.sessionId || this.stopped) return
    this.audio.push(samples)

    if (this.segmenter) {
      // final-only：主进程自己切段，不经过流式进程
      const cut = this.segmenter.push(samples)
      if (cut) this.dispatchLocalSegment(cut.sampleIndex)
    } else {
      this.stream?.postMessage({
        type: 'audio', sessionId: this.sessionId, samples
      } satisfies StreamCommand)
    }

    if (this.audio.length - this.lastCompactAt > COMPACT_EVERY) {
      this.audio.compact()
      this.lastCompactAt = this.audio.length
    }
  }

  /** final-only 档位下把切出来的一段交给定稿进程。没有流式文本可兜底。 */
  private dispatchLocalSegment(sampleIndex: number): void {
    if (!this.sessionId) return
    const samples = this.audio.cutTo(sampleIndex)
    if (samples.length === 0) return

    const segment = this.localSegment++
    this.outstanding.add(segment)
    this.finalize?.postMessage({
      type: 'finalize',
      sessionId: this.sessionId,
      segment,
      samples,
      streamText: ''
    } satisfies FinalizeCommand)
  }

  stopSession(): void {
    if (!this.sessionId || this.stopped) return
    this.stopped = true

    if (this.segmenter) {
      const cut = this.segmenter.flush()
      if (cut) this.dispatchLocalSegment(cut.sampleIndex)
      this.expectedSegments = this.localSegment
      this.checkComplete()
      return
    }

    this.stream?.postMessage({
      type: 'session:stop', sessionId: this.sessionId
    } satisfies StreamCommand)
  }

  /** 放弃当前会话，不再派发定稿。 */
  abortSession(): void {
    this.stopped = true
    this.sessionId = null
    this.outstanding.clear()
    this.expectedSegments = null
    this.segmenter = null
    this.audio.reset()
  }

  updateHotwords(hotwords: string[]): void {
    this.hotwords = hotwords
    this.stream?.postMessage({ type: 'hotwords:update', hotwords } satisfies StreamCommand)
  }

  updateCleanup(cleanup: CleanupConfig): void {
    this.cleanup = cleanup
    this.finalize?.postMessage({ type: 'cleanup:update', cleanup } satisfies FinalizeCommand)
  }

  /**
   * 换模型 / 改断句阈值后重新加载，不用重启整个应用。
   *
   * sherpa 的 recognizer 在构造时就把模型读进去了，改不了，所以只能把
   * 两个工作进程换掉。它们是 utilityProcess，杀掉重开只有加载模型那一两秒，
   * 主进程、热键、托盘、悬浮面板全都不受影响 —— 这是当初把 ASR
   * 拆进独立进程换来的好处，现在正好用上。
   *
   * 调用方负责确保当前没有会话在跑（见 main/index.ts）。
   */
  async reload(
    models: ModelPaths,
    profile: AsrProfile,
    endpointSilenceMs: number,
    idleUnloadMin: number
  ): Promise<void> {
    this.models = models
    this.profile = profile
    this.endpointSilenceMs = endpointSilenceMs
    this.idleUnloadMin = idleUnloadMin
    this.abortSession()
    await this.dispose()
    this.restarts = 0
    await this.start()
  }

  /* ---------------- 事件 ---------------- */

  private onStreamEvent(e: StreamEvent): void {
    switch (e.type) {
      case 'partial':
        if (e.sessionId !== this.sessionId) return
        this.events.onPartial(e.segment, e.text)
        break

      case 'endpoint': {
        if (e.sessionId !== this.sessionId) return
        const samples = this.audio.cutTo(e.sampleIndex)

        if (this.profile === 'streaming-only') {
          // 不重转写，但标点和清洗照做 —— 交给定稿进程的 punct-only 模式。
          // 这里曾经是「流式文本直接当定稿」，结果是用户下载并启用了标点模型，
          // 说出来的话却一个标点都没有。
          this.outstanding.add(e.segment)
          this.finalize?.postMessage({
            type: 'punctuate', sessionId: e.sessionId, segment: e.segment, text: e.text
          } satisfies FinalizeCommand)
          return
        }

        this.outstanding.add(e.segment)
        this.finalize?.postMessage({
          type: 'finalize',
          sessionId: e.sessionId,
          segment: e.segment,
          samples,
          streamText: e.text
        } satisfies FinalizeCommand)
        break
      }

      case 'session:ended':
        if (e.sessionId !== this.sessionId) return
        this.expectedSegments = e.segments
        this.checkComplete()
        break

      case 'error':
        this.events.onError(e.message, e.fatal)
        break
    }
  }

  private onFinalizeEvent(e: FinalizeEvent): void {
    switch (e.type) {
      case 'finalized':
        if (e.sessionId !== this.sessionId) return
        this.outstanding.delete(e.segment)
        this.events.onSegment(e.segment, e.text, {
          cleanedChars: e.cleanedChars,
          latencyMs: e.latencyMs,
          fellBack: e.fellBack
        })
        this.checkComplete()
        break

      case 'error':
        this.events.onError(e.message, e.fatal)
        break
    }
  }

  private checkComplete(): void {
    if (this.expectedSegments === null || this.outstanding.size > 0) return
    const id = this.sessionId
    this.sessionId = null
    this.expectedSegments = null
    this.audio.reset()
    this.scheduleIdleUnload()
    if (id) this.events.onSessionComplete(id)
  }

  /** 只改空闲时长，不用重开进程。 */
  setIdleUnloadMin(min: number): void {
    this.idleUnloadMin = min
    if (!this.sessionId) this.scheduleIdleUnload()
  }

  async dispose(): Promise<void> {
    this.disposing = true
    this.cancelIdleTimer()
    this.stream?.postMessage({ type: 'shutdown' } satisfies StreamCommand)
    this.finalize?.postMessage({ type: 'shutdown' } satisfies FinalizeCommand)
    await new Promise((r) => setTimeout(r, 200))
    this.stream?.kill()
    this.finalize?.kill()
    this.stream = null
    this.finalize = null
    this.ready = null
    this.disposing = false
  }
}
