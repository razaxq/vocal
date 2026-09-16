/** Built Electron utility-process regression: ordering, hotword protection, model switch and fallback. */
const { app, utilityProcess } = require('electron')
const { resolve, join } = require('node:path')
const { readFileSync } = require('node:fs')
const assert = require('node:assert/strict')
const registry = require('../models.json')
const catalog = JSON.parse(readFileSync(resolve('resources/dictionaries/rime-ice/catalog.json'), 'utf8'))
let worker
const watchdog = setTimeout(() => { console.error('FAIL: correction worker timeout'); worker?.kill(); app.exit(1) }, 60000)
async function run(id, expected, broken = false) {
  const entry = registry.correction.find(m => m.id === id)
  worker = utilityProcess.fork(resolve('out/main/correction.js'), [], { stdio: 'pipe', serviceName: 'vocal-correction-test' })
  worker.stderr.on('data', data => process.stderr.write(data))
  const events = []
  const waiters = []
  worker.on('message', event => { events.push(event); for (const fn of [...waiters]) fn() })
  const wait = predicate => new Promise(resolve => {
    const done = () => { if (predicate()) { waiters.splice(waiters.indexOf(done), 1); resolve() } }
    waiters.push(done); done()
  })
  worker.postMessage({ type: 'init', hotwords: [], dictionary: catalog,
    model: { model: resolve('data/models', entry.dir, broken ? 'missing.onnx' : entry.files.model),
      vocab: resolve('data/models', entry.dir, entry.files.vocab), mode: entry.correctionMode } })
  await wait(() => events.some(e => e.type === 'ready'))
  const errors = events.filter(e => e.type === 'error')
  assert.equal(errors.length > 0, broken, JSON.stringify(errors))
  worker.postMessage({ type: 'correct', result: { type: 'finalized', sessionId: 'test', segment: 0, text: '完全就是给拦柜用的', cleanedChars: 0, latencyMs: 0, fellBack: false } })
  worker.postMessage({ type: 'hotwords:update', hotwords: [{ text: '拦柜', score: 2.5 }] })
  worker.postMessage({ type: 'correct', result: { type: 'finalized', sessionId: 'test', segment: 1, text: '完全就是给拦柜用的', cleanedChars: 0, latencyMs: 0, fellBack: false } })
  await wait(() => events.filter(e => e.type === 'finalized').length === 2)
  const output = events.filter(e => e.type === 'finalized')
  assert.deepEqual(output.map(e => e.segment), [0, 1])
  assert.ok(output[0].text.includes(expected), JSON.stringify(output))
  assert.ok(output[1].text.includes('拦柜'), JSON.stringify(output))
  const stopped = new Promise(resolve => worker.once('exit', resolve))
  worker.postMessage({ type: 'shutdown' }); await stopped
  console.log(`PASS ${id}${broken ? ' missing-model fallback' : ''}: ordered final text, personal hotwords protected`)
}
app.whenReady().then(async () => {
  await run('macbert4csc', '懒鬼')
  await run('bert-chinese-int8', '拦柜')
  await run('macbert4csc', '拦柜', true)
}).then(() => { clearTimeout(watchdog); app.exit(0) }).catch(e => { console.error(e); worker?.kill(); clearTimeout(watchdog); app.exit(1) })
