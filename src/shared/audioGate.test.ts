/**
 * 语音门限与定稿健全性的回归测试。
 *   npm run test:gate
 *
 * 这一层挡的是「用户没说话，屏幕上却多了字」——
 * 语音输入工具最不能容忍的故障。所以静音必须判死，
 * 但轻声说话不能误杀（误杀就是丢字，同样不可接受）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectVoice, isFinalSane } from './audioGate.ts'

const SR = 16000

/** 生成指定秒数的静音，带一点点底噪，模拟真实麦克风。 */
function silence(seconds: number, noise = 0.0003): Float32Array {
  const a = new Float32Array(Math.round(SR * seconds))
  for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * noise
  return a
}

/** 在静音里放一段正弦波，模拟「10 秒里说了 N 秒话」。 */
function speech(totalSec: number, voiceSec: number, amp = 0.08): Float32Array {
  const a = silence(totalSec)
  const n = Math.round(SR * voiceSec)
  const start = Math.floor((a.length - n) / 2)
  for (let i = 0; i < n; i++) {
    a[start + i] = Math.sin((2 * Math.PI * 220 * i) / SR) * amp
  }
  return a
}

test('纯静音判为无语音', () => {
  assert.equal(detectVoice(silence(5)).hasVoice, false)
  assert.equal(detectVoice(silence(0.5)).hasVoice, false)
})

test('太短的片段一律判为无语音', () => {
  assert.equal(detectVoice(silence(0.05)).hasVoice, false)
  assert.equal(detectVoice(new Float32Array(0)).hasVoice, false)
})

test('正常说话判为有语音', () => {
  assert.equal(detectVoice(speech(3, 2)).hasVoice, true)
})

test('长静音里的一小段话不能被稀释掉', () => {
  // 10 秒里只说了 1 秒 —— 整段 RMS 会很低，但按帧算就抓得住
  const a = speech(10, 1)
  const r = detectVoice(a)
  assert.equal(r.hasVoice, true, `activeRatio=${r.activeRatio}`)
})

test('轻声说话不能被误杀', () => {
  // 振幅 0.015，比正常说话小一个量级
  assert.equal(detectVoice(speech(3, 2, 0.015)).hasVoice, true)
})

test('一声短促杂音不足以判成有语音', () => {
  // 10 秒静音里 30ms 的脉冲，活跃帧占比远低于阈值
  const a = silence(10)
  for (let i = 0; i < Math.round(SR * 0.03); i++) a[SR * 5 + i] = 0.5
  assert.equal(detectVoice(a).hasVoice, false)
})

/* ---------------- 定稿健全性 ---------------- */

test('定稿为空则回落', () => {
  assert.equal(isFinalSane('', '今天天气'), false)
  assert.equal(isFinalSane('   ', '今天天气'), false)
})

test('定稿被截断一半以上则回落', () => {
  assert.equal(isFinalSane('今天', '今天天气不错我们出去走走'), false)
  assert.equal(isFinalSane('今天天气不错，我们出去走走。', '今天天气不错我们出去走走'), true)
})

test('流式没出字、定稿只有一两个字 —— 判为幻觉', () => {
  // M1 探针实测：5 秒静音喂给 SenseVoice 得到「我.」
  assert.equal(isFinalSane('我.', ''), false)
  assert.equal(isFinalSane('我。', ''), false)
  assert.equal(isFinalSane('嗯', ''), false)
})

test('流式没出字但定稿够长 —— 认为是流式没跟上，采信', () => {
  assert.equal(isFinalSane('今天天气不错。', ''), true)
})
