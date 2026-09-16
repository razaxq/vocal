/**
 * uiohook-napi 能识别的键名白名单。
 *
 * 这个列表是真实存在的坑：uiohook 的枚举叫 `CtrlRight` 而不是 `RightControl`，
 * 写错了要到运行时注册热键那一刻才炸。所以键名集中在这里，
 * 配置校验、设置界面的下拉、热键注册三处共用同一份，不给打错字的机会。
 *
 * 完整枚举有 124 个键，这里只列适合当「按住说话」的那些 ——
 * 普通字母数字键当热键会把正常打字全部吃掉。
 */

export interface HotkeyChoice {
  /** uiohook 的键名，必须和 UiohookKey 的 key 完全一致 */
  key: string
  label: string
  /**
   * 单独按下时对应用是否无副作用。
   * hold 模式下我们不能吞掉按键，所以只有 safe 的键才不会干扰目标应用。
   */
  safe: boolean
}

export const HOTKEY_CHOICES: HotkeyChoice[] = [
  // 修饰键：单独按下在几乎所有应用里都是空操作，最适合「按住说话」
  { key: 'CtrlRight', label: '右 Ctrl（推荐）', safe: true },
  { key: 'AltRight', label: '右 Alt', safe: true },
  { key: 'ShiftRight', label: '右 Shift', safe: true },
  { key: 'MetaRight', label: '右 Win', safe: true },
  { key: 'Ctrl', label: '左 Ctrl', safe: true },
  { key: 'Alt', label: '左 Alt（可能打开菜单）', safe: false },

  // 功能键：多数应用不用，但有些会（F1 帮助、F5 刷新、F12 开发者工具）
  { key: 'F2', label: 'F2', safe: false },
  { key: 'F3', label: 'F3', safe: false },
  { key: 'F4', label: 'F4', safe: false },
  { key: 'F6', label: 'F6', safe: false },
  { key: 'F7', label: 'F7', safe: false },
  { key: 'F8', label: 'F8', safe: false },
  { key: 'F9', label: 'F9', safe: false },
  { key: 'F10', label: 'F10', safe: false },
  { key: 'F13', label: 'F13', safe: true },
  { key: 'F14', label: 'F14', safe: true },
  { key: 'F15', label: 'F15', safe: true },

  // 其它
  { key: 'CapsLock', label: 'CapsLock（切换大小写）', safe: false }
]

/** 下拉里给出的推荐键。 */
export const HOTKEY_KEYS = HOTKEY_CHOICES.map((c) => c.key)

/**
 * 配置里允许出现的全部键名 —— 比推荐列表宽。
 * 录制器能录到白名单之外的键（用户坚持要用 F5 就让他用），
 * 但仍然必须是 uiohook 真实存在的名字，不能是任意字符串。
 */
export const ALL_RECORDABLE_KEYS: string[] = [
  'Ctrl', 'CtrlRight', 'Alt', 'AltRight', 'Shift', 'ShiftRight',
  'Meta', 'MetaRight', 'CapsLock',
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`)
]

export const DEFAULT_HOTKEY_KEY = 'CtrlRight'

/** 取消键固定用 Escape，不开放配置。 */
export const CANCEL_KEY = 'Escape'

/** Upgrade the former exclusive mouse mode without enabling extra triggers. */
export function migrateHotkeyConfig(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const cfg = value as Record<string, unknown>
  if (cfg.mode !== 'mouseHold') return value
  return { ...cfg, mode: 'hold', keyboardEnabled: cfg.keyboardEnabled ?? false,
    mouseEnabled: cfg.mouseEnabled ?? true, mouseButton: cfg.mouseButton ?? 'middle' }
}

export function isValidHotkeyKey(key: string): boolean {
  return HOTKEY_KEYS.includes(key)
}

export function hotkeyLabel(key: string): string {
  return HOTKEY_CHOICES.find((c) => c.key === key)?.label ?? key
}

/**
 * 浏览器 KeyboardEvent.code → uiohook 键名。
 *
 * 热键录制器用：用户在设置窗口里按一下想用的键，
 * 我们拿 event.code 转成 uiohook 认识的名字存进配置。
 * 两套命名不一致（ControlRight vs CtrlRight），必须显式映射。
 */
const CODE_TO_UIOHOOK: Record<string, string> = {
  ControlRight: 'CtrlRight',
  ControlLeft: 'Ctrl',
  AltRight: 'AltRight',
  AltLeft: 'Alt',
  ShiftRight: 'ShiftRight',
  ShiftLeft: 'Shift',
  MetaRight: 'MetaRight',
  MetaLeft: 'Meta',
  CapsLock: 'CapsLock'
}

/** 认不出或不适合当热键的返回 null。 */
export function fromKeyboardCode(code: string): string | null {
  if (CODE_TO_UIOHOOK[code]) return CODE_TO_UIOHOOK[code]
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code
  return null
}

/** 这个键单独按下时对目标应用有没有副作用。录制器用来给提示。 */
export function isSafeKey(key: string): boolean {
  return HOTKEY_CHOICES.find((c) => c.key === key)?.safe ?? false
}

/** 录制器可能录到白名单之外的键（比如 F5），这时给个可读名字。 */
export function displayKey(key: string): string {
  const known = HOTKEY_CHOICES.find((c) => c.key === key)
  if (known) return known.label
  return key
}
