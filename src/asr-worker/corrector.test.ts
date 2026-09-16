import test from 'node:test'
import assert from 'node:assert/strict'
import { CorrectionTokenizer } from './corrector.ts'

test('中文和中英混排按原始偏移编码，保留空格、大小写和未知字符位置', () => {
  const tokenizer = new CorrectionTokenizer(['[UNK]', '[CLS]', '[SEP]', '[MASK]', '中', '文', 'git', '##hub', '，', '1', '.', '2'])
  const text = '中文 GitHub，1.2 🙂'
  const tokens = tokenizer.encode(text)
  assert.deepEqual(tokens.slice(1, -1).map(t => [tokenizer.vocab[t.id], text.slice(t.start, t.end)]), [
    ['中', '中'], ['文', '文'], ['git', 'Git'], ['##hub', 'Hub'], ['，', '，'],
    ['1', '1'], ['.', '.'], ['2', '2'], ['[UNK]', '🙂']
  ])
})
