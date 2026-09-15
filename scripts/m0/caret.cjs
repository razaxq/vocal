/**
 * 光标位置探针。
 *
 *   npm run m0:caret
 *
 * 跑起来之后去点别的窗口，每换一个前台窗口这里就打一行，
 * 告诉你这个应用**能不能**被查到文字光标位置，以及面板会落在哪。
 *
 * 为什么需要这个：「跟随光标」在很多应用里没效果不是 bug，
 * 是 Win32 的 caret 只有真的调用了 CreateCaret 的应用才有。
 * Chrome、Electron 应用、UWP、终端全都自己画光标，系统查不到。
 * 与其让用户逐个试、猜哪儿出了问题，不如让程序自己说。
 */
const { app } = require('electron')
const koffi = require('koffi')

const user32 = koffi.load('user32.dll')
const kernel32 = koffi.load('kernel32.dll')

const RECT = koffi.struct('RECT', {
  left: 'int32', top: 'int32', right: 'int32', bottom: 'int32'
})
const POINT = koffi.struct('POINT', { x: 'int32', y: 'int32' })
const GUITHREADINFO = koffi.struct('GUITHREADINFO', {
  cbSize: 'uint32',
  flags: 'uint32',
  hwndActive: 'uintptr',
  hwndFocus: 'uintptr',
  hwndCapture: 'uintptr',
  hwndMenuOwner: 'uintptr',
  hwndMoveSize: 'uintptr',
  hwndCaret: 'uintptr',
  rcCaret: RECT
})

const GetForegroundWindow = user32.func('__stdcall', 'GetForegroundWindow', 'uintptr', [])
const GetWindowThreadProcessId = user32.func(
  '__stdcall', 'GetWindowThreadProcessId', 'uint32',
  ['uintptr', koffi.out(koffi.pointer('uint32'))]
)
const GetWindowTextW = user32.func(
  '__stdcall', 'GetWindowTextW', 'int32',
  ['uintptr', koffi.out(koffi.pointer('uint16')), 'int32']
)
const GetGUIThreadInfo = user32.func(
  '__stdcall', 'GetGUIThreadInfo', 'int32',
  ['uint32', koffi.inout(koffi.pointer(GUITHREADINFO))]
)
const ClientToScreen = user32.func(
  '__stdcall', 'ClientToScreen', 'int32',
  ['uintptr', koffi.inout(koffi.pointer(POINT))]
)
const GetWindowRect = user32.func(
  '__stdcall', 'GetWindowRect', 'int32', ['uintptr', koffi.out(koffi.pointer(RECT))]
)
const OpenProcess = kernel32.func(
  '__stdcall', 'OpenProcess', 'uintptr', ['uint32', 'int32', 'uint32']
)
const CloseHandle = kernel32.func('__stdcall', 'CloseHandle', 'int32', ['uintptr'])
const QueryFullProcessImageNameW = kernel32.func(
  '__stdcall', 'QueryFullProcessImageNameW', 'int32',
  ['uintptr', 'uint32', koffi.out(koffi.pointer('uint16')), koffi.inout(koffi.pointer('uint32'))]
)

const SIZEOF_GUITHREADINFO = koffi.sizeof(GUITHREADINFO)
const wstr = (buf, len) => Buffer.from(buf.buffer, 0, len * 2).toString('utf16le')

function foreground() {
  const hwnd = GetForegroundWindow()
  if (!hwnd) return null
  const pidOut = [0]
  const threadId = GetWindowThreadProcessId(hwnd, pidOut)
  const titleBuf = new Uint16Array(512)
  const n = GetWindowTextW(hwnd, titleBuf, 512)

  let proc = '?'
  const h = OpenProcess(0x1000 /* QUERY_LIMITED_INFORMATION */, 0, pidOut[0])
  if (h) {
    const buf = new Uint16Array(520)
    const size = [520]
    if (QueryFullProcessImageNameW(h, 0, buf, size)) {
      proc = wstr(buf, size[0]).split('\\').pop()
    }
    CloseHandle(h)
  }
  return { hwnd, threadId, title: wstr(titleBuf, n), proc }
}

function caretOf(threadId) {
  const info = { cbSize: SIZEOF_GUITHREADINFO }
  if (!GetGUIThreadInfo(threadId, info)) {
    return { ok: false, why: `GetGUIThreadInfo 失败（多半是目标进程权限更高）` }
  }
  const hwndCaret = Number(info.hwndCaret ?? 0)
  if (!hwndCaret) {
    return { ok: false, why: '这个应用没有 Win32 caret（自己画的光标）' }
  }
  const r = info.rcCaret
  const pt = { x: r.left, y: r.top }
  if (!ClientToScreen(hwndCaret, pt)) return { ok: false, why: 'ClientToScreen 失败' }
  return { ok: true, x: pt.x, y: pt.y, w: r.right - r.left, h: r.bottom - r.top }
}

function windowRect(hwnd) {
  const r = {}
  if (!GetWindowRect(hwnd, r)) return null
  return { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top }
}

app.whenReady().then(() => {
  console.log('\n═══ 光标位置探针 ═══')
  console.log('去点别的窗口试试：记事本、Word、微信、Chrome、VS Code、终端…')
  console.log('每换一个前台窗口打一行。Ctrl+C 退出。\n')

  let lastKey = ''
  setInterval(() => {
    const fg = foreground()
    if (!fg) return
    const key = `${fg.hwnd}`
    if (key === lastKey) return
    lastKey = key

    const c = caretOf(fg.threadId)
    const name = `${fg.proc}${fg.title ? `  「${fg.title.slice(0, 28)}」` : ''}`
    if (c.ok) {
      console.log(`  \x1b[32m跟随光标\x1b[0m  ${name}`)
      console.log(`            光标在屏幕 (${c.x}, ${c.y})，高 ${c.h}px → 面板落在它下方 8px`)
    } else {
      const wr = windowRect(fg.hwnd)
      console.log(`  \x1b[33m退到窗口底部\x1b[0m  ${name}`)
      console.log(`            ${c.why}`)
      if (wr) console.log(`            窗口 (${wr.x}, ${wr.y}) ${wr.w}×${wr.h} → 面板落在窗口底部居中`)
    }
  }, 600)
})
