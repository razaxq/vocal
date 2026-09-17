import test from 'node:test'
import assert from 'node:assert/strict'
import { coversMonitor } from './fullscreen.ts'

test('全屏覆盖、多屏负坐标与桌面排除，不把带标题栏或任务栏的最大化窗口当成全屏', () => {
  const monitor = { left: -2560, top: -100, right: 0, bottom: 1340 }
  assert.equal(coversMonitor(monitor, monitor, 'GameWindow'), true)
  assert.equal(coversMonitor({ ...monitor, right: 2560 }, monitor, 'GameWindow'), true)
  assert.equal(coversMonitor({ ...monitor, top: -99 }, monitor, 'GameWindow'), true)
  assert.equal(coversMonitor({ ...monitor, top: -68 }, monitor, 'BrowserWindow'), false)
  assert.equal(coversMonitor({ ...monitor, bottom: 1300 }, monitor, 'BrowserWindow'), false)
  assert.equal(coversMonitor({ ...monitor, left: 0 }, monitor, 'BrowserWindow'), false)
  assert.equal(coversMonitor({ ...monitor, left: NaN }, monitor, 'BrowserWindow'), false)
  for (const className of ['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']) {
    assert.equal(coversMonitor(monitor, monitor, className), false)
  }
})
