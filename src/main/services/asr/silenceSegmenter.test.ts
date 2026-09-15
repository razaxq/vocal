/**
 * 静音切段器的回归测试。
 *   npm run test:segmenter
 *
 * 这块修的是「final-only 档位一个字都出不来」——
 * 之前主进程根本没切段，音频从没送到定稿进程。
 * 所以测试的核心是：说完一句必须切、没说话不能切、超长必须强制切。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SilenceSegmenter } from './silenceSegmenter.ts'

const SR = 16000
const FRAME = 1600 // 100ms

function silentFrame(): Float32Array {
  const a = new Float32Array(FRAME)
  for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * 0.0003
  return a
}

function voiceFrame(amp = 0.08): Float32Array {
  const a = new Float32Array(FRAME)
  for (let i = 0; i < a.length; i++) a[i] = Math.sin((2 * Math.PI * 220 * i) / SR) * amp
  return a
}

/** 喂 n 帧，返回这期间发生的所有切点。 */
function feed(seg: SilenceSegmenter, frames: Float32Array[]): number[] {
  const cuts: number[] = []
  for (const f of frames) {
    const c = seg.push(f)
    if (c) cuts.push(c.sampleIndex)
  }
  return cuts
}

const rep = (f: () => Float32Array, n: number): Float32Array[] =>
  Array.from({ length: n }, f)

test('纯静音不切段', () => {
  const seg = new SilenceSegmenter()
  assert.deepEqual(feed(seg, rep(silentFrame, 50)), [])
  assert.equal(seg.flush(), null)
})

test('说一句 + 静音 → 切一段', () => {
  const seg = new SilenceSegmenter()
  // 2 秒语音
  const cutsDuringVoice = feed(seg, rep(voiceFrame, 20))
  assert.deepEqual(cutsDuringVoice, [], '说话过程中不该切')

  // 1.2 秒静音（超过 900ms 阈值）
  const cuts = feed(seg, rep(silentFrame, 12))
  assert.equal(cuts.length, 1, `期望切 1 段，实际 ${cuts.length}`)
})

test('说两句 → 切两段', () => {
  const seg = new SilenceSegmenter()
  const cuts: number[] = []
  cuts.push(...feed(seg, rep(voiceFrame, 15)))
  cuts.push(...feed(seg, rep(silentFrame, 12)))
  cuts.push(...feed(seg, rep(voiceFrame, 15)))
  cuts.push(...feed(seg, rep(silentFrame, 12)))
  assert.equal(cuts.length, 2)
  assert.ok(cuts[1]! > cuts[0]!, '第二个切点必须在第一个之后')
})

test('句中的短停顿不切段', () => {
  const seg = new SilenceSegmenter()
  const cuts: number[] = []
  cuts.push(...feed(seg, rep(voiceFrame, 10)))
  cuts.push(...feed(seg, rep(silentFrame, 5)))   // 500ms，不到 900ms
  cuts.push(...feed(seg, rep(voiceFrame, 10)))
  assert.deepEqual(cuts, [])
})

test('会话结束时把最后一段冲出来', () => {
  const seg = new SilenceSegmenter()
  feed(seg, rep(voiceFrame, 10))
  const cut = seg.flush()
  assert.notEqual(cut, null)
  assert.equal(cut!.sampleIndex, 10 * FRAME)
})

test('结束时没说过话就不切', () => {
  const seg = new SilenceSegmenter()
  feed(seg, rep(silentFrame, 10))
  assert.equal(seg.flush(), null)
})

test('超长强制切段', () => {
  const seg = new SilenceSegmenter({ maxSegmentMs: 2000 })
  // 一直说不停顿，3 秒
  const cuts = feed(seg, rep(voiceFrame, 30))
  assert.ok(cuts.length >= 1, '超过 maxSegmentMs 必须强制切')
})

test('太短的段不切 —— 一声「嗯」不该成段', () => {
  const seg = new SilenceSegmenter({ minSegmentMs: 2000 })
  const cuts: number[] = []
  cuts.push(...feed(seg, rep(voiceFrame, 2)))   // 200ms 语音
  cuts.push(...feed(seg, rep(silentFrame, 15))) // 1.5s 静音
  assert.deepEqual(cuts, [], '段长不足 minSegmentMs 不该切')
})

test('切点的 sampleIndex 和累计采样数一致', () => {
  const seg = new SilenceSegmenter()
  feed(seg, rep(voiceFrame, 10))
  const cuts = feed(seg, rep(silentFrame, 12))
  assert.equal(cuts.length, 1)
  // 切点必须落在已消费的范围内，且等于当时的 totalSamples
  assert.ok(cuts[0]! <= seg.totalSamples)
  assert.equal(cuts[0]! % FRAME, 0, '切点应该落在帧边界上')
})
