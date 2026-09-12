"use client";

import { MONO } from "./tokens";

const STEPS: { n: string; t: string; h: string }[] = [
  { n: "1", t: "Install", h: "#install" },
  { n: "2", t: "Recommend", h: "#demo" },
  { n: "3", t: "Enforce", h: "#enforce" },
  { n: "4", t: "Build", h: "#build" },
  { n: "5", t: "Verify", h: "#verify" },
];

// How Pattern fits into a build, in order. Every anchor here points at a
// section that actually covers that step -- Install/Enforce live in Hero,
// Recommend is the ScrollDemo walkthrough, Build is AvoidsMistakes (the
// judgment calls that keep a build decision from going wrong), and Verify
// is the ledger in TracksDecisions.
export function StepStrip() {
  return (
    <nav
      aria-label="How Pattern fits into your workflow"
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", rowGap: 10, maxWidth: 760 }}
    >
      {STEPS.map((s, i) => (
        <span key={s.t} style={{ display: "flex", alignItems: "center" }}>
          <a
            href={s.h}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "6px 12px 6px 6px",
              borderRadius: 999,
              border: "1px solid var(--border-subtle)",
              background: "#fff",
              textDecoration: "none",
              color: "var(--text-primary)",
              fontSize: "var(--text-body-sm)",
              whiteSpace: "nowrap",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                ...MONO,
                width: 20,
                height: 20,
                borderRadius: "50%",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                background: "var(--surface-sunken)",
                color: "var(--text-secondary)",
              }}
            >
              {s.n}
            </span>
            {s.t}
          </a>
          {i < STEPS.length - 1 && (
            <span aria-hidden="true" style={{ width: 14, height: 1, background: "var(--border-subtle)", margin: "0 3px", flexShrink: 0 }} />
          )}
        </span>
      ))}
    </nav>
  );
}
