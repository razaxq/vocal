/**
 * 语音活动门限 —— 纯算术，不需要模型。
 *
 * 存在的理由是实测踩到的：SenseVoice 对纯静音会**幻觉**出内容。
 * M1 探针喂 5 秒静音，它吐出「我.」。真实场景里这意味着
 * 用户按住热键没说话就松开，屏幕上会凭空多一个字 ——
 * 语音输入工具最不能容忍的就是「我没说，它打了」。
 *
 * 所以在把音频交给 SenseVoice 之前先过这一道：没语音就直接丢，
 * 既堵住幻觉，也省掉一次没必要的解码。
 *
 * 为什么不用「整段 RMS 超过阈值」这种朴素做法：
 *   一段 10 秒里说了 1 秒话，整段 RMS 会被 9 秒静音稀释到阈值以下，误杀；
 *   一段静音里有一声咳嗽，整段 RMS 又会被拉高，误放。
 * 改成「按帧算，看有多少比例的帧是活跃的」，两种情况都能正确判断。
 *
 * 真正的 VAD（silero）留给二期做长录音的二级分段，这里不需要那么重。
 */

export interface VoiceActivityOptions {
  /** 单帧长度（采样点）。20ms @16k = 320 */
  frameSize: number
  /** 帧 RMS 超过这个值算「活跃帧」。说话通常 0.02~0.2，静音 < 0.001 */
  frameThreshold: number
  /** 活跃帧占比超过这个值才认为这段里有人说话 */
  minActiveRatio: number
  /** 短于这个长度的片段一律认为没语音（采样点）。0.2s @16k = 3200 */
  minSamples: number
}

export const DEFAULT_GATE: VoiceActivityOptions = {
  frameSize: 320,
  // 取得比典型静音底噪（~0.0005）高一个量级，又远低于轻声说话（~0.01），
  // 宁可放过也不误杀 —— 漏掉一个静音段只是多花 100ms，误杀一句话是丢字。
  frameThreshold: 0.005,
  minActiveRatio: 0.04,
  minSamples: 3200
}

export interface VoiceActivity {
  /** 整段 RMS，仅供调试展示 */
  rms: number
  /** 活跃帧占比 */
  activeRatio: number
  hasVoice: boolean
}

export function detectVoice(
  samples: Float32Array,
  opts: Partial<VoiceActivityOptions> = {}
): VoiceActivity {
  const o = { ...DEFAULT_GATE, ...opts }

  if (samples.length < o.minSamples) {
    return { rms: 0, activeRatio: 0, hasVoice: false }
  }

  let total = 0
  let frames = 0
  let active = 0

  for (let start = 0; start + o.frameSize <= samples.length; start += o.frameSize) {
    let sum = 0
    for (let i = start; i < start + o.frameSize; i++) {
      const v = samples[i] ?? 0
      sum += v * v
    }
    const frameRms = Math.sqrt(sum / o.frameSize)
    total += sum
    frames++
    if (frameRms > o.frameThreshold) active++
  }

  if (frames === 0) return { rms: 0, activeRatio: 0, hasVoice: false }

  const rms = Math.sqrt(total / (frames * o.frameSize))
  const activeRatio = active / frames

  return { rms, activeRatio, hasVoice: activeRatio >= o.minActiveRatio }
}

/**
 * 定稿结果的健全性检查。
 *
 * 两种回落情形：
 *  1. 定稿是空的 —— 直接用流式结果
 *  2. 定稿比流式短一半以上 —— 多半是截断了，宁可要没那么准的流式文本也别丢字
 *
 * 还有第三种，是 M1 探针逼出来的：流式什么都没出，定稿却冒出一两个字。
 * 这在正常情况下不可能 —— 流式模型和离线模型听的是同一段音频，
 * 流式全程没憋出一个字，离线却「听」到了内容，只能是幻觉。
 * 太短就丢掉，够长（说明确实有内容，只是流式没跟上）才信。
 */
export function isFinalSane(finalText: string, streamText: string): boolean {
  const f = finalText.trim()
  const s = streamText.trim()

  if (!f) return false

  if (!s) {
    // 去掉标点再数，「我。」这种只算 1 个字
    const bare = f.replace(/[\s，。！？；：、,.!?;:~〜…—-]/g, '')
    return bare.length > 2
  }

  return f.length >= s.length * 0.5
}
