/**
 * M0 穿刺验证。在 Electron 里跑，验证三个「不过就得换方案」的假设。
 *
 *   npm run m0:native   R2  三个原生模块能不能在 Electron 里加载
 *   npm run m0:focus    R3  focusable:false 的面板会不会夺焦
 *   npm run m0:inject   R1  SendInput 往任意窗口打字（需要你自己看一眼）
 *   npm run m0:roundtrip R1  同上但自己验自己：打完把字读回来比对，无需人工
 *
 * 结果直接打在控制台，PASS / FAIL 一目了然。
 */
const { app, BrowserWindow } = require('electron')

const MODE = (process.argv.find((a) => a.startsWith('--check=')) || '').split('=')[1] || 'native'

const results = []
const pass = (name, detail) => { results.push({ ok: true, name, detail }); log('PASS', name, detail) }
const fail = (name, detail) => { results.push({ ok: false, name, detail }); log('FAIL', name, detail) }
const info = (name, detail) => log('    ', name, detail)

function log(tag, name, detail) {
  const t = tag === 'PASS' ? '\x1b[32mPASS\x1b[0m'
    : tag === 'FAIL' ? '\x1b[31mFAIL\x1b[0m' : '    '
  console.log(`  ${t}  ${name}${detail ? `  —  ${detail}` : ''}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ============================================================
 * R2：原生模块能否在 Electron 里加载
 * ============================================================ */
async function checkNative() {
  console.log('\n【R2】原生模块在 Electron 里的加载\n')

  // koffi
  try {
    const w = require('./win32.cjs')
    pass('koffi', `v${w.koffiVersion}`)
    if (w.SIZEOF_INPUT === 40) {
      pass('INPUT 结构体对齐', `sizeof(INPUT) = ${w.SIZEOF_INPUT}（x64 期望 40）`)
    } else {
      fail('INPUT 结构体对齐', `sizeof(INPUT) = ${w.SIZEOF_INPUT}，期望 40 —— koffi 的联合体布局不对，注入层不能用`)
    }
  } catch (e) {
    fail('koffi', e.message)
  }

  // uiohook-napi
  try {
    const { UiohookKey } = require('uiohook-napi')
    const want = ['CtrlRight', 'AltRight', 'ShiftRight', 'F13', 'Escape']
    const missing = want.filter((k) => typeof UiohookKey[k] !== 'number')
    if (missing.length === 0) {
      pass('uiohook-napi', `CtrlRight=${UiohookKey.CtrlRight} Escape=${UiohookKey.Escape}`)
    } else {
      fail('uiohook-napi', `键名对不上，缺少 ${missing.join(', ')}`)
      info('', `实际有的修饰键：${Object.keys(UiohookKey).filter((k) => /Ctrl|Alt|Shift|Meta/.test(k)).join(', ')}`)
    }
  } catch (e) {
    fail('uiohook-napi', e.message)
  }

  // sherpa-onnx-node —— 这是最可能出问题的一个
  try {
    const sherpa = require('sherpa-onnx-node')
    pass('sherpa-onnx-node', `v${sherpa.version}，onnxruntime ${sherpa.onnxruntimeVersion}`)
    const need = ['OnlineRecognizer', 'OfflineRecognizer', 'OfflinePunctuation']
    const missing = need.filter((k) => typeof sherpa[k] !== 'function')
    if (missing.length === 0) pass('sherpa 导出完整', need.join(' / '))
    else fail('sherpa 导出完整', `缺少 ${missing.join(', ')}`)
  } catch (e) {
    fail('sherpa-onnx-node', `${e.message}\n        → 这一项不过，整个 ASR 方案要换（备选：whisper.cpp 的 Node 绑定）`)
  }

  info('', `Electron ${process.versions.electron} / Node ${process.versions.node} / ${process.arch}`)
}

/* ============================================================
 * R3：focusable:false 的面板会不会夺焦
 * ============================================================ */
async function checkFocus() {
  console.log('\n【R3】悬浮面板不抢焦点\n')
  console.log('  3 秒内请把焦点切到别的窗口（记事本、浏览器都行），然后不要动。\n')
  await sleep(3000)

  const w = require('./win32.cjs')
  const before = w.foreground()
  info('显示前的前台窗口', `hwnd=${before.hwnd} 「${before.title}」`)

  if (!before.hwnd) {
    fail('前置条件', '拿不到前台窗口句柄')
    return
  }

  const panel = new BrowserWindow({
    width: 420, height: 92,
    show: false, frame: false, transparent: true,
    skipTaskbar: true, alwaysOnTop: true,
    focusable: false, hasShadow: false
  })
  panel.setAlwaysOnTop(true, 'screen-saver')
  await panel.loadURL('data:text/html,<body style="background:rgba(30,30,30,.9);color:#fff;font:14px sans-serif;display:flex;align-items:center;justify-content:center">M0 焦点测试面板</body>')

  panel.showInactive()
  await sleep(1200)

  const after = w.foreground()
  info('显示后的前台窗口', `hwnd=${after.hwnd} 「${after.title}」`)

  if (after.hwnd === before.hwnd) {
    pass('面板不夺焦', '前台窗口未变，SendInput 会打到目标应用')
  } else {
    fail('面板不夺焦',
      `前台窗口变了！文字会被打进面板自己。\n        → 需要改用 setIgnoreMouseEvents / WS_EX_NOACTIVATE，或改成无窗口的托盘提示`)
  }

  panel.destroy()
}

/* ============================================================
 * R1：SendInput + KEYEVENTF_UNICODE 能不能真的打出字
 * ============================================================ */
async function checkInject() {
  console.log('\n【R1】SendInput 文本注入\n')
  console.log('  请在 5 秒内点进一个能输入文字的地方（记事本最干净），光标要在闪。\n')

  for (let i = 5; i > 0; i--) {
    process.stdout.write(`\r  ${i} ...   `)
    await sleep(1000)
  }
  process.stdout.write('\r        \r')

  const w = require('./win32.cjs')
  const target = w.foreground()
  info('目标窗口', `hwnd=${target.hwnd} 「${target.title}」`)

  const sample = '你好 hello 123 —— Vocal M0'
  const r = w.typeText(sample)

  if (r.sent === r.expected) {
    pass('SendInput 全部被接受', `${r.sent}/${r.expected} 条`)
    console.log(`\n  现在去看那个窗口，应该出现了：${sample}`)
    console.log('  字对、顺序对、中英数字都在 → R1 通过')
    console.log('  一个字没有 / 乱码 / 缺字 → R1 不通过，需要改用 napi-rs 写原生模块\n')
  } else {
    fail('SendInput 被拦截', `只接受了 ${r.sent}/${r.expected} 条`)
    console.log('\n  → 可能原因：目标窗口是管理员权限（UIPI 拦截），或安全软件拦了合成输入。')
    console.log('  → 换一个普通权限的记事本再试一次；还不行就要换 FFI 方案。\n')
  }
}

/* ============================================================
 * R1 自动版：往返验证 SendInput 打出来的到底是不是那些字
 *
 * 手动版只能证明「系统收下了 48 条事件」，证明不了渲染成了正确的字符。
 * 这里自己开一个带输入框的窗口当靶子，打完再把 value 读回来逐字符比对，
 * 全程无需人工判断。靶子是 Chromium 控件，等价于 Chrome / VS Code /
 * 微信桌面版这类应用；Win32 原生控件（记事本）仍建议手动过一次。
 * ============================================================ */
async function checkRoundtrip() {
  console.log('\n【R1·自动】SendInput 往返验证\n')
  console.log('  会弹一个测试窗口并自动抢焦点，几秒后自己关掉。期间别动键盘鼠标。\n')
  await sleep(1500)

  const w = require('./win32.cjs')

  const win = new BrowserWindow({
    width: 560, height: 200, show: false, alwaysOnTop: true,
    title: 'Vocal M0 靶子窗口',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })

  await win.loadURL(
    'data:text/html;charset=utf-8,' + encodeURIComponent(`
      <body style="margin:0;font:14px system-ui;background:#1e1e1e;color:#eee;
                   display:flex;flex-direction:column;gap:10px;padding:20px">
        <div>M0 靶子窗口 —— 正在自动测试注入，请勿操作</div>
        <input id="t" style="font:16px system-ui;padding:8px;width:100%;box-sizing:border-box">
      </body>`)
  )

  win.show()
  win.focus()
  win.webContents.focus()
  await win.webContents.executeJavaScript(`document.getElementById('t').focus()`)
  await sleep(600)

  const fg = w.foreground()
  info('当前前台窗口', `hwnd=${fg.hwnd} 「${fg.title}」`)

  const sample = '你好 hello 123 —— Vocal'
  const r = w.typeText(sample)

  if (r.sent !== r.expected) {
    fail('SendInput 被拦截', `只接受了 ${r.sent}/${r.expected} 条`)
    win.destroy()
    return
  }
  pass('SendInput 全部被接受', `${r.sent}/${r.expected} 条`)

  // 逐字符合成需要一点时间落到 DOM
  await sleep(800)
  const got = await win.webContents.executeJavaScript(`document.getElementById('t').value`)

  if (got === sample) {
    pass('往返比对', `输入框里正是「${got}」—— 中文 / 英文 / 数字 / 破折号全部正确`)
  } else {
    fail('往返比对', '打进去的字和预期不符')
    console.log(`        期望：${JSON.stringify(sample)}`)
    console.log(`        实际：${JSON.stringify(got)}`)
    const n = Math.max(sample.length, String(got).length)
    for (let i = 0; i < n; i++) {
      if (sample[i] !== String(got)[i]) {
        console.log(`        第 ${i} 个字符起分叉：期望 ${JSON.stringify(sample[i])}，实际 ${JSON.stringify(String(got)[i])}`)
        break
      }
    }
  }

  win.destroy()
}

/* ============================================================ */

app.whenReady().then(async () => {
  console.log('\n═══ Vocal M0 穿刺验证 ═══')
  try {
    if (MODE === 'native') await checkNative()
    else if (MODE === 'focus') await checkFocus()
    else if (MODE === 'inject') await checkInject()
    else if (MODE === 'roundtrip') await checkRoundtrip()
    else console.log(`  未知的 --check=${MODE}，可选 native / focus / inject / roundtrip`)
  } catch (e) {
    fail('探针本身崩了', e.stack || e.message)
  }

  const bad = results.filter((r) => !r.ok).length
  console.log(`\n═══ ${results.length - bad} 通过 / ${bad} 失败 ═══\n`)
  app.exit(bad > 0 ? 1 : 0)
})

app.on('window-all-closed', () => { /* 探针自己控制退出 */ })
