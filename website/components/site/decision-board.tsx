'use client'

import { Check, Eye, Minus, Plus, RotateCcw, Terminal, X } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { useInView } from '@/hooks/use-in-view'
import { cn } from '@/lib/utils'
import { SectionHeading } from './section-heading'

type Source = 'yours' | 'inferred' | 'practice'
type Requirement = { label: string; source: Source; component: string }
type Verdict = 'reuse_existing' | 'extend_existing' | 'custom_build'

const requirements: Requirement[] = [
  { label: 'Itemized line rows', source: 'yours', component: 'PriceRow' },
  { label: 'Nightly rate × nights', source: 'yours', component: 'PriceRow' },
  { label: 'Total row', source: 'yours', component: 'TotalRow' },
  { label: 'Currency formatting', source: 'inferred', component: 'formatMoney' },
  { label: 'Discount line', source: 'inferred', component: 'DiscountLine' },
  { label: 'Fee tooltip', source: 'inferred', component: 'FeeTooltip' },
  { label: 'Collapsible fee explanation', source: 'practice', component: 'FeeDisclosure' },
  { label: 'Mobile layout', source: 'practice', component: 'MobileSheet' },
]

const initialMet = [true, true, false, false, false, false, false, false]

function getVerdict(metCount: number): Verdict {
  if (metCount >= 7) return 'reuse_existing'
  if (metCount >= 4) return 'extend_existing'
  return 'custom_build'
}

const verdictBorder: Record<Verdict, string> = {
  reuse_existing: 'border-success',
  extend_existing: 'border-primary',
  custom_build: 'border-warn',
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

type DecisionState = {
  met: boolean[]
  metCount: number
  verdict: Verdict
  reuse: string[]
  build: string[]
}

function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('overflow-hidden rounded-3xl bg-muted p-4 md:p-5', className)}>{children}</div>
}

function PriceMock() {
  const [nights, setNights] = useState(5)
  const rate = 182
  const base = rate * nights
  const cleaning = 85
  const service = Math.round(base * 0.142)
  const taxes = Math.round((base + cleaning) * 0.078)
  const total = base + cleaning + service + taxes
  const rows: [string, number][] = [
    ['Cleaning fee', cleaning],
    ['Service fee', service],
    ['Taxes', taxes],
  ]

  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex items-start gap-2 self-end rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-sm text-background">
        {'“Price breakdown with fees and taxes”'}
      </div>
      <div className="flex flex-col gap-3 rounded-2xl bg-background p-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Image src="/logos/figma.svg" alt="" width={12} height={12} className="size-3" />
          Checkout / Price breakdown
        </div>
        <dl className="flex flex-col gap-2.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span className="underline decoration-dotted underline-offset-4">${rate} ×</span>
              <span className="flex items-center rounded-full bg-muted">
                <button
                  type="button"
                  onClick={() => setNights((n) => Math.max(1, n - 1))}
                  disabled={nights <= 1}
                  aria-label="Fewer nights"
                  className="flex size-6 items-center justify-center rounded-full text-foreground transition-colors hover:bg-border disabled:opacity-30"
                >
                  <Minus className="size-3" />
                </button>
                <span className="w-16 text-center text-xs text-foreground tabular-nums" aria-live="polite">
                  {nights} {nights === 1 ? 'night' : 'nights'}
                </span>
                <button
                  type="button"
                  onClick={() => setNights((n) => Math.min(14, n + 1))}
                  disabled={nights >= 14}
                  aria-label="More nights"
                  className="flex size-6 items-center justify-center rounded-full text-foreground transition-colors hover:bg-border disabled:opacity-30"
                >
                  <Plus className="size-3" />
                </button>
              </span>
            </dt>
            <dd className="font-medium tabular-nums">{usd.format(base)}</dd>
          </div>
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between">
              <dt className="text-muted-foreground underline decoration-dotted underline-offset-4">{label}</dt>
              <dd className="font-medium tabular-nums">{usd.format(value)}</dd>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t pt-3 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{usd.format(total)}</dd>
          </div>
        </dl>
        <button
          type="button"
          className="mt-1 rounded-xl bg-foreground py-3 text-center text-sm font-medium text-background transition-opacity hover:opacity-90 active:scale-[0.99]"
        >
          Reserve
        </button>
      </div>
    </Panel>
  )
}

function CoverageCard({ revealed, met }: { revealed: number; met: boolean[] }) {
  const count = met.slice(0, revealed).filter(Boolean).length
  return (
    <Panel className="flex flex-col gap-4">
      <p className="text-xs font-medium text-muted-foreground">Coverage</p>
      <p className="text-5xl font-medium tracking-tight tabular-nums">
        {count}
        <span className="text-muted-foreground">/{requirements.length}</span>
      </p>
      <div className="flex gap-1.5" aria-hidden="true">
        {requirements.map((r, i) => (
          <span
            key={r.label}
            className={cn(
              'h-2 flex-1 rounded-full transition-colors duration-300',
              i < revealed ? (met[i] ? 'bg-success' : 'bg-border') : 'bg-background',
            )}
          />
        ))}
      </div>
    </Panel>
  )
}

function VerdictCard({ state }: { state: DecisionState }) {
  return (
    <Panel className="flex flex-col items-start gap-6">
      <div className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground">
        <span>Verdict</span>
        <span>
          Confidence <span className="text-foreground">High</span>
        </span>
      </div>
      <span
        aria-live="polite"
        className={cn(
          'rounded-full border-2 bg-background px-4 py-2 font-mono text-lg font-medium transition-colors md:text-xl',
          verdictBorder[state.verdict],
        )}
      >
        {state.verdict}
      </span>
      <div className="flex w-full gap-2 text-xs">
        <span className="rounded-full bg-background px-3 py-1.5">{state.reuse.length} reuse</span>
        <span className="rounded-full bg-background px-3 py-1.5">{state.build.length} build</span>
      </div>
    </Panel>
  )
}

function RequirementsCard({
  revealed,
  met,
  onToggle,
}: {
  revealed: number
  met: boolean[]
  onToggle: (index: number) => void
}) {
  return (
    <Panel className="flex flex-col gap-1">
      <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Requirements</p>
      <ul className="flex flex-col">
        {requirements.map((r, i) => {
          const shown = i < revealed
          const isMet = shown && met[i]
          return (
            <li key={r.label}>
              <button
                type="button"
                onClick={() => onToggle(i)}
                disabled={!shown}
                aria-pressed={met[i]}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm transition-all duration-300 hover:bg-background/70',
                  shown ? 'opacity-100' : 'opacity-30',
                )}
              >
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full transition-colors',
                    isMet ? 'bg-success text-background' : 'bg-background text-muted-foreground',
                  )}
                >
                  {isMet ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
                </span>
                <span className="flex-1 truncate">{r.label}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{r.source}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function ChipList({ items, tone }: { items: string[]; tone: 'success' | 'warn' }) {
  if (items.length === 0) {
    return <span className="text-xs text-ink-foreground/40">None</span>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((c) => (
        <span
          key={c}
          className="flex items-center gap-2 rounded-full bg-ink-muted px-3 py-1.5 font-mono text-xs animate-in fade-in zoom-in-95 duration-200"
        >
          <span className={cn('size-1.5 rounded-full', tone === 'success' ? 'bg-success' : 'bg-warn')} />
          {c}
        </span>
      ))}
    </div>
  )
}

function DecisionPanel({ state }: { state: DecisionState }) {
  const seconds = 8 + state.build.length * 2
  const cost = (0.01 + state.build.length * 0.004).toFixed(2)
  return (
    <div className="flex flex-col gap-5 rounded-3xl bg-ink p-5 text-ink-foreground">
      <div className="flex items-center justify-between">
        <p className="font-medium">Decision</p>
        <span className="font-mono text-xs text-ink-foreground/50">#a41f</span>
      </div>

      <div className="flex items-center justify-between rounded-2xl bg-ink-muted px-4 py-3 text-sm">
        <span className="text-ink-foreground/60">Design system</span>
        <span className="flex items-center gap-2">
          <Image src="/logos/figma.svg" alt="" width={12} height={12} className="size-3" />
          acme-ds
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-foreground/60">Reuse</p>
        <ChipList items={state.reuse} tone="success" />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-foreground/60">Build</p>
        <ChipList items={state.build} tone="warn" />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-foreground/60">Evidence</p>
        <div className="rounded-2xl bg-ink-muted p-3 font-mono text-xs leading-relaxed">
          <p className="text-ink-foreground/50">src/ui/PriceRow.tsx:14</p>
          <p>{'label: string; amount: Money'}</p>
        </div>
      </div>

      <dl className="mt-auto grid grid-cols-3 gap-2 text-center">
        {[
          [`${seconds}s`, 'time'],
          [`$${cost}`, 'cost'],
          ['4.2.0', 'version'],
        ].map(([value, label]) => (
          <div key={label} className="rounded-2xl bg-ink-muted px-2 py-3">
            <dd className="font-mono text-sm tabular-nums">{value}</dd>
            <dt className="text-[11px] text-ink-foreground/50">{label}</dt>
          </div>
        ))}
      </dl>
    </div>
  )
}

function AgentView({ state }: { state: DecisionState }) {
  const response = JSON.stringify(
    {
      verdict: state.verdict,
      confidence: 'high',
      coverage: { met: state.metCount, total: requirements.length },
      reuse: state.reuse,
      build: state.build,
      evidence: [{ file: 'src/ui/PriceRow.tsx', line: 14, quote: 'label: string; amount: Money' }],
      cost: { seconds: 8 + state.build.length * 2, usd: Number((0.01 + state.build.length * 0.004).toFixed(2)) },
      checked_against: 'acme-ds@4.2.0',
    },
    null,
    2,
  )
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-3xl bg-ink text-ink-foreground">
      <div className="flex items-center gap-2 border-b border-ink-muted px-5 py-3 font-mono text-xs text-ink-foreground/50">
        <Terminal className="size-3.5" />
        pattern.check → response
      </div>
      <pre className="flex-1 overflow-x-auto p-5 font-mono text-xs leading-relaxed md:text-sm">
        <code>{response}</code>
      </pre>
    </div>
  )
}

export function DecisionBoard() {
  const { ref, inView } = useInView<HTMLDivElement>(0.25)
  const [mode, setMode] = useState<'human' | 'agent'>('human')
  const [revealed, setRevealed] = useState(0)
  const [run, setRun] = useState(0)
  const [met, setMet] = useState<boolean[]>(initialMet)

  const state = useMemo<DecisionState>(() => {
    const metCount = met.filter(Boolean).length
    const reuse = [...new Set(requirements.filter((_, i) => met[i]).map((r) => r.component))]
    const build = [...new Set(requirements.filter((_, i) => !met[i]).map((r) => r.component))].filter(
      (c) => !reuse.includes(c),
    )
    return { met, metCount, verdict: getVerdict(metCount), reuse, build }
  }, [met])

  useEffect(() => {
    if (!inView) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRevealed(requirements.length)
      return
    }
    setRevealed(0)
    const id = setInterval(() => {
      setRevealed((n) => {
        if (n >= requirements.length) {
          clearInterval(id)
          return n
        }
        return n + 1
      })
    }, 280)
    return () => clearInterval(id)
  }, [inView, run])

  const toggle = (index: number) => setMet((prev) => prev.map((v, i) => (i === index ? !v : v)))

  return (
    <section aria-labelledby="board-title" className="flex flex-col items-center gap-12 py-24">
      <SectionHeading id="board-title">Ask for the screen. Get a decision.</SectionHeading>

      <div ref={ref} className="relative w-full max-w-6xl px-4 md:px-6">
        <div className="rounded-[2rem] border bg-background p-3 shadow-[0_30px_80px_-40px_rgb(0_0_0/0.25)]">
          <div className="grid gap-3 lg:grid-cols-[1fr_1fr_320px]">
            {mode === 'human' ? (
              <>
                <div className="flex flex-col gap-3">
                  <PriceMock />
                  <CoverageCard revealed={revealed} met={met} />
                </div>
                <div className="flex flex-col gap-3">
                  <VerdictCard state={state} />
                  <RequirementsCard revealed={revealed} met={met} onToggle={toggle} />
                </div>
              </>
            ) : (
              <div className="min-h-96 lg:col-span-2">
                <AgentView state={state} />
              </div>
            )}
            <DecisionPanel state={state} />
          </div>

          <div className="flex justify-center pt-3">
            <div className="flex items-center gap-2">
              <div role="tablist" aria-label="View" className="flex gap-1 rounded-2xl bg-ink p-1.5 shadow-lg">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'human'}
                  onClick={() => setMode('human')}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-4 py-2 text-sm text-ink-foreground transition-colors',
                    mode === 'human' ? 'bg-ink-muted' : 'opacity-60 hover:opacity-100',
                  )}
                >
                  <Eye className="size-4" />
                  What you see
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'agent'}
                  onClick={() => setMode('agent')}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-4 py-2 text-sm text-ink-foreground transition-colors',
                    mode === 'agent' ? 'bg-ink-muted' : 'opacity-60 hover:opacity-100',
                  )}
                >
                  <Terminal className="size-4" />
                  What your agent sees
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMode('human')
                  setMet(initialMet)
                  setRun((r) => r + 1)
                }}
                aria-label="Reset and replay check"
                className="flex size-12 items-center justify-center rounded-2xl bg-ink text-ink-foreground shadow-lg transition-opacity hover:opacity-80"
              >
                <RotateCcw className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
