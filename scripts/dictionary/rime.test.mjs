import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { selectRimeWords } from './rime.mjs'

const directory = new URL('../../resources/dictionaries/rime-ice/', import.meta.url)

test('完整词库可由固定上游原文重新生成，来源与许可一致', () => {
  const catalog = JSON.parse(readFileSync(new URL('catalog.json', directory), 'utf8'))
  const raw = readFileSync(new URL('base.dict.yaml', directory), 'utf8')
  assert.ok(catalog.words.length > 500_000)
  assert.equal(createHash('sha256').update(raw).digest('hex'), catalog.source.sha256)
  const generated = selectRimeWords(raw)
  assert.deepEqual(catalog.words, generated.words)
  assert.deepEqual(catalog.readings, generated.readings)
  assert.equal(catalog.source.eligibleCount, generated.eligibleCount)
  assert.equal(catalog.updatedAt, generated.date)
  assert.ok(readFileSync(new URL('LICENSE', directory), 'utf8').includes('GNU GENERAL PUBLIC LICENSE'))
})

test('保留多音读法、按词频排序，过滤无效词条', () => {
  const raw = '# Rime dictionary\nversion: "2026-09-01"\n...\n低频词\tdi pin ci\t1\n短词\tduan ci\t999\n短词\tduan zi\t8\n#注释\tfoo\t999\n坏:词\tfoo\t999\n'
  assert.deepEqual(selectRimeWords(raw), {
    words: ['短词', '低频词'], readings: ['duan ci|duan zi', 'di pin ci'],
    eligibleCount: 2, date: '2026-09-01'
  })
  assert.throws(() => selectRimeWords('not a dictionary'))
  assert.throws(() => selectRimeWords('# Rime dictionary\n...\n'))
})
