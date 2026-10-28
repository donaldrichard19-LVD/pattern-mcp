'use client'

import { Check, FileCode2, PanelLeft, Quote } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { SectionHeading } from './section-heading'

type Line = { code: string; quote?: { text: string; source: string } }

const lines: Line[] = [
  { code: "import { Modal } from '@acme/ui'" },
  { code: "import { Button } from '@acme/ui'" },
  { code: '' },
  { code: 'export function ConfirmDialog({ open, onClose }) {' },
  { code: '  return (' },
  {
    code: '    <Modal open={open} onClose={onClose}',
    quote: { text: 'Modal closes on Escape', source: 'Modal.tsx:42 · closeOnEscape = true' },
  },
  {
    code: '      initialFocus="cancel">',
    quote: { text: 'Focus moves to Cancel', source: 'Figma · Dialog / Destructive · focus order' },
  },
  { code: '      <Modal.Title>Delete project?</Modal.Title>' },
  {
    code: '      <Modal.Actions>',
    quote: { text: 'Actions stack on mobile', source: 'Modal.Actions.tsx:9 · flex-col sm:flex-row' },
  },
  { code: '        <Button variant="ghost">Cancel</Button>' },
  {
    code: '        <Button tone="danger">Delete</Button>',
    quote: { text: 'Danger tone from tokens', source: 'tokens.json · color.action.danger' },
  },
  { code: '      </Modal.Actions>' },
  { code: '    </Modal>' },
  { code: '  )' },
  { code: '}' },
]

const quoted = lines.map((l, i) => ({ ...l, index: i })).filter((l) => l.quote)

function Token({ code }: { code: string }) {
  const parts = code.split(/('[^']*'|"[^"]*"|<\/?[A-Za-z.]+|\b(?:import|from|export|function|return)\b)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null
        const cls = /^['"]/.test(part)
          ? 'text-success'
          : /^<\/?/.test(part)
            ? 'text-primary'
            : /^(import|from|export|function|return)$/.test(part)
              ? 'text-muted-foreground'
              : ''
        return (
          <span key={i} className={cls}>
            {part}
          </span>
        )
      })}
    </>
  )
}

export function ProofWindow() {
  const [active, setActive] = useState<number>(quoted[0].index)
  const [sidebar, setSidebar] = useState(true)
  const activeLine = lines[active]

  return (
    <section aria-labelledby="proof-title" className="flex flex-col items-center gap-16 py-24">
      <SectionHeading id="proof-title">
        Every Pattern check comes with
        <br />a quote from your file.
      </SectionHeading>

      <div className="w-full max-w-6xl px-4 md:px-6">
        <div className="overflow-hidden rounded-2xl border bg-background shadow-[0_30px_80px_-40px_rgb(0_0_0/0.25)]">
          <div className="relative flex items-center justify-between border-b bg-muted/60 px-4 py-3">
            <div className="flex gap-2" aria-hidden="true">
              <span className="size-3 rounded-full bg-border" />
              <span className="size-3 rounded-full bg-border" />
              <span className="size-3 rounded-full bg-border" />
            </div>
            <p className="absolute left-1/2 -translate-x-1/2 text-sm text-muted-foreground">Build confirm dialog</p>
            <button
              type="button"
              onClick={() => setSidebar((s) => !s)}
              aria-pressed={sidebar}
              aria-label="Toggle sidebar"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-border hover:text-foreground"
            >
              <PanelLeft className="size-4" />
            </button>
          </div>

          <div className={cn('grid', sidebar && 'md:grid-cols-[300px_1fr]')}>
            {sidebar ? (
              <div className="flex flex-col gap-5 border-b p-5 md:border-r md:border-b-0">
                <p className="rounded-2xl bg-muted p-4 text-sm leading-relaxed">
                  Add a confirm step before deleting a project. Use our modal.
                </p>
                <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
                  {['Read design summary', 'pattern.check → reuse Modal', 'Verified 4 of 4 quotes'].map((s) => (
                    <li key={s} className="flex items-center gap-2">
                      <Check className="size-4 text-success" />
                      {s}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Quotes</p>
                  {quoted.map((q) => (
                    <button
                      key={q.index}
                      type="button"
                      onClick={() => setActive(q.index)}
                      aria-pressed={active === q.index}
                      className={cn(
                        'flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors',
                        active === q.index ? 'bg-success/15 text-foreground' : 'text-muted-foreground hover:bg-muted',
                      )}
                    >
                      <span className="w-5 font-mono text-xs text-muted-foreground">{q.index + 1}</span>
                      {q.quote?.text}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex min-w-0 flex-col">
              <div className="flex items-center gap-2 border-b px-5 py-3 text-xs text-muted-foreground">
                <FileCode2 className="size-4" aria-hidden="true" />
                <span className="font-mono">ConfirmDialog.tsx</span>
                <span className="ml-auto rounded-full bg-success/15 px-2.5 py-1 font-medium text-foreground">
                  4 verified
                </span>
              </div>
              <ol className="overflow-x-auto py-4 font-mono text-xs leading-7 md:text-[13px]">
                {lines.map((line, i) => {
                  const isActive = i === active
                  const content = (
                    <>
                      <span className="w-5 shrink-0 text-right text-muted-foreground/60 select-none">{i + 1}</span>
                      <span className="flex-1 whitespace-pre text-left">
                        <Token code={line.code} />
                      </span>
                      {line.quote ? (
                        <span
                          className={cn(
                            'hidden shrink-0 items-center gap-1.5 rounded-full px-3 py-0.5 font-sans text-xs text-foreground shadow-sm transition-colors lg:flex',
                            isActive ? 'bg-success text-background' : 'bg-background',
                          )}
                        >
                          <Check className={cn('size-3', isActive ? 'text-background' : 'text-success')} strokeWidth={3} />
                          {line.quote.text}
                        </span>
                      ) : null}
                    </>
                  )
                  return (
                    <li key={i}>
                      {line.quote ? (
                        <button
                          type="button"
                          onClick={() => setActive(i)}
                          aria-pressed={isActive}
                          className={cn(
                            'flex w-full items-center gap-4 pr-4 pl-3 transition-colors',
                            isActive ? 'bg-success/25' : 'bg-success/10 hover:bg-success/20',
                          )}
                        >
                          {content}
                        </button>
                      ) : (
                        <div className="flex items-center gap-4 pr-4 pl-3">{content}</div>
                      )}
                    </li>
                  )
                })}
              </ol>
              {activeLine.quote ? (
                <div
                  key={active}
                  aria-live="polite"
                  className="flex items-start gap-3 border-t bg-muted/60 px-5 py-4 animate-in fade-in duration-200"
                >
                  <Quote className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-medium">{activeLine.quote.text}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      line {active + 1} ← {activeLine.quote.source}
                    </p>
                  </div>
                  <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                    <Check className="size-3.5 text-success" strokeWidth={3} aria-hidden="true" />
                    matched
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
