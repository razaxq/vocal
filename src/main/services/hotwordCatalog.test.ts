import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { HotwordCatalogService, CATALOG_URL } from './hotwordCatalog.ts'
import { MAX_CATALOG_BYTES } from '../../shared/hotwordCatalog.ts'

const source = {
  id: 'rime-ice', revision: 'a'.repeat(40), file: 'cn_dicts/base.dict.yaml', license: 'GPL-3.0',
  sha256: 'b'.repeat(64), selection: 'frequency-3-12-v1', eligibleCount: 1000
} as const
const bundled = { version: 2, updatedAt: '2026-09-16', source, words: ['情绪价值'] }
const newer = { ...bundled, version: 3, words: ['情绪价值', '松弛感'] }

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'vocal-hotword-test-'))
  t.after(async () => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()))
    await rm(dir, { recursive: true, force: true })
  })
  return join(dir, 'catalog.json')
}

test('更新落盘，重启后断网仍可用，重复检查不重新应用词库', async t => {
  const file = await fixture(t)
  let changed = 0
  const service = new HotwordCatalogService(file, bundled, async (url, init) => {
    assert.equal(url, CATALOG_URL)
    assert.equal(init?.redirect, 'error')
    return Response.json(newer)
  }, () => changed++, () => {})
  await service.load()
  assert.deepEqual(service.current.words, bundled.words)
  assert.equal((await service.check()).state, 'updated')
  assert.equal(changed, 1)
  assert.equal((await service.check()).state, 'latest')
  assert.equal(changed, 1)
  const restarted = new HotwordCatalogService(file, bundled, async () => { throw new Error('offline') }, () => {}, () => {})
  await restarted.load()
  assert.deepEqual(restarted.current.words, newer.words)
  assert.equal((await restarted.check()).state, 'error')
  assert.deepEqual(restarted.current.words, newer.words)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).catalog, newer)
})

test('坏缓存回落内置词库，新版内置词库优先于旧缓存', async t => {
  const file = await fixture(t)
  await writeFile(file, 'broken')
  const service = new HotwordCatalogService(file, newer, async () => Response.json(newer), () => {}, () => {})
  await service.load()
  assert.equal(service.current.version, 3)
  await writeFile(file, JSON.stringify({ catalog: bundled, checkedAt: Date.now() }))
  await service.load()
  assert.equal(service.current.version, 3)
  await writeFile(file, JSON.stringify({ catalog: { version: 999, updatedAt: '2026-09-16', words: ['旧手工词'] }, checkedAt: Date.now() }))
  await service.load()
  assert.equal(service.current.version, 3)
  assert.deepEqual(service.current.words, newer.words)
})

test('拒绝降级、同版本改写和超大下载，保留本地词库', async t => {
  const file = await fixture(t)
  for (const response of [Response.json(bundled), Response.json({ ...newer, words: ['篡改词'] }),
    new Response('x'.repeat(MAX_CATALOG_BYTES + 1)), new Response('', { status: 503 })]) {
    const service = new HotwordCatalogService(file, newer, async () => response, () => assert.fail('must not apply'), () => {})
    assert.equal((await service.check()).state, 'error')
    assert.deepEqual(service.current.words, newer.words)
  }
})

test('同时点击只下载一次；关闭自动更新不请求；成功检查后一周内不重复下载', async t => {
  const file = await fixture(t)
  let requests = 0
  const service = new HotwordCatalogService(file, bundled, async () => { requests++; return Response.json(bundled) }, () => {}, () => {})
  service.start(false)
  assert.equal(requests, 0)
  const a = service.check()
  const b = service.check()
  assert.equal(a, b)
  await a
  service.start(true)
  assert.equal(requests, 1)
  service.dispose()
})
