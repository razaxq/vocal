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
  private events: { onStart: () => void; onStop: () => void }

  constructor(delayMs: number, debounceMs: number, events: { onStart: () => void; onStop: () => void }) {
    this.delayMs = delayMs
    this.debounceMs = debounceMs
    this.events = events
  }

  down(button: unknown, x: number, y: number): void {
    // libuiohook: 1 = left, 2 = right (not the browser MouseEvent numbering).
    if ((button !== 1 && button !== 2) || this.buttons.has(button)) return
    const now = Date.now()
    if (!this.buttons.size) {
      this.firstDownAt = now
      this.origin = { x, y }
      this.blocked = now - this.lastEndedAt < this.debounceMs
    }
    this.buttons.add(button)
    this.move(x, y)
    if (this.buttons.size !== 2 || this.blocked) return
    // A long-held button followed by another press is usually a drag/other gesture.
    if (now - this.firstDownAt > 250) { this.blocked = true; return }
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.blocked || this.buttons.size !== 2) return
      this.active = true
      this.events.onStart()
    }, this.delayMs)
  }

  up(button: unknown): void {
    if (button !== 1 && button !== 2) return
    if (!this.buttons.delete(button)) return
    this.cancelWaiting()
    this.stop()
    // Both buttons must be released before another gesture can start.
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
