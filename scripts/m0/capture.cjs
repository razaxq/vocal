/** 验证构建后的悬浮条可从 file:// 加载采集脚本；只使用虚拟麦克风。 */
const { app, BrowserWindow, ipcMain } = require('electron')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve, dirname, basename } = require('node:path')
const assert = require('node:assert/strict')

app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
const dir = mkdtempSync(join(tmpdir(), 'vocal-capture-'))
app.setPath('userData', join(dir, 'profile'))
const preload = join(dir, 'preload.cjs')
writeFileSync(preload, `
const { contextBridge, ipcRenderer } = require('electron')
const off = () => () => {}
contextBridge.exposeInMainWorld('vocal', {
  getConfig: async () => ({
    audio: { deviceId: null, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    ui: { theme: 'system' }, models: { streaming: 'zipformer-zh' }
  }),
  sendAudioFrame: samples => ipcRenderer.send('test:frame', Array.from(samples)),
  onStateChanged: cb => {
    const listener = (_event, state) => cb(state)
    ipcRenderer.on('test:state', listener)
    ipcRenderer.send('test:ready')
    return () => ipcRenderer.removeListener('test:state', listener)
  },
  onAudioConfigChanged: off, onThemeChanged: off, onPanelLayout: off,
  onPanelVisible: off, onPartial: off, onTranscript: off, onToast: off
})
`)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const timeout = setTimeout(() => { console.error('FAIL capture timed out'); app.exit(1) }, 15000)
let win
let exitCode = 0
let frames = []
ipcMain.on('test:frame', (_event, samples) => frames.push(samples))
const ready = new Promise(resolve => ipcMain.once('test:ready', resolve))

app.whenReady().then(async () => {
  win = new BrowserWindow({
    show: false, focusable: false,
    webPreferences: { preload, sandbox: false, contextIsolation: true, backgroundThrottling: false }
  })
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))
  await win.loadFile(resolve('out/renderer/panel/index.html'))
  await ready
  await sleep(700)
  assert.equal(frames.length, 0, 'idle must not send audio')
  win.webContents.send('test:state', 'listening')
  await sleep(2500)
  const detail = await win.webContents.executeJavaScript('document.body.innerText')
  assert.ok(frames.length >= 5, 'Expected audio frames; panel: ' + detail)
  assert.ok(frames.every(frame => frame.length === 1600), 'Expected 100 ms frames at 16 kHz')
  assert.ok(frames.some(frame => frame.some(sample => Math.abs(sample) > 0.001)), 'Expected non-silent audio')
  const heights = await win.webContents.executeJavaScript('Array.from(document.querySelectorAll("[data-bar]"), bar => parseFloat(bar.style.height))')
  assert.ok(heights.some(height => height > 8), 'Expected waveform movement')
  win.webContents.send('test:state', 'idle')
  await sleep(300)
  const stopped = frames.length
  await sleep(400)
  assert.equal(frames.length, stopped, 'idle must stop sending audio')
  console.log('PASS packaged panel: non-silent 16 kHz frames, waveform and recording gate')
}).catch(error => {
  console.error('FAIL', error)
  exitCode = 1
}).finally(() => {
  clearTimeout(timeout)
  win?.destroy()
  app.exit(exitCode)
})
app.on('quit', () => {
  if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('vocal-capture-')) return
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* Chromium may still hold its temp profile. */ }
})
