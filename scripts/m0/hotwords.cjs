/** 构建后设置页回归：中文组合输入不写配置，保存只发送一次。使用隔离配置。 */
const { app, BrowserWindow, ipcMain } = require('electron')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { tmpdir } = require('node:os')
const { join, resolve, dirname, basename } = require('node:path')
const assert = require('node:assert/strict')
const dir = mkdtempSync(join(tmpdir(), 'vocal-hotwords-ui-'))
app.setPath('userData', join(dir, 'profile'))
let config
try {
  config = JSON.parse(execFileSync('node', ['-e',
    "eval(require('esbuild').buildSync({entryPoints:['src/shared/config.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text); console.log(JSON.stringify(module.exports.defaultConfig()))"], { encoding: 'utf8' }))
} catch (error) { console.error(error); app.exit(1) }
let saves = 0
let failNext = false
ipcMain.handle('test:get', () => config)
ipcMain.handle('test:save', async (_, patch) => {
  saves++
  await new Promise(resolve => setTimeout(resolve, 80))
  if (failNext) { failNext = false; throw new Error('test save failure') }
  config = { ...config, ...patch }
  return config
})
const preload = join(dir, 'preload.cjs')
writeFileSync(preload, `
const { contextBridge, ipcRenderer } = require('electron')
const off = () => () => {}
contextBridge.exposeInMainWorld('vocal', {
  getConfig: () => ipcRenderer.invoke('test:get'), setConfig: p => ipcRenderer.invoke('test:save', p),
  getUpdateStatus: async () => ({ state: 'idle' }), onUpdateStatus: off,
  getHotwordCatalog: async () => ({ version: 3, updatedAt: '2026-09-01', wordCount: 541809,
    words: ['测试词'], source: { eligibleCount: 541809 }, state: 'idle' }), onHotwordCatalog: off,
  modelsStatus: async () => ({ ready: true, installed: {} }),
  onModelsChanged: off, onModelProgress: off, onAsrStatus: off, onGotoTab: off
})
`)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const timeout = setTimeout(() => { console.error('FAIL hotwords UI timed out'); app.exit(1) }, 20000)
let win
let code = 0
const run = js => win.webContents.executeJavaScript(js).catch(error => { throw new Error(js, { cause: error }) })
async function until(js) {
  for (let i = 0; i < 80; i++) { if (await run(js)) return; await sleep(50) }
  throw new Error('UI condition timed out: ' + js + '\n' + await run('document.body.innerText'))
}
app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: false, contextIsolation: true } })
  win.webContents.on('console-message', details => {
    if (details.level === 'error') console.error('renderer:', details.message)
  })
  await win.loadFile(resolve('out/renderer/settings/index.html'))
  await until(`[...document.querySelectorAll('nav button')].some(b => b.textContent === '识别')`)
  await run(`[...document.querySelectorAll('nav button')].find(b => b.textContent === '识别').click()`)
  await until(`Boolean(document.querySelector('textarea'))`)
  await run(`window.field = document.querySelector('textarea');
    window.save = () => [...document.querySelectorAll('button')].find(b => /保存/.test(b.textContent));
    window.edit = text => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, text);
      field.dispatchEvent(new Event('input', { bubbles: true })); };
    field.focus(); field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); edit('zhang');`)
  await sleep(150)
  assert.equal(saves, 0)
  assert.equal(await run('save().disabled'), true)
  await run(`edit(${JSON.stringify('张晓明\n苏州工业园区')}); window.dispatchEvent(new Event('focus'));`)
  await sleep(150)
  assert.equal(await run('field.value'), '张晓明\n苏州工业园区')
  assert.equal(saves, 0)
  await run(`field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '区' }));`)
  await until('!save().disabled')
  await run('save().click(); save().click()')
  await until(`save().textContent === '已保存'`)
  assert.equal(saves, 1)
  assert.deepEqual(config.hotwords, ['张晓明', '苏州工业园区'])
  failNext = true
  await run(`edit('新增词');`)
  await until('!save().disabled')
  await run('save().click()')
  await until(`document.body.innerText.includes('保存失败')`)
  assert.equal(await run('field.value'), '新增词')
  await run('save().click()')
  await until(`save().textContent === '已保存'`)
  assert.deepEqual(config.hotwords, ['新增词'])
  console.log('PASS built settings: IME composition, draft survives refresh, single save, failed-save retry')
}).catch(error => { console.error('FAIL', error); code = 1 }).finally(() => {
  clearTimeout(timeout); win?.destroy(); app.exit(code)
})
app.on('quit', () => {
  if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('vocal-hotwords-ui-')) return
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* Chromium may still hold the test profile. */ }
})
