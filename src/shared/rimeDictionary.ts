/** 只读取 Rime 词典的数据行，不执行 YAML 配置或脚本。 */
export function selectRimeWords(text: string, limit = 500): { words: string[]; eligibleCount: number; date: string } {
  if (!text.includes('# Rime dictionary') || !text.includes('\n...')) throw new Error('不是 Rime 词典')
  const date = text.match(/^version:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1]
  if (!date) throw new Error('词典缺少版本日期')
  const entries = new Map<string, number>()
  let data = false
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '...') { data = true; continue }
    if (!data || line.startsWith('#')) continue
    const [word, , weight] = line.split('\t')
    if (!word || !weight || !/^[\u4e00-\u9fff]{3,12}$/.test(word) || !/^\d+(?:\.\d+)?$/.test(weight)) continue
    const score = Number(weight)
    if (!Number.isFinite(score)) continue
    entries.set(word, Math.max(entries.get(word) ?? 0, score))
  }
  const sorted = [...entries].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return { words: sorted.slice(0, limit).map(([word]) => word), eligibleCount: entries.size, date }
}
