"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { useIsMobile } from "./hooks";
import { SECTION } from "./tokens";
import { Button, Mark, Wordmark } from "./ui";
import { REPO } from "./constants";

const NAV: [string, string][] = [
  ["How it works", "#demo"],
  ["Capabilities", "#capabilities"],
  ["Who it's for", "#audiences"],
  ["Reference", "#reference"],
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
            NAV.map(([t, h]) => (
              <a key={h} href={h} style={{ color: "var(--text-secondary)" }}>
                {t}
              </a>
            ))}
          <Button size="sm" onClick={() => window.open(REPO, "_blank")}>
            Get the repo
          </Button>
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
          {NAV.map(([t, h]) => (
            <a
              key={h}
              href={h}
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
        </div>
      )}
    </header>
  );
}
