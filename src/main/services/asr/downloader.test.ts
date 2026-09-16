import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, mkdir, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelDownloader } from './downloader.ts'
import type { ModelEntry } from '../../../shared/modelRegistry.ts'
import type { ModelProgress } from '../../../shared/ipc.ts'

for (const scenario of ['success', 'bad-hash', 'cancel'] as const) {
  test(`多文件纠错模型 ${scenario}：校验全部文件后安装，失败或取消保留旧模型`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'vocal-correction-download-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const old = join(root, 'model')
    await mkdir(old); await writeFile(join(old, 'model.onnx'), 'previous-model')
    const data = Buffer.from('new-model')
    const vocab = Buffer.from('vocab')
    const assets = [data, vocab].map((bytes, i) => ({ file: i ? 'vocab.txt' : 'model.onnx',
      url: `https://example.invalid/${i}`, bytes: bytes.length,
      sha256: createHash('sha256').update(scenario === 'bad-hash' && i === 1 ? 'wrong' : bytes).digest('hex') }))
    t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => new Response(String(input).endsWith('/0') ? data : vocab))
    const events: ModelProgress[] = []
    const downloader = new ModelDownloader(root, p => {
      events.push(p)
      if (p.phase === 'done' || p.phase === 'error' || p.phase === 'cancelled') assert.equal(downloader.isDownloading('test-correction'), false)
      if (scenario === 'cancel' && p.received > 0) downloader.cancel('test-correction')
    })
    await downloader.download({ id: 'test-correction', name: '', kind: 'correction-bert', langs: '', note: '',
      dir: 'model', url: assets[0]!.url, approxMB: 1, archive: 'files', files: { model: 'model.onnx', vocab: 'vocab.txt' }, prune: [], downloads: assets })
    assert.equal(events.at(-1)?.phase, scenario === 'success' ? 'done' : scenario === 'cancel' ? 'cancelled' : 'error')
    assert.equal(await readFile(join(old, 'model.onnx'), 'utf8'), scenario === 'success' ? 'new-model' : 'previous-model')
    assert.deepEqual(await readdir(root), ['model'])
  })
}

test('响应立即到达时，进度统计不能吃掉尚未写入文件的开头', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'vocal-download-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const payload = Buffer.from('BZh9-model-download-must-preserve-every-byte')
  t.mock.method(globalThis, 'fetch', async () => new Response(payload, {
    headers: { 'content-length': String(payload.length) }
  }))
  const events: ModelProgress[] = []
  const downloader = new ModelDownloader(root, (p) => events.push(p))
  const entry: ModelEntry = {
    id: 'immediate-response', name: '测试模型', langs: '', note: '', kind: 'vad-silero',
    url: 'https://example.invalid/model', dir: 'model', approxMB: 1,
    archive: 'raw', files: { model: 'model.onnx' }, prune: []
  }

  await downloader.download(entry)

  assert.equal(events.at(-1)?.phase, 'done', JSON.stringify(events.at(-1)))
  assert.deepEqual(await readFile(join(root, entry.dir, 'model.onnx')), payload)
  const completedDownload = events.filter((p) => p.phase === 'downloading').at(-1)
  assert.equal(completedDownload?.received, payload.length)
})

test('分块到达的 bzip2 模型完整落盘并成功解压', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'vocal-archive-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  // 一个真实的 tar.bz2，包含 fixture/model.onnx，内容为 test-model-content。
  const archive = Buffer.from(
    'QlpoOTFBWSZTWTxnMEEAAHP9gMqAQABAA/0AAAFvJ55ACAggAHUNTU9Q0DQ0PUGjanqBJSMhpoAAAaR+gSIQetQhFfl9BdB86BDAYcvZva4TmCEocNjhdnAGj3YaqIyFITuIfzYZKolObPKtgX3uTNjkkg/F3JFOFCQPGcwQQA==',
    'base64'
  )
  let offset = 0
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    async pull(controller) {
      if (offset === archive.length) { controller.close(); return }
      controller.enqueue(archive.subarray(offset, offset + 17))
      offset = Math.min(offset + 17, archive.length)
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
  }), { headers: { 'content-length': String(archive.length) } }))
  const events: ModelProgress[] = []
  const entry: ModelEntry = {
    id: 'chunked-archive', name: '测试归档', langs: '', note: '', kind: 'punct-ct-transformer',
    url: 'https://example.invalid/model.tar.bz2', dir: 'model', approxMB: 1,
    files: { model: 'model.onnx' }, prune: []
  }

  await new ModelDownloader(root, (p) => events.push(p)).download(entry)

  assert.equal(events.at(-1)?.phase, 'done', JSON.stringify(events.at(-1)))
  assert.equal(await readFile(join(root, entry.dir, 'model.onnx'), 'utf8'), 'test-model-content')
  assert.equal(events.filter((p) => p.phase === 'downloading').at(-1)?.received, archive.length)
})

test('无效归档报告可读错误，不输出二进制乱码或误报完成', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'vocal-invalid-archive-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  t.mock.method(globalThis, 'fetch', async () => new Response(Buffer.from([0xff, 0x00, 0x1b, 0x80])))
  const events: ModelProgress[] = []
  const entry: ModelEntry = {
    id: 'invalid-archive', name: '测试归档', langs: '', note: '', kind: 'punct-ct-transformer',
    url: 'https://example.invalid/model.tar.bz2', dir: 'model', approxMB: 1,
    files: { model: 'model.onnx' }, prune: []
  }

  await new ModelDownloader(root, (p) => events.push(p)).download(entry)

  assert.equal(events.at(-1)?.phase, 'error')
  assert.match(events.at(-1)?.message ?? '', /文件头：ff 00 1b 80/)
  assert.doesNotMatch(events.at(-1)?.message ?? '', /\uFFFD/)
  assert.equal(events.some((p) => p.phase === 'done'), false)
})
