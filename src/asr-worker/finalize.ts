/**
 * 定稿进程。
 *
 * 收到一段音频 → SenseVoice 重转写 → CT-Transformer 补标点 → 规则清洗 → 回传。
 *
 * 跑在独立进程里，跟流式解码并行。这样用户说第 N+1 段的时候，
 * 第 N 段已经在另一个核上定稿，延迟被完全藏住 ——
 * 长输入时只有最后一段需要真等。
 *
 * 旧设计是会话结束后把整段音频重跑一次，说 3 分钟就要重转写 3 分钟，
 * 那是个随时长线性恶化的坑。现在每段只跑自己那几秒。
 */
import sherpa, { type OfflineRecognizer, type OfflinePunctuation } from 'sherpa-onnx-node'
import type { FinalizeCommand, FinalizeEvent, ModelPaths, CleanupConfig } from '@shared/types'
import { cleanupSpeech } from '@shared/textCleanup'
import { detectVoice, isFinalSane } from '@shared/audioGate'

const port = process.parentPort
const send = (e: FinalizeEvent): void => port.postMessage(e)

let recognizer: OfflineRecognizer | null = null
let punct: OfflinePunctuation | null = null
let cleanup: CleanupConfig = { level: 'standard', protect: [], extraFillers: [] }

/** 标点 + 规则清洗，两个档位共用的收尾。 */
function polish(text: string): { text: string; removed: number } {
  // SenseVoice 开了 ITN 之后 2024-07-17 版自带标点，再过一道基本幂等；
  // 流式文本完全不带标点，这一步是它唯一的标点来源。
  const punctuated = punct && text ? punct.addPunct(text) : text
  const cleaned = cleanupSpeech(punctuated, {
    level: cleanup.level,
    protect: cleanup.protect,
    extraFillers: cleanup.extraFillers
  })
  return { text: cleaned.text, removed: cleaned.removed }
}

function init(m: ModelPaths, c: CleanupConfig, mode: 'full' | 'punct-only'): void {
  cleanup = c

  // punct-only：只用流式档位，不重转写，所以 SenseVoice 不加载（省 ~230MB）。
  // 标点模型照常加载 —— 它才 72MB，而没有它输出就是一长串不断句的字。
  if (mode === 'full') buildRecognizer(m)
  buildPunct(m)
  send({ type: 'ready' })
}

function buildRecognizer(m: ModelPaths): void {
  recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: {
        model: m.offline.model,
        language: '',                    // 空 = 自动判语种
        useInverseTextNormalization: 1   // 「二零二六年三点五万」→「2026 年 3.5 万」
      },
      tokens: m.offline.tokens,
      numThreads: 2,
      provider: 'cpu',
      debug: 0
    }
  })
}

function buildPunct(m: ModelPaths): void {
  punct = new sherpa.OfflinePunctuation({
    model: {
      ctTransformer: m.punct,
      numThreads: 1,
      provider: 'cpu',
      debug: 0
    }
  })
}

port.on('message', (event: { data: FinalizeCommand }) => {
  const cmd = event.data
  try {
    switch (cmd.type) {
      case 'init':
        init(cmd.models, cmd.cleanup, cmd.mode)
        break

      case 'punctuate': {
        // 只用流式档位：没有音频可重转写，但标点和清洗照做。
        // 以前这个档位直接把流式原文当定稿发出去 —— 于是用户明明
        // 下载并启用了标点模型，说出来的话却一个标点都没有。
        const startedAt = Date.now()
        const { text, removed } = polish(cmd.text.trim())
        send({
          type: 'finalized',
          sessionId: cmd.sessionId,
          segment: cmd.segment,
          text,
          cleanedChars: removed,
          latencyMs: Date.now() - startedAt,
          fellBack: true
        })
        break
      }

      case 'cleanup:update':
        cleanup = cmd.cleanup
        break

      case 'finalize': {
        const startedAt = Date.now()
        const samples = cmd.samples instanceof Float32Array
          ? cmd.samples
          : new Float32Array(cmd.samples as ArrayLike<number>)

        let text = ''
        let fellBack = false

        // 先看这段里到底有没有人说话。
        // SenseVoice 对纯静音会幻觉出内容（M1 实测：5 秒静音 → 「我.」），
        // 在这里拦掉既避免凭空打字，也省一次没必要的解码。
        const voice = detectVoice(samples)

        if (voice.hasVoice && recognizer && samples.length > 0) {
          const s = recognizer.createStream()
          s.acceptWaveform({ sampleRate: 16000, samples })
          recognizer.decode(s)
          text = (recognizer.getResult(s).text ?? '').trim()
        }

        if (!isFinalSane(text, cmd.streamText)) {
          text = cmd.streamText.trim()
          fellBack = true
        }

        const cleaned = polish(text)

        send({
          type: 'finalized',
          sessionId: cmd.sessionId,
          segment: cmd.segment,
          text: cleaned.text,
          cleanedChars: cleaned.removed,
          latencyMs: Date.now() - startedAt,
          fellBack
        })
        break
      }

      case 'shutdown':
        recognizer = null
        punct = null
        process.exit(0)
    }
  } catch (e) {
    // 单段定稿失败不能让整个会话垮掉：回传流式文本，让上层继续
    if (cmd.type === 'finalize') {
      send({
        type: 'finalized',
        sessionId: cmd.sessionId,
        segment: cmd.segment,
        text: cmd.streamText.trim(),
        cleanedChars: 0,
        latencyMs: 0,
        fellBack: true
      })
    }
    send({
      type: 'error',
      sessionId: cmd.type === 'finalize' ? cmd.sessionId : undefined,
      segment: cmd.type === 'finalize' ? cmd.segment : undefined,
      message: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e),
      fatal: cmd.type === 'init'
    })
  }
})
