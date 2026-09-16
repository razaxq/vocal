import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { buildSync } from 'esbuild'
import { runInNewContext } from 'node:vm'
import type { HotkeyService } from './index'
import type { HotkeyConfig } from '../../../shared/types'

// Bundle the real service, replacing only the Electron/native-hook boundary.
const source = buildSync({
  entryPoints: ['src/main/services/hotkey/index.ts'], tsconfig: 'tsconfig.node.json',
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['electron', 'uiohook-napi']
}).outputFiles[0]!.text

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 })
  const hook = Object.assign(new EventEmitter(), { start() {}, stop() {} })
  const calls: string[] = []
  const module = { exports: {} as { HotkeyService: new (events: {
    onStart: () => void; onStop: () => void; onCancel: () => void
  }) => HotkeyService } }
  runInNewContext(source, { module, exports: module.exports, Date, setTimeout, clearTimeout,
    require: (name: string) => {
      if (name === 'electron') return { globalShortcut: { register: () => true, unregisterAll() {} } }
      if (name === 'uiohook-napi') return { uIOhook: hook, UiohookKey: { CtrlRight: 3613, Escape: 1 } }
      throw new Error('Unexpected import ' + name)
    }
  })
  const service = new module.exports.HotkeyService({
    onStart: () => calls.push('start'), onStop: () => calls.push('stop'), onCancel: () => calls.push('cancel')
  })
  const config: HotkeyConfig = { mode: 'mouseHold', key: 'CtrlRight', accelerator: 'Control+Shift+Space',
    doubleTapWindowMs: 350, minHoldMs: 200, debounceMs: 300, mouseHoldDelayMs: 1000 }
  service.apply(config)
  const input = (type: number, button = 1, x = 0, y = 0) => hook.emit('input', { type, button, x, y })
  return { service, config, hook, calls, input, tick: (ms: number) => t.mock.timers.tick(ms) }
}

test('鼠标模式注册原生输入监听，不监听 Esc；松开后结束', t => {
  const { service, hook, calls, input, tick } = setup(t)
  assert.equal(hook.listenerCount('keydown'), 0)
  input(7, 1); input(7, 2); tick(1000)
  hook.emit('keydown', { keycode: 1 })
  hook.emit('input', { type: 4, keycode: 1 })
  assert.deepEqual(calls, ['start'])
  input(8, 2); input(8, 1)
  assert.deepEqual(calls, ['start', 'stop'])
  service.dispose()
  assert.equal(hook.listenerCount('input'), 0)
})

test('原生拖拽事件 type 10 也取消等待，旧定时器不随模式切换触发', t => {
  const { service, config, hook, calls, input, tick } = setup(t)
  input(7, 1); input(7, 2); input(10, 1, 20, 20); tick(1000)
  assert.deepEqual(calls, [])
  input(8, 1); input(8, 2)
  input(7, 1); input(7, 2); tick(500)
  service.apply({ ...config, mode: 'hold' }); tick(1000)
  assert.deepEqual(calls, [])
  assert.equal(hook.listenerCount('input'), 0)
  hook.emit('keydown', { keycode: 3613 }); tick(500); hook.emit('keyup', { keycode: 3613 })
  assert.deepEqual(calls, ['start', 'stop'])
  service.dispose()
})

test('键盘录音中切到鼠标模式会结束原录音，不遗留键盘监听', t => {
  const { service, config, hook, calls } = setup(t)
  service.apply({ ...config, mode: 'hold' })
  hook.emit('keydown', { keycode: 3613 })
  service.apply(config)
  assert.deepEqual(calls, ['start', 'stop'])
  assert.equal(hook.listenerCount('keydown'), 0)
  assert.equal(hook.listenerCount('input'), 1)
  service.dispose()
})

test('调整延迟后只使用新时长，录音中切换模式会正常结束', t => {
  const { service, config, calls, input, tick } = setup(t)
  input(7, 1); input(7, 2); tick(500)
  service.apply({ ...config, mouseHoldDelayMs: 2000 }); tick(1000)
  assert.deepEqual(calls, [])
  input(7, 1); input(7, 2); tick(1999)
  assert.deepEqual(calls, [])
  tick(1)
  assert.deepEqual(calls, ['start'])
  service.apply({ ...config, mode: 'hold' })
  assert.deepEqual(calls, ['start', 'stop'])
  service.dispose()
})
