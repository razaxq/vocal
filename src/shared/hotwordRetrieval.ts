import { pinyin } from 'pinyin-pro'
import type { HotwordCatalog } from './hotwordCatalog'

/** 全词库只建一次索引；每句只把相关候选送进 ASR，不全量构建热词图。 */
export class HotwordIndex {
  private words: string[]
  private byReading = new Map<string, number | number[]>()
  private maxSyllables = 2

  /** 给纠错模型提供整词同音候选；只负责召回，不决定替换。 */
  homophones(word: string): string[] {
    const reading = pinyin(word, { toneType: 'none', type: 'array' }).join(' ').replaceAll('ü', 'v')
    const found = this.byReading.get(reading)
    const ids = found === undefined ? [] : typeof found === 'number' ? [found] : found
    return ids.map(id => this.words[id]!).filter(w => w.length === word.length && w !== word).slice(0, 16)
  }

  constructor(catalog: Pick<HotwordCatalog, 'words' | 'readings'>) {
    this.words = catalog.words
    catalog.readings.forEach((readings, i) => {
      for (const reading of readings.split('|')) {
        this.maxSyllables = Math.max(this.maxSyllables, reading.split(' ').length)
        const existing = this.byReading.get(reading)
        if (existing === undefined) this.byReading.set(reading, i)
        else if (typeof existing === 'number') this.byReading.set(reading, [existing, i])
        else existing.push(i)
      }
    })
  }

  /** 同音候选，不做文字强行替换；由定稿模型结合原音频选择。 */
  retrieve(text: string, limit = 64): string[] {
    if (limit <= 0) return []
    const candidates = new Map<number, number>()
    const runs = text.slice(0, 512).match(/[\p{Script=Han}]+/gu) ?? []
    for (const run of runs) {
      const syllables = pinyin(run, { toneType: 'none', type: 'array' }).map(s => s.replaceAll('ü', 'v'))
      for (let start = 0; start < syllables.length; start++) {
        for (let length = Math.min(this.maxSyllables, syllables.length - start); length >= 2; length--) {
          const found = this.byReading.get(syllables.slice(start, start + length).join(' '))
          if (found === undefined) continue
          // 每个读音最多取 8 个，避免短词同音词淹没整句候选。
          const ids = typeof found === 'number' ? [found] : found.slice(0, 8)
          for (const id of ids) candidates.set(id, Math.max(candidates.get(id) ?? 0, length))
        }
      }
    }
    return [...candidates].sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, Math.min(limit, 64)).map(([id]) => this.words[id]!)
  }
}
