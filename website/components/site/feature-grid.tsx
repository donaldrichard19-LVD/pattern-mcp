import { BadgeCheck, CircleDollarSign, FileText, Layers, ListChecks, Lock, Scale, Split } from 'lucide-react'
import { SectionHeading } from './section-heading'

const features = [
  { icon: Layers, title: 'Your design system', text: 'Figma, a components folder, Storybook, or JSON. Registered once.' },
  { icon: FileText, title: 'Design summaries', text: 'Each design in words, so your agent keeps it while it builds.' },
  { icon: Split, title: 'Reuse or build', text: 'A plain answer: use this component, or build these pieces.' },
  { icon: ListChecks, title: 'Requirements', text: 'Tagged as yours, inferred, or general practice.' },
  { icon: BadgeCheck, title: 'Verified code', text: 'Every pass quotes your file, confirmed by the server.' },
  { icon: Lock, title: 'Required check', text: 'Agents can’t create a component until Pattern answers.' },
  { icon: Scale, title: 'Decision record', text: 'What was checked, decided, and what it cost — per version.' },
  { icon: CircleDollarSign, title: 'Cost and confidence', text: 'Time, tokens, and dollars beside every decision.' },
]

export function FeatureGrid() {
  return (
    <section aria-labelledby="features-title" className="flex flex-col items-center gap-16 py-24">
      <SectionHeading id="features-title">
        Everything between your design system and shipped code.
      </SectionHeading>

      <ul className="grid w-full max-w-5xl gap-x-12 gap-y-14 px-6 sm:grid-cols-2 lg:grid-cols-4">
        {features.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex flex-col gap-4">
            <Icon className="size-6 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <h3 className="font-medium">{title}</h3>
              <p className="text-pretty leading-relaxed text-muted-foreground">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
