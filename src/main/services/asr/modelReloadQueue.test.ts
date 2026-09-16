import test from 'node:test'
import assert from 'node:assert/strict'
import { ModelReloadQueue } from './modelReloadQueue.ts'
import type { AppConfig, AsrStatus } from '../../../shared/ipc'

function config(streaming = 'stream-a', offline = 'final-a', correction = 'none'): AppConfig {
  return { models: { streaming, offline, correction } } as AppConfig
}

function deferred() {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

for (const firstFails of [false, true]) test(`跨槽位切换按最新配置排队，旧加载失败=${firstFails}不影响后续请求`, async () => {
  let cfg = config()
  const first = deferred()
  const loaded: AppConfig[] = []
  const states: AsrStatus[] = []
  let active = 0
  const queue = new ModelReloadQueue({ getConfig: () => cfg, blocked: () => false,
    check: () => ({ ready: true, missing: [] }), downloading: () => false, publish: s => states.push(s),
    load: async c => { assert.equal(active++, 0); loaded.push(c); try { if (loaded.length === 1) await first.promise } finally { active-- } } })
  const run = queue.request({ streaming: cfg.models.streaming })
  cfg = config('stream-a', 'final-b')
  await queue.request({ offline: 'final-b' })
  cfg = config('stream-a', 'final-c', 'macbert')
  await queue.request({ offline: 'final-c', correction: 'macbert' })
  assert.equal(loaded.length, 1)
  if (firstFails) first.reject(new Error('stale model failed')); else first.resolve()
  await run
  assert.equal(loaded.length, 2)
  assert.deepEqual(loaded[1]!.models, cfg.models)
  assert.equal(states.some(s => s.state === 'error'), false)
  assert.equal(states.at(-1)?.state, 'ready')
  assert.equal(queue.running, false); assert.equal(queue.pending, false)
})

test('流式模型和词表尚在下载时等待，不把另一个模型标为失败；下载完加载最新组合', async () => {
  let cfg = config('new-stream')
  let installed = false
  let downloading = true
  const states: AsrStatus[] = []; const loaded: AppConfig[] = []
  const queue = new ModelReloadQueue({ getConfig: () => cfg, blocked: () => false,
    check: () => ({ ready: installed, missing: installed ? [] : ['流式模型', '流式词表'] }),
    downloading: () => downloading, publish: s => states.push(s), load: async c => { loaded.push(c) } })
  await queue.request({ streaming: 'new-stream' })
  cfg = config('new-stream', 'final-b')
  await queue.request({ offline: 'final-b' })
  assert.equal(states.at(-1)?.state, 'loading')
  assert.equal(states.at(-1)?.message, '等待模型下载完成')
  assert.equal(states.some(s => s.state === 'error'), false)
  assert.equal(loaded.length, 0)
  installed = true; downloading = false
  await queue.resume()
  assert.deepEqual(loaded.map(c => c.models), [cfg.models])
  assert.equal(states.at(-1)?.state, 'ready')
})

test('取消下载后报告缺失；重选已安装模型可恢复，录音期间只保留最新请求', async () => {
  let cfg = config('missing')
  let downloading = true
  let blocked = false
  const states: AsrStatus[] = []; const loaded: AppConfig[] = []
  const queue = new ModelReloadQueue({ getConfig: () => cfg, blocked: () => blocked,
    check: c => ({ ready: c.models.streaming !== 'missing', missing: ['流式模型', '流式词表'] }),
    downloading: () => downloading, publish: s => states.push(s), load: async c => { loaded.push(c) } })
  await queue.request({ streaming: 'missing' })
  downloading = false
  await queue.resume()
  assert.equal(states.at(-1)?.state, 'error'); assert.equal(queue.pending, false)
  blocked = true
  cfg = config('installed', 'final-b')
  await queue.request(cfg.models)
  cfg = config('installed', 'final-c')
  await queue.request({ offline: 'final-c' })
  assert.equal(loaded.length, 0)
  blocked = false
  await queue.resume()
  assert.deepEqual(loaded.map(c => c.models), [cfg.models])
  assert.equal(states.at(-1)?.state, 'ready')
})
