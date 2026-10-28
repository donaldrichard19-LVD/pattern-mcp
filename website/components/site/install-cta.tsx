import { CopyCommand } from './copy-command'

const stats = [
  ['<1s', 'lookups'],
  ['¢', 'per check'],
  ['$0', 'repeats'],
]

export function InstallCta() {
  return (
    <section id="install" aria-labelledby="install-title" className="flex justify-center px-4 py-24 md:px-6">
      <div className="flex w-full max-w-4xl flex-col items-center gap-10 rounded-[2rem] bg-ink px-6 py-16 text-center text-ink-foreground md:py-20">
        <div className="flex flex-col gap-4">
          <h2 id="install-title" className="text-balance text-4xl font-medium tracking-tight md:text-6xl">
            Free and open source.
          </h2>
          <p className="mx-auto max-w-md text-pretty leading-relaxed text-ink-foreground/60">
            MIT licensed. Checks run on your own Anthropic key, and repeats are cached.
          </p>
        </div>

        <dl className="grid w-full max-w-md grid-cols-3 gap-2">
          {stats.map(([value, label]) => (
            <div key={label} className="flex flex-col gap-1 rounded-2xl bg-ink-muted py-4">
              <dd className="font-mono text-2xl">{value}</dd>
              <dt className="text-xs text-ink-foreground/50">{label}</dt>
            </div>
          ))}
        </dl>

        <CopyCommand command="npx pattern-mcp init" variant="inverse" className="px-7 py-4 text-base" />
      </div>
    </section>
  )
}
