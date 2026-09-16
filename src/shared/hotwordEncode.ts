/**
 * 把用户写的热词编码成 sherpa 认识的 token 序列。
 *
 * 这一步不能省。sherpa 的 `hotwordsFile` 里每一行必须是
 * **tokens.txt 里真实存在的 token，用空格分开**；直接写「陈心宇」这种
 * 自然词，编码阶段会失败，而 sherpa 只往 stderr 打一行
 * 「Encode hotwords failed, skipping」然后当没有热词继续跑。
 * 应用层什么都察觉不到 —— 用户以为填了热词，实际一点作用没有。
 *
 * 中文流式 Zipformer 的词表长这样（sentencepiece unigram，
 * ▁ = U+2581，标记「词首」）：
 *
 *     ▁的  ▁我  ▁是  的  我  是  ▁花  费  …
 *
 * 所以「花费」要编码成 `▁花 费`：第一个字优先取带 ▁ 的那版，
 * 后面的字取不带 ▁ 的。用贪心最长匹配一路往后吃，
 * 有的词表里也有多字 token（`▁我们`），最长匹配能一并吃掉。
 *
 * 匹配不上的热词整条丢掉并回报 —— 与其让它静默失效，
 * 不如让上层能告诉用户「这几个词这个模型认不了」。
 */

import type { RecognitionHotword } from './hotwordCatalog'

export interface EncodedHotwords {
  /** 每行一条，已编码成空格分隔的 token */
  lines: string[]
  /** 编不出来的原始热词 */
  dropped: string[]
}

const WORD_START = '▁'

export function encodeHotwords(phrases: Array<string | RecognitionHotword>, tokens: Iterable<string>): EncodedHotwords {
  const vocab = tokens instanceof Set ? tokens : new Set(tokens)
  const lines: string[] = []
  const dropped: string[] = []

  // 最长匹配要知道词表里最长的 token 有多长，否则每次都要试到句尾
  let maxLen = 1
  for (const t of vocab) {
    const bare = t.startsWith(WORD_START) ? t.slice(1) : t
    if (bare.length > maxLen) maxLen = bare.length
  }

  for (const raw of phrases) {
    const phrase = (typeof raw === 'string' ? raw : raw.text).trim()
    if (!phrase) continue
    const out = encodeOne(phrase, vocab, maxLen)
    if (out) lines.push(typeof raw === 'string' ? out : `${out} :${raw.score}`)
    else dropped.push(phrase)
  }

  return { lines, dropped }
}

function encodeOne(phrase: string, vocab: Set<string>, maxLen: number): string | null {
  const out: string[] = []
  let i = 0

  while (i < phrase.length) {
    const atStart = i === 0
    let hit: string | null = null

    // 贪心最长匹配。词首优先试带 ▁ 的那版 —— 「▁花 费」比「花 费」更贴近
    // 训练时的切分，boost 才落在对的路径上。
    for (let len = Math.min(maxLen, phrase.length - i); len >= 1 && !hit; len--) {
      const chunk = phrase.slice(i, i + len)
      const candidates = atStart
        ? [WORD_START + chunk, chunk]
        : [chunk, WORD_START + chunk]
      for (const c of candidates) {
        if (vocab.has(c)) { hit = c; i += len; break }
      }
    }

    if (!hit) return null      // 有一个字编不出来，整条热词就不可靠，丢掉
    out.push(hit)
  }

  return out.join(' ')
}

/** 从 tokens.txt 的内容里取出 token 集合（每行「token id」）。 */
export function parseTokens(text: string): Set<string> {
  const set = new Set<string>()
  for (const line of text.split('\n')) {
    const tok = line.split(' ')[0]
    if (tok) set.add(tok)
  }
  return set
}
