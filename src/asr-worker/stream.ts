/**
 * 流式识别进程。
 *
 * 只干一件事：吃音频，吐实时文本和句子边界。绝不做重活 ——
 * SenseVoice 重转写在另一个进程（finalize.ts）里跑，两者并行。
 * 这是长输入性能的关键：说第 N+1 段的时候，第 N 段已经在另一个核上定稿了。
 */
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sherpa, { type OnlineRecognizer, type OnlineStream } from 'sherpa-onnx-node'
import type { StreamCommand, StreamEvent, ModelPaths } from '@shared/types'

const port = process.parentPort
const send = (e: StreamEvent): void => port.postMessage(e)

let recognizer: OnlineRecognizer | null = null
let stream: OnlineStream | null = null
let models: ModelPaths | null = null
let enabled = true
let endpointSilenceMs = 1500

let sessionId: string | null = null
let segment = 0
let consumedSamples = 0
let lastPartial = ''

/** 热词必须写成文件交给 sherpa —— 它的接口只接受路径。 */
function writeHotwords(words: string[]): string | undefined {
  const cleaned = words.map((w) => w.trim()).filter(Boolean)
  if (cleaned.length === 0) return undefined
  const dir = mkdtempSync(join(tmpdir(), 'vocal-hw-'))
  const file = join(dir, 'hotwords.txt')
  writeFileSync(file, cleaned.join('\n') + '\n', 'utf8')
  return file
}

function build(m: ModelPaths, hotwords: string[]): OnlineRecognizer {
  const hotwordsFile = writeHotwords(hotwords)
  const st = m.streaming

  // 两类模型的配置形状不同：
  //   paraformer 是 CTC —— encoder + decoder
  //   zipformer 是 transducer —— encoder + decoder + joiner
  // 写错分支 sherpa 会直接报「没有给出任何模型」，不会静默回落。
  const arch = st.kind === 'online-zipformer'
    ? { transducer: { encoder: st.encoder, decoder: st.decoder, joiner: st.joiner ?? '' } }
    : { paraformer: { encoder: st.encoder, decoder: st.decoder } }

  return new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      ...arch,
      tokens: st.tokens,
      numThreads: 2,
      provider: 'cpu',
      debug: 0
    },
    decodingMethod: 'greedy_search',
    enableEndpoint: true,
    // rule2：已经解码出字之后，停顿多久算这一句说完 —— 这是用户真正感觉到
    // 「我想一下措辞就被切断了」的那个值，所以做成可配。
    // rule1 管的是「一个字都还没解出来」的静音，留出更长的余量。
    // 这两个值决定长输入时多久上一次屏，太大会让用户干等。
    rule1MinTrailingSilence: (endpointSilenceMs + 1200) / 1000,
    rule2MinTrailingSilence: endpointSilenceMs / 1000,
    rule3MinUtteranceLength: 300,
    ...(hotwordsFile ? { hotwordsFile, hotwordsScore: 1.5 } : {})
  })
}

function drain(): void {
  if (!recognizer || !stream) return
  while (recognizer.isReady(stream)) recognizer.decode(stream)
}

function emitEndpoint(text: string): void {
  if (!sessionId) return
  send({ type: 'endpoint', sessionId, segment, text, sampleIndex: consumedSamples })
  segment++
  lastPartial = ''
}

port.on('message', (event: { data: StreamCommand }) => {
  const cmd = event.data
  try {
    switch (cmd.type) {
      case 'init':
        models = cmd.models
        enabled = cmd.enabled
        endpointSilenceMs = cmd.endpointSilenceMs
        if (enabled) recognizer = build(cmd.models, cmd.hotwords)
        send({ type: 'ready' })
        break

      case 'session:start':
        sessionId = cmd.sessionId
        segment = 0
        consumedSamples = 0
        lastPartial = ''
        stream = recognizer ? recognizer.createStream() : null
        break

      case 'audio': {
        if (cmd.sessionId !== sessionId) return
        const samples = cmd.samples instanceof Float32Array
          ? cmd.samples
          : new Float32Array(cmd.samples as ArrayLike<number>)
        consumedSamples += samples.length

        // final-only 档位根本不会把音频发到这个进程（主进程用 SilenceSegmenter
        // 自己切段直接给定稿进程），所以这里为 null 只可能是 init 还没完成
        if (!recognizer || !stream) return

        stream.acceptWaveform({ sampleRate: 16000, samples })
        drain()

        const text = recognizer.getResult(stream).text ?? ''
        if (text && text !== lastPartial) {
          lastPartial = text
          send({ type: 'partial', sessionId, segment, text })
        }

        if (recognizer.isEndpoint(stream)) {
          if (text.trim()) emitEndpoint(text)
          recognizer.reset(stream)
        }
        break
      }

      case 'session:stop': {
        if (cmd.sessionId !== sessionId) return

        if (recognizer && stream) {
          // 补 0.5s 静音把尾字挤出来
          stream.acceptWaveform({ sampleRate: 16000, samples: new Float32Array(8000) })
          stream.inputFinished()
          drain()
          const tail = recognizer.getResult(stream).text ?? ''
          if (tail.trim()) emitEndpoint(tail)
        }

        send({
          type: 'session:ended',
          sessionId: cmd.sessionId,
          segments: segment,
          totalSamples: consumedSamples
        })
        sessionId = null
        stream = null
        break
      }

      case 'hotwords:update':
        // 热词只在构造时读取，改了必须重建
        if (models && enabled) {
          recognizer = build(models, cmd.hotwords)
          stream = null
        }
        break

      case 'shutdown':
        recognizer = null
        stream = null
        process.exit(0)
    }
  } catch (e) {
    send({
      type: 'error',
      sessionId: sessionId ?? undefined,
      message: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e),
      fatal: cmd.type === 'init'
    })
  }
})
