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
  const hookState = { starts: 0, stops: 0 }
  const hook = Object.assign(new EventEmitter(), {
    start() { hookState.starts++ }, stop() { hookState.stops++ }
  })
  let shortcut: (() => void) | undefined
  const calls: string[] = []
  const module = { exports: {} as { HotkeyService: new (events: {
    onStart: () => void; onStop: () => void; onCancel: () => void
  }) => HotkeyService } }
  runInNewContext(source, { module, exports: module.exports, Date, setTimeout, clearTimeout,
    require: (name: string) => {
      if (name === 'electron') return { globalShortcut: {
        register: (_key: string, callback: () => void) => { shortcut = callback; return true },
        unregisterAll() { shortcut = undefined }
      } }
      if (name === 'uiohook-napi') return { uIOhook: hook, UiohookKey: { CtrlRight: 3613, Escape: 1 } }
      throw new Error('Unexpected import ' + name)
    }
  })
  const service = new module.exports.HotkeyService({
    onStart: () => calls.push('start'), onStop: () => calls.push('stop'), onCancel: () => calls.push('cancel')
  })
  const config: HotkeyConfig = { mode: 'hold', keyboardEnabled: false, mouseEnabled: true, mouseButton: 'leftMiddle', key: 'CtrlRight', accelerator: 'Control+Shift+Space',
    doubleTapWindowMs: 350, minHoldMs: 200, debounceMs: 300, mouseHoldDelayMs: 1000 }
  service.apply(config)
  const input = (type: number, button = 1, x = 0, y = 0) => hook.emit('input', { type, button, x, y })
  return { service, config, hook, calls, input, hookState, shortcut: () => shortcut?.(), tick: (ms: number) => t.mock.timers.tick(ms) }
}

test('独立开关支持全部关闭并停止监听，再单独开启中键', t => {
  const { service, config, hook, hookState, calls, input, tick } = setup(t)
  service.apply({ ...config, mouseEnabled: false })
  assert.equal(hook.listenerCount('input'), 0)
  assert.equal(hook.listenerCount('keydown'), 0)
  assert.equal(hookState.stops, 1)
  input(7, 3); tick(1000); hook.emit('keydown', { keycode: 3613 })
  assert.deepEqual(calls, [])
  service.apply({ ...config, mouseButton: 'middle' })
  input(7, 3); tick(1000); input(8, 3)
  assert.deepEqual(calls, ['start', 'stop'])
  assert.equal(hookState.starts, 2)
  service.dispose()
})

for (const mouseButton of ['left', 'middle'] as const) for (const mode of ['hold', 'doubleTap', 'toggle'] as const) {
  test(`键鼠同时启用（${mode}/${mouseButton}）：只允许启动录音的设备结束，鼠标不受 Esc 影响`, t => {
    const { service, config, hook, calls, input, tick, shortcut } = setup(t)
    service.apply({ ...config, keyboardEnabled: true, mouseButton, mode })
    const button = mouseButton === 'left' ? 1 : 3
    assert.equal(hook.listenerCount('input'), 1)
    assert.equal(hook.listenerCount('keydown'), 1)
    const keyDown = () => hook.emit('keydown', { keycode: 3613 })
    const keyUp = () => hook.emit('keyup', { keycode: 3613 })
    const startKeyboard = () => {
      if (mode === 'toggle') shortcut()
      else { keyDown(); if (mode === 'doubleTap') { keyUp(); tick(100); keyDown() } }
    }
    const stopKeyboard = () => { if (mode === 'toggle') shortcut(); else if (mode === 'hold') keyUp(); else keyDown() }
    input(7, button); tick(1000)
    startKeyboard(); stopKeyboard(); hook.emit('keydown', { keycode: 1 })
    assert.deepEqual(calls, ['start'])
    input(8, button)
    assert.deepEqual(calls, ['start', 'stop'])
    tick(300)
    startKeyboard(); tick(300)
    input(7, button); tick(1000); input(8, button)
    assert.deepEqual(calls, ['start', 'stop', 'start'])
    stopKeyboard()
    assert.deepEqual(calls, ['start', 'stop', 'start', 'stop'])
    service.dispose()
  })
}

test('键盘启动会取消鼠标等待，键盘结束后不会被旧计时器再次启动', t => {
  const { service, config, hook, calls, input, tick } = setup(t)
  service.apply({ ...config, keyboardEnabled: true, mouseButton: 'middle' })
  input(7, 3); tick(500)
  hook.emit('keydown', { keycode: 3613 }); tick(300)
  hook.emit('keyup', { keycode: 3613 }); tick(2000)
  assert.deepEqual(calls, ['start', 'stop'])
  input(8, 3)
  service.dispose()
})

test('鼠标模式注册原生输入监听，不监听 Esc；松开后结束', t => {
  const { service, hook, calls, input, tick } = setup(t)
  assert.equal(hook.listenerCount('keydown'), 0)
  input(7, 1); input(7, 3); tick(1000)
  hook.emit('keydown', { keycode: 1 })
  hook.emit('input', { type: 4, keycode: 1 })
  assert.deepEqual(calls, ['start'])
  input(8, 3); input(8, 1)
  assert.deepEqual(calls, ['start', 'stop'])
  service.dispose()
  assert.equal(hook.listenerCount('input'), 0)
})

test('原生拖拽事件 type 10 也取消等待，旧定时器不随模式切换触发', t => {
  const { service, config, hook, calls, input, tick } = setup(t)
  input(7, 1); input(7, 3); input(10, 1, 20, 20); tick(1000)
  assert.deepEqual(calls, [])
  input(8, 1); input(8, 3)
  input(7, 1); input(7, 3); tick(500)
  service.apply({ ...config, keyboardEnabled: true, mouseEnabled: false }); tick(1000)
  assert.deepEqual(calls, [])
  assert.equal(hook.listenerCount('input'), 0)
  hook.emit('keydown', { keycode: 3613 }); tick(500); hook.emit('keyup', { keycode: 3613 })
  assert.deepEqual(calls, ['start', 'stop'])
  service.dispose()
})

test('键盘录音中切到鼠标模式会结束原录音，不遗留键盘监听', t => {
  const { service, config, hook, calls } = setup(t)
  service.apply({ ...config, keyboardEnabled: true, mouseEnabled: false })
  hook.emit('keydown', { keycode: 3613 })
  service.apply(config)
  assert.deepEqual(calls, ['start', 'stop'])
  assert.equal(hook.listenerCount('keydown'), 0)
  assert.equal(hook.listenerCount('input'), 1)
  service.dispose()
})

test('调整延迟后只使用新时长，录音中切换模式会正常结束', t => {
  const { service, config, calls, input, tick } = setup(t)
  input(7, 1); input(7, 3); tick(500)
  service.apply({ ...config, mouseHoldDelayMs: 2000 }); tick(1000)
  assert.deepEqual(calls, [])
  input(7, 1); input(7, 3); tick(1999)
  assert.deepEqual(calls, [])
  tick(1)
  assert.deepEqual(calls, ['start'])
  service.apply({ ...config, keyboardEnabled: true, mouseEnabled: false })
  assert.deepEqual(calls, ['start', 'stop'])
  service.dispose()
})
