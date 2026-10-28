import { links } from './links'
import { PatternMark } from './logo'

export function SiteFooter() {
  return (
    <footer className="flex flex-col items-center py-12">
      <div className="flex w-full max-w-3xl flex-col items-center justify-between gap-4 px-6 text-sm text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <PatternMark className="size-5" />
          <span>MIT licensed</span>
        </div>
        <nav aria-label="Footer" className="flex items-center gap-6">
          <a href={links.docs} className="hover:text-foreground">
            Docs
          </a>
          <a href={links.changelog} className="hover:text-foreground">
            Changelog
          </a>
          <a href={links.github} className="hover:text-foreground">
            GitHub
          </a>
          <span>{'© 2026'}</span>
        </nav>
      </div>
    </footer>
  )
}
