// pattern-mcp:override reason="static link row, no decision to check"
import { links } from './links'

export function TopNav() {
  return (
    <header className="flex items-center justify-end px-6 py-6 md:px-12">
      <nav aria-label="Primary" className="flex items-center gap-8 text-sm font-medium text-muted-foreground">
        <a href={links.docs} className="transition-colors hover:text-foreground">
          Docs
        </a>
        <a href={links.changelog} className="transition-colors hover:text-foreground">
          Changelog
        </a>
        <a href={links.github} className="transition-colors hover:text-foreground">
          GitHub
        </a>
      </nav>
    </header>
  )
}
