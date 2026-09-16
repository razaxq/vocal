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
let deletes = 0
let finishDelete
let currentAsr = null
ipcMain.handle('test:models', () => ({ ready: true, installed: Object.fromEntries(
  [...Object.values(config.models), 'macbert4csc', 'bert-chinese-int8'].map(id => [id, { id, installed: true, bytes: 100 * 1048576 }])), asr: currentAsr }))
ipcMain.handle('test:delete', () => { deletes++; return new Promise(resolve => { finishDelete = resolve }) })
ipcMain.handle('test:get', () => config)
ipcMain.handle('test:save', async (_, patch) => {
  saves++
  await new Promise(resolve => setTimeout(resolve, 80))
  if (failNext) { failNext = false; throw new Error('test save failure') }
  config = { ...config, ...patch, models: { ...config.models, ...patch.models } }
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
  modelsStatus: () => ipcRenderer.invoke('test:models'), deleteModel: id => ipcRenderer.invoke('test:delete', id),
  onModelsChanged: off, onModelProgress: off, onGotoTab: off,
  onAsrStatus: cb => { const handler = (_, value) => cb(value); ipcRenderer.on('test:asr', handler);
    return () => ipcRenderer.removeListener('test:asr', handler); }
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
  await run(`[...document.querySelectorAll('nav button')].find(b => b.textContent === '通用').click()`)
  await until(`document.querySelector('[role="switch"][aria-label="自动更新"]')?.getAttribute('aria-checked') === 'true'`)
  assert.equal(await run(`[...document.querySelectorAll('[role="switch"]')].some(b => /检查更新/.test(b.getAttribute('aria-label') || ''))`), false)
  await run(`document.querySelector('[role="switch"][aria-label="自动更新"]').click()`)
  await until(`document.querySelector('[role="switch"][aria-label="自动更新"]')?.getAttribute('aria-checked') === 'false'`)
  assert.equal(config.update.auto, false)
  await run(`[...document.querySelectorAll('nav button')].find(b => b.textContent === '触发方式').click()`)
  await run(`[...document.querySelectorAll('nav button')].find(b => b.textContent === '通用').click()`)
  await until(`document.querySelector('[role="switch"][aria-label="自动更新"]')?.getAttribute('aria-checked') === 'false'`)
  await run(`document.querySelector('[role="switch"][aria-label="自动更新"]').click()`)
  await until(`document.querySelector('[role="switch"][aria-label="自动更新"]')?.getAttribute('aria-checked') === 'true'`)
  assert.equal(config.update.auto, true)
  console.log('PASS built general settings: automatic updates enabled by default, toggle persists')
  saves = 0
  await run(`[...document.querySelectorAll('nav button')].find(b => b.textContent === '识别').click()`)
  await until(`Boolean(document.querySelector('textarea'))`)
  for (const [label, id] of [['MacBERT 中文纠错', 'macbert4csc'], ['BERT 中文纠错 · 轻量', 'bert-chinese-int8']]) {
    await run(`[...document.querySelectorAll('[role="radio"]')].find(row => row.textContent.includes(${JSON.stringify(label)})).click()`)
    await until(`[...document.querySelectorAll('[role="radio"]')].find(row => row.textContent.includes(${JSON.stringify(label)}))?.getAttribute('aria-checked') === 'true'`)
    assert.equal(config.models.correction, id)
  }
  await run(`[...document.querySelectorAll('[role="radio"]')].find(row => row.textContent.includes('MacBERT 中文纠错')).parentElement.querySelector('[role="radio"]').click()`)
  await sleep(150)
  assert.equal(config.models.correction, 'none')
  await run(`[...document.querySelectorAll('[role="radio"]')].find(row => row.textContent.includes('Zipformer 中文')).click()`)
  await sleep(150)
  // Both clicks happen before either IPC save resolves, while the first model is loading.
  currentAsr = { state: 'loading', targets: { streaming: 'none' } }
  win.webContents.send('test:asr', currentAsr)
  await run(`document.querySelector('[role="radio"]').click();
    [...document.querySelectorAll('[role="radio"]')].find(row => row.textContent.includes('MacBERT 中文纠错')).click()`)
  await sleep(250)
  assert.equal(config.models.streaming, 'none', 'changing correction must retain the pending streaming selection')
  assert.equal(config.models.correction, 'macbert4csc')
  await run(`[...document.querySelectorAll('[role="radio"]')].find(row => row.textContent.includes('Zipformer 中文')).click()`)
  await sleep(150)
  currentAsr = null
  console.log('PASS overlapping model selections preserve both slots')
  saves = 0
  console.log('PASS correction settings: select either model or disable independently')
  currentAsr = { state: 'loading', targets: { offline: config.models.offline } }
  win.webContents.send('test:asr', currentAsr)
  await until(`document.querySelectorAll('[role="status"]').length === 1`)
  assert.equal(await run(`document.querySelector('[role="status"]').closest('[role="radio"]').textContent.includes('Paraformer 三语')`), true)
  assert.equal(await run(`document.body.innerText.includes('正在准备模型')`), false)
  // 切走再回来仍能从模型状态快照恢复加载动画。
  await run(`[...document.querySelectorAll('nav button')].find(b => b.textContent === '触发方式').click()`)
  await until(`!document.querySelector('[role="radio"]')`)
  await run(`[...document.querySelectorAll('nav button')].find(b => b.textContent === '识别').click()`)
  await until(`document.querySelectorAll('[role="status"]').length === 1`)
  currentAsr = { ...currentAsr, state: 'ready' }
  win.webContents.send('test:asr', currentAsr)
  await until(`document.querySelectorAll('[role="status"]').length === 0`)
  await run(`window.removeModel = document.querySelector('button[title="删除模型"]'); removeModel.click(); removeModel.click()`)
  await until(`document.querySelector('button[title="正在删除"]')?.disabled === true`)
  assert.equal(deletes, 1)
  assert.equal(await run(`document.querySelector('button[title="正在删除"] svg.animate-spin') !== null`), true)
  finishDelete()
  await until(`!document.querySelector('button[title="正在删除"]')`)
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
  await run(`[...document.querySelectorAll('nav button')].find(b => b.textContent === '触发方式').click()`)
  await until(`document.querySelector('[role="switch"][aria-label="鼠标触发"]') !== null`)
  await run(`document.querySelector('[role="switch"][aria-label="鼠标触发"]').click()`)
  await until(`document.querySelector('[aria-label="启动延迟（秒）"]') !== null`)
  assert.equal(config.hotkey.keyboardEnabled, true)
  assert.equal(config.hotkey.mouseEnabled, true)
  assert.equal(config.hotkey.mouseButton, 'middle')
  await run(`document.querySelector('[role="switch"][aria-label="键盘触发"]').click()`)
  await until(`document.querySelector('[role="switch"][aria-label="键盘触发"]').getAttribute('aria-checked') === 'false'`)
  assert.equal(config.hotkey.mouseEnabled, true)
  assert.equal(await run(`document.body.innerText.includes('Esc')`), false)
  const beforeDelaySave = saves
  await run(`window.delayField = document.querySelector('[aria-label="启动延迟（秒）"]');
    window.editDelay = text => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(delayField, text);
      delayField.dispatchEvent(new Event('input', { bubbles: true })); };
    delayField.focus(); editDelay('');`)
  await sleep(100)
  assert.equal(saves, beforeDelaySave)
  await run(`delayField.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))`)
  await until(`document.body.innerText.includes('请输入 0.1–10 秒')`)
  assert.equal(saves, beforeDelaySave)
  await run(`delayField.focus(); editDelay('2.5');`)
  await sleep(100)
  assert.equal(saves, beforeDelaySave)
  await run(`delayField.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))`)
  await until(`document.querySelector('[aria-label="启动延迟（秒）"]').value === '2.5' && !document.querySelector('[role="alert"]')`)
  // Wait for the async IPC write, then remount the tab to check persistence.
  await sleep(150)
  assert.equal(config.hotkey.mouseHoldDelayMs, 2500)
  assert.equal(saves, beforeDelaySave + 1)
  await run(`[...document.querySelectorAll('nav button')].find(b => b.textContent === '识别').click()`)
  await run(`[...document.querySelectorAll('nav button')].find(b => b.textContent === '触发方式').click()`)
  await until(`document.querySelector('[aria-label="启动延迟（秒）"]')?.value === '2.5'`)
  await run(`delayField = document.querySelector('[aria-label="启动延迟（秒）"]'); editDelay('3.5');`)
  await run(`delayField.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    [...document.querySelectorAll('button')].find(b => b.textContent === '中键（按下滚轮）').click();`)
  await until(`document.querySelector('[role="option"]') !== null`)
  assert.deepEqual(await run(`[...document.querySelectorAll('[role="option"]')].map(b => b.textContent)`), ['左键', '中键（按下滚轮）', '左键＋中键'])
  await run(`[...document.querySelectorAll('[role="option"]')].find(b => b.textContent === '左键＋中键').click()`)
  await until(`[...document.querySelectorAll('button')].some(b => b.textContent === '左键＋中键')`)
  assert.equal(config.hotkey.mouseButton, 'leftMiddle')
  assert.equal(config.hotkey.mouseHoldDelayMs, 3500)
  await run(`[...document.querySelectorAll('button')].find(b => b.textContent === '左键＋中键').click()`)
  await until(`document.querySelector('[role="option"]') !== null`)
  await run(`[...document.querySelectorAll('[role="option"]')].find(b => b.textContent === '左键').click()`)
  await until(`[...document.querySelectorAll('button')].some(b => b.textContent === '左键')`)
  assert.equal(config.hotkey.mouseButton, 'left')
  await run(`[...document.querySelectorAll('nav button')].find(b => b.textContent === '识别').click()`)
  await run(`[...document.querySelectorAll('nav button')].find(b => b.textContent === '触发方式').click()`)
  await until(`[...document.querySelectorAll('button')].some(b => b.textContent === '左键')`)
  assert.equal(config.hotkey.mouseButton, 'left')
  assert.equal(config.hotkey.mouseHoldDelayMs, 3500)
  await run(`document.querySelector('[role="switch"][aria-label="键盘触发"]').click()`)
  await until(`document.body.innerText.includes('Esc')`)
  assert.equal(config.hotkey.keyboardEnabled, true)
  assert.equal(config.hotkey.mouseEnabled, true)
  await run(`document.querySelector('[role="switch"][aria-label="鼠标触发"]').click()`)
  await until(`document.querySelector('[aria-label="启动延迟（秒）"]') === null`)
  assert.equal(config.hotkey.keyboardEnabled, true)
  assert.equal(config.hotkey.mouseEnabled, false)
  assert.equal(config.hotkey.mouseHoldDelayMs, 3500)
  console.log('PASS built trigger settings: independent switches, left/middle/left-middle selection, delay validation and persistence')
  console.log('PASS built settings: target-row loading and navigation, delete icon and duplicate-click guard, IME composition and save')
}).catch(error => { console.error('FAIL', error); code = 1 }).finally(() => {
  clearTimeout(timeout); win?.destroy(); app.exit(code)
})
app.on('quit', () => {
  if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('vocal-hotwords-ui-')) return
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* Chromium may still hold the test profile. */ }
})
