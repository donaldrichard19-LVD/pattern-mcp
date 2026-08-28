"use client";

import { useEffect, useState } from "react";
import { Github, Menu, X } from "lucide-react";
import { REPO } from "./constants";
import { useIsMobile } from "./hooks";
import { SECTION } from "./tokens";
import { Mark, Wordmark } from "./ui";

const NAV: [string, string][] = [
  ["Installation", "#install"],
  ["How it works", "#demo"],
  ["Capabilities", "#capabilities"],
  ["Reference", "#reference"],
  ["Docs", REPO],
];

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
        <nav style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 26, fontSize: "var(--text-body-sm)" }}>
          {!isMobile &&
            NAV.map(([t, h]) => {
              const external = h.startsWith("http");
              return (
                <a
                  key={h}
                  href={h}
                  target={external ? "_blank" : undefined}
                  rel={external ? "noreferrer" : undefined}
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t}
                </a>
              );
            })}
          {isMobile && (
            <a
              href="https://github.com/donaldrichard19-LVD/pattern-mcp"
              target="_blank"
              rel="noreferrer"
              aria-label="View pattern-mcp on GitHub"
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
                flexShrink: 0,
              }}
            >
              <Github size={18} />
            </a>
          )}
          {isMobile && (
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
          )}
        </nav>
      </div>
      {isMobile && open && (
        <div style={{ borderTop: "1px solid var(--border-subtle)", background: "#fff", padding: "6px 20px 14px", display: "grid" }}>
          {NAV.map(([t, h]) => {
            const external = h.startsWith("http");
            return (
              <a
                key={h}
                href={h}
                target={external ? "_blank" : undefined}
                rel={external ? "noreferrer" : undefined}
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
            );
          })}
        </div>
      )}
    </header>
  );
}
