'use client'

import { Check, CircleDot, GitPullRequest, Loader2, Play, RotateCcw, ShieldX } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { SectionHeading } from './section-heading'

const flow = [
  {
    who: 'Agent',
    icon: <Image src="/logos/claude.svg" alt="" width={16} height={16} className="size-4" />,
    text: 'write PriceBreakdown.tsx',
    tone: 'neutral',
  },
  { who: 'Hook', icon: <ShieldX className="size-4" />, text: 'Blocked — no decision yet', tone: 'warn' },
  { who: 'Pattern', icon: null, text: 'reuse PriceRow · build FeeTooltip', tone: 'neutral' },
  { who: 'Agent', icon: <Check className="size-4" strokeWidth={3} />, text: 'Write allowed', tone: 'success' },
] as const

const checks = [
  { name: 'Pattern / decision recorded', detail: 'custom_build · 12s · $0.03' },
  { name: 'Pattern / required check', detail: 'Every component had a decision' },
  { name: 'Pattern / quotes verified', detail: '4 of 4 matched the file' },
]

export function RuleSection() {
  const [step, setStep] = useState<number>(flow.length)
  const [checksDone, setChecksDone] = useState<number>(checks.length)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const play = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setStep(0)
    setChecksDone(0)
    const total = flow.length + checks.length
    for (let i = 1; i <= total; i++) {
      timers.current.push(
        setTimeout(() => {
          if (i <= flow.length) setStep(i)
          else setChecksDone(i - flow.length)
        }, i * 650),
      )
    }
  }

  const running = step < flow.length || checksDone < checks.length
  const passed = checksDone >= checks.length

  return (
    <section aria-labelledby="rule-title" className="flex flex-col items-center gap-16 py-24">
      <SectionHeading id="rule-title">
        Agents can&apos;t build
        <br />
        until Pattern answers.
      </SectionHeading>

      <div className="grid w-full max-w-6xl gap-3 px-4 md:grid-cols-2 md:px-6">
        <div className="flex flex-col gap-6 rounded-[2rem] bg-muted p-6 md:p-8">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">On your machine</p>
            <button
              type="button"
              onClick={play}
              disabled={running}
              className="flex items-center gap-2 rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-ink-foreground transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              {step === flow.length && passed ? (
                <RotateCcw className="size-3.5" aria-hidden="true" />
              ) : (
                <Play className="size-3.5" aria-hidden="true" />
              )}
              {running ? 'Running' : 'Run a write'}
            </button>
          </div>
          <ol className="flex flex-col gap-3" aria-live="polite">
            {flow.map((s, i) => {
              const shown = i < step
              const current = i === step - 1 && running
              return (
                <li
                  key={i}
                  className={cn(
                    'flex items-center gap-3 transition-all duration-300',
                    shown ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-25',
                  )}
                >
                  <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{s.who}</span>
                  <span
                    className={cn(
                      'flex flex-1 items-center gap-2.5 rounded-2xl px-4 py-3.5 text-sm shadow-sm transition-shadow',
                      s.tone === 'neutral' && 'bg-background',
                      s.tone === 'warn' && 'bg-ink text-ink-foreground',
                      s.tone === 'success' && 'bg-success text-background',
                      current && 'ring-2 ring-primary ring-offset-2 ring-offset-muted',
                    )}
                  >
                    {s.icon ?? <span className="size-2 rounded-full bg-primary" />}
                    <span className={cn(s.tone === 'neutral' && 'font-mono text-xs md:text-sm')}>{s.text}</span>
                    {s.tone === 'warn' ? <span className="ml-auto size-2 rounded-full bg-warn" /> : null}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>

        <div className="flex flex-col gap-6 rounded-[2rem] bg-muted p-6 md:p-8">
          <p className="text-sm font-medium text-muted-foreground">On the pull request</p>
          <div className="flex flex-col overflow-hidden rounded-2xl bg-background shadow-sm">
            <div className="flex items-center gap-3 border-b px-5 py-4">
              <GitPullRequest className="size-5 text-success" aria-hidden="true" />
              <div className="flex flex-col">
                <p className="text-sm font-medium">Add price breakdown</p>
                <p className="font-mono text-xs text-muted-foreground">#128 · feat/checkout</p>
              </div>
            </div>
            <div
              className={cn(
                'flex items-center gap-3 px-5 py-3 transition-colors',
                passed ? 'bg-success/10' : 'bg-muted/60',
              )}
            >
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full transition-colors',
                  passed ? 'bg-success text-background' : 'bg-border text-muted-foreground',
                )}
              >
                {passed ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
              </span>
              <p className="text-sm font-medium">
                {passed ? 'All checks have passed' : step < flow.length ? 'Waiting for a push' : 'Checks running'}
              </p>
            </div>
            <ul className="flex flex-col">
              {checks.map((c, i) => {
                const ok = i < checksDone
                return (
                  <li key={c.name} className="flex items-center gap-3 border-t px-5 py-3.5">
                    {ok ? (
                      <CircleDot className="size-4 shrink-0 text-success" aria-hidden="true" />
                    ) : (
                      <span className="size-4 shrink-0 rounded-full border-2 border-dashed border-border" aria-hidden="true" />
                    )}
                    <span className={cn('text-sm transition-colors', !ok && 'text-muted-foreground')}>{c.name}</span>
                    <span className="ml-auto hidden truncate text-xs text-muted-foreground sm:inline">
                      {ok ? c.detail : 'Pending'}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
