/** 用段号关联预览与定稿，迟到的上一句不能清空正在说的下一句。 */
export class SegmentPreview {
  private pending = new Map<number, string>()
  private finalized = new Set<number>()

  partial(index: number, text: string): void {
    if (!this.finalized.has(index)) this.pending.set(index, text)
  }

  finish(index: number): string {
    const raw = this.pending.get(index) ?? ''
    this.pending.delete(index)
    this.finalized.add(index)
    return raw
  }

  get live(): string {
    return [...this.pending].sort((a, b) => a[0] - b[0]).map(([, text]) => text).join('')
  }

  reset(): void { this.pending.clear(); this.finalized.clear() }
}
