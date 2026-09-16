/**
 * 设置界面的基础控件。
 *
 * 分节方式：不用卡片边框，靠标题 + 细横线分隔。
 * 一屏里套七八个带边框的盒子会显得很碎，横线更安静。
 *
 * 所有颜色走 styles.css 的 token，不写死 —— 之前满屏 dark: 变体
 * 漏一个就瞎一处，那个教训不再重复。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'

/* ---------------- 容器 ---------------- */

export function Page({ title, desc, children }: {
  title: string; desc?: ReactNode; children: ReactNode
}): React.ReactElement {
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <header className="pb-5">
        <h1 className="text-[19px] font-semibold tracking-tight text-[var(--fg)]">{title}</h1>
        {desc && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--fg-muted)]">{desc}</p>
        )}
      </header>
      <div>{children}</div>
    </div>
  )
}

/** 一个小节：上方一条横线 + 小标题，内容直接铺开。 */
export function Section({ title, hint, children, action }: {
  title?: string; hint?: string; children: ReactNode; action?: ReactNode
}): React.ReactElement {
  return (
    <section className="border-t border-[var(--border)] pt-5 pb-1 first:border-t-0 first:pt-0">
      {(title || action) && (
        <div className="flex items-start justify-between gap-4">
          {title && (
            <h2 className="text-[13px] font-semibold tracking-wide text-[var(--fg)]">{title}</h2>
          )}
          {action}
        </div>
      )}
      {hint && (
        <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-[var(--fg-muted)]">{hint}</p>
      )}
      <div className="mt-3.5 space-y-4">{children}</div>
    </section>
  )
}

export function Row({ label, hint, children, stack, wideLabel }: {
  label: string; hint?: string; children: ReactNode; stack?: boolean; wideLabel?: boolean
}): React.ReactElement {
  return (
    <div className={stack ? '' : 'sm:flex sm:items-start sm:gap-5'}>
      <div className={stack ? 'mb-2' : wideLabel ? 'min-w-0 pt-1.5 sm:flex-1' : 'w-36 shrink-0 pt-1.5'}>
        <div className="text-[13px] text-[var(--fg)]">{label}</div>
        {hint && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--fg-subtle)]">{hint}</p>
        )}
      </div>
      <div className={wideLabel && !stack ? 'min-w-0 sm:shrink-0' : 'min-w-0 flex-1'}>{children}</div>
    </div>
  )
}

/* ---------------- 输入 ---------------- */

const field =
  'rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 ' +
  'text-[13px] text-[var(--fg)] transition-colors ' +
  'hover:border-[var(--border-strong)] focus:border-[var(--accent)] focus:outline-none'

/**
 * 自己画的下拉，不用原生 select。
 *
 * 原生 select 的弹出列表由操作系统绘制，CSS 完全管不到 ——
 * 界面其它地方都是自定义样式，就它一个是 Windows 默认灰框，很跳。
 */
export function Select({ value, onChange, options, className = '', placeholder }: {
  value: string
  onChange: (v: string) => void
  options: Array<[string, string]>
  className?: string
  placeholder?: string
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  const currentIdx = options.findIndex(([v]) => v === value)
  const current = options[currentIdx]

  useEffect(() => {
    if (!open) return
    setActive(currentIdx >= 0 ? currentIdx : 0)

    const onDocDown = (e: MouseEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open, currentIdx])

  const pick = (v: string): void => { onChange(v); setOpen(false) }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault(); setOpen(true)
      }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = options[active]
      if (opt) pick(opt[0])
    }
  }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onKeyDown={onKeyDown}
        className={`${field} flex w-full items-center justify-between gap-2 text-left ${
          open ? 'border-[var(--accent)]' : ''
        }`}
      >
        <span className={current ? '' : 'text-[var(--fg-subtle)]'}>
          {current ? current[1] : (placeholder ?? '请选择')}
        </span>
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden
             className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round" opacity=".55" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border
                     border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg"
        >
          {options.map(([v, label], i) => (
            <li key={v}>
              <button
                type="button"
                role="option"
                aria-selected={v === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(v)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left
                            text-[13px] transition-colors ${
                  i === active ? 'bg-[var(--surface-hover)]' : ''
                } ${v === value ? 'text-[var(--accent)]' : 'text-[var(--fg)]'}`}
              >
                <span className="w-3.5 shrink-0">
                  {v === value && (
                    <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden>
                      <path d="M1 5l3.5 3.5L11 1.5" fill="none" stroke="currentColor"
                            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="min-w-0 flex-1">{label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Input({ value, onChange, type = 'text', placeholder, mono, className = '' }: {
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  mono?: boolean
  className?: string
}): React.ReactElement {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${field} w-full ${mono ? 'font-mono text-[12px]' : ''} ${className}`}
    />
  )
}

export function Textarea({ value, onChange, rows = 4, placeholder, mono, className = '' }: {
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
  mono?: boolean
  className?: string
}): React.ReactElement {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${field} w-full resize-y leading-relaxed ${mono ? 'font-mono text-[12px]' : ''} ${className}`}
    />
  )
}

export function Num({ value, onChange, min, max, suffix }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; suffix?: string
}): React.ReactElement {
  return (
    <div className="flex w-fit items-center gap-2">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className={`${field} w-28 shrink-0 tabular-nums`}
      />
      {suffix && <span className="shrink-0 text-[12px] text-[var(--fg-muted)]">{suffix}</span>}
    </div>
  )
}

/** 默认显示操作结果，展开后查看排查所需的详细原因。 */
export function ErrorDetails({ title, detail }: { title: string; detail?: string }): React.ReactElement {
  return (
    <div role="alert" className="text-[12px] text-[var(--danger)]">
      <p>{title}</p>
      {detail && (
        <details className="mt-1 text-[var(--fg-muted)]">
          <summary className="cursor-pointer">查看详情</summary>
          <p className="mt-1 select-text whitespace-pre-wrap break-words">{detail}</p>
        </details>
      )}
    </div>
  )
}

export function Toggle({ checked, onChange, label, disabled = false, ariaLabel }: {
  checked: boolean; onChange: (b: boolean) => void; label?: string
  disabled?: boolean; ariaLabel?: string
}): React.ReactElement {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel ?? label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:cursor-wait disabled:opacity-50 ${
          checked ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'
        }`}
      >
        <span
          className="absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-[left]"
          style={{ left: checked ? 19 : 3 }}
        />
      </button>
      {label && <span className="text-[13px] text-[var(--fg-muted)]">{label}</span>}
    </label>
  )
}

export function Button({ onClick, children, variant = 'default', disabled, size = 'md' }: {
  onClick: () => void
  children: ReactNode
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  size?: 'sm' | 'md'
}): React.ReactElement {
  const styles = {
    default: 'border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] hover:bg-[var(--surface-hover)]',
    // 下载用绿底白字，删除用红底白字 —— 破坏性操作要一眼看出来
    primary: 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]',
    danger: 'bg-[var(--danger)] text-white hover:opacity-90',
    ghost: 'text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]'
  }[variant]

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg font-medium transition-colors disabled:cursor-not-allowed
                  disabled:opacity-50 ${size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3 py-1.5 text-[13px]'}
                  ${styles}`}
    >
      {children}
    </button>
  )
}

/** 需要强调的一行说明。不用圆点 —— 圆点看着像在表示某种运行状态。 */
export function Note({ tone = 'muted', children }: {
  tone?: 'muted' | 'warn' | 'danger'
  children: ReactNode
}): React.ReactElement {
  const color = {
    muted: 'text-[var(--fg-subtle)]',
    warn: 'text-[var(--warn)]',
    danger: 'text-[var(--danger)]'
  }[tone]
  return <p className={`text-[11.5px] leading-relaxed ${color}`}>{children}</p>
}

/** 每行一个的列表编辑器。热词、过滤词、应用黑名单都用它。 */
export function LineList({ value, onChange, placeholder, rows = 5 }: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  rows?: number
}): React.ReactElement {
  const count = value.filter((v) => v.trim()).length
  return (
    <div>
      <Textarea
        value={value.join('\n')}
        rows={rows}
        placeholder={placeholder}
        mono
        onChange={(v) => onChange(v.split('\n'))}
      />
      <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">{count} 条 · 每行一个</p>
    </div>
  )
}

/**
 * 窗口控件。
 *
 * 不做成独立的一行标题栏 —— 那条横杠白占 36px 高度，视觉上还把侧栏和内容
 * 拦腰截断。改成右上角的两个按钮，应用名放侧栏顶部（和常见的设置窗口一个路子）。
 *
 * 但它所在的那条必须是**不透明**的：早先做成透明浮层，内容一滚就从按钮
 * 底下穿过去，文字直接压到窗口边缘。现在它是内容区上方一条 surface 色的
 * 实心横条，整条可拖拽，按钮本身排除掉。
 */
export function WindowControls(): React.ReactElement {
  return (
    <div className="no-drag flex">
      <WinBtn onClick={() => void window.vocal.minimizeWindow()} label="最小化">
        <svg width="10" height="1" viewBox="0 0 10 1" aria-hidden>
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </WinBtn>
      <WinBtn onClick={() => void window.vocal.closeWindow()} label="关闭" danger>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </WinBtn>
    </div>
  )
}

function WinBtn({ onClick, children, label, danger }: {
  onClick: () => void; children: ReactNode; label: string; danger?: boolean
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-9 w-11 items-center justify-center text-[var(--fg-subtle)]
                  transition-colors ${
        danger ? 'hover:bg-[var(--danger)] hover:text-white' : 'hover:bg-[var(--surface-hover)]'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * 侧栏顶部的应用标识 —— 就是应用图标本身（build/icon.svg 的精简版）。
 *
 * 之前这里是个绿底白麦克风，和任务栏、开始菜单里看到的图标对不上。
 * 一个应用只该有一个脸：用户在任务栏上认得的那个，打开设置也得是那个。
 * 蓝色是图标的品牌色，不跟着 --accent 走；界面里的绿仍然是绿。
 */
export function AppMark(): React.ReactElement {
  return (
    <div className="drag mb-4 flex h-11 items-center gap-2.5 px-1">
      <svg width="26" height="26" viewBox="220 128 710 706" aria-hidden className="shrink-0">
        <defs>
          <linearGradient id="vm-a" x1="0%" y1="15%" x2="100%" y2="85%">
            <stop offset="0%" stopColor="#3A8CFF" />
            <stop offset="52%" stopColor="#246EEB" />
            <stop offset="100%" stopColor="#123FCA" />
          </linearGradient>
          <linearGradient id="vm-b" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3387FA" />
            <stop offset="58%" stopColor="#2268E3" />
            <stop offset="100%" stopColor="#123FC5" />
          </linearGradient>
        </defs>
        <path d="M651 338C646 432 615 515 558 585C498 659 414 717 287 778"
              fill="none" stroke="url(#vm-b)" strokeWidth="98"
              strokeLinecap="round" strokeLinejoin="round" />
        <path d="M362 430C420 526 489 608 575 669C646 720 724 751 812 775"
              fill="none" stroke="url(#vm-a)" strokeWidth="98"
              strokeLinecap="round" strokeLinejoin="round" />
        <rect x="473" y="134" width="102" height="166" rx="51" fill="url(#vm-a)" />
        <rect x="220" y="240" width="570" height="112" rx="56" fill="url(#vm-a)" />
        <rect x="738" y="430" width="46" height="112" rx="23" fill="url(#vm-a)" />
        <rect x="808" y="388" width="46" height="196" rx="23" fill="url(#vm-a)" />
        <rect x="878" y="430" width="46" height="112" rx="23" fill="url(#vm-a)" />
      </svg>
      <span className="text-[16px] font-semibold tracking-tight text-[var(--fg)]">Vocal</span>
    </div>
  )
}
