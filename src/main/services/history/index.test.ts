/**
 * 历史存储的回归测试。
 *   npm run test:history
 *
 * 重点覆盖两件容易出事的事：
 *  1. 崩溃留下半行 JSON 时还能不能打开（不能因为一行坏数据就丢掉全部历史）
 *  2. 删除后重写文件的原子性与顺序
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { HistoryService } from './index.ts'
import type { Transcript } from '../../../shared/types.ts'

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'vocal-hist-')), 'history.jsonl')
}

function make(id: string, text: string, ms = 1000): Transcript {
  return {
    id,
    createdAt: Date.now(),
    raw: text,
    polished: text,
    final: text,
    durationMs: ms,
    segmentCount: 1
  }
}

test('写入后能读回，最新的在前', () => {
  const f = tmpFile()
  const h = new HistoryService(f)
  h.insert(make('a', '第一条'))
  h.insert(make('b', '第二条'))

  const list = h.list()
  assert.equal(list.length, 2)
  assert.equal(list[0]?.id, 'b')
  assert.equal(list[1]?.id, 'a')
})

test('重新打开能恢复，且顺序不变', () => {
  const f = tmpFile()
  const h1 = new HistoryService(f)
  h1.insert(make('a', '第一条'))
  h1.insert(make('b', '第二条'))
  h1.close()

  const h2 = new HistoryService(f)
  assert.deepEqual(h2.list().map((t) => t.id), ['b', 'a'])
})

test('半行 JSON（进程被杀）不影响其余记录', () => {
  const f = tmpFile()
  const h1 = new HistoryService(f)
  h1.insert(make('a', '好的一条'))
  h1.insert(make('b', '也是好的'))
  // 模拟写到一半被杀
  appendFileSync(f, '{"id":"c","final":"半行', 'utf8')

  const h2 = new HistoryService(f)
  assert.deepEqual(h2.list().map((t) => t.id), ['b', 'a'])
})

test('删除会真的落盘', () => {
  const f = tmpFile()
  const h1 = new HistoryService(f)
  h1.insert(make('a', '留下'))
  h1.insert(make('b', '删掉'))
  h1.delete('b')

  assert.deepEqual(h1.list().map((t) => t.id), ['a'])
  assert.ok(!readFileSync(f, 'utf8').includes('"b"'))

  const h2 = new HistoryService(f)
  assert.deepEqual(h2.list().map((t) => t.id), ['a'])
})

test('分页', () => {
  const f = tmpFile()
  const h = new HistoryService(f)
  for (let i = 0; i < 10; i++) h.insert(make(`i${i}`, `第 ${i} 条`))

  assert.deepEqual(h.list(3, 0).map((t) => t.id), ['i9', 'i8', 'i7'])
  assert.deepEqual(h.list(3, 3).map((t) => t.id), ['i6', 'i5', 'i4'])
})

test('统计', () => {
  const f = tmpFile()
  const h = new HistoryService(f)
  h.insert(make('a', '一二三', 2000))
  h.insert(make('b', '四五', 3000))

  const s = h.stats()
  assert.equal(s.count, 2)
  assert.equal(s.chars, 5)
  assert.equal(s.totalMs, 5000)
})

test('空文件和空目录都不报错', () => {
  const f = tmpFile()
  writeFileSync(f, '', 'utf8')
  const h = new HistoryService(f)
  assert.deepEqual(h.list(), [])
  assert.deepEqual(h.stats(), { count: 0, chars: 0, totalMs: 0 })
})
