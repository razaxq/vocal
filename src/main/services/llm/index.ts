/**
 * LLM 文本整理（可选）。OpenAI 兼容端点。
 *
 * 分工：规则层（textCleanup）负责删语气词和口吃，这里负责**改写** ——
 * 口语句式转书面、合并碎句、分段。这一层 ASR 模型做不了，
 * 只能靠 LLM（云端 API 或本地小模型）。
 *
 * 铁律：LLM 永远不是必需路径。超时、报错、没配 key、输出明显不对劲，
 * 一律返回输入原文。用户感知不到失败，只是少了一层整理。
 */
import type { AppConfig } from '@shared/ipc'

export interface PolishOptions {
  /** 前文，给模型上下文用，不要求它改写这部分 */
  context?: string
  signal?: AbortSignal
}

export class LlmService {
  constructor(private getConfig: () => AppConfig) {}

  get enabled(): boolean {
    const c = this.getConfig().llm
    return c.enabled && Boolean(c.apiKey)
  }

  /** 段级轻润色：只修错别字和标点，不改写句式。默认不用，留给需要极致准确的场景。 */
  polish(text: string, opts: PolishOptions = {}): Promise<string> {
    return this.run(this.getConfig().llm.prompt, text, opts)
  }

  /** 会话级整理：口语转书面，合并碎句，该分段就分段。 */
  consolidate(text: string, opts: PolishOptions = {}): Promise<string> {
    return this.run(this.getConfig().llm.consolidatePrompt, text, opts)
  }

  private async run(system: string, text: string, opts: PolishOptions): Promise<string> {
    const cfg = this.getConfig().llm
    if (!this.enabled || !text.trim()) return text

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs)
    const onAbort = (): void => ctrl.abort()
    opts.signal?.addEventListener('abort', onAbort)

    const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: system }]
    if (opts.context?.trim()) {
      messages.push({
        role: 'user',
        content: `【前文，仅供理解上下文，不要输出】\n${opts.context.trim()}`
      })
      messages.push({ role: 'assistant', content: '明白，我只处理接下来的正文。' })
    }
    messages.push({ role: 'user', content: text })

    try {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`
        },
        body: JSON.stringify({ model: cfg.model, temperature: 0, messages })
      })
      if (!res.ok) return text

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const out = data.choices?.[0]?.message?.content
      if (typeof out !== 'string') return text

      return this.guard(text, out.trim())
    } catch {
      return text
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
  }

  /**
   * 输出健全性检查。
   *
   * 这是必须的：模型偶尔会「回答」而不是「整理」——
   * 你说「帮我看看这段代码」，它真的开始讲代码。
   * 长度偏离太多就认定跑题，直接丢掉它的输出。
   */
  private guard(input: string, output: string): string {
    if (!output) return input

    const ratio = output.length / Math.max(1, input.length)
    if (ratio < 0.4 || ratio > 2.5) return input

    // 模型常见的画蛇添足前缀
    const prefixes = ['整理后的文本：', '整理后：', '以下是整理后的内容：', '好的，', 'Here is', '修改后：']
    let cleaned = output
    for (const p of prefixes) {
      if (cleaned.startsWith(p)) cleaned = cleaned.slice(p.length).trim()
    }
    // 包在代码块里
    const fence = cleaned.match(/^```[a-z]*\n([\s\S]*?)\n```$/)
    if (fence?.[1]) cleaned = fence[1].trim()

    return cleaned || input
  }
}
