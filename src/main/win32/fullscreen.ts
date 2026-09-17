export interface WindowRect { left: number; top: number; right: number; bottom: number }

/** Use the client area: maximized window borders can extend beyond the monitor. */
export function coversMonitor(client: WindowRect, monitor: WindowRect, className: string): boolean {
  if (['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd'].includes(className)) return false
  if (![...Object.values(client), ...Object.values(monitor)].every(Number.isFinite)) return false
  if (client.right <= client.left || client.bottom <= client.top ||
      monitor.right <= monitor.left || monitor.bottom <= monitor.top) return false
  return client.left <= monitor.left + 1 && client.top <= monitor.top + 1 &&
    client.right >= monitor.right - 1 && client.bottom >= monitor.bottom - 1
}
