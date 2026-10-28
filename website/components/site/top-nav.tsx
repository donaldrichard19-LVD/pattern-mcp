'use client'

// pattern-mcp:override reason="static link row, no decision to check"
import { Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { links } from './links'
import { PatternMark, PatternWordmark } from './logo'

const items = [
  { label: 'Docs', href: links.docs },
  { label: 'Changelog', href: links.changelog },
  { label: 'GitHub', href: links.github },
]

export function TopNav() {
  const [scrolled, setScrolled] = useState(false)
  const [pastHero, setPastHero] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const hero = document.getElementById('hero-logo')
    if (!hero) return
    const barHeight = 72
    const observer = new IntersectionObserver(
      ([entry]) => setPastHero(!entry.isIntersecting && entry.boundingClientRect.bottom < barHeight),
      { rootMargin: `-${barHeight}px 0px 0px 0px` },
    )
    observer.observe(hero)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header
      className={`sticky top-0 z-50 transition-colors ${
        scrolled ? 'border-b border-border bg-background/80 backdrop-blur' : 'border-b border-transparent'
      }`}
    >
      <div className="flex items-center justify-between px-6 py-4 md:px-12">
        <a
          href="#"
          aria-label="Pattern home"
          aria-hidden={!pastHero}
          tabIndex={pastHero ? 0 : -1}
          className={`flex items-center gap-2 transition-all duration-200 ${
            pastHero ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1 opacity-0'
          }`}
        >
          <PatternMark className="size-6" />
          <PatternWordmark className="text-xl" />
        </a>

        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="nav-menu"
          onClick={() => setOpen((o) => !o)}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground md:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>

        <nav
          aria-label="Primary"
          className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex"
        >
          {items.map((item) => (
            <a key={item.label} href={item.href} className="transition-colors hover:text-foreground">
              {item.label}
            </a>
          ))}
        </nav>
      </div>

      {open && (
        <nav
          id="nav-menu"
          aria-label="Primary"
          className="flex flex-col border-t border-border bg-background px-6 py-2 text-sm font-medium md:hidden"
        >
          {items.map((item) => (
            <a
              key={item.label}
              href={item.href}
              onClick={() => setOpen(false)}
              className="py-3 text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  )
}
