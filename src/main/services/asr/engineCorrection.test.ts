import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { buildSync } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const bundle = buildSync({ entryPoints: ['src/main/services/asr/engine.ts'], bundle: true,
  platform: 'node', format: 'cjs', external: ['electron'], write: false }).outputFiles[0]!.text

for (const correctionEnabled of [false, true]) test(`定稿送出前等待纠错=${correctionEnabled}，进程异常回退且忽略旧会话`, async () => {
  class Worker extends EventEmitter {
    pid = 1
    messages: any[] = []
    postMessage(message: any): void { this.messages.push(message); if (message.type === 'init') queueMicrotask(() => this.emit('message', { type: 'ready' })) }
    kill(): void { this.emit('exit', 1) }
  }
  const workers = new Map<string, Worker>()
  const electron = { app: { getAppPath: () => 'test' }, utilityProcess: { fork: (_: string, _args: string[], options: { serviceName: string }) => {
    const worker = new Worker(); workers.set(options.serviceName, worker); return worker
  } } }
  const module = { exports: {} as any }
  runInNewContext(bundle, { module, exports: module.exports, require: (name: string) => name === 'electron' ? electron : require(name), setTimeout, clearTimeout, console })
  const results: string[] = []; const finished: string[] = []; const errors: string[] = []
  const engine = new module.exports.AsrEngine({ offline: { kind: 'offline-transducer' },
    ...(correctionEnabled ? { correction: { model: 'model', vocab: 'vocab', mode: 'csc' } } : {}) },
  'streaming+final', [], { level: 'off', protect: [], extraFillers: [] }, 1500, 0, {
    onPartial() {}, onSegment: (_: number, text: string) => results.push(text),
    onSessionComplete: (id: string) => finished.push(id), onError: (error: string) => errors.push(error)
  })
  await engine.start()
  engine.startSession('one')
  const fp = workers.get('vocal-asr-finalize')!
  const sp = workers.get('vocal-asr-stream')!
  sp.emit('message', { type: 'endpoint', sessionId: 'one', segment: 0, text: '拦柜', sampleIndex: 0 })
  const original = { type: 'finalized', sessionId: 'one', segment: 0, text: '拦柜', cleanedChars: 0, latencyMs: 1, fellBack: false }
  fp.emit('message', original)
  sp.emit('message', { type: 'session:ended', sessionId: 'one', segments: 1, totalSamples: 0 })
  if (correctionEnabled) {
    assert.deepEqual(results, []); assert.deepEqual(finished, [])
    const cp = workers.get('vocal-correction')!
    cp.emit('message', { ...original, text: '懒鬼' })
    assert.deepEqual(results, ['懒鬼']); assert.deepEqual(finished, ['one'])
    engine.startSession('two')
    cp.emit('message', { ...original, text: '过期' })
    sp.emit('message', { type: 'endpoint', sessionId: 'two', segment: 0, text: '原文', sampleIndex: 0 })
    fp.emit('message', { ...original, sessionId: 'two', text: '原文' })
    sp.emit('message', { type: 'session:ended', sessionId: 'two', segments: 1, totalSamples: 0 })
    cp.kill()
    assert.deepEqual(results, ['懒鬼', '原文']); assert.deepEqual(finished, ['one', 'two'])
    assert.equal(errors.length, 1)
  } else {
    assert.equal(workers.has('vocal-correction'), false)
    assert.deepEqual(results, ['拦柜']); assert.deepEqual(finished, ['one'])
  }
})
