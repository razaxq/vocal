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
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 10000 })
  const hookState = { starts: 0, stops: 0 }
  const hook = Object.assign(new EventEmitter(), {
    start() { hookState.starts++ }, stop() { hookState.stops++ }
  })
  let shortcut: (() => void) | undefined
  let fullscreen = false
  const calls: string[] = []
  const module = { exports: {} as { HotkeyService: new (events: {
    onStart: () => void; onStop: () => void; onCancel: () => void
  }, isFullscreen: () => boolean) => HotkeyService } }
  runInNewContext(source, { module, exports: module.exports, Date, setTimeout, clearTimeout, setInterval, clearInterval,
    require: (name: string) => {
      if (name === 'electron') return { globalShortcut: {
        register: (_key: string, callback: () => void) => { shortcut = callback; return true },
        unregister() { shortcut = undefined },
        unregisterAll() { shortcut = undefined }
      } }
      if (name === 'uiohook-napi') return { uIOhook: hook, UiohookKey: { CtrlRight: 3613, Escape: 1 } }
      throw new Error('Unexpected import ' + name)
    }
  })
  const service = new module.exports.HotkeyService({
    onStart: () => calls.push('start'), onStop: () => calls.push('stop'), onCancel: () => calls.push('cancel')
  }, () => fullscreen)
  const config: HotkeyConfig = { mode: 'hold', keyboardEnabled: false, mouseEnabled: true, mouseButton: 'leftMiddle', key: 'CtrlRight', accelerator: 'Control+Shift+Space',
    keyboardInFullscreen: false, mouseInFullscreen: false,
    doubleTapWindowMs: 350, minHoldMs: 200, debounceMs: 300, mouseHoldDelayMs: 1000 }
  service.apply(config)
  const input = (type: number, button = 1, x = 0, y = 0) => hook.emit('input', { type, button, x, y })
  return { service, config, hook, calls, input, hookState, shortcut: () => shortcut?.(), tick: (ms: number) => t.mock.timers.tick(ms),
    setFullscreen: (value: boolean) => { fullscreen = value }, registered: () => !!shortcut }
}

for (const keyboardInFullscreen of [false, true]) for (const mouseInFullscreen of [false, true]) {
  test(`全屏键鼠开关互相独立 keyboard=${keyboardInFullscreen} mouse=${mouseInFullscreen}`, t => {
    const s = setup(t)
    s.service.apply({ ...s.config, keyboardEnabled: true, mouseButton: 'middle', keyboardInFullscreen, mouseInFullscreen })
    s.setFullscreen(true)
    s.hook.emit('keydown', { keycode: 3613 }); s.tick(300); s.hook.emit('keyup', { keycode: 3613 })
    assert.deepEqual(s.calls, keyboardInFullscreen ? ['start', 'stop'] : [])
    s.calls.length = 0; s.tick(300)
    s.input(7, 3); s.tick(1000); s.input(8, 3)
    assert.deepEqual(s.calls, mouseInFullscreen ? ['start', 'stop'] : [])
    s.service.dispose()
  })
}

test('鼠标延迟到期前进入全屏不启动，开始后进入全屏仍能松键结束', t => {
  const s = setup(t)
  s.input(7, 1); s.input(7, 3); s.tick(500); s.setFullscreen(true); s.tick(500)
  assert.deepEqual(s.calls, [])
  s.input(8, 1); s.input(8, 3); s.setFullscreen(false)
  s.input(7, 1); s.input(7, 3); s.tick(1000); s.setFullscreen(true)
  s.input(8, 1); s.input(8, 3)
  assert.deepEqual(s.calls, ['start', 'stop'])
  s.service.dispose()
})

test('全屏中按住的键鼠离开全屏后不会补触发，释放后重新按下才恢复', t => {
  const s = setup(t)
  s.service.apply({ ...s.config, keyboardEnabled: true, mouseButton: 'middle' })
  s.setFullscreen(true); s.hook.emit('keydown', { keycode: 3613 }); s.input(7, 3)
  s.setFullscreen(false); s.hook.emit('keydown', { keycode: 3613 }); s.tick(1000)
  assert.deepEqual(s.calls, [])
  s.hook.emit('keyup', { keycode: 3613 }); s.input(8, 3)
  s.hook.emit('keydown', { keycode: 3613 }); s.tick(300); s.setFullscreen(true); s.hook.emit('keyup', { keycode: 3613 })
  assert.deepEqual(s.calls, ['start', 'stop'])
  s.service.dispose()
})

test('双击模式在全屏中不累积点击，录音中进入全屏仍可结束', t => {
  const s = setup(t)
  s.service.apply({ ...s.config, keyboardEnabled: true, mode: 'doubleTap' })
  const tap = () => { s.hook.emit('keydown', { keycode: 3613 }); s.hook.emit('keyup', { keycode: 3613 }) }
  s.setFullscreen(true); tap(); s.tick(100); tap(); s.tick(100)
  s.setFullscreen(false); tap()
  assert.deepEqual(s.calls, [])
  s.tick(100); tap(); s.tick(300); s.setFullscreen(true); tap()
  assert.deepEqual(s.calls, ['start', 'stop'])
  s.service.dispose()
})

test('全屏时释放组合键占用，退出恢复；保留结束录音的组合键并清理轮询', t => {
  const s = setup(t)
  s.setFullscreen(true)
  s.service.apply({ ...s.config, keyboardEnabled: true, mode: 'toggle' })
  assert.equal(s.registered(), false)
  s.setFullscreen(false); s.tick(250); assert.equal(s.registered(), true)
  // Check at invocation as well as polling, closing the foreground-switch race.
  s.setFullscreen(true); s.shortcut()
  assert.deepEqual(s.calls, []); assert.equal(s.registered(), false)
  s.setFullscreen(false); s.tick(250); s.shortcut()
  s.setFullscreen(true); s.tick(250); assert.equal(s.registered(), true)
  s.shortcut(); assert.deepEqual(s.calls, ['start', 'stop']); assert.equal(s.registered(), false)
  s.setFullscreen(false); s.tick(300); s.shortcut(); s.setFullscreen(true)
  s.hook.emit('keydown', { keycode: 1 })
  assert.deepEqual(s.calls, ['start', 'stop', 'start', 'cancel']); assert.equal(s.registered(), false)
  s.service.dispose(); s.setFullscreen(false); s.tick(1000); assert.equal(s.registered(), false)
})

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
