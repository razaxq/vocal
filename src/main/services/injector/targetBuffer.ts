/**
 * 目标窗口的文本镜像。
 *
 * 记着「我往那个窗口里打了什么」，然后用最小改动把它推进到新状态：
 * 算公共前缀，退掉多余的，补上新增的。
 *
 * 追加（每段定稿后上屏）和改写（流式 partial、LLM 整理替换）
 * 走的是同一条路 —— 追加时公共前缀就是已写内容，退格数为 0，
 * 所以不需要两套代码。
 *
 * 安全约束，这些是能不能放心用退格的前提：
 *  1. 目标窗口必须还是当初那个（hwnd 一致），否则会删掉别人的字；
 *  2. 单次退格数有上限，超了就拒绝改写而不是硬删。
 */
import type { TextInjector } from './index'
import type { InjectionTarget } from '@shared/types'

export interface TargetBufferOptions {
  /** 单次最多允许退掉多少字符 */
  maxBackspaces: number
}

export class TargetBuffer {
  private written = ''
  private queue: Promise<unknown> = Promise.resolve()

  private injector: TextInjector
  private target: InjectionTarget | undefined
  private opts: TargetBufferOptions
  constructor(injector: TextInjector, target: InjectionTarget | undefined, opts: TargetBufferOptions) {
    this.injector = injector; this.target = target; this.opts = opts
  }

  get length(): number {
    return this.written.length
  }

  get content(): string {
    return this.written
  }

  /**
   * 把目标窗口里的文本推进到 next。串行化，避免并发注入互相插队。
   * 返回是否真的写成功了 —— 拒绝改写时返回 false，调用方据此决定要不要提示用户。
   */
  set(next: string): Promise<boolean> {
    const run = this.queue.then(() => this.apply(next))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async apply(next: string): Promise<boolean> {
    const prev = this.written
    if (next === prev) return true

    let common = 0
    const max = Math.min(prev.length, next.length)
    while (common < max && prev[common] === next[common]) common++

    const toDelete = prev.length - common
    const toAdd = next.slice(common)

    if (toDelete > 0) {
      // 要退格就必须确认窗口没变，否则删的是别人的内容
      if (!this.injector.isStillFocused(this.target)) return false
      if (toDelete > this.opts.maxBackspaces) return false
    }

    const r = await this.injector.inject(
      {
        text: toAdd,
        ...(toDelete > 0 ? { strategy: 'unicode' as const, replaceLastChars: toDelete } : {})
      },
      this.target
    )
    if (!r.ok) return false

    this.written = next
    return true
  }

  /** 撤回已经打上去的全部内容。 */
  async rollback(): Promise<boolean> {
    return this.set('')
  }

  /** 会话正常结束：忘掉镜像，但不动目标窗口里的字。 */
  detach(): void {
    this.written = ''
  }
}
