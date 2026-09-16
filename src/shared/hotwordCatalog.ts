/** 下载内容只作为词语数据；不接受引擎的分隔符或加权语法。 */
export interface RimeSource {
  id: 'rime-ice'; revision: string; file: 'cn_dicts/base.dict.yaml'; license: 'GPL-3.0'
  sha256: string; selection: 'full-pinyin-v2'; eligibleCount: number
}
export interface HotwordCatalog { version: number; updatedAt: string; source: RimeSource; words: string[]; readings: string[] }
export interface RecognitionHotword { text: string; score: number }
export const MAX_CATALOG_BYTES = 64 * 1024 * 1024

export function parseCatalog(value: unknown): HotwordCatalog {
  const c = value as Partial<HotwordCatalog> | null
  if (!c || !Number.isSafeInteger(c.version) || c.version! < 1 ||
      typeof c.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.updatedAt) ||
      !Array.isArray(c.words) || c.words.length === 0 || c.words.length > 1_000_000 ||
      !Array.isArray(c.readings) || c.readings.length !== c.words.length) {
    throw new Error('词库格式不正确')
  }
  const s = c.source
  if (!s || s.id !== 'rime-ice' || s.file !== 'cn_dicts/base.dict.yaml' || s.license !== 'GPL-3.0' ||
      !/^[a-f0-9]{40}$/.test(s.revision) || !/^[a-f0-9]{64}$/.test(s.sha256) ||
      s.selection !== 'full-pinyin-v2' || !Number.isSafeInteger(s.eligibleCount) || s.eligibleCount !== c.words.length) {
    throw new Error('词库来源不正确')
  }
  const words: string[] = []
  const seen = new Set<string>()
  for (const [i, raw] of c.words.entries()) {
    if (typeof raw !== 'string' || raw !== raw.trim() || raw.length < 1 || raw.length > 64 ||
        !/^[\p{Script=Han}A-Za-z0-9 ·（）-]+$/u.test(raw)) throw new Error('词库包含无效词语')
    const reading = c.readings[i]
    if (typeof reading !== 'string' || reading.length > 1024 || !/^[a-z]+(?: [a-z]+)*(?:\|[a-z]+(?: [a-z]+)*)*$/.test(reading)) {
      throw new Error('词库包含无效读音')
    }
    if (seen.has(raw)) throw new Error('词库包含重复词语')
    seen.add(raw)
    words.push(raw)
  }
  return { version: c.version!, updatedAt: c.updatedAt, source: { ...s }, words, readings: [...c.readings] }
}

/** 用户词优先，网络词较低加权；不修改持久化的个人词表。 */
export function mergeHotwords(personal: string[], network: string[]): RecognitionHotword[] {
  const merged = new Map<string, RecognitionHotword>()
  for (const [words, score] of [[personal, 2.5], [network, 1.5]] as const) {
    for (const raw of words) {
      const text = raw.trim()
      if (!text || /[\r\n/:：]/u.test(text)) continue
      const key = text.toLowerCase()
      if (!merged.has(key)) merged.set(key, { text, score })
    }
  }
  return [...merged.values()]
}

export function offlineHotwords(words: RecognitionHotword[]): string | undefined {
  return words.length ? words.map(word => `${word.text} :${word.score}`).join('/') : undefined
}
