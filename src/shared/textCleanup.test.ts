/**
 * 规则清洗的回归测试。
 *   npm run test:cleanup
 *
 * 这一层最容易出的事故是「误删」—— 把实词当成填充词删掉。
 * 所以反例（必须原样保留）比正例更重要，改规则前先跑这个。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanupSpeech, type CleanupOptions } from './textCleanup.ts'

const std = (s: string, extra: Partial<CleanupOptions> = {}): string =>
  cleanupSpeech(s, { level: 'standard', ...extra }).text

test('删除句首和句中的语气词', () => {
  assert.equal(std('嗯，那个，我觉得这个方案不行。'), '我觉得这个方案不行。')
  assert.equal(std('呃，然后呢，我们上线了。'), '我们上线了。')
})

test('折叠口吃式重复', () => {
  assert.equal(std('我我我觉得吧'), '我觉得吧')
  assert.equal(std('就是就是就是这样'), '就是这样')
})

test('不碰合法叠词', () => {
  assert.equal(std('刚刚看看常常谢谢'), '刚刚看看常常谢谢')
  assert.equal(std('爸爸妈妈'), '爸爸妈妈')
})

test('实词位置的「这个 / 那个」必须保留', () => {
  assert.equal(std('这个方案不行'), '这个方案不行')
  assert.equal(std('那个文件在哪'), '那个文件在哪')
})

test('英文填充词', () => {
  assert.equal(std('um, I mean, we should ship it'), 'we should ship it')
})

test('中英之间补空格', () => {
  assert.equal(std('性能提升了30%'), '性能提升了 30%')
})

test('保护词不会被当成填充词删掉', () => {
  const out = std('那个，那个啥模块崩了', { protect: ['那个啥'] })
  assert.ok(out.includes('那个啥'), out)
})

test('关闭时原样返回', () => {
  const s = '嗯，那个，我觉得'
  assert.equal(cleanupSpeech(s, { level: 'off' }).text, s)
})

test('统计删掉的字数', () => {
  const r = cleanupSpeech('嗯，那个，我觉得这个方案不行。', { level: 'standard' })
  assert.ok(r.removed > 0)
})
