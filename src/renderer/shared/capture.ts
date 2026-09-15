/**
 * 麦克风采集。以 16k 打开 AudioContext，让浏览器做重采样，
 * 再用 AudioWorklet 攒成 100ms 的帧丢给主进程。
 *
 * 常驻不关：反复 getUserMedia 会有 100~300ms 的开麦延迟，
 * 那正好落在「按下热键到开始录」这段最敏感的时间里。
 * 所以流一直开着，只用 gate 控制是否投递。
 */
import { AUDIO } from '@shared/types'

export interface CaptureOptions {
  deviceId: string | null
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
}

export class MicCapture {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private gateOpen = false

  constructor(
    private onFrame: (samples: Float32Array) => void,
    private onLevel: (rms: number) => void
  ) {}

  async init(opts: CaptureOptions): Promise<void> {
    await this.dispose()

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: AUDIO.channels,
        sampleRate: AUDIO.sampleRate,
        echoCancellation: opts.echoCancellation,
        noiseSuppression: opts.noiseSuppression,
        autoGainControl: opts.autoGainControl,
        ...(opts.deviceId ? { deviceId: { exact: opts.deviceId } } : {})
      }
    })

    this.ctx = new AudioContext({ sampleRate: AUDIO.sampleRate })
    // 两个页面都在 renderer 的下一层；绝对路径在 file:// 下会指向盘符根目录。
    const workletUrl = new URL('../pcm-worklet.js', window.location.href)
    await this.ctx.audioWorklet.addModule(workletUrl.href)

    const src = this.ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.ctx, 'pcm-collector', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { frameSize: AUDIO.frameSize }
    })

    this.node.port.onmessage = (e: MessageEvent<{ samples: Float32Array; rms: number }>) => {
      this.onLevel(e.data.rms)
      if (this.gateOpen) this.onFrame(e.data.samples)
    }

    src.connect(this.node)
  }

  open(): void { this.gateOpen = true }
  close(): void { this.gateOpen = false }

  async dispose(): Promise<void> {
    this.gateOpen = false
    this.node?.port.close()
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close()
    this.node = null
    this.stream = null
    this.ctx = null
  }
}
