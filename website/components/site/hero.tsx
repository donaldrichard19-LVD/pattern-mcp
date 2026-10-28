'use client'

import { FolderOpen } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { CopyCommand } from './copy-command'
import { PatternLogoPill } from './logo'

type ChipOption = { label: string; icon: React.ReactNode }

const logo = (src: string) => (
  <Image src={src} alt="" width={28} height={28} className="size-6 object-contain md:size-8" />
)

const sources: ChipOption[] = [
  { label: 'Figma', icon: logo('/logos/figma.svg') },
  { label: 'Storybook', icon: logo('/logos/storybook.svg') },
  { label: 'components', icon: <FolderOpen className="size-6 text-primary md:size-8" strokeWidth={2.25} /> },
  { label: 'JSON', icon: logo('/logos/json.svg') },
]

const agents: ChipOption[] = [
  { label: 'Claude Code', icon: logo('/logos/claude.svg') },
  { label: 'Cursor', icon: logo('/logos/cursor.svg') },
  { label: 'Codex', icon: logo('/logos/openai.svg') },
]

function Chip({ options, index, onNext }: { options: ChipOption[]; index: number; onNext: () => void }) {
  const option = options[index]
  return (
    <button
      type="button"
      onClick={onNext}
      aria-label={`${option.label}. Show another option`}
      className="inline-flex translate-y-1 items-center gap-2 rounded-full bg-muted py-1 pr-4 pl-2 align-baseline transition-colors hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 md:gap-3 md:pr-5"
    >
      <span
        key={option.label}
        className="inline-flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none md:gap-3"
      >
        {option.icon}
        <span className="-translate-y-0.5">{option.label}</span>
      </span>
    </button>
  )
}

export function Hero() {
  const [sourceIndex, setSourceIndex] = useState(0)
  const [agentIndex, setAgentIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let tick = 0
    const id = setInterval(() => {
      tick += 1
      if (tick % 2 === 0) setSourceIndex((i) => (i + 1) % sources.length)
      else setAgentIndex((i) => (i + 1) % agents.length)
    }, 2200)
    return () => clearInterval(id)
  }, [paused])

  return (
    <section aria-labelledby="hero-title" className="flex flex-col items-center gap-14 px-6 pt-12 pb-24 text-center md:pt-20">
      <PatternLogoPill />

      <h1
        id="hero-title"
        className="max-w-4xl text-balance text-3xl font-medium leading-snug tracking-tight md:text-5xl md:leading-snug"
      >
        {'Build your product exactly as designed in '}
        <Chip
          options={sources}
          index={sourceIndex}
          onNext={() => {
            setPaused(true)
            setSourceIndex((i) => (i + 1) % sources.length)
          }}
        />
        {' using '}
        <Chip
          options={agents}
          index={agentIndex}
          onNext={() => {
            setPaused(true)
            setAgentIndex((i) => (i + 1) % agents.length)
          }}
        />
        .
      </h1>

      <CopyCommand command="npx pattern-mcp init" />
    </section>
  )
}
