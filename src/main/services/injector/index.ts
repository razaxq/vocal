/**
 * 文本注入层 —— 把识别结果送进「当前有焦点的那个窗口」。
 *
 * 两条通路：
 *  A. SendInput + KEYEVENTF_UNICODE：合成键盘事件，wScan 直接放 UTF-16 码元，
 *     等价于真的打字。不动剪贴板、可以退格改写、对绝大多数应用透明。
 *  B. 剪贴板 + Ctrl+V：长文本一次到位，代价是污染剪贴板（用完恢复）。
 *
 * **失败自动降级**：选中的策略失败时会自动试下一条，而不是直接报错。
 * 这一点是从 vocotype-cli 的 output.py 学来的 —— 注入失败的原因五花八门
 * （某些应用过滤合成输入、剪贴板被别的程序占用），有备胎才不会让用户
 * 说了半天一个字没出来。最后一道兜底是「至少把文本留在剪贴板里」。
 *
 * 权限前提：本进程必须与目标进程完整性级别相同或更高。以 asInvoker 运行时，
 * 无法向管理员权限的窗口注入（UIPI 拦截），这是 Windows 的设计，不是 bug。
 */
import { clipboard } from 'electron'
import type { InjectionRequest, InjectionResult, InjectionTarget } from '@shared/types'
import type { AppConfig } from '@shared/ipc'
import {
  keyInput, sendInputs, getForegroundInfo,
  KEYEVENTF_UNICODE, KEYEVENTF_KEYUP, VK_CONTROL, VK_V, VK_BACK
} from '@main/win32/user32'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** SendInput 单批上限。太大时部分驱动会丢事件，分批更稳。 */
const BATCH = 200

type Concrete = 'unicode' | 'clipboard'

export class TextInjector {
  constructor(private getConfig: () => AppConfig) {}

  /** 记录当前前台窗口，在弹出悬浮面板之前调用。 */
  captureTarget(): InjectionTarget {
    const { hwnd, processName, windowTitle } = getForegroundInfo()
    return { hwnd, processName, windowTitle }
  }

  /** 目标窗口还是当初那个吗？替换已上屏文本之前必须确认，否则会删掉别人的字。 */
  isStillFocused(target?: InjectionTarget): boolean {
    if (!target?.hwnd) return false
    return getForegroundInfo().hwnd === target.hwnd
  }

  async inject(req: InjectionRequest, target?: InjectionTarget): Promise<InjectionResult> {
    const cfg = this.getConfig().injection
    const chain = this.buildChain(req, target)
    const fellBackFrom: string[] = []

    try {
      if (req.replaceLastChars && req.replaceLastChars > 0) {
        await this.sendBackspaces(req.replaceLastChars)
      }
    } catch (e) {
      return {
        ok: false, used: 'unicode', charsWritten: 0,
        error: `退格失败：${e instanceof Error ? e.message : String(e)}`
      }
    }

    if (!req.text) {
      return { ok: true, used: chain[0] ?? 'unicode', charsWritten: 0 }
    }

    let lastError = ''
    for (const strategy of chain) {
      try {
        if (strategy === 'clipboard') {
          await this.pasteViaClipboard(req.text, cfg.restoreClipboard)
        } else {
          await this.typeUnicode(req.text, cfg.charDelayMs)
        }
        return {
          ok: true,
          used: strategy,
          charsWritten: req.text.length,
          ...(fellBackFrom.length ? { fellBackFrom } : {})
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
        fellBackFrom.push(`${strategy}: ${lastError}`)
      }
    }

    // 全都失败了：至少把文本留在剪贴板，用户能自己 Ctrl+V
    try { await clipboard.writeText(req.text) } catch { /* 尽力而为 */ }

    return {
      ok: false,
      used: chain[chain.length - 1] ?? 'unicode',
      charsWritten: 0,
      fellBackFrom,
      error: `${lastError}。文本已留在剪贴板，可手动粘贴。`
    }
  }

  /**
   * 决定策略顺序。第一个是首选，后面的是备胎。
   * 流式改写必须只用 unicode —— 剪贴板方案没法做「退格重写」。
   */
  private buildChain(req: InjectionRequest, target?: InjectionTarget): Concrete[] {
    const cfg = this.getConfig().injection
    if (req.replaceLastChars) return ['unicode']

    const want = req.strategy ?? cfg.strategy
    if (want === 'unicode') return ['unicode', 'clipboard']
    if (want === 'clipboard') return ['clipboard', 'unicode']

    const proc = (target?.processName ?? getForegroundInfo().processName).toUpperCase()
    if (cfg.clipboardOnlyApps.some((a) => a.toUpperCase() === proc)) {
      return ['clipboard', 'unicode']
    }
    return req.text.length > cfg.clipboardThreshold
      ? ['clipboard', 'unicode']
      : ['unicode', 'clipboard']
  }

  /**
   * 逐 UTF-16 码元合成按键，一批 200 条 INPUT 一次投递。
   *
   * vocotype-cli 是每个字符调一次 SendInput，50 个字就是 50 次系统调用；
   * 批量投递把这个降到 1 次，长句差距明显。
   * emoji / 生僻字的代理对会被自然拆成两个码元，顺序发送即可。
   */
  private async typeUnicode(text: string, charDelayMs: number): Promise<void> {
    const units: number[] = []
    for (let i = 0; i < text.length; i++) units.push(text.charCodeAt(i))

    for (let i = 0; i < units.length; i += BATCH) {
      const slice = units.slice(i, i + BATCH)
      const inputs = slice.flatMap((code) => [
        keyInput({ scan: code, flags: KEYEVENTF_UNICODE }),
        keyInput({ scan: code, flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP })
      ])
      const sent = sendInputs(inputs)
      if (sent !== inputs.length) {
        throw new Error(`SendInput 被拦截（期望 ${inputs.length} 条，实际 ${sent} 条）`)
      }
      if (charDelayMs > 0) await sleep(charDelayMs * slice.length)
      else if (i + BATCH < units.length) await sleep(1)
    }
  }

  private async sendBackspaces(n: number): Promise<void> {
    for (let i = 0; i < n; i += BATCH) {
      const count = Math.min(BATCH, n - i)
      const inputs = Array.from({ length: count }).flatMap(() => [
        keyInput({ vk: VK_BACK }),
        keyInput({ vk: VK_BACK, flags: KEYEVENTF_KEYUP })
      ])
      const sent = sendInputs(inputs)
      if (sent !== inputs.length) throw new Error('退格被拦截')
      await sleep(1)
    }
  }

  private async pasteViaClipboard(text: string, restore: boolean): Promise<void> {
    // Electron 44 起 clipboard.readText / writeText 返回 Promise
    const saved = restore ? await clipboard.readText() : null
    await clipboard.writeText(text)
    // 给目标应用一点时间观察到剪贴板变化，否则少数应用会贴到旧内容
    await sleep(20)

    const sent = sendInputs([
      keyInput({ vk: VK_CONTROL }),
      keyInput({ vk: VK_V }),
      keyInput({ vk: VK_V, flags: KEYEVENTF_KEYUP }),
      keyInput({ vk: VK_CONTROL, flags: KEYEVENTF_KEYUP })
    ])
    if (sent !== 4) throw new Error(`Ctrl+V 被拦截（实际 ${sent}/4 条）`)

    if (restore && saved !== null) {
      // 等粘贴真正完成再还原，否则会把原内容贴进去
      await sleep(180)
      await clipboard.writeText(saved)
    }
  }
}
