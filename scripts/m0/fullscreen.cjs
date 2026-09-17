/** Exercise real Win32 geometry on hidden windows; substitute only the foreground handle. */
const { app, BrowserWindow, screen } = require('electron')
const { buildSync } = require('esbuild')
const { runInNewContext } = require('node:vm')
const assert = require('node:assert/strict')
const koffi = require('koffi')
let foreground = 0
const native = { ...koffi, load: name => {
  const library = koffi.load(name)
  return { func: (...args) => args[1] === 'GetForegroundWindow' ? () => foreground : library.func(...args) }
} }
const mod = { exports: {} }
const source = buildSync({ entryPoints: ['src/main/win32/user32.ts'], bundle: true,
  platform: 'node', format: 'cjs', write: false, external: ['koffi'] }).outputFiles[0].text
runInNewContext(source, { module: mod, exports: mod.exports, Uint16Array,
  require: name => { if (name === 'koffi') return native; throw Error(name) } })
let win
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  assert.equal(mod.exports.isForegroundFullscreen(), false)
  for (const display of screen.getAllDisplays()) {
    for (const [frame, bounds, expected] of [
      [false, display.bounds, true],
      [true, display.bounds, false],
      [false, { ...display.bounds, width: 400, height: 300 }, false]
    ]) {
      win = new BrowserWindow({ ...bounds, show: false, frame, useContentSize: false })
      win.setMenu(null)
      if (expected) win.setFullScreen(true)
      await new Promise(resolve => setTimeout(resolve, 150))
      foreground = Number(win.getNativeWindowHandle().readBigUInt64LE())
      assert.equal(mod.exports.isForegroundFullscreen(), expected,
        JSON.stringify({ bounds, frame, scale: display.scaleFactor }))
      win.destroy(); win = undefined
    }
  }
  console.log('PASS Win32 fullscreen geometry: hidden borderless, framed and normal windows on each display')
  app.exit(0)
}).catch(error => { console.error(error); win?.destroy(); app.exit(1) })
