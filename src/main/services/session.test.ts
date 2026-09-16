import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionController } from './session.ts'
import type { SessionHooks } from './session'
import type { PanelPartial, AppConfig } from '../../shared/ipc'
import type { Transcript } from '../../shared/types'

test('连续句定稿保留后一句，写入完成后才保存完整历史并结束', async () => {
  const panels: PanelPartial[] = []
  const history: Transcript[] = []
  let sessionId = ''
  let finishInjection!: () => void
  const gate = new Promise<void>(resolve => { finishInjection = resolve })
  const cfg = { consolidation: { mode: 'off', maxReplaceChars: 1000 }, streaming: { injectMode: 'segment' } } as AppConfig
  const hooks = { onState() {}, onPartial(p) { panels.push(p) }, onSegment() {}, onTranscript() {},
    onToast() {}, setCapture() {}, showPanel() {}, hidePanel() {} } satisfies SessionHooks
  const session = new SessionController(
    { ensureReady: async () => {}, startSession: (id: string) => { sessionId = id } } as never,
    { captureTarget: () => undefined, inject: async () => { await gate; return { ok: true } } } as never,
    { enabled: false } as never, { insert: (t: Transcript) => history.push(t) } as never, () => cfg, hooks)
  session.start()
  await Promise.resolve()
  session.onPartial(0, '人工只能')
  session.onPartial(1, '下一句')
  const meta = { cleanedChars: 0, latencyMs: 1, fellBack: false }
  const first = session.onSegment(0, '人工智能。', meta)
  await Promise.resolve()
  assert.deepEqual(panels.at(-1), { committed: '人工智能。', live: '下一句' })
  const second = session.onSegment(1, '下一句。', meta)
  let completed = false
  const complete = session.onSessionComplete(sessionId).then(() => { completed = true })
  await Promise.resolve()
  assert.equal(completed, false)
  assert.equal(history.length, 0)
  finishInjection()
  await Promise.all([first, second, complete])
  assert.equal(history[0]?.final, '人工智能。下一句。')
  assert.equal(history[0]?.raw, '人工只能下一句')
  assert.equal(history[0]?.segmentCount, 2)
  assert.equal(session.current, 'idle')
})
