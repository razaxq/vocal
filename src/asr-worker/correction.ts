/** Dedicated process: sherpa and onnxruntime-node ship different Windows ORT DLLs. */
import type { CorrectionCommand, FinalizeEvent } from '../shared/types'
import type { LocalCorrector } from './corrector'
import { HotwordIndex } from '../shared/hotwordRetrieval'

const port = process.parentPort
const send = (event: FinalizeEvent): void => port.postMessage(event)
let model: LocalCorrector | undefined
let dictionary: HotwordIndex | undefined
let words: string[] = []
let queue = Promise.resolve()

port.on('message', (event: { data: CorrectionCommand }) => {
  queue = queue.then(() => handle(event.data)).catch(error => {
    send({ type: 'error', message: `同音纠错不可用：${String(error)}`, fatal: false })
  })
})

async function handle(command: CorrectionCommand): Promise<void> {
  switch (command.type) {
    case 'init':
      words = command.hotwords.map(w => w.text)
      try {
        const { LocalCorrector } = await import('./corrector')
        model = await LocalCorrector.create(command.model.model, command.model.vocab, command.model.mode)
        dictionary = command.dictionary ? new HotwordIndex(command.dictionary) : undefined
      } catch (error) {
        send({ type: 'error', message: `同音纠错暂不可用，继续语音识别：${String(error)}`, fatal: false })
      }
      send({ type: 'ready' })
      break
    case 'hotwords:update': words = command.hotwords.map(w => w.text); break
    case 'dictionary:update': dictionary = command.dictionary ? new HotwordIndex(command.dictionary) : undefined; break
    case 'correct': {
      const started = Date.now()
      let text = command.result.text
      try { if (model) text = await model.correct(text, words, dictionary) }
      catch (error) { send({ type: 'error', message: `同音纠错失败，已保留识别结果：${String(error)}`, fatal: false }) }
      send({ ...command.result, text, latencyMs: command.result.latencyMs + Date.now() - started })
      break
    }
    case 'shutdown': await model?.dispose(); process.exit(0)
  }
}
