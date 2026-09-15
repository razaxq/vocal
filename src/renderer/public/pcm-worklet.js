/**
 * AudioWorklet：把 AudioContext 的 128 采样块攒成固定长度的帧，投递给主线程。
 *
 * AudioContext 以 16000Hz 创建，浏览器直接按该采样率重采样，
 * 所以这里拿到的就是模型要的格式，不需要额外 resampler。
 */
class PcmCollector extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.frameSize = options?.processorOptions?.frameSize ?? 1600
    this.buf = new Float32Array(this.frameSize)
    this.filled = 0
  }

  process(inputs) {
    const ch = inputs[0]?.[0]
    if (!ch) return true

    let offset = 0
    while (offset < ch.length) {
      const n = Math.min(this.frameSize - this.filled, ch.length - offset)
      this.buf.set(ch.subarray(offset, offset + n), this.filled)
      this.filled += n
      offset += n

      if (this.filled === this.frameSize) {
        // 顺带算个 RMS 给波形用，省得主线程再遍历一遍
        let sum = 0
        for (let i = 0; i < this.frameSize; i++) sum += this.buf[i] * this.buf[i]
        const rms = Math.sqrt(sum / this.frameSize)

        const out = this.buf.slice()
        this.port.postMessage({ samples: out, rms }, [out.buffer])
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-collector', PcmCollector)
