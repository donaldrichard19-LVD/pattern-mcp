'use client'

import { ChevronRight, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useInView } from '@/hooks/use-in-view'
import { cn } from '@/lib/utils'
import { SectionHeading } from './section-heading'

const command = 'npx pattern-mcp init'

const steps: { text: string; detail: string; more: string[] }[] = [
  { text: 'Anthropic key', detail: 'verified', more: ['Stored in your OS keychain', 'Never sent to Pattern servers'] },
  { text: 'Figma token', detail: 'verified', more: ['Read-only scope', 'Used to fetch frames and variables'] },
  {
    text: 'Connected',
    detail: 'Claude Code, Cursor, Codex',
    more: ['~/.claude.json → pattern-mcp', '.cursor/mcp.json → pattern-mcp', '~/.codex/config.toml → pattern-mcp'],
  },
  {
    text: 'Design system',
    detail: 'acme-ds · 142 components',
    more: ['Figma library: Acme DS 4.2', 'src/ui/** · 142 exports indexed'],
  },
  {
    text: 'Required check',
    detail: 'hook installed',
    more: ['.claude/settings.json → PreToolUse gate', 'Copy pattern-gate.yml to .github/workflows/'],
  },
]

export function TerminalSetup() {
  const { ref, inView } = useInView<HTMLDivElement>(0.4)
  const [typed, setTyped] = useState(0)
  const [lines, setLines] = useState(0)
  const [run, setRun] = useState(0)
  const [requiredOn, setRequiredOn] = useState(true)
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    if (!inView) return
    setTyped(0)
    setLines(0)
    setOpen(null)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTyped(command.length)
      setLines(steps.length + 1)
      return
    }
    let t = 0
    let lineId: ReturnType<typeof setInterval> | undefined
    const typeId = setInterval(() => {
      t += 1
      setTyped(t)
      if (t >= command.length) {
        clearInterval(typeId)
        let l = 0
        lineId = setInterval(() => {
          l += 1
          setLines(l)
          if (l > steps.length && lineId) clearInterval(lineId)
        }, 420)
      }
    }, 55)
    return () => {
      clearInterval(typeId)
      if (lineId) clearInterval(lineId)
    }
  }, [inView, run])

  const done = lines > steps.length

  return (
    <section aria-labelledby="setup-title" className="flex flex-col items-center gap-16 py-24">
      <SectionHeading id="setup-title">Download and set up in 5 easy steps.</SectionHeading>

      <div ref={ref} className="w-full max-w-3xl px-4 md:px-6">
        <div className="overflow-hidden rounded-2xl bg-ink text-ink-foreground shadow-[0_40px_100px_-40px_rgb(0_0_0/0.45)]">
          <div className="relative flex items-center border-b border-ink-muted px-4 py-3">
            <div className="flex gap-2" aria-hidden="true">
              <span className="size-3 rounded-full bg-ink-muted" />
              <span className="size-3 rounded-full bg-ink-muted" />
              <span className="size-3 rounded-full bg-ink-muted" />
            </div>
            <p className="absolute left-1/2 -translate-x-1/2 text-xs text-ink-foreground/50">my-app — zsh</p>
            <button
              type="button"
              onClick={() => setRun((r) => r + 1)}
              aria-label="Run setup again"
              className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-ink-foreground/60 transition-colors hover:bg-ink-muted hover:text-ink-foreground"
            >
              <RotateCcw className="size-3.5" />
              <span className="hidden sm:inline">Run again</span>
            </button>
          </div>
          <div className="flex min-h-80 flex-col gap-1 p-5 font-mono text-sm leading-relaxed" aria-live="polite">
            <p>
              <span className="text-primary">my-app</span>
              <span className="text-ink-foreground/50"> % </span>
              {command.slice(0, typed)}
              {typed < command.length || done ? (
                <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 bg-ink-foreground animate-caret" />
              ) : null}
            </p>
            {lines > 0 ? <p className="pt-3 pb-1 text-ink-foreground/50">Pattern setup</p> : null}
            {steps.slice(0, Math.max(0, lines - 1)).map((s, i) => {
              const isRequired = i === steps.length - 1
              const ok = !isRequired || requiredOn
              const expanded = open === i
              return (
                <div key={s.text} className="flex flex-col animate-in fade-in duration-300">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : i)}
                      aria-expanded={expanded}
                      className="-mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-0.5 text-left transition-colors hover:bg-ink-muted"
                    >
                      <span className={cn('w-3 shrink-0', ok ? 'text-success' : 'text-warn')}>{ok ? '✔' : '○'}</span>
                      <span className="w-32 shrink-0 sm:w-36">{s.text}</span>
                      <span className="truncate text-ink-foreground/50">
                        {isRequired ? (requiredOn ? `on · ${s.detail}` : 'off · skipped') : s.detail}
                      </span>
                      <ChevronRight
                        className={cn(
                          'ml-auto size-3.5 shrink-0 text-ink-foreground/40 transition-transform',
                          expanded && 'rotate-90',
                        )}
                        aria-hidden="true"
                      />
                    </button>
                    {isRequired ? (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={requiredOn}
                        aria-label="Required check"
                        onClick={() => setRequiredOn((v) => !v)}
                        className={cn(
                          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                          requiredOn ? 'bg-success' : 'bg-ink-muted',
                        )}
                      >
                        <span
                          className={cn(
                            'absolute top-0.5 left-0.5 size-4 rounded-full bg-ink-foreground transition-transform',
                            requiredOn && 'translate-x-4',
                          )}
                        />
                      </button>
                    ) : null}
                  </div>
                  {expanded ? (
                    <ul className="flex flex-col py-1 pl-6 text-xs text-ink-foreground/50 animate-in fade-in slide-in-from-top-1 duration-200">
                      {(isRequired && !requiredOn ? ['Agents can write without a decision'] : s.more).map((m) => (
                        <li key={m}>
                          <span className="text-ink-foreground/30">└ </span>
                          {m}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )
            })}
            {done ? (
              <p className="pt-3 text-success animate-in fade-in duration-300">Ready. Ask your agent for a screen.</p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
