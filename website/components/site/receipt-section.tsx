'use client'

import {
  BadgeCheck,
  Check,
  CircleDot,
  CircleX,
  FileJson,
  GitPullRequest,
  MessageSquareWarning,
  RotateCcw,
  ShieldX,
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { SectionHeading } from './section-heading'

function Card({
  step,
  title,
  className,
  children,
}: {
  step: number
  title: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <li className={cn('flex min-w-0 flex-col gap-6 rounded-[2rem] bg-muted p-6 md:p-8', className)}>
      <p className="flex items-center gap-3 text-sm font-medium">
        <span className="flex size-6 items-center justify-center rounded-full bg-background font-mono text-xs text-muted-foreground shadow-sm">
          {step}
        </span>
        {title}
      </p>
      <div className="flex flex-1 flex-col justify-end">{children}</div>
    </li>
  )
}

function FileHeader({ name, icon, action }: { name: string; icon?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b px-4 py-2.5 font-mono text-xs text-muted-foreground">
      {icon ?? <FileJson className="size-3.5" aria-hidden="true" />}
      <span className="truncate">{name}</span>
      {action ? <span className="ml-auto shrink-0">{action}</span> : null}
    </div>
  )
}

const ledgerFiles = {
  'src/checkout/PriceBreakdown.tsx': [
    { verb: 'reuse', name: 'PriceRow' },
    { verb: 'build', name: 'FeeTooltip' },
  ],
  'src/projects/ConfirmDialog.tsx': [
    { verb: 'reuse', name: 'Modal' },
    { verb: 'reuse', name: 'Button' },
  ],
  'src/nav/AccountMenu.tsx': [
    { verb: 'reuse', name: 'Menu' },
    { verb: 'build', name: 'PlanBadge' },
  ],
} as const

type LedgerPath = keyof typeof ledgerFiles

function Ledger() {
  const paths = Object.keys(ledgerFiles) as LedgerPath[]
  const [path, setPath] = useState<LedgerPath>(paths[0])
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-3 rounded-2xl bg-background px-4 py-3 shadow-sm">
        <span className="size-2 shrink-0 rounded-full bg-primary" />
        <span className="shrink-0 font-mono text-xs">file_path</span>
        <select
          value={path}
          onChange={(e) => setPath(e.target.value as LedgerPath)}
          className="ml-auto min-w-0 flex-1 cursor-pointer truncate bg-transparent text-right font-mono text-xs text-muted-foreground outline-none"
        >
          {paths.map((p) => (
            <option key={p} value={p}>
              {p.split('/').pop()}
            </option>
          ))}
        </select>
      </label>
      <div
        key={path}
        className="flex flex-col gap-1.5 rounded-2xl bg-background px-4 py-3 font-mono text-xs shadow-sm animate-in fade-in duration-200"
      >
        <span className="truncate text-muted-foreground">{path}</span>
        {ledgerFiles[path].map((d) => (
          <span key={d.name} className="flex items-center gap-2">
            <Check className="size-3.5 text-success" strokeWidth={3} aria-hidden="true" />
            {d.verb} {d.name}
          </span>
        ))}
      </div>
    </div>
  )
}

function Receipt() {
  const [verified, setVerified] = useState(false)
  return (
    <div className="overflow-hidden rounded-2xl bg-background shadow-sm">
      <FileHeader
        name="feat-checkout.json"
        action={
          <button
            type="button"
            onClick={() => setVerified((v) => !v)}
            aria-pressed={verified}
            className={cn(
              'flex items-center gap-1 rounded-full px-2.5 py-1 font-sans text-xs font-medium transition-colors',
              verified ? 'bg-success/15 text-foreground' : 'bg-ink text-ink-foreground hover:opacity-85',
            )}
          >
            {verified ? (
              <BadgeCheck className="size-3.5 text-success" aria-hidden="true" />
            ) : null}
            {verified ? 'Verified' : 'Verify'}
          </button>
        }
      />
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-6">
        {'{\n  '}
        <span className="text-primary">{'"file"'}</span>
        {': '}
        <span className="text-success">{'"PriceBreakdown.tsx"'}</span>
        {',\n  '}
        <span className="text-primary">{'"components"'}</span>
        {': ['}
        <span className="text-success">{'"FeeTooltip"'}</span>
        {'],\n  '}
        <span className="text-primary">{'"decision"'}</span>
        {': '}
        <span className="text-success">{'"custom_build"'}</span>
        {verified ? (
          <span className="animate-in fade-in duration-300">
            {',\n  '}
            <span className="text-primary">{'"verified"'}</span>
            {': '}
            <span className="text-success">{'"4/4"'}</span>
          </span>
        ) : null}
        {'\n}'}
      </pre>
    </div>
  )
}

function BlockedWrite() {
  const [stage, setStage] = useState<0 | 1 | 2>(0)
  const label = stage === 0 ? 'Write file' : stage === 1 ? 'Run pattern.check' : 'Reset'
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-2xl bg-background shadow-sm">
        <FileHeader name=".claude/settings.json" />
        <p className="px-4 py-3 font-mono text-xs text-muted-foreground">
          PreToolUse → <span className="text-foreground">pattern-mcp gate</span>
        </p>
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {stage >= 1 ? (
          <div className="flex items-center gap-2.5 rounded-2xl bg-ink px-4 py-3 text-sm text-ink-foreground shadow-sm animate-in fade-in slide-in-from-top-1 duration-200">
            <ShieldX className="size-4" aria-hidden="true" />
            Write blocked. Check first.
            <span className="ml-auto size-2 rounded-full bg-warn" />
          </div>
        ) : null}
        {stage === 2 ? (
          <div className="flex items-center gap-2.5 rounded-2xl bg-success px-4 py-3 text-sm text-background shadow-sm animate-in fade-in slide-in-from-top-1 duration-200">
            <Check className="size-4" strokeWidth={3} aria-hidden="true" />
            Agent checked, write allowed
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => setStage((s) => (s === 2 ? 0 : ((s + 1) as 1 | 2)))}
        className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-4 py-3 font-mono text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
      >
        {stage === 2 ? <RotateCcw className="size-3.5" aria-hidden="true" /> : null}
        {label}
      </button>
    </div>
  )
}

function GateCheck() {
  const [hasReceipt, setHasReceipt] = useState(true)
  const gateChecks = [
    {
      name: 'pattern-gate / receipts',
      detail: hasReceipt ? '3 of 3 components' : 'FeeTooltip has no receipt',
      ok: hasReceipt,
    },
    { name: 'pattern-gate / base diff', detail: 'vs main', ok: true },
    { name: 'pattern-gate / secrets', detail: 'none needed', ok: true },
  ]
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl bg-background shadow-sm">
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <GitPullRequest
          className={cn('size-5 shrink-0 transition-colors', hasReceipt ? 'text-success' : 'text-warn')}
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-col">
          <p className="text-sm font-medium">Add price breakdown</p>
          <p className="truncate font-mono text-xs text-muted-foreground">.github/workflows/pattern-gate.yml</p>
        </div>
        <span
          className={cn(
            'ml-auto shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors',
            hasReceipt ? 'bg-muted text-muted-foreground' : 'bg-warn/20 text-foreground',
          )}
        >
          {hasReceipt ? 'Required' : 'Merge blocked'}
        </span>
      </div>
      <ul className="flex flex-col" aria-live="polite">
        {gateChecks.map((c) => (
          <li key={c.name} className="flex items-center gap-3 border-b px-5 py-3">
            {c.ok ? (
              <CircleDot className="size-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <CircleX className="size-4 shrink-0 text-warn" aria-hidden="true" />
            )}
            <span className="font-mono text-xs">{c.name}</span>
            <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">{c.detail}</span>
          </li>
        ))}
      </ul>
      <label className="flex cursor-pointer items-center gap-3 px-5 py-3 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={hasReceipt}
          onChange={(e) => setHasReceipt(e.target.checked)}
          className="size-4 accent-[var(--success)]"
        />
        Commit receipt with the PR
      </label>
    </div>
  )
}

function SkipAnnotation() {
  const [reason, setReason] = useState('one-off promo')
  const trimmed = reason.trim()
  return (
    <div className="overflow-hidden rounded-2xl bg-background shadow-sm">
      <FileHeader name="LegacyBanner.tsx" />
      <ol className="py-2 font-mono text-xs leading-7">
        <li className={cn('flex items-center gap-4 px-4', trimmed ? 'bg-warn/15' : 'bg-muted')}>
          <span className="w-4 shrink-0 text-right text-muted-foreground/60 select-none">12</span>
          <span className="flex min-w-0 flex-1 items-center whitespace-pre text-muted-foreground">
            {'// pattern-mcp:skip reason="'}
            <label htmlFor="skip-reason" className="sr-only">
              Skip reason
            </label>
            <input
              id="skip-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={40}
              spellCheck={false}
              className="min-w-0 rounded bg-background/70 px-1 text-foreground outline-none focus:ring-1 focus:ring-primary"
              style={{ width: `${Math.max(reason.length, 1) + 2}ch` }}
            />
            {'"'}
          </span>
        </li>
        <li className="flex gap-4 px-4">
          <span className="w-4 shrink-0 text-right text-muted-foreground/60 select-none">13</span>
          <span className="whitespace-pre">
            <span className="text-muted-foreground">export function </span>
            <span className="text-primary">LegacyBanner</span>
            {'() {'}
          </span>
        </li>
      </ol>
      <div aria-live="polite" className="flex items-start gap-3 border-t bg-muted/60 px-4 py-3">
        {trimmed ? (
          <MessageSquareWarning className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
        ) : (
          <CircleX className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
        )}
        <p className="min-w-0 text-sm leading-relaxed">
          {trimmed ? (
            <>
              <span className="font-medium">Skipped:</span>{' '}
              <span className="break-words text-muted-foreground">{trimmed}</span>
            </>
          ) : (
            <>
              <span className="font-medium">Check failed:</span>{' '}
              <span className="text-muted-foreground">a reason is required</span>
            </>
          )}
        </p>
      </div>
    </div>
  )
}

export function ReceiptSection() {
  return (
    <section aria-labelledby="receipt-title" className="flex flex-col items-center gap-16 py-24">
      <SectionHeading id="receipt-title">
        Every shipped screen comes with proof that it was built to spec.
      </SectionHeading>

      <ol className="grid w-full grid-cols-1 max-w-6xl gap-3 px-4 md:grid-cols-6 md:px-6">
        <Card step={1} title="Pattern checks first" className="md:col-span-2">
          <Ledger />
        </Card>
        <Card step={2} title="A receipt ships with the code" className="md:col-span-2">
          <Receipt />
        </Card>
        <Card step={3} title="No decision, no new file" className="md:col-span-2">
          <BlockedWrite />
        </Card>
        <Card step={4} title="pattern-gate runs on every PR" className="md:col-span-3">
          <GateCheck />
        </Card>
        <Card step={5} title="Skips are out in the open" className="md:col-span-3">
          <SkipAnnotation />
        </Card>
      </ol>
    </section>
  )
}
