/**
 * 口语清洗 —— 纯规则，不需要任何模型，微秒级。
 *
 * 分工要说清楚：
 *   这一层只干「删」和「折叠」—— 语气词、口吃重复、无意义的填充短语。
 *   它不改写句式、不合并碎句、不分段，那些是 LLM 的活（见 LlmService）。
 *
 * 设计原则是**宁可漏删，不可错删**。「这个方案不行」里的「这个」是实词，
 * 「这个，嗯，我觉得」里的「这个」才是填充词。所以填充短语只在
 * 句首或被停顿标点包围时才删，孤立出现一律保留。
 *
 * 曾经有过一个「激进」档，连「说实话」「其实呢」「我觉得吧」也删。
 * 砍掉了：这些词承载语气和态度，删掉之后句子的意思其实变了，
 * 而这一层的职责只是去掉「说话时的噪音」，不是替用户重写句子。
 */

export type CleanupLevel = 'off' | 'light' | 'standard'

/** 纯语气词：任何位置独立出现都可以删。 */
const INTERJECTIONS_ZH = ['嗯', '呃', '唔', '额', '诶', '欸', '哎', '啊', '哦', '喔', '噢']
const INTERJECTIONS_EN = ['um', 'uh', 'erm', 'er', 'hmm', 'mmm']

/** 填充短语：只在句首或被标点包围时删。 */
const FILLERS_ZH_STANDARD = [
  '那个', '这个', '就是说', '就是讲', '然后呢', '对吧', '对不对',
  '你知道吧', '你知道吗', '怎么说呢', '我跟你讲', '说白了'
]
const FILLERS_EN_STANDARD = ['you know', 'i mean', 'sort of', 'kind of']

/** 停顿类标点，用来判断「短语边界」。 */
const PAUSE = '，。！？；：、,.!?;:'

/** 保护词占位符用私有区字符，正常文本里不可能出现。 */
const SENTINEL = ''

export interface CleanupOptions {
  level: CleanupLevel
  /** 永不删除的词，通常直接复用热词表里的专有名词 */
  protect?: string[]
  /** 用户自定义的额外过滤词 */
  extraFillers?: string[]
}

export interface CleanupResult {
  text: string
  /** 删掉了多少字符，用于在面板上显示「已清理 N 字」 */
  removed: number
}

/** 转义正则元字符。 */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const P = esc(PAUSE)

/**
 * 折叠口吃式重复。
 *   单字重复三次以上 → 一次：「我我我觉得」→「我觉得」
 *   双字词重复三次以上 → 一次：「就是就是就是」→「就是」
 *
 * 阈值定在「出现 3 次」而不是 2 次，是因为叠词合法：
 * 「刚刚」「常常」「看看」「谢谢」「爸爸」都不能碰。
 */
function collapseStutter(text: string): string {
  let out = text.replace(/([一-龥])\1{2,}/g, '$1')
  out = out.replace(/([一-龥]{2})\1{2,}/g, '$1')
  out = out.replace(/\b(\w+)(\s+\1\b)+/gi, '$1')
  return out
}

/** 删掉独立出现的语气词。 */
function stripInterjections(text: string, level: CleanupLevel): string {
  const zh = INTERJECTIONS_ZH.join('|')
  let out = text

  // 中文语气词后面常跟一个停顿标点，一起删掉
  out = out.replace(new RegExp(`(^|[${P}\\s])(?:${zh})+[${P}\\s]*`, 'g'), '$1')
  // 句尾残留
  out = out.replace(new RegExp(`(?:${zh})+$`, 'g'), '')

  if (level !== 'light') {
    const en = INTERJECTIONS_EN.join('|')
    out = out.replace(new RegExp(`\\b(?:${en})\\b[,\\s]*`, 'gi'), '')
  }
  return out
}

/** 删掉填充短语，只在句首或被标点包围时。 */
function stripFillers(text: string, phrases: string[]): string {
  let out = text
  for (const p of phrases) {
    if (!p.trim()) continue
    const e = esc(p.trim())
    // 句首或跟在停顿标点后，且自身后面也有停顿标点
    out = out.replace(new RegExp(`(^|[${P}])\\s*${e}\\s*[${P}]\\s*`, 'gi'), '$1')
    // 被标点包围，后面紧跟另一个标点
    out = out.replace(new RegExp(`[${P}]\\s*${e}\\s*(?=[${P}])`, 'gi'), '')
  }
  return out
}

/** 收尾：重复标点、多余空白、中英文之间补空格。 */
function tidy(text: string): string {
  return text
    .replace(new RegExp(`([${P}])\\s*(?=[${P}])`, 'g'), '')
    .replace(/\s{2,}/g, ' ')
    .replace(/([一-龥])([A-Za-z0-9])/g, '$1 $2')
    .replace(/([A-Za-z0-9])([一-龥])/g, '$1 $2')
    .replace(/\s+([，。！？；：、])/g, '$1')
    .trim()
}

/**
 * 主入口。保护词先替换成私有区占位符，清洗完再换回来，
 * 这样「那个」作为项目名一部分时不会被误删。
 */
export function cleanupSpeech(input: string, opts: CleanupOptions): CleanupResult {
  if (opts.level === 'off' || !input.trim()) {
    return { text: input, removed: 0 }
  }

  // 长的先替换，避免短词吃掉长词的一部分
  const protect = (opts.protect ?? [])
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .sort((a, b) => b.length - a.length)

  const tokens: Array<[string, string]> = []
  let text = input

  protect.forEach((word, i) => {
    const token = `${SENTINEL}${i}${SENTINEL}`
    tokens.push([token, word])
    text = text.split(word).join(token)
  })

  text = collapseStutter(text)
  text = stripInterjections(text, opts.level)

  if (opts.level !== 'light') {
    const phrases = [
      ...FILLERS_ZH_STANDARD,
      ...FILLERS_EN_STANDARD,
      ...(opts.extraFillers ?? [])
    ]
    text = stripFillers(text, phrases)
  }

  text = tidy(text)

  for (const [token, word] of tokens) {
    text = text.split(token).join(word)
  }

  return { text, removed: Math.max(0, input.length - text.length) }
}
