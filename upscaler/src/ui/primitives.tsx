// Small shared pieces. Everything tappable is at least 3rem tall, which is the whole
// reason these exist rather than repeating class strings: a control that is comfortable
// on a desktop is often too small on a phone, and the app is used on a phone.

import type { ReactNode } from 'react'

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-2xl border border-paper-300 bg-paper-50 p-4 dark:border-ink-700 dark:bg-ink-900 ${className}`}
    >
      {children}
    </section>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
}) {
  const styles = {
    primary:
      'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-700 disabled:bg-ink-600',
    secondary:
      'bg-paper-200 text-ink-900 hover:bg-paper-300 dark:bg-ink-800 dark:text-paper-100 dark:hover:bg-ink-700',
    ghost:
      'bg-transparent text-ink-700 hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-ink-800',
    danger: 'bg-bad-500 text-white hover:brightness-110',
  }[variant]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`touch inline-flex items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  )
}

export interface Option<T> {
  value: T
  label: string
  hint?: string
}

/**
 * A row of choices. Wraps rather than scrolling sideways: a horizontally scrolling row
 * hides options, and on a phone a hidden option may as well not exist.
 */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  columns,
}: {
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
  label?: string
  columns?: number
}) {
  return (
    <div>
      {label && <Label>{label}</Label>}
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${columns ?? Math.min(options.length, 3)}, minmax(0, 1fr))`,
        }}
        role="radiogroup"
        aria-label={label}
      >
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              className={`touch flex flex-col items-center justify-center rounded-xl border px-2 py-2 text-center text-sm font-semibold transition ${
                active
                  ? 'border-brand-500 bg-brand-500/15 text-brand-700 dark:text-brand-400'
                  : 'border-paper-300 bg-paper-50 text-ink-700 dark:border-ink-700 dark:bg-ink-850 dark:text-paper-200'
              }`}
            >
              <span>{option.label}</span>
              {option.hint && (
                <span className="text-xs font-normal opacity-70">{option.hint}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-600 dark:text-paper-300">
      {children}
    </div>
  )
}

export function Stat({
  label,
  value,
  tone = 'plain',
  wide = false,
}: {
  label: string
  value: ReactNode
  tone?: 'plain' | 'good' | 'warn' | 'bad'
  /** Spans both columns. For values like "28,800 x 10,800" that wrap mid-number. */
  wide?: boolean
}) {
  const colour = {
    plain: '',
    good: 'text-good-500',
    warn: 'text-warn-500',
    bad: 'text-bad-500',
  }[tone]
  return (
    <div
      className={`rounded-xl bg-paper-100 px-3 py-2 dark:bg-ink-850 ${
        wide ? 'col-span-2' : ''
      }`}
    >
      <div className="text-xs font-medium text-ink-600 dark:text-paper-300">{label}</div>
      <div className={`tabular text-base font-bold ${colour}`}>{value}</div>
    </div>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  step = 1,
  suffix,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  step?: number
  suffix?: string
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <div className="flex items-center rounded-xl border border-paper-300 bg-paper-50 dark:border-ink-700 dark:bg-ink-850">
        <input
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          step={step}
          onChange={(event) => {
            const next = Number(event.target.value)
            onChange(Number.isFinite(next) ? next : 0)
          }}
          className="touch w-full bg-transparent px-3 text-base font-semibold outline-none"
        />
        {suffix && (
          <span className="pr-3 text-sm text-ink-600 dark:text-paper-300">{suffix}</span>
        )}
      </div>
    </label>
  )
}

export function Note({
  children,
  tone = 'info',
}: {
  children: ReactNode
  tone?: 'info' | 'warn' | 'bad'
}) {
  const styles = {
    info: 'border-brand-500/40 bg-brand-500/10 text-ink-800 dark:text-paper-200',
    warn: 'border-warn-500/50 bg-warn-500/10 text-ink-800 dark:text-paper-200',
    bad: 'border-bad-500/50 bg-bad-500/10 text-ink-800 dark:text-paper-200',
  }[tone]
  return (
    <p className={`rounded-xl border px-3 py-2 text-sm leading-relaxed ${styles}`}>
      {children}
    </p>
  )
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="touch flex w-full items-center justify-between gap-3 rounded-xl border border-paper-300 bg-paper-50 px-3 text-left dark:border-ink-700 dark:bg-ink-850"
    >
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {hint && (
          <span className="block text-xs text-ink-600 dark:text-paper-300">{hint}</span>
        )}
      </span>
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${
          checked ? 'bg-brand-600' : 'bg-paper-300 dark:bg-ink-700'
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
            checked ? 'left-6' : 'left-1'
          }`}
        />
      </span>
    </button>
  )
}
