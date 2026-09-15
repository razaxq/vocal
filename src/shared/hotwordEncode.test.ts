import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeHotwords, parseTokens } from './hotwordEncode.ts'

// 仿中文流式 Zipformer 的词表形状：词首带 ▁，词中不带
const VOCAB = parseTokens([
  '<blk> 0', '▁花 1', '费 2', '花 3', '▁我 4', '▁我们 5', '们 6',
  '▁陈 7', '心 8', '宇 9', 'a 10', '▁a 11'
].join('\n'))

test('词首优先取带 ▁ 的那版', () => {
  const { lines, dropped } = encodeHotwords(['花费'], VOCAB)
  assert.deepEqual(lines, ['▁花 费'])
  assert.deepEqual(dropped, [])
})

test('贪心最长匹配会吃掉多字 token', () => {
  // 词表里同时有 ▁我 和 ▁我们，应该取长的
  assert.deepEqual(encodeHotwords(['我们'], VOCAB).lines, ['▁我们'])
})

test('三字人名逐字编码', () => {
  assert.deepEqual(encodeHotwords(['陈心宇'], VOCAB).lines, ['▁陈 心 宇'])
})

test('有一个字不在词表里就整条丢掉并回报', () => {
  const { lines, dropped } = encodeHotwords(['花费', '不存在的词'], VOCAB)
  assert.deepEqual(lines, ['▁花 费'])
  assert.deepEqual(dropped, ['不存在的词'])
})

test('空行和空白被忽略，不算丢弃', () => {
  const { lines, dropped } = encodeHotwords(['', '   ', '花费'], VOCAB)
  assert.deepEqual(lines, ['▁花 费'])
  assert.deepEqual(dropped, [])
})

test('parseTokens 只取每行第一列', () => {
  const s = parseTokens('▁的 0\n我 1\n\n是 2\n')
  assert.ok(s.has('▁的') && s.has('我') && s.has('是'))
  assert.equal(s.size, 3)
})
