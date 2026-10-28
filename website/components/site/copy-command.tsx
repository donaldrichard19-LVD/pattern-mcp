// pattern-mcp:override reason="trivial primitive: copy-to-clipboard pill, no decision to check"
'use client'

import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

export function CopyCommand({
  command,
  variant = 'light',
  className,
}: {
  command: string
  variant?: 'light' | 'dark' | 'inverse'
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'group inline-flex items-center gap-3 rounded-full px-5 py-3 font-mono text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
        variant === 'light' && 'bg-muted text-foreground hover:bg-border',
        variant === 'dark' && 'bg-ink-muted text-ink-foreground hover:bg-ink-muted/70',
        variant === 'inverse' && 'bg-background text-foreground hover:bg-muted',
        className,
      )}
    >
      <span className="opacity-50" aria-hidden="true">
        $
      </span>
      <span>{command}</span>
      <span className="opacity-60 transition-opacity group-hover:opacity-100" aria-hidden="true">
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied to clipboard' : 'Copy command'}
      </span>
    </button>
  )
}
