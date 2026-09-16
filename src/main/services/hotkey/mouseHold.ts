/** Mouse events are observed, not suppressed. No keyboard events are used. */
export class MouseHoldTrigger {
  private buttons = new Set<number>()
  private origin = { x: 0, y: 0 }
  private firstDownAt = 0
  private lastEndedAt = -Infinity
  private blocked = false
  private active = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private delayMs: number
  private debounceMs: number
  private required: readonly number[]
  private events: { onStart: () => boolean | void; onStop: () => void }

  constructor(delayMs: number, debounceMs: number, events: { onStart: () => boolean | void; onStop: () => void }, button: 'left' | 'middle' | 'leftMiddle' = 'middle') {
    this.delayMs = delayMs
    this.debounceMs = debounceMs
    this.events = events
    this.required = button === 'left' ? [1] : button === 'middle' ? [3] : [1, 3]
  }

  down(button: unknown, x: number, y: number): void {
    // libuiohook: 1 = left, 3 = middle; the right button is never a trigger.
    if (typeof button !== 'number' || !this.required.includes(button) || this.buttons.has(button)) return
    const now = Date.now()
    if (!this.buttons.size) {
      this.firstDownAt = now
      this.origin = { x, y }
      this.blocked = now - this.lastEndedAt < this.debounceMs
    }
    this.buttons.add(button)
    this.move(x, y)
    if (this.buttons.size !== this.required.length || this.blocked) return
    // A long-held button followed by another press is usually a drag/other gesture.
    if (now - this.firstDownAt > 250) { this.blocked = true; return }
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.blocked || this.buttons.size !== this.required.length) return
      if (this.events.onStart() === false) { this.blocked = true; return }
      this.active = true
    }, this.delayMs)
  }

  up(button: unknown): void {
    if (typeof button !== 'number' || !this.required.includes(button)) return
    if (!this.buttons.delete(button)) return
    this.cancelWaiting()
    this.stop()
    // All required buttons must be released before another gesture can start.
    if (!this.buttons.size) this.blocked = false
  }

  move(x: number, y: number): void {
    if (!this.active && this.buttons.size && Math.hypot(x - this.origin.x, y - this.origin.y) > 6) {
      this.cancelWaiting()
    }
  }

  cancelWaiting(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.blocked = true
  }

  private stop(): void {
    if (!this.active) return
    this.active = false
    this.lastEndedAt = Date.now()
    this.events.onStop()
  }

  dispose(): void {
    this.cancelWaiting()
    this.buttons.clear()
    this.stop()
  }
}
