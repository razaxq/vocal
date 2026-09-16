import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseCatalog, mergeHotwords, offlineHotwords } from './hotwordCatalog.ts'
import { encodeHotwords } from './hotwordEncode.ts'
import { createHash } from 'node:crypto'
import { selectRimeWords } from './rimeDictionary.ts'

const directory = new URL('../../resources/dictionaries/rime-ice/', import.meta.url)
const bundled = JSON.parse(readFileSync(new URL('catalog.json', directory), 'utf8'))

test('雾凇词库有效，来源可追溯，所有词由原始词库生成', () => {
  const raw = bundled
  const parsed = parseCatalog(raw)
  assert.deepEqual(parsed.words, raw.words)
  assert.equal(parsed.words.length, 500)
  const dictionary = readFileSync(new URL('base.dict.yaml', directory), 'utf8')
  assert.equal(createHash('sha256').update(dictionary).digest('hex'), parsed.source.sha256)
  const generated = selectRimeWords(dictionary)
  assert.deepEqual(parsed.words, generated.words)
  assert.equal(parsed.source.eligibleCount, generated.eligibleCount)
  assert.equal(parsed.updatedAt, generated.date)
  assert.ok(readFileSync(new URL('LICENSE', directory), 'utf8').includes('GNU GENERAL PUBLIC LICENSE'))
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
    assert.throws(() => parseCatalog({ ...bundled, words }))
  }
  assert.throws(() => parseCatalog({ version: 0, updatedAt: '2026-09-16', words: ['热词'] }))
  assert.deepEqual(mergeHotwords(['热/词', '热词 :20', '热\n词'], []), [])
})

test('拒绝旧手工词库，防止旧缓存继续生效', () => {
  const { source: _, ...legacy } = bundled
  assert.throws(() => parseCatalog(legacy), /来源/)
})

test('按真实词频排序，去重，跳过短词、注释和引擎语法', () => {
  const text = '# Rime dictionary\nversion: "2026-09-01"\n...\n低频词\tdi pin ci\t1\n高频词\tgao pin ci\t99\n高频词\tgao pin ci\t3\n短词\tduan ci\t999\n#注释词\tfoo\t999\n坏:词\tfoo\t999\n'
  assert.deepEqual(selectRimeWords(text).words, ['高频词', '低频词'])
  assert.equal(selectRimeWords(text).eligibleCount, 2)
})
