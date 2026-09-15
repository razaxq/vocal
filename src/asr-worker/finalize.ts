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
let models: ModelPaths | null = null
let hotwords: string[] = []

/**
 * 热词加权强度。和 stream.ts 同一个口径，理由见那边的注释。
 */
const HOTWORDS_SCORE = 2.5

/**
 * 离线侧的热词和在线侧**不是一套接口**：
 *   在线 —— 配置里给 hotwordsFile（一个文件路径）
 *   离线 —— createStream(hotwords) 逐条传，`/` 分隔，可选 ` :分数`
 * 后者的冒号前**必须有空格**，没有的话 sherpa 静默当作没写分数也不报错。
 *
 * 这个模型是 byte-level BPE，配上 modelingUnit='bbpe' + bpeVocab 之后
 * 可以直接写自然词，不用像流式那样自己按词表编码。
 */
function hotwordsArg(): string | undefined {
  const cleaned = hotwords.map((w) => w.trim()).filter(Boolean)
  return cleaned.length ? cleaned.join('/') : undefined
}

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

function init(m: ModelPaths, c: CleanupConfig, mode: 'full' | 'punct-only', hw: string[]): void {
  cleanup = c
  models = m
  hotwords = hw

  // punct-only：只用流式档位，不重转写，所以 SenseVoice 不加载（省 ~230MB）。
  // 标点模型照常加载 —— 它才 72MB，而没有它输出就是一长串不断句的字。
  if (mode === 'full') buildRecognizer(m)
  buildPunct(m)
  send({ type: 'ready' })
}

/**
 * 两种定稿模型，两套配置形状：
 *   sense-voice —— CTC 单文件。自带 ITN（「二零二六年三点五万」→「2026 年 3.5 万」），
 *                  但引擎层面没有热词这条路径。
 *   paraformer  —— CTC 单文件。没有 ITN，也没有热词；胜在有粤语和方言的专门版本。
 *   transducer  —— encoder + decoder + joiner。**支持热词**，体积小得多，
 *                  代价是没有 ITN。
 * 写错分支 sherpa 会直接报「没有给出任何模型」，不会静默回落。
 */
function buildRecognizer(m: ModelPaths): void {
  const off = m.offline

  if (off.kind === 'offline-transducer') {
    // 热词只在 transducer + modified_beam_search 下生效。
    // bpeVocab 是硬前提：没有它，sherpa 编码热词时会失败并静默跳过。
    const wantHotwords = Boolean(off.bpeVocab) && hotwordsArg() !== undefined
    recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: off.encoder ?? '',
          decoder: off.decoder ?? '',
          joiner: off.joiner ?? ''
        },
        tokens: off.tokens,
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
        ...(off.bpeVocab ? { modelingUnit: 'bbpe', bpeVocab: off.bpeVocab } : {})
      },
      decodingMethod: wantHotwords ? 'modified_beam_search' : 'greedy_search',
      maxActivePaths: 4,
      hotwordsScore: HOTWORDS_SCORE
    })
    return
  }

  if (off.kind === 'offline-paraformer') {
    // 单文件 CTC，和 SenseVoice 同类但没有 ITN，也没有热词
    recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        paraformer: { model: off.model },
        tokens: off.tokens,
        numThreads: 2,
        provider: 'cpu',
        debug: 0
      }
    })
    return
  }

  recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: {
        model: off.model,
        language: '',                    // 空 = 自动判语种
        useInverseTextNormalization: 1   // 「二零二六年三点五万」→「2026 年 3.5 万」
      },
      tokens: off.tokens,
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
        init(cmd.models, cmd.cleanup, cmd.mode, cmd.hotwords)
        break

      case 'hotwords:update':
        // 离线侧热词是每次 createStream 现传的，不用重建 recognizer ——
        // 改个热词要等两秒重新加载模型，那体验说不过去
        hotwords = cmd.hotwords
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
          // 离线侧热词是 per-stream 给的，不在构造配置里
          const hw = models?.offline.kind === 'offline-transducer' && models.offline.bpeVocab
            ? hotwordsArg()
            : undefined
          const s = hw === undefined ? recognizer.createStream() : recognizer.createStream(hw)
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
        models = null
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
