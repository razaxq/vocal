/**
 * 主题应用。
 *
 * 配置里存 'system' | 'light' | 'dark'：
 *   system → 根元素不带 data-theme，交给 CSS 的 prefers-color-scheme
 *   其余   → 打上 data-theme，属性选择器优先级压过媒体查询
 *
 * 两个窗口（悬浮面板、设置）各自调用，各自跟随同一份配置。
 */
export type ThemeMode = 'system' | 'light' | 'dark'

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement
  if (mode === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', mode)
}

/** 当前实际生效的是明还是暗 —— 面板要据此调毛玻璃的浓度。 */
export function effectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * 跟随系统时监听系统切换。返回取消订阅函数。
 * 非 system 模式下不需要监听，直接返回空函数。
 */
export function watchSystemTheme(mode: ThemeMode, cb: () => void): () => void {
  if (mode !== 'system' || !window.matchMedia) return () => undefined
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
