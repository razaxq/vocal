/** 完整保留有效词条及多音读法，词频只用于候选排序。 */
export function selectRimeWords(text: string): { words: string[]; readings: string[]; eligibleCount: number; date: string } {
  if (!text.includes('# Rime dictionary') || !text.includes('\n...')) throw new Error('不是 Rime 词典')
  const date = text.match(/^version:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1]
  if (!date) throw new Error('词典缺少版本日期')
  const entries = new Map<string, { weight: number; readings: Set<string> }>()
  let data = false
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '...') { data = true; continue }
    if (!data || line.startsWith('#')) continue
    const [word, rawReading, weight] = line.split('\t')
    const reading = rawReading?.toLowerCase().replaceAll('ü', 'v').trim()
    if (!word || word.length > 64 || !/^[\p{Script=Han}A-Za-z0-9 ·（）-]+$/u.test(word) ||
        !reading || !/^[a-z]+(?: [a-z]+)*$/.test(reading) || !weight || !/^\d+(?:\.\d+)?$/.test(weight)) continue
    const score = Number(weight)
    if (!Number.isFinite(score)) continue
    const entry = entries.get(word) ?? { weight: score, readings: new Set<string>() }
    entry.weight = Math.max(entry.weight, score)
    entry.readings.add(reading)
    entries.set(word, entry)
  }
  const sorted = [...entries].sort((a, b) => b[1].weight - a[1].weight || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return { words: sorted.map(([word]) => word), readings: sorted.map(([, entry]) => [...entry.readings].sort().join('|')),
    eligibleCount: entries.size, date }
}
