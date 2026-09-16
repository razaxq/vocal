import { pinyin } from 'pinyin-pro'

export interface CorrectionEdit { start: number; source: string; target: string; margin: number }
const han = /^[\p{Script=Han}]+$/u

export function similarSound(a: string, b: string): boolean {
  if (!han.test(a) || !han.test(b) || a.length !== b.length) return false
  const reading = (s: string): string => pinyin(s, { toneType: 'none', type: 'array' })
    .map(x => x.replaceAll('ü', 'v').replace(/ng$/, 'n')).join(' ')
  return reading(a) === reading(b)
}

export function protectedPositions(text: string, words: string[]): Set<number> {
  const positions = new Set<number>()
  const protect = (start: number, length: number): void => {
    for (let i = start; i < start + length; i++) positions.add(i)
  }
  // 引号内代码、网址、邮件和数字标识符整体保护，中文热词按所有出现位置保护。
  for (const match of text.matchAll(/`[^`]*`|https?:\/\/\S+|[\w.+-]+@[\w.-]+|[A-Za-z0-9_][A-Za-z0-9_.:+/#@-]*/g)) protect(match.index, match[0].length)
  for (const match of text.matchAll(/[零〇一二三四五六七八九十百千万亿两]+(?:[点年月日号时分秒元块个岁度成倍%％])?/g)) protect(match.index, match[0].length)
  for (const word of words.filter(Boolean)) {
    for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) protect(at, word.length)
  }
  return positions
}

export function applyCorrections(text: string, edits: CorrectionEdit[], protectedWords: string[]): string {
  const occupied = protectedPositions(text, protectedWords)
  const accepted: CorrectionEdit[] = []
  for (const edit of [...edits].sort((a, b) => b.margin - a.margin)) {
    const { start, source, target } = edit
    if (!Number.isFinite(edit.margin) || start < 0 || text.slice(start, start + source.length) !== source ||
        !similarSound(source, target) || [...source].some((_, i) => occupied.has(start + i))) continue
    accepted.push(edit)
    for (let i = start; i < start + source.length; i++) occupied.add(i)
  }
  let out = text
  for (const edit of accepted.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.target + out.slice(edit.start + edit.source.length)
  }
  return out
}
