import { ChevronDown } from 'lucide-react'

const faqs = [
  {
    q: 'Who is Pattern for?',
    a: 'Teams with a design system who build UI with a coding agent. Pattern makes the agent check what already exists before it writes a new component.',
  },
  {
    q: 'Which agents does it work with?',
    a: 'Claude Code, Cursor, and Codex — any client that speaks MCP. Setup connects them for you.',
  },
  {
    q: 'What counts as a design system?',
    a: 'A Figma file, a components folder, a Storybook export, or a JSON manifest. You register it once, and it becomes the only source Pattern judges against.',
  },
  {
    q: 'What does a check cost?',
    a: 'Cents, on your own Anthropic key. Lookups take under a second, and repeated checks are cached at no cost. Every decision shows its time, tokens, and dollars.',
  },
  {
    q: 'Can I make it required?',
    a: 'Yes. A hook blocks the agent from writing a component until Pattern answers, and a pull request check confirms every component had a decision.',
  },
]

export function Faq() {
  return (
    <section aria-labelledby="faq-title" className="flex justify-center px-6 py-24">
      <div className="flex w-full max-w-3xl flex-col gap-12">
        <h2 id="faq-title" className="text-4xl font-medium tracking-tight md:text-5xl">
          FAQ
        </h2>
        <div className="flex flex-col">
          {faqs.map((item, i) => (
            <details key={item.q} open={i === 0} className="group border-b py-6 first:pt-0">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lg font-medium [&::-webkit-details-marker]:hidden">
                {item.q}
                <ChevronDown
                  className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <p className="pt-5 text-pretty text-lg leading-relaxed text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
