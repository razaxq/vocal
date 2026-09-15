/**
 * M0 探针共用的 Win32 绑定（独立于 src/，故意不复用项目代码）。
 *
 * 目的是验证「koffi 这条路本身走不走得通」，所以这里必须是最小可运行的
 * 原始调用 —— 如果连这个都不工作，就不是我们代码的问题，得换 FFI 方案。
 */
const koffi = require('koffi')

/* ---------- 结构体 ---------- */

const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
  dx: 'int32', dy: 'int32', mouseData: 'uint32',
  dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr'
})

const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
  wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32',
  time: 'uint32', dwExtraInfo: 'uintptr'
})

const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', {
  uMsg: 'uint32', wParamL: 'uint16', wParamH: 'uint16'
})

const INPUT_UNION = koffi.union('INPUT_UNION', {
  mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT
})

const INPUT = koffi.struct('INPUT', { type: 'uint32', u: INPUT_UNION })

/* ---------- 常量 ---------- */

const INPUT_KEYBOARD = 1
const KEYEVENTF_KEYUP = 0x0002
const KEYEVENTF_UNICODE = 0x0004
const VOCAL_INJECT_TAG = 0x564f4341 // "VOCA"

/* ---------- 函数 ---------- */

const user32 = koffi.load('user32.dll')

const SendInput = user32.func(
  '__stdcall', 'SendInput', 'uint32',
  ['uint32', koffi.pointer(INPUT), 'int32']
)
const GetForegroundWindow = user32.func(
  '__stdcall', 'GetForegroundWindow', 'uintptr', []
)
const GetWindowTextW = user32.func(
  '__stdcall', 'GetWindowTextW', 'int32',
  ['uintptr', koffi.out(koffi.pointer('uint16')), 'int32']
)

const SIZEOF_INPUT = koffi.sizeof(INPUT)

/* ---------- 便利封装 ---------- */

function keyInput(opts) {
  return {
    type: INPUT_KEYBOARD,
    u: {
      ki: {
        wVk: opts.vk || 0,
        wScan: opts.scan || 0,
        dwFlags: opts.flags || 0,
        time: 0,
        dwExtraInfo: VOCAL_INJECT_TAG
      }
    }
  }
}

/** 把一段文本逐 UTF-16 码元合成按键投递。返回 SendInput 接受的条数。 */
function typeText(text) {
  const inputs = []
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    inputs.push(keyInput({ scan: code, flags: KEYEVENTF_UNICODE }))
    inputs.push(keyInput({ scan: code, flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP }))
  }
  if (inputs.length === 0) return { sent: 0, expected: 0 }
  const sent = SendInput(inputs.length, inputs, SIZEOF_INPUT)
  return { sent, expected: inputs.length }
}

/** 当前前台窗口的句柄和标题。拿不到标题不算失败。 */
function foreground() {
  const hwnd = Number(GetForegroundWindow())
  let title = ''
  if (hwnd) {
    try {
      const buf = new Uint16Array(512)
      const len = GetWindowTextW(hwnd, buf, buf.length)
      title = String.fromCharCode(...buf.subarray(0, Math.max(0, len)))
    } catch (e) {
      title = `(读取标题失败: ${e.message})`
    }
  }
  return { hwnd, title }
}

module.exports = {
  SIZEOF_INPUT, VOCAL_INJECT_TAG,
  typeText, foreground, koffiVersion: koffi.version
}
