"use client";

import type { CSSProperties } from "react";
import { BODY, H2, LABEL, MONO, SECTION } from "./tokens";
import { CopyBlock, Reveal } from "./ui";

const COMMAND_LINES = ["npx -p pattern-mcp pattern-check-gate init"];

const STEP: CSSProperties = {
  padding: "9px 12px",
  border: "1px solid var(--border-subtle)",
  borderRadius: 8,
  display: "flex",
  flexDirection: "column",
  gap: 2,
};
const ARROW = <span style={{ color: "var(--text-tertiary)" }}>→</span>;

export function MakeItRequired() {
  return (
    <section id="enforce" style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <div
        className="pt-sec"
        style={{
          ...SECTION,
          padding: "80px 32px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))",
          gap: 56,
          alignItems: "center",
        }}
      >
        <Reveal>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: "30em" }}>
            <h2 style={{ ...H2, lineHeight: 1.04 }}>Make it a rule.</h2>
            <p style={{ ...BODY, fontSize: "var(--text-body-lg)" }}>
              Turn on the required check and your agent can&apos;t create a new component until Pattern has answered (in Claude Code, on your machine).
              The same check runs on every pull request, whichever agent wrote it.
            </p>
            <p style={{ ...BODY, fontSize: "var(--text-body-lg)" }}>
              Every decision is saved, and reviewers get the reasoning with the code. A record goes stale if the file changes.
            </p>
            <div style={{ maxWidth: 420 }}>
              <CopyBlock label="turn on the required check" lines={COMMAND_LINES} />
            </div>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 20, background: "#fff" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={LABEL}>On your machine</div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <div style={STEP}>
                  <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>Agent</span>
                  <span style={{ ...MONO, fontSize: 12 }}>write PriceBreakdown.tsx</span>
                </div>
                {ARROW}
                <div style={{ ...STEP, border: "1px solid color-mix(in oklab, var(--amber-500) 48%, transparent)", background: "color-mix(in oklab, var(--amber-500) 12%, transparent)" }}>
                  <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>Hook</span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>✕ Blocked</span>
                </div>
                {ARROW}
                <div style={STEP}>
                  <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>Pattern</span>
                  <span style={{ fontWeight: 500, fontSize: 13 }}>Decides</span>
                </div>
                {ARROW}
                <div style={{ ...STEP, border: "1px solid color-mix(in oklab, var(--green-500) 40%, transparent)", background: "color-mix(in oklab, var(--green-500) 9%, transparent)" }}>
                  <span style={{ color: "var(--text-success)", fontSize: 12 }}>Write</span>
                  <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-success)" }}>✓ Allowed</span>
                </div>
              </div>
            </div>
            <div style={{ height: 1, background: "var(--border-subtle)" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={LABEL}>On the pull request</div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "11px 14px",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 8,
                  flexWrap: "wrap",
                  background: "var(--surface-sunken)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 999,
                      background: "var(--green-500)",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    ✓
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Pattern decision recorded</span>
                </div>
                <span style={{ ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>Required check · Passed</span>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
