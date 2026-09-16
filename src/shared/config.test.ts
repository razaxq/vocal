import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { runInNewContext } from 'node:vm'
import type { configSchema as ConfigSchema } from './config'

const module = { exports: {} as { configSchema: typeof ConfigSchema } }
runInNewContext(buildSync({ entryPoints: ['src/shared/config.ts'], bundle: true,
  platform: 'node', format: 'cjs', write: false }).outputFiles[0]!.text,
{ module, exports: module.exports })
const { configSchema } = module.exports

test('旧键盘设置补全独立开关，保留按键、录音模式和其他设置', () => {
  const cfg = configSchema.parse({ hotkey: { mode: 'doubleTap', key: 'AltRight' }, asr: { idleUnloadMin: 17 } })
  assert.equal(cfg.hotkey.keyboardEnabled, true)
  assert.equal(cfg.hotkey.mouseEnabled, false)
  assert.equal(cfg.hotkey.mode, 'doubleTap')
  assert.equal(cfg.hotkey.key, 'AltRight')
  assert.equal(cfg.asr.idleUnloadMin, 17)
})

test('旧左右键模式迁移为仅中键，保留用户延迟，不重置整个配置', () => {
  const cfg = configSchema.parse({ hotkey: { mode: 'mouseHold', mouseHoldDelayMs: 2100 }, ui: { launchAtLogin: true } })
  assert.equal(cfg.hotkey.mode, 'hold')
  assert.equal(cfg.hotkey.keyboardEnabled, false)
  assert.equal(cfg.hotkey.mouseEnabled, true)
  assert.equal(cfg.hotkey.mouseButton, 'middle')
  assert.equal(cfg.hotkey.mouseHoldDelayMs, 2100)
  assert.equal(cfg.ui.launchAtLogin, true)
})

test('键鼠开关互相独立，只接受中键或左键加中键，延迟限制保持不变', () => {
  for (const keyboardEnabled of [true, false]) for (const mouseEnabled of [true, false]) {
    const cfg = configSchema.parse({ hotkey: { keyboardEnabled, mouseEnabled, mouseButton: 'leftMiddle', mouseHoldDelayMs: 10000 } })
    assert.equal(cfg.hotkey.keyboardEnabled, keyboardEnabled)
    assert.equal(cfg.hotkey.mouseEnabled, mouseEnabled)
    assert.equal(cfg.hotkey.mouseButton, 'leftMiddle')
  }
  assert.equal(configSchema.safeParse({ hotkey: { mouseButton: 'leftRight' } }).success, false)
  for (const mouseHoldDelayMs of [0, 99, 10001, NaN, Infinity]) {
    assert.equal(configSchema.safeParse({ hotkey: { mouseHoldDelayMs } }).success, false)
  }
})
