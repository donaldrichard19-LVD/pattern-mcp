"use client";

import { useEffect, useState } from "react";
import { Github, Menu, Star, X } from "lucide-react";
import { DOCS, REPO } from "./constants";
import { useIsMobile } from "./hooks";
import { SECTION } from "./tokens";
import { Button, Mark, Wordmark } from "./ui";

// "Docs" and "Changelog" point at the GitHub repo (README / releases) for
// now -- the v2 design spec's own engineering notes say /docs, /docs/reference
// etc. don't exist yet and need a real home before those links go live. This
// avoids shipping dead first-party routes in the meantime.
const NAV: [string, string][] = [
  ["Docs", DOCS],
  ["Changelog", REPO + "/releases"],
];

function useStarCount(): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("https://api.github.com/repos/donaldrichard19-LVD/pattern-mcp")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && typeof d.stargazers_count === "number") setCount(d.stargazers_count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return count;
}

function StarLink({ compact }: { compact?: boolean }) {
  const count = useStarCount();
  return (
    <a
      href={REPO}
      target="_blank"
      rel="noreferrer"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        color: "var(--text-secondary)",
        fontSize: compact ? "var(--text-body-md)" : "var(--text-body-sm)",
      }}
    >
      <Github size={compact ? 17 : 15} />
      <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <Star size={13} />
        {count !== null ? count.toLocaleString() : "Star"}
      </span>
    </a>
  );
}

export function TopBar() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!isMobile) setOpen(false);
  }, [isMobile]);

  return (
    <header style={{ position: "sticky", top: 0, zIndex: 30, background: "#fff", borderBottom: "1px solid var(--border-subtle)" }}>
      <div className="pt-sec pt-bar" style={{ ...SECTION, height: 72, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <a href="#top" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none" }}>
          <Mark size={24} />
          <Wordmark size={21} />
        </a>
        {!isMobile && (
          <nav style={{ display: "flex", alignItems: "center", gap: 26, fontSize: "var(--text-body-sm)" }}>
            {NAV.map(([t, h]) => (
              <a key={h} href={h} target="_blank" rel="noreferrer" style={{ color: "var(--text-secondary)" }}>
                {t}
              </a>
            ))}
            <StarLink />
            <Button href="#install" size="sm">
              Get started
            </Button>
          </nav>
        )}
        {isMobile && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              style={{
                width: 44,
                height: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-primary)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        )}
      </div>
      {isMobile && open && (
        <div style={{ borderTop: "1px solid var(--border-subtle)", background: "#fff", padding: "6px 20px 14px", display: "grid", gap: 2 }}>
          {NAV.map(([t, h]) => (
            <a
              key={h}
              href={h}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              style={{
                display: "flex",
                alignItems: "center",
                minHeight: 48,
                fontSize: "var(--text-body-md)",
                color: "var(--text-primary)",
                textDecoration: "none",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              {t}
            </a>
          ))}
          <div style={{ minHeight: 48, display: "flex", alignItems: "center", borderBottom: "1px solid var(--border-subtle)" }}>
            <StarLink compact />
          </div>
          <div style={{ padding: "12px 0 4px" }}>
            <Button href="#install" style={{ width: "100%" }} onClick={() => setOpen(false)}>
              Get started
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
