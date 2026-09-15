/**
 * 会话音频缓冲。
 *
 * 主进程从渲染进程收到每一帧音频后存在这里，同时转发给流式进程。
 * 流式进程报 endpoint 时会带上「截至此刻消费了多少采样点」，
 * 主进程据此从缓冲里精确切出这一段交给定稿进程 ——
 * 音频只在主进程存一份，不用在两个工作进程之间来回传。
 *
 * 用 chunk 链表而不是不断 realloc 的大数组：一小时录音也不会有拷贝尖峰。
 */
export class SessionAudioBuffer {
  private chunks: Float32Array[] = []
  private total = 0
  /** 已经切走的采样点数，切片从这里开始 */
  private cursor = 0

  push(samples: Float32Array): void {
    this.chunks.push(samples)
    this.total += samples.length
  }

  get length(): number {
    return this.total
  }

  get pending(): number {
    return this.total - this.cursor
  }

  /**
   * 切出 [cursor, end) 并把游标推到 end。
   * end 超过已缓冲的长度时按已有的算 —— 流式进程和主进程的帧计数
   * 可能差一两帧，多切少切几十毫秒的静音对定稿没有影响。
   */
  cutTo(end: number): Float32Array {
    const stop = Math.min(end, this.total)
    const out = this.slice(this.cursor, stop)
    this.cursor = stop
    return out
  }

  /** 切走剩下的全部。 */
  cutRest(): Float32Array {
    return this.cutTo(this.total)
  }

  private slice(from: number, to: number): Float32Array {
    const n = Math.max(0, to - from)
    const out = new Float32Array(n)
    if (n === 0) return out

    let written = 0
    let pos = 0
    for (const chunk of this.chunks) {
      const chunkStart = pos
      const chunkEnd = pos + chunk.length
      pos = chunkEnd
      if (chunkEnd <= from) continue
      if (chunkStart >= to) break

      const a = Math.max(from, chunkStart) - chunkStart
      const b = Math.min(to, chunkEnd) - chunkStart
      out.set(chunk.subarray(a, b), written)
      written += b - a
    }
    return out
  }

  reset(): void {
    this.chunks = []
    this.total = 0
    this.cursor = 0
  }

  /**
   * 丢掉游标之前的 chunk，回收内存。
   * 长时间连续听写时必须定期调用，否则一小时录音会占掉 ~230MB。
   */
  compact(): void {
    if (this.cursor === 0) return
    let dropped = 0
    let keepFrom = 0
    for (const chunk of this.chunks) {
      if (dropped + chunk.length > this.cursor) break
      dropped += chunk.length
      keepFrom++
    }
    if (keepFrom === 0) return
    this.chunks = this.chunks.slice(keepFrom)
    this.total -= dropped
    this.cursor -= dropped
  }
}
