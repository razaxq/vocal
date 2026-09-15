/**
 * sherpa-onnx-node 没有随包发布 .d.ts（只有 JSDoc）。
 * 这里只声明我们实际用到的那几个类，其余留 any。
 * 完整的配置字段见 node_modules/sherpa-onnx-node/types.js。
 */
declare module 'sherpa-onnx-node' {
  export interface Waveform { sampleRate: number; samples: Float32Array }

  export class OnlineStream {
    acceptWaveform(w: Waveform): void
    inputFinished(): void
  }

  export class OnlineRecognizer {
    constructor(config: Record<string, unknown>)
    createStream(): OnlineStream
    isReady(s: OnlineStream): boolean
    decode(s: OnlineStream): void
    isEndpoint(s: OnlineStream): boolean
    reset(s: OnlineStream): void
    getResult(s: OnlineStream): { text: string; tokens?: string[]; timestamps?: number[] }
  }

  export class OfflineStream {
    acceptWaveform(w: Waveform): void
  }

  export class OfflineRecognizer {
    constructor(config: Record<string, unknown>)
    /** hotwords：`/` 分隔的短语串，只对 transducer + modified_beam_search 生效 */
    createStream(hotwords?: string): OfflineStream
    decode(s: OfflineStream): void
    getResult(s: OfflineStream): { text: string; lang?: string; emotion?: string }
  }

  export class OfflinePunctuation {
    constructor(config: Record<string, unknown>)
    addPunct(text: string): string
  }

  export class LinearResampler {
    constructor(inputSampleRate: number, outputSampleRate: number)
    resample(samples: Float32Array): Float32Array
    flush(samples: Float32Array): Float32Array
    reset(): void
  }

  export const version: string

  const _default: {
    OnlineRecognizer: typeof OnlineRecognizer
    OfflineRecognizer: typeof OfflineRecognizer
    OfflinePunctuation: typeof OfflinePunctuation
    LinearResampler: typeof LinearResampler
    version: string
  }
  export default _default
}
