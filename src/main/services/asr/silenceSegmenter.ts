/**
 * 静音切段器 —— `final-only` 档位专用。
 *
 * 那个档位不加载流式模型，所以没人告诉主进程「一句话说完了」。
 * 这里用帧级 RMS 自己判断：说过话之后连续静音超过阈值，就把这一段切出来
 * 交给定稿进程。语义和流式模型的 endpoint 检测一致，只是用能量代替声学模型。
 *
 * 之前这块是缺的 —— stream.ts 里留了句「靠主进程的静音检测切段」的注释，
 * 但主进程从没实现，导致 final-only 档位下一个字都出不来。
 */
// 用相对路径而不是 @shared 别名：这个文件有单元测试，
// 而 node --experimental-strip-types 不读 tsconfig 的 paths
import { detectVoice } from '../../../shared/audioGate.ts'

export interface SegmenterOptions {
  /** 说过话之后，连续静音多久算一段结束 */
  trailingSilenceMs: number
  /** 一段最短多长，防止把「嗯」这种单音切成一段 */
  minSegmentMs: number
  /** 一段最长多长，超了强制切 —— 有人能不喘气说两分钟 */
  maxSegmentMs: number
}

export const DEFAULT_SEGMENTER: SegmenterOptions = {
  // 比流式模型的 rule1（2.4s）短：能量判据比声学判据敏感，
  // 不需要那么长的确认窗口，切快一点上屏也快一点
  trailingSilenceMs: 900,
  minSegmentMs: 400,
  maxSegmentMs: 30_000
}

export interface SegmentCut {
  /** 本次会话截至此刻消费的采样点总数 —— 和流式进程的 endpoint 语义一致 */
  sampleIndex: number
}

export class SilenceSegmenter {
  private opts: SegmenterOptions
  private consumed = 0
  /** 当前段起点（采样点） */
  private segmentStart = 0
  private sawVoice = false
  private silenceMs = 0

  constructor(opts: Partial<SegmenterOptions> = {}) {
    this.opts = { ...DEFAULT_SEGMENTER, ...opts }
  }

  reset(): void {
    this.consumed = 0
    this.segmentStart = 0
    this.sawVoice = false
    this.silenceMs = 0
  }

  get totalSamples(): number {
    return this.consumed
  }

  /**
   * 喂一帧音频。返回非 null 表示这一帧结束时应该切一段。
   * 帧长通常是 100ms（AUDIO.frameSize）。
   */
  push(samples: Float32Array, sampleRate = 16000): SegmentCut | null {
    const frameMs = (samples.length / sampleRate) * 1000
    this.consumed += samples.length

    // 复用语音门限的帧级判据，阈值口径和定稿前那道保持一致
    const voice = detectVoice(samples, { minSamples: 0 })

    if (voice.hasVoice) {
      this.sawVoice = true
      this.silenceMs = 0
    } else if (this.sawVoice) {
      this.silenceMs += frameMs
    }

    const segmentMs = ((this.consumed - this.segmentStart) / sampleRate) * 1000

    // 超长强制切：即使还在说也得切，否则定稿进程要处理几分钟的音频
    if (this.sawVoice && segmentMs >= this.opts.maxSegmentMs) {
      return this.cut()
    }

    if (
      this.sawVoice &&
      this.silenceMs >= this.opts.trailingSilenceMs &&
      segmentMs >= this.opts.minSegmentMs
    ) {
      return this.cut()
    }

    return null
  }

  /** 会话结束：还有没交出去的语音就切最后一段，否则返回 null。 */
  flush(): SegmentCut | null {
    if (!this.sawVoice) return null
    return this.cut()
  }

  private cut(): SegmentCut {
    const cut = { sampleIndex: this.consumed }
    this.segmentStart = this.consumed
    this.sawVoice = false
    this.silenceMs = 0
    return cut
  }
}
