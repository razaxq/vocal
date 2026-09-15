/**
 * Win32 绑定层（koffi FFI，无需本地编译工具链）。
 *
 * 只封装「注入文本」和「定位光标」这两件事需要的 API。
 * 全部调用都集中在这里，其余代码不直接碰 FFI。
 *
 * 注意：koffi 的 out 参数语义与结构体对齐在 Windows x64 上需实机验证，
 * 相关位置已标 [VERIFY]。
 */
import koffi from 'koffi'

/* ---------- 类型定义 ---------- */

const RECT = koffi.struct('RECT', {
  left: 'int32', top: 'int32', right: 'int32', bottom: 'int32'
})

const POINT = koffi.struct('POINT', { x: 'int32', y: 'int32' })

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

// x64 下 sizeof(INPUT) == 40，koffi 会按 C 规则自动补齐 type 后的 4 字节 padding。
const INPUT = koffi.struct('INPUT', { type: 'uint32', u: INPUT_UNION })

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

/* ---------- 常量 ---------- */

export const INPUT_KEYBOARD = 1
export const KEYEVENTF_EXTENDEDKEY = 0x0001
export const KEYEVENTF_KEYUP = 0x0002
export const KEYEVENTF_UNICODE = 0x0004
export const KEYEVENTF_SCANCODE = 0x0008

export const VK_CONTROL = 0x11
export const VK_V = 0x56
export const VK_BACK = 0x08

export const SIZEOF_INPUT = koffi.sizeof(INPUT)
export const SIZEOF_GUITHREADINFO = koffi.sizeof(GUITHREADINFO)

/**
 * 我们自己合成的按键都打上这个标记（dwExtraInfo）。
 *
 * 作用是让低级键盘钩子能认出「这是我自己打的字」并放行，
 * 否则注入的字符会反过来触发我们的热键逻辑，或者在 live 模式下
 * 被当成用户输入再喂一遍。vocotype-cli 用的是 GetMessageExtraInfo()，
 * 但那个值不可控也认不出来，用固定魔数更可靠。
 *
 * 取值避开 0（很多程序用 0 判断「无额外信息」）和常见的驱动标记。
 */
export const VOCAL_INJECT_TAG = 0x564f_4341 // "VOCA"

/* ---------- 函数绑定 ---------- */

const user32 = koffi.load('user32.dll')
const kernel32 = koffi.load('kernel32.dll')

export const SendInput = user32.func(
  '__stdcall', 'SendInput', 'uint32',
  ['uint32', koffi.pointer(INPUT), 'int32']
)

export const GetForegroundWindow = user32.func(
  '__stdcall', 'GetForegroundWindow', 'uintptr', []
)

export const GetWindowThreadProcessId = user32.func(
  '__stdcall', 'GetWindowThreadProcessId', 'uint32',
  ['uintptr', koffi.out(koffi.pointer('uint32'))]
)

export const GetWindowTextW = user32.func(
  '__stdcall', 'GetWindowTextW', 'int32',
  ['uintptr', koffi.out(koffi.pointer('uint16')), 'int32']
)

export const AttachThreadInput = user32.func(
  '__stdcall', 'AttachThreadInput', 'int32',
  ['uint32', 'uint32', 'int32']
)

export const GetCurrentThreadId = kernel32.func(
  '__stdcall', 'GetCurrentThreadId', 'uint32', []
)

// [VERIFY] out 结构体参数：koffi 要求传入一个 JS 对象，调用后被就地填充。
export const GetGUIThreadInfo = user32.func(
  '__stdcall', 'GetGUIThreadInfo', 'int32',
  ['uint32', koffi.inout(koffi.pointer(GUITHREADINFO))]
)

export const ClientToScreen = user32.func(
  '__stdcall', 'ClientToScreen', 'int32',
  ['uintptr', koffi.inout(koffi.pointer(POINT))]
)

export const GetWindowRect = user32.func(
  '__stdcall', 'GetWindowRect', 'int32',
  ['uintptr', koffi.out(koffi.pointer(RECT))]
)

export const MapVirtualKeyW = user32.func(
  '__stdcall', 'MapVirtualKeyW', 'uint32', ['uint32', 'uint32']
)

const OpenProcess = kernel32.func(
  '__stdcall', 'OpenProcess', 'uintptr', ['uint32', 'int32', 'uint32']
)
const CloseHandle = kernel32.func('__stdcall', 'CloseHandle', 'int32', ['uintptr'])
const QueryFullProcessImageNameW = kernel32.func(
  '__stdcall', 'QueryFullProcessImageNameW', 'int32',
  ['uintptr', 'uint32', koffi.out(koffi.pointer('uint16')), koffi.inout(koffi.pointer('uint32'))]
)

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

/* ---------- 便利封装 ---------- */

/** 构造一个键盘 INPUT 结构。 */
export function keyInput(opts: {
  vk?: number; scan?: number; flags?: number
}): Record<string, unknown> {
  return {
    type: INPUT_KEYBOARD,
    u: {
      ki: {
        wVk: opts.vk ?? 0,
        wScan: opts.scan ?? 0,
        dwFlags: opts.flags ?? 0,
        time: 0,
        dwExtraInfo: VOCAL_INJECT_TAG
      }
    }
  }
}

/** 把一批 INPUT 一次性投递。返回实际被系统接受的条数。 */
export function sendInputs(inputs: Array<Record<string, unknown>>): number {
  if (inputs.length === 0) return 0
  return SendInput(inputs.length, inputs, SIZEOF_INPUT) as number
}

function decodeWide(buf: Uint16Array, len?: number): string {
  const end = len ?? buf.indexOf(0)
  return String.fromCharCode(...buf.subarray(0, end < 0 ? buf.length : end))
}

/** 读取当前前台窗口的标题与进程可执行文件名。 */
export function getForegroundInfo(): {
  hwnd: number; threadId: number; processName: string; windowTitle: string
} {
  const hwnd = Number(GetForegroundWindow())
  if (!hwnd) return { hwnd: 0, threadId: 0, processName: '', windowTitle: '' }

  const pidOut: number[] = [0]
  const threadId = GetWindowThreadProcessId(hwnd, pidOut) as number
  const pid = pidOut[0] ?? 0

  const titleBuf = new Uint16Array(512)
  const titleLen = GetWindowTextW(hwnd, titleBuf, titleBuf.length) as number
  const windowTitle = decodeWide(titleBuf, titleLen)

  let processName = ''
  if (pid) {
    const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
    if (h) {
      try {
        const pathBuf = new Uint16Array(1024)
              const sizeRef: number[] = [pathBuf.length]
        if (QueryFullProcessImageNameW(h, 0, pathBuf, sizeRef)) {
          const full = decodeWide(pathBuf, sizeRef[0])
          processName = full.split('\\').pop() ?? ''
        }
      } finally {
        CloseHandle(h)
      }
    }
  }
  return { hwnd, threadId, processName, windowTitle }
}

/**
 * 取前台窗口的插入符（光标）屏幕坐标，用于把悬浮条贴到光标旁边。
 * 拿不到时返回 null —— 很多应用（Chrome、Electron、终端）不上报 caret，
 * 这时调用方应退化到「跟随鼠标」或「屏幕底部居中」。
 */
/**
 * 前台窗口在屏幕上的矩形。
 *
 * 拿不到光标位置时用它兜底：把面板放在**你正在用的那个窗口**下方，
 * 而不是屏幕正下方。多显示器、或者窗口只占屏幕一角的时候，
 * 差别很明显 —— 后者会把面板甩到另一块屏幕或者半个屏幕之外。
 */
export function getForegroundWindowRect(): { x: number; y: number; w: number; h: number } | null {
  const hwnd = GetForegroundWindow() as number
  if (!hwnd) return null
  const r: Record<string, number> = {}
  if (!GetWindowRect(hwnd, r)) return null
  const w = (r.right ?? 0) - (r.left ?? 0)
  const h = (r.bottom ?? 0) - (r.top ?? 0)
  if (w <= 0 || h <= 0) return null
  return { x: r.left ?? 0, y: r.top ?? 0, w, h }
}

export function getCaretScreenRect(): { x: number; y: number; w: number; h: number } | null {
  const { threadId } = getForegroundInfo()
  if (!threadId) return null

  const info: Record<string, any> = { cbSize: SIZEOF_GUITHREADINFO }
  if (!GetGUIThreadInfo(threadId, info)) return null

  const caretHwnd = Number(info.hwndCaret ?? 0)
  const r = info.rcCaret
  if (!caretHwnd || !r) return null
  if (r.right - r.left <= 0 && r.bottom - r.top <= 0) return null

  const pt: { x: number; y: number } = { x: r.left, y: r.top }
  if (!ClientToScreen(caretHwnd, pt)) return null

  return { x: pt.x, y: pt.y, w: r.right - r.left, h: r.bottom - r.top }
}
