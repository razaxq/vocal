/**
 * 会话编排器 —— 把热键、音频、ASR、清洗、整理、注入串成一条线。
 *
 * 连续听写的形状（这是 v2 的核心改动）：
 *
 *   按下热键
 *     → 记住当前前台窗口（此刻还没弹面板，焦点还在目标应用）
 *     → 显示悬浮面板（showInactive，不抢焦点）
 *     → 开麦，音频同时进主进程缓冲和流式进程
 *
 *   说话中，每检测到一次句子边界：
 *     → 主进程从缓冲切出这一段，丢给定稿进程（并行，不打断流式）
 *     → 定稿回来 = SenseVoice 重转写 + 标点 + 规则清洗
 *     → 立刻追加上屏
 *   所以长输入是「每隔几秒出一批字」，而不是憋到最后一次性吐出来。
 *
 *   松开热键
 *     → 等最后一段定稿
 *     → 够长且开了整理：LLM 把全文改写成书面语，退格替换已上屏内容
 *     → 写历史，隐藏面板
 */
import { randomUUID } from 'node:crypto'
import type {
  SessionState, InjectionTarget, Transcript, Segment
} from '@shared/types'
import type { AppConfig, PanelPartial } from '@shared/ipc'
import type { AsrEngine } from './asr/engine'
import type { TextInjector } from './injector'
import { TargetBuffer } from './injector/targetBuffer.ts'
import { SegmentPreview } from '../../shared/segmentPreview.ts'
import type { LlmService } from './llm'
import type { HistoryService } from './history'

export interface SessionHooks {
  onState: (s: SessionState) => void
  onPartial: (p: PanelPartial) => void
  onSegment: (s: Segment) => void
  onTranscript: (t: Transcript) => void
  onToast: (level: 'info' | 'warn' | 'error', text: string) => void
  /** 让渲染进程开/关麦克风 */
  setCapture: (on: boolean) => void
  showPanel: (target: InjectionTarget) => void
  hidePanel: () => void
}

export class SessionController {
  private state: SessionState = 'idle'
  private id: string | null = null
  private target: InjectionTarget | undefined
  private buffer: TargetBuffer | null = null
  private cancelled = false
  private startedAt = 0

  private segments: Segment[] = []
  /** 各段定稿文本拼接，等于「屏幕上应该有的内容」 */
  private committed = ''
  /** 当前段的流式文本 */
  private preview = new SegmentPreview()
  private segmentQueue: Promise<void> = Promise.resolve()
  private get live(): string { return this.preview.live }
  /** rolling 整理：还没被整理过的那部分在 committed 里的起点 */
  private rollingFrom = 0

  private asr: AsrEngine
  private injector: TextInjector
  private llm: LlmService
  private history: HistoryService
  private getConfig: () => AppConfig
  private hooks: SessionHooks
  constructor(asr: AsrEngine, injector: TextInjector, llm: LlmService, history: HistoryService,
    getConfig: () => AppConfig, hooks: SessionHooks) {
    this.asr = asr; this.injector = injector; this.llm = llm; this.history = history
    this.getConfig = getConfig; this.hooks = hooks
  }

  get current(): SessionState { return this.state }

  private setState(s: SessionState): void {
    this.state = s
    this.hooks.onState(s)
  }

  private emitPanel(): void {
    this.hooks.onPartial({ committed: this.committed, live: this.live })
  }

  /* ---------------- 生命周期 ---------------- */

  start(): void {
    if (this.state !== 'idle' && this.state !== 'error') return

    const cfg = this.getConfig()

    // 必须在弹面板之前抓焦点窗口
    this.target = this.injector.captureTarget()
    this.id = randomUUID()
    this.cancelled = false
    this.startedAt = Date.now()
    this.segments = []
    this.committed = ''
    this.preview.reset()
    this.segmentQueue = Promise.resolve()
    this.rollingFrom = 0

    this.buffer = new TargetBuffer(this.injector, this.target, {
      maxBackspaces: cfg.consolidation.maxReplaceChars
    })

    this.setState('arming')
    this.hooks.showPanel(this.target)
    this.emitPanel()

    // 模型可能因为空闲被卸载了，这里要等它回来再开麦 ——
    // 否则前一两秒的音频喂给了一个还没初始化的进程，等于白说。
    // 常驻的情况下 ensureReady() 立即 resolve，这条路径感觉不到。
    const id = this.id
    void this.asr.ensureReady().then(() => {
      if (this.id !== id) return                    // 已经是下一次会话了
      if (this.state !== 'arming') {
        // 用户在加载期间就松手或取消了：这次会话作废，别卡在 finalizing
        this.asr.abortSession()
        this.reset()
        return
      }
      this.asr.startSession(id)
      this.hooks.setCapture(true)
      this.setState('listening')
      this.emitPanel()
    }).catch((e: unknown) => {
      this.hooks.onToast('error', `识别引擎没能启动：${e instanceof Error ? e.message : String(e)}`)
      this.reset()
    })
  }

  stop(): void {
    if (this.state !== 'listening' && this.state !== 'arming') return
    this.hooks.setCapture(false)
    // 还在 arming 说明模型没加载完，这次会话根本没开始 —— 直接收掉，
    // 否则 stopSession() 什么都不会发生，状态会卡死在 finalizing
    if (this.state === 'arming') {
      this.asr.abortSession()
      this.reset()
      return
    }
    this.setState('finalizing')
    this.asr.stopSession()
  }

  async cancel(): Promise<void> {
    if (this.state === 'idle') return
    this.cancelled = true
    this.hooks.setCapture(false)
    this.asr.abortSession()

    if (this.buffer && this.buffer.length > 0) {
      const ok = await this.buffer.rollback()
      if (!ok) this.hooks.onToast('warn', '已取消，但屏幕上的文字没能撤回（焦点已经变了）')
      else this.hooks.onToast('info', '已取消')
    } else {
      this.hooks.onToast('info', '已取消')
    }
    this.reset()
  }

  pushAudio(samples: Float32Array): void {
    if (this.state !== 'listening' || !this.id) return
    this.asr.pushAudio(samples)
  }

  /* ---------------- ASR 回调 ---------------- */

  onPartial(segment: number, text: string): void {
    if (this.cancelled || !this.id) return
    this.preview.partial(segment, text)
    this.emitPanel()

    if (this.getConfig().streaming.injectMode === 'live') {
      void this.buffer?.set(this.committed + this.live)
    }
  }

  onSegment(index: number, text: string, meta: {
    cleanedChars: number; latencyMs: number; fellBack: boolean
  }): Promise<void> {
    const id = this.id
    const run = this.segmentQueue.then(async () => {
      if (!id || this.id !== id || this.cancelled) return
      await this.commitSegment(index, text, meta, id)
    })
    this.segmentQueue = run.catch(() => {
      if (this.id === id) this.hooks.onToast('warn', '文字写入失败，请查看历史记录')
    })
    return this.segmentQueue
  }

  private async commitSegment(index: number, text: string, meta: {
    cleanedChars: number; latencyMs: number; fellBack: boolean
  }, id: string): Promise<void> {
    const streamText = this.preview.finish(index)
    if (!text.trim()) { this.emitPanel(); return }

    const seg: Segment = {
      index,
      streamText,
      finalText: text,
      cleanedChars: meta.cleanedChars,
      latencyMs: meta.latencyMs,
      injected: false
    }

    // 段与段之间不额外加空格：中文不需要，英文由标点模型收尾
    this.committed = this.committed ? `${this.committed}${text}` : text
    this.emitPanel()

    const next = this.committed + (this.getConfig().streaming.injectMode === 'live' ? this.live : '')
    const ok = await this.buffer?.set(next)
    if (this.id !== id || this.cancelled) return
    seg.injected = ok === true
    if (ok === false) {
      this.hooks.onToast('warn', '这一段没能写进目标窗口，文本留在面板里')
    }

    this.segments.push(seg)
    this.hooks.onSegment(seg)
    this.emitPanel()

    await this.maybeRollingConsolidate()
  }

  async onSessionComplete(sessionId: string): Promise<void> {
    await this.segmentQueue
    if (this.id !== sessionId || this.cancelled) return

    if (!this.committed.trim()) {
      this.hooks.onToast('info', '没有识别到内容')
      this.reset()
      return
    }

    await this.consolidateAll()
    if (this.id !== sessionId || this.cancelled) return

    const t: Transcript = {
      id: this.id ?? randomUUID(),
      createdAt: this.startedAt,
      raw: this.segments.map((s) => s.streamText).join(''),
      polished: this.segments.map((s) => s.finalText ?? '').join(''),
      final: this.committed,
      durationMs: Date.now() - this.startedAt,
      segmentCount: this.segments.length,
      target: this.target
    }
    try { this.history.insert(t) } catch { /* 历史写失败不影响主流程 */ }
    this.hooks.onTranscript(t)

    this.reset()
  }

  onError(message: string, fatal: boolean): void {
    this.hooks.onToast(fatal ? 'error' : 'warn', message)
    if (fatal) { this.setState('error'); this.hooks.hidePanel() }
  }

  /* ---------------- LLM 整理 ---------------- */

  /**
   * rolling 模式：每积累够一个段落就整理一次，只替换那一块。
   * 好处是长输入过程中屏幕上的文字就在逐步变书面，不用等到最后；
   * 代价是每次替换都要退格，所以块不能太大。
   */
  private async maybeRollingConsolidate(): Promise<void> {
    const cfg = this.getConfig().consolidation
    if (cfg.mode !== 'rolling' || !this.llm.enabled) return

    const block = this.committed.slice(this.rollingFrom)
    if (block.length < cfg.rollingChars) return

    const head = this.committed.slice(0, this.rollingFrom)
    const tidied = await this.llm.consolidate(block, { context: head.slice(-400) })
    if (tidied === block) { this.rollingFrom = this.committed.length; return }

    const next = head + tidied
    const ok = await this.buffer?.set(next)
    if (ok) {
      this.committed = next
      this.rollingFrom = next.length
    } else {
      // 替换失败就把这块标记为已处理，不要反复重试
      this.rollingFrom = this.committed.length
    }
  }

  /** onFinish 模式：会话结束后整体整理一次。 */
  private async consolidateAll(): Promise<void> {
    const cfg = this.getConfig().consolidation
    if (cfg.mode === 'off' || !this.llm.enabled) return
    if (this.committed.length < cfg.minChars) return
    // rolling 模式下前面的块已经整理过了，只收尾剩下那点
    if (cfg.mode === 'rolling' && this.committed.length - this.rollingFrom < cfg.minChars) return

    this.setState('consolidating')

    const from = cfg.mode === 'rolling' ? this.rollingFrom : 0
    const head = this.committed.slice(0, from)
    const block = this.committed.slice(from)

    const tidied = await this.llm.consolidate(block, { context: head.slice(-400) })
    if (tidied === block) return

    const next = head + tidied
    this.setState('injecting')

    const ok = await this.buffer?.set(next)
    if (ok) {
      this.committed = next
    } else {
      // 没能替换：不是错误，只是用户动了光标或文本太长。
      // 把整理结果留在面板和历史里，用户可以自己复制。
      this.committed = next
      this.hooks.onToast(
        'info',
        '整理完成，但没能替换已输入的文字（焦点已变或文本过长）。整理结果在历史里。'
      )
    }
  }

  /* ---------------- 收尾 ---------------- */

  private reset(): void {
    this.buffer?.detach()
    this.id = null
    this.target = undefined
    this.buffer = null
    this.cancelled = false
    this.segments = []
    this.committed = ''
    this.preview.reset()
    this.rollingFrom = 0
    this.setState('idle')
    this.hooks.hidePanel()
  }
}
