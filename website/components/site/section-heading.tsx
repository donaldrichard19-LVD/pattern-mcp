import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function SectionHeading({
  children,
  hint,
  id,
  className,
}: {
  children: React.ReactNode
  hint?: string
  id?: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-5 px-6 text-center', className)}>
      <h2
        id={id}
        className="max-w-3xl text-balance text-4xl font-medium leading-tight tracking-tight md:text-6xl"
      >
        {children}
      </h2>
      {hint ? (
        <p className="flex items-center gap-2 font-mono text-sm text-muted-foreground">
          {hint}
          <ArrowRight className="size-4" aria-hidden="true" />
        </p>
      ) : null}
    </div>
  )
}
