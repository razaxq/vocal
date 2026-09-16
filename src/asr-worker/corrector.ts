import { readFile } from 'node:fs/promises'
import * as ort from 'onnxruntime-node'
import type { HotwordIndex } from '../shared/hotwordRetrieval.ts'
import { applyCorrections, protectedPositions, similarSound, type CorrectionEdit } from '../shared/correctionGuard.ts'

interface Token { id: number; start: number; end: number }

/** BERT BasicTokenizer + WordPiece with original offsets; output never rebuilds user text from tokens. */
export class CorrectionTokenizer {
  readonly ids: Map<string, number>
  readonly vocab: string[]
  constructor(vocab: string[]) {
    this.vocab = vocab
    this.ids = new Map(vocab.map((word, i) => [word, i]))
    for (const token of ['[CLS]', '[SEP]', '[MASK]', '[UNK]']) {
      if (!this.ids.has(token)) throw new Error(`纠错词表缺少 ${token}`)
    }
  }
  encode(text: string): Token[] {
    const out: Token[] = [{ id: this.ids.get('[CLS]')!, start: -1, end: -1 }]
    for (const m of text.matchAll(/[\p{Script=Han}]|[\p{P}\p{S}]|[^\s\p{Script=Han}\p{P}\p{S}]+/gu)) {
      const word = m[0].toLowerCase()
      const pieces: Token[] = []
      let start = 0
      while (start < word.length) {
        let end = word.length
        let id: number | undefined
        while (end > start) {
          id = this.ids.get((start ? '##' : '') + word.slice(start, end))
          if (id !== undefined) break
          end--
        }
        if (id === undefined) { pieces.length = 0; pieces.push({ id: this.ids.get('[UNK]')!, start: m.index, end: m.index + m[0].length }); break }
        pieces.push({ id, start: m.index + start, end: m.index + end }); start = end
      }
      out.push(...pieces)
    }
    out.push({ id: this.ids.get('[SEP]')!, start: -1, end: -1 })
    return out
  }
}

/** One CPU session per selected model, owned by the finalize utility process. */
export class LocalCorrector {
  private session: ort.InferenceSession
  private tokenizer: CorrectionTokenizer
  private mode: 'csc' | 'mlm'
  private constructor(session: ort.InferenceSession, tokenizer: CorrectionTokenizer, mode: 'csc' | 'mlm') {
    this.session = session; this.tokenizer = tokenizer; this.mode = mode
  }

  static async create(model: string, vocab: string, mode: 'csc' | 'mlm'): Promise<LocalCorrector> {
    const tokenizer = new CorrectionTokenizer((await readFile(vocab, 'utf8')).trimEnd().split(/\r?\n/))
    const session = await ort.InferenceSession.create(model, {
      executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1,
      graphOptimizationLevel: 'all'
    })
    if (!session.outputNames.includes('logits')) { await session.release(); throw new Error('纠错模型缺少 logits 输出') }
    return new LocalCorrector(session, tokenizer, mode)
  }

  async dispose(): Promise<void> { await this.session.release() }

  private async predict(tokens: Token[], mask?: { start: number; end: number }): Promise<Float32Array> {
    const ids = tokens.map(t => BigInt(mask && t.start >= mask.start && t.end <= mask.end && t.start >= 0
      ? this.tokenizer.ids.get('[MASK]')! : t.id))
    const feeds: Record<string, ort.Tensor> = {}
    for (const name of this.session.inputNames) {
      if (!['input_ids', 'attention_mask', 'token_type_ids'].includes(name)) throw new Error(`不支持的纠错输入：${name}`)
      feeds[name] = new ort.Tensor('int64', BigInt64Array.from(name === 'input_ids' ? ids : ids.map(() => name === 'attention_mask' ? 1n : 0n)), [1, ids.length])
    }
    const result = await this.session.run(feeds)
    try {
      const logits = result.logits!
      if (logits.type !== 'float32' || logits.dims[1] !== tokens.length || logits.dims[2] !== this.tokenizer.vocab.length) throw new Error('纠错模型输出尺寸不符')
      return new Float32Array(logits.data as Float32Array)
    } finally {
      for (const tensor of Object.values(result)) tensor.dispose()
      for (const tensor of Object.values(feeds)) tensor.dispose()
    }
  }

  async correct(text: string, words: string[] = [], dictionary?: HotwordIndex): Promise<string> {
    // Long segments are evaluated in overlapping windows. Only the central region is edited.
    const edits: CorrectionEdit[] = []
    const protectedAt = protectedPositions(text, words)
    const deadline = Date.now() + 2000
    for (let offset = 0; offset < text.length; offset += 96) {
      if (Date.now() >= deadline) break // Keep the untouched remainder on slow machines.
      const start = Math.max(0, offset - 16)
      const chunk = text.slice(start, offset + 112)
      if (!/[\p{Script=Han}]/u.test(chunk)) continue
      const tokens = this.tokenizer.encode(chunk)
      const vocab = this.tokenizer.vocab
      const eligible = (at: number, length: number): boolean => at >= offset && at + length <= offset + 96 &&
        Array.from({ length }, (_, j) => !protectedAt.has(at + j)).every(Boolean)

      if (this.mode === 'csc') {
        const logits = await this.predict(tokens)
        for (const [i, token] of tokens.entries()) {
          if (token.start < 0 || token.end - token.start !== 1 || !eligible(start + token.start, 1)) continue
          const source = chunk.slice(token.start, token.end)
          if (!/^[\p{Script=Han}]$/u.test(source)) continue
          const row = logits.subarray(i * vocab.length, (i + 1) * vocab.length)
          let best = token.id
          for (let j = 0; j < row.length; j++) if (row[j]! > row[best]!) best = j
          const target = vocab[best]!
          if (target === source || !similarSound(source, target)) continue
          const margin = row[best]! - row[token.id]!
          let sum = 0
          for (const value of row) sum += Math.exp(value - row[best]!)
          if (1 / sum >= 0.98 && margin >= 4) edits.push({ start: start + token.start, source, target, margin })
        }
      }

      if (!dictionary) continue
      const segments = [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(chunk)]
      const spans: Array<{ at: number; source: string; known: boolean }> = []
      for (const [i, seg] of segments.entries()) {
        if (/^[\p{Script=Han}]{2,4}$/u.test(seg.segment)) spans.push({ at: seg.index, source: seg.segment, known: true })
        // Unknown two-character words are often segmented as two single Han characters.
        const next = segments[i + 1]
        if (/^[\p{Script=Han}]$/u.test(seg.segment) && next && /^[\p{Script=Han}]$/u.test(next.segment)) {
          spans.push({ at: seg.index, source: seg.segment + next.segment, known: false })
        }
      }
      let evaluated = 0
      for (const span of spans.sort((a, b) => Number(a.known) - Number(b.known))) {
        if (Date.now() >= deadline) break
        if (!eligible(start + span.at, span.source.length)) continue
        const candidates = [span.source, ...dictionary.homophones(span.source)].filter(w => [...w].every(c => this.tokenizer.ids.has(c)))
        if (candidates.length < 2) continue
        if (++evaluated > 12) break // bounded CPU work per window
        const positions = tokens.flatMap((t, i) => t.start >= span.at && t.end <= span.at + span.source.length && t.end - t.start === 1 ? [i] : [])
        if (positions.length !== span.source.length) continue
        const logits = await this.predict(tokens, { start: span.at, end: span.at + span.source.length })
        const scored = candidates.map(word => ({ word, score: [...word].reduce((sum, char, i) => sum + logits[positions[i]! * vocab.length + this.tokenizer.ids.get(char)!]!, 0) })).sort((a, b) => b.score - a.score)
        const best = scored[0]!
        const original = scored.find(c => c.word === span.source)!
        const margin = best.score - original.score
        if (best.word !== span.source && margin >= (span.known ? 8 : 3.8) && best.score - scored[1]!.score >= 2.5) {
          edits.push({ start: start + span.at, source: span.source, target: best.word, margin })
        }
      }
    }
    return applyCorrections(text, edits, words)
  }
}
