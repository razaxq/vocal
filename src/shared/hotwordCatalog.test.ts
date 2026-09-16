import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseCatalog, mergeHotwords, offlineHotwords } from './hotwordCatalog.ts'
import { encodeHotwords } from './hotwordEncode.ts'

test('精选词库有效，无重复且容量受限', () => {
  const raw = JSON.parse(readFileSync(new URL('./network-hotwords.json', import.meta.url), 'utf8'))
  const parsed = parseCatalog(raw)
  assert.deepEqual(parsed.words, raw.words)
  assert.ok(parsed.words.length >= 100 && parsed.words.length <= 500)
})

test('个人词优先，网络词较低加权，关闭网络词不改变个人词', () => {
  const personal = ['情绪价值', ' Vocal ', 'vocal', '']
  assert.deepEqual(mergeHotwords(personal, ['情绪价值', '松弛感']), [
    { text: '情绪价值', score: 2.5 }, { text: 'Vocal', score: 2.5 }, { text: '松弛感', score: 1.5 }
  ])
  assert.equal(mergeHotwords(personal, []).length, 2)
  assert.deepEqual(personal, ['情绪价值', ' Vocal ', 'vocal', ''])
})

test('流式与定稿都收到每词权重，不把权重当成词语', () => {
  const words = mergeHotwords(['花费'], ['松弛感'])
  const tokens = new Set(['▁花', '费', '▁松', '弛', '感'])
  assert.deepEqual(encodeHotwords(words, tokens), { lines: ['▁花 费 :2.5', '▁松 弛 感 :1.5'], dropped: [] })
  assert.equal(offlineHotwords(words), '花费 :2.5/松弛感 :1.5')
  assert.equal(offlineHotwords([]), undefined)
})

test('词库拒绝超量、控制符、引擎分隔符和加权语法', () => {
  for (const words of [[], Array(501).fill('热词'), ['热词 :20'], ['热/词'], ['热\n词'], ['a'.repeat(33)]]) {
    assert.throws(() => parseCatalog({ version: 1, updatedAt: '2026-09-16', words }))
  }
  assert.throws(() => parseCatalog({ version: 0, updatedAt: '2026-09-16', words: ['热词'] }))
  assert.deepEqual(mergeHotwords(['热/词', '热词 :20', '热\n词'], []), [])
})
