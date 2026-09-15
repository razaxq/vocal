/**
 * 热键层。
 *
 * 为什么不能只用 Electron 的 globalShortcut：
 *   globalShortcut 只在「按下」时回调，拿不到 keyup，所以做不了「按住说话」。
 *   它的优点是会吞掉按键（不透传给前台应用）。
 *
 * 为什么不能只用 uiohook-napi：
 *   uiohook 装的是 WH_KEYBOARD_LL 低级钩子，能拿到 keydown/keyup，
 *   但这个绑定不支持「消费」事件，按键仍会透传给前台应用。
 *
 * 所以：
 *   hold / doubleTap 用 uiohook，并且默认键选 RightControl —— 单独按修饰键
 *   在几乎所有应用里都是空操作，透传无害。
 *   toggle 用 globalShortcut，因为组合键必须被吞掉。
 */
import { globalShortcut } from 'electron'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import type { HotkeyConfig } from '@shared/types'
import { ALL_RECORDABLE_KEYS, CANCEL_KEY } from '@shared/hotkeys'

export interface HotkeyEvents {
  onStart: () => void
  onStop: () => void
  /** 取消（默认 Esc）：丢弃本次结果，撤回已上屏文本 */
  onCancel: () => void
}

type KeyName = keyof typeof UiohookKey

export class HotkeyService {
  private hookRunning = false
  private active = false
  private lastTapAt = 0
  /** 上一次会话结束的时刻，用于防抖 */
  private lastEndedAt = 0
  /** 本次按下的时刻，用于判断是不是误触 */
  private pressedAt = 0
  private armedByDoubleTap = false
  private keycode = 0
  private cfg: HotkeyConfig | null = null

  constructor(private events: HotkeyEvents) {}

  apply(cfg: HotkeyConfig): void {
    this.teardown()
    this.cfg = cfg

    if (cfg.mode === 'toggle') {
      const ok = globalShortcut.register(cfg.accelerator, () => this.toggle())
      if (!ok) throw new Error(`热键 ${cfg.accelerator} 注册失败，可能已被其它程序占用`)
      // keycode 置 0，下面 onKeyDown 里主键那条分支永远不会命中，
      // 但 Esc 取消仍然要挂上 —— 之前这里直接 return，导致 toggle 模式下
      // 根本没人监听 Esc，界面上的「Esc 取消」提示是个谎。
      this.keycode = 0
    } else {
      const code = UiohookKey[cfg.key as KeyName]
      if (typeof code !== 'number') {
        // uiohook 的枚举是 CtrlRight 而不是 RightControl 这种，写错只会在这里暴露
        throw new Error(
          `未知按键名「${cfg.key}」。可选：${ALL_RECORDABLE_KEYS.join(' / ')}`
        )
      }
      this.keycode = code
    }

    // 三种模式都要监听：hold/doubleTap 靠它拿主键，toggle 靠它拿 Esc
    uIOhook.on('keydown', this.onKeyDown)
    uIOhook.on('keyup', this.onKeyUp)
    if (!this.hookRunning) {
      uIOhook.start()
      this.hookRunning = true
    }
  }

  private onKeyDown = (e: { keycode: number }): void => {
    if (e.keycode === UiohookKey[CANCEL_KEY as KeyName] && this.active) {
      this.active = false
      this.armedByDoubleTap = false
      this.lastEndedAt = Date.now()
      this.events.onCancel()
      return
    }
    if (!this.keycode || e.keycode !== this.keycode || !this.cfg) return

    if (this.cfg.mode === 'hold') {
      if (this.active) return // 长按的自动重复
      if (!this.canStart()) return
      this.active = true
      this.pressedAt = Date.now()
      this.events.onStart()
      return
    }

    // doubleTap：双击开始，再单击结束
    const now = Date.now()
    if (this.active && this.armedByDoubleTap) {
      this.active = false
      this.armedByDoubleTap = false
      this.lastEndedAt = now
      if (now - this.pressedAt < this.cfg.minHoldMs) {
        this.events.onCancel()
        return
      }
      this.events.onStop()
      return
    }
    if (now - this.lastTapAt <= this.cfg.doubleTapWindowMs) {
      this.lastTapAt = 0
      if (!this.canStart()) return
      this.active = true
      this.armedByDoubleTap = true
      this.pressedAt = now
      this.events.onStart()
    } else {
      this.lastTapAt = now
    }
  }

  private onKeyUp = (e: { keycode: number }): void => {
    if (!this.cfg || this.cfg.mode !== 'hold') return
    if (!this.keycode || e.keycode !== this.keycode || !this.active) return

    this.active = false
    this.lastEndedAt = Date.now()

    // 按一下就松：多半是手碰到了，不是真要说话。
    // 走 cancel 而不是 stop —— stop 会让识别链路跑一遍空白音频，
    // 还可能因为模型幻觉往屏幕上打字。
    if (Date.now() - this.pressedAt < this.cfg.minHoldMs) {
      this.events.onCancel()
      return
    }
    this.events.onStop()
  }

  /**
   * 防抖：上一次刚结束就又触发，多半是手抖连按或者键盘抖动。
   * 语音输入的会话有真实开销（开麦、起会话、最后还要跑一遍识别），
   * 连续误触会让面板疯狂闪烁。
   */
  private canStart(): boolean {
    if (!this.cfg) return false
    return Date.now() - this.lastEndedAt >= this.cfg.debounceMs
  }

  private toggle(): void {
    if (!this.active) {
      if (!this.canStart()) return
      this.active = true
      this.pressedAt = Date.now()
      this.events.onStart()
    } else {
      this.active = false
      this.lastEndedAt = Date.now()
      this.events.onStop()
    }
  }

  teardown(): void {
    globalShortcut.unregisterAll()
    uIOhook.off('keydown', this.onKeyDown)
    uIOhook.off('keyup', this.onKeyUp)
    this.active = false
    this.armedByDoubleTap = false
  }

  dispose(): void {
    this.teardown()
    if (this.hookRunning) {
      uIOhook.stop()
      this.hookRunning = false
    }
  }
}
