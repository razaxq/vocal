/**
 * M1 前置验证：sherpa 的配置字段和模型路径到底对不对。
 *
 *   npm run m1:asr
 *
 * 为什么单独验这个：`src/asr-worker/*.ts` 里的配置对象是照着
 * sherpa-onnx-node 的 types.js 写的，一行都没执行过。字段名打错一个字母
 * （`senseVoice` 写成 `sensevoice`、`ctTransformer` 写成 `ct_transformer`）
 * 类型检查完全拦不住 —— 那些参数的类型就是 Record<string, unknown>。
 * 只有真的 new 一个出来才知道。
 *
 * 这里直接用 sherpa，不经过 utilityProcess，把「配置对不对」和
 * 「进程能不能 fork」两个问题分开，出错时不用猜是哪一层。
 *
 * 局限：喂的是静音，只能证明「加载 + 解码跑通不崩」，
 * 证明不了识别准确率。真实语音要等 npm run dev。
 */
const { join } = require('node:path')
const { existsSync, statSync, readdirSync } = require('node:fs')

const results = []
const pass = (n, d) => { results.push(true); console.log(`  \x1b[32mPASS\x1b[0m  ${n}${d ? `  —  ${d}` : ''}`) }
const fail = (n, d) => { results.push(false); console.log(`  \x1b[31mFAIL\x1b[0m  ${n}${d ? `  —  ${d}` : ''}`) }
const info = (n, d) => console.log(`        ${n}${d ? `  —  ${d}` : ''}`)

/** 和主进程的 setupDataDir() 保持一致：便携模式，模型在项目根的 data/models。 */
function modelsRoot() {
  return join(__dirname, '..', '..', 'data', 'models')
}

function resolveModelPaths(root) {
  const D = {
    streaming: 'sherpa-onnx-streaming-paraformer-bilingual-zh-en',
    senseVoice: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17',
    punct: 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8',
    vad: 'silero-vad'
  }
  return {
    streamingEncoder: join(root, D.streaming, 'encoder.int8.onnx'),
    streamingDecoder: join(root, D.streaming, 'decoder.int8.onnx'),
    streamingTokens: join(root, D.streaming, 'tokens.txt'),
    senseVoiceModel: join(root, D.senseVoice, 'model.int8.onnx'),
    senseVoiceTokens: join(root, D.senseVoice, 'tokens.txt'),
    punctCtTransformer: join(root, D.punct, 'model.int8.onnx'),
    vadModel: join(root, D.vad, 'silero_vad.onnx')
  }
}

function dirSize(dir) {
  let total = 0
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else total += statSync(p).size
    }
  }
  try { walk(dir) } catch { /* ignore */ }
  return total
}

const mb = (b) => `${(b / (1 << 20)).toFixed(1)} MB`

async function main() {
  console.log('\n═══ Vocal M1 前置：ASR 配置与模型 ═══\n')

  const root = modelsRoot()
  const m = resolveModelPaths(root)
  info('模型目录', root)

  // ---- 1. 文件齐不齐 ----
  const missing = Object.entries(m).filter(([, p]) => !existsSync(p)).map(([k]) => k)
  if (missing.length === 0) {
    pass('模型文件齐全', `7 个文件，共 ${mb(dirSize(root))}`)
  } else {
    fail('模型文件缺失', missing.join(', '))
    info('→', '先跑 npm run models；仍然缺就看实际目录名是不是和 scripts/models.json 的 dir 对不上')
    return
  }

  let sherpa
  try {
    sherpa = require('sherpa-onnx-node')
  } catch (e) {
    fail('加载 sherpa-onnx-node', e.message)
    return
  }

  // ---- 2. 流式识别器：配置字段 + 加载耗时 ----
  let online = null
  try {
    const t0 = Date.now()
    online = new sherpa.OnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        paraformer: { encoder: m.streamingEncoder, decoder: m.streamingDecoder },
        tokens: m.streamingTokens,
        numThreads: 2,
        provider: 'cpu',
        debug: 0
      },
      decodingMethod: 'greedy_search',
      enableEndpoint: true,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.2,
      rule3MinUtteranceLength: 300
    })
    pass('OnlineRecognizer 构造', `加载耗时 ${Date.now() - t0}ms`)
  } catch (e) {
    fail('OnlineRecognizer 构造', e.message)
    info('→', '配置字段名不对，或模型文件损坏。对照 node_modules/sherpa-onnx-node/types.js')
  }

  // ---- 3. 流式解码：喂 2 秒静音，只看跑不跑得通 ----
  if (online) {
    try {
      const t0 = Date.now()
      const s = online.createStream()
      const frame = new Float32Array(1600) // 100ms
      for (let i = 0; i < 20; i++) {
        s.acceptWaveform({ sampleRate: 16000, samples: frame })
        while (online.isReady(s)) online.decode(s)
      }
      const text = online.getResult(s).text ?? ''
      const isEnd = online.isEndpoint(s)
      pass('流式解码 2 秒静音', `${Date.now() - t0}ms，结果「${text}」，endpoint=${isEnd}`)
      info('', '静音出空串是正确的；这一步只证明 acceptWaveform / decode / getResult / isEndpoint 四个接口都在')
    } catch (e) {
      fail('流式解码', e.message)
    }
  }

  // ---- 4. SenseVoice：配置字段 + 加载 + 解码 ----
  let offline = null
  try {
    const t0 = Date.now()
    offline = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        senseVoice: {
          model: m.senseVoiceModel,
          language: '',
          useInverseTextNormalization: 1
        },
        tokens: m.senseVoiceTokens,
        numThreads: 2,
        provider: 'cpu',
        debug: 0
      }
    })
    pass('OfflineRecognizer(SenseVoice) 构造', `加载耗时 ${Date.now() - t0}ms`)
  } catch (e) {
    fail('OfflineRecognizer(SenseVoice) 构造', e.message)
    info('→', 'senseVoice / useInverseTextNormalization 这些字段名要和 types.js 完全一致')
  }

  if (offline) {
    try {
      // 5 秒静音 —— 和真实使用中一段话的长度接近，这个耗时就是定稿延迟的量级
      const samples = new Float32Array(16000 * 5)
      const t0 = Date.now()
      const s = offline.createStream()
      s.acceptWaveform({ sampleRate: 16000, samples })
      offline.decode(s)
      const r = offline.getResult(s)
      const ms = Date.now() - t0
      pass('SenseVoice 解码 5 秒', `${ms}ms，结果「${r.text ?? ''}」`)
      info('', `这就是每段定稿的延迟量级。设计文档估的是 80~250ms，实测 ${ms}ms`)
      if (ms > 600) {
        info('⚠', '比预期慢不少，长句上屏会有感。可以考虑调 numThreads，或做 DirectML 实验')
      }
    } catch (e) {
      fail('SenseVoice 解码', e.message)
    }
  }

  // ---- 5. 标点模型 ----
  try {
    const t0 = Date.now()
    const punct = new sherpa.OfflinePunctuation({
      model: {
        ctTransformer: m.punctCtTransformer,
        numThreads: 1,
        provider: 'cpu',
        debug: 0
      }
    })
    const load = Date.now() - t0

    const t1 = Date.now()
    const out = punct.addPunct('今天天气不错我们出去走走吧你觉得呢')
    pass('标点恢复', `加载 ${load}ms，处理 ${Date.now() - t1}ms`)
    info('输入', '今天天气不错我们出去走走吧你觉得呢')
    info('输出', out)
    if (out === '今天天气不错我们出去走走吧你觉得呢') {
      info('⚠', '输出和输入一样，标点没加上 —— 检查模型文件是不是对的')
    }
  } catch (e) {
    fail('标点恢复', e.message)
    info('→', 'ctTransformer 字段名，或 punct 模型的目录名和 models.json 对不上')
  }

  const bad = results.filter((r) => !r).length
  console.log(`\n═══ ${results.length - bad} 通过 / ${bad} 失败 ═══`)
  if (bad === 0) {
    console.log('\n配置和模型都没问题，可以 npm run dev 跑真实语音了。\n')
  }
  process.exit(bad > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('\n探针本身崩了：', e.stack || e.message)
  process.exit(1)
})
