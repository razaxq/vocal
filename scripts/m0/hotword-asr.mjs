/** 本地 Zipformer 实际解码冒烟测试；检查热词路径与重载次数，不评估准确率。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sherpa from 'sherpa-onnx-node'

let constructions = 0
const streams = []
const Original = sherpa.OfflineRecognizer
sherpa.OfflineRecognizer = class extends Original {
  constructor(config) { super(config); constructions++ }
  createStream(hotwords) { streams.push(hotwords); return super.createStream(hotwords) }
}
let handle
const events = []
process.parentPort = { on: (_, callback) => { handle = callback }, postMessage: event => events.push(event) }
await import('../../out/main/finalize.js')
const send = command => handle({ data: command })
const root = resolve('data/models/sherpa-onnx-zipformer-zh-en-2023-11-22')
const models = { offline: { kind: 'offline-transducer', model: '',
  encoder: resolve(root, 'encoder-epoch-34-avg-19.int8.onnx'), decoder: resolve(root, 'decoder-epoch-34-avg-19.onnx'),
  joiner: resolve(root, 'joiner-epoch-34-avg-19.int8.onnx'), tokens: resolve(root, 'tokens.txt'), bpeVocab: resolve(root, 'bbpe.vocab') },
  punct: resolve('data/models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8/model.int8.onnx') }
send({ type: 'init', models, mode: 'full', hotwords: [], cleanup: { level: 'off', protect: [], extraFillers: [] } })
assert.equal(events.at(-1)?.type, 'ready')
assert.equal(constructions, 1)
for (let i = 0; i < 10; i++) send({ type: 'hotwords:update', hotwords: [{ text: '张晓明', score: 2.5 }] })
const catalog = JSON.parse(readFileSync('resources/dictionaries/rime-ice/catalog.json', 'utf8'))
const started = performance.now()
send({ type: 'dictionary:update', dictionary: catalog })
console.log(`Index ${catalog.words.length} words: ${(performance.now() - started).toFixed(0)} ms`)
const wave = sherpa.readWave(resolve('data/models/sherpa-onnx-streaming-paraformer-bilingual-zh-en/test_wavs/0.wav'))
assert.equal(wave.sampleRate, 16000)
send({ type: 'finalize', sessionId: 'test', segment: 0, samples: wave.samples, streamText: '苏州工业园区' })
assert.ok(streams.at(-1)?.includes('苏州工业园区 :1.5'))
assert.ok(streams.at(-1)?.includes('张晓明 :2.5'))
const before = streams.length
send({ type: 'finalize', sessionId: 'test', segment: 1, samples: wave.samples, streamText: '' })
assert.equal(streams.length - before, 2, 'final-only speech must retrieve from its first pass and decode again')
send({ type: 'dictionary:update' })
send({ type: 'hotwords:update', hotwords: [] })
send({ type: 'finalize', sessionId: 'test', segment: 2, samples: wave.samples, streamText: '测试结果' })
assert.equal(streams.at(-1), undefined)
assert.equal(constructions, 1, 'hotword changes must not reconstruct the model')
assert.deepEqual(events.filter(e => e.type === 'error'), [])
assert.equal(events.filter(e => e.type === 'finalized').length, 3)
console.log('PASS native decoder: retrieved candidates, personal priority, final-only two-pass, disable, model constructed once')
console.log(JSON.stringify(events.filter(e => e.type === 'finalized').map(e => ({ segment: e.segment, latencyMs: e.latencyMs }))))
