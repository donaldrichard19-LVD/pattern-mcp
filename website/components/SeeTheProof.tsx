"use client";

import { useState } from "react";
import { BODY, H2, MONO, SECTION } from "./tokens";
import { Reveal, SegTabs } from "./ui";

const BEFORE: [string, string][] = [
  ["From your Figma", "Modal is 320×224, gap 16, radius 14"],
  ["Inferred", "Cancel, then Confirm, in that order"],
  ["General practice", "Escape closes it; focus returns to the trigger"],
];
const AFTER: { label: string; quote: string; ok: boolean }[] = [
  { label: "Verified: Modal is 320×224", quote: "width: 320, height: 224", ok: true },
  { label: "Verified: Escape closes it", quote: 'if (e.key === "Escape")', ok: true },
  { label: "Verified: Focus returns to the trigger", quote: "return () => trigger?.focus();", ok: true },
  { label: "Unverified: Styled from tokens.ts", quote: "look at this", ok: false },
];

export function SeeTheProof() {
  const [view, setView] = useState<"before" | "after">("after");
  return (
    <section
      className="pt-sec"
      style={{
        ...SECTION,
        padding: "40px 32px 80px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))",
        gap: 56,
        alignItems: "center",
      }}
    >
      <Reveal>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: "30em" }}>
          <h2 style={{ ...H2, lineHeight: 1.04 }}>See the proof.</h2>
          <p style={{ ...BODY, fontSize: "var(--text-body-lg)" }}>
            After the build, Pattern checks the finished file against the list. Every pass comes with a quote from your file, and the server confirms
            the quote is there. No quote, no pass. Things that must be absent, like &ldquo;no Tailwind classes,&rdquo; are searched for by the server.
          </p>
        </div>
      </Reveal>
      <Reveal delay={80}>
        <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              padding: "10px 16px",
              background: "var(--surface-sunken)",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <SegTabs
              value={view}
              onChange={setView}
              options={[
                ["before", "Before"],
                ["after", "After"],
              ]}
            />
            <span style={{ ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>a confirmation dialog</span>
          </div>
          <div style={{ padding: "6px 20px 14px", display: "flex", flexDirection: "column" }}>
            {view === "before"
              ? BEFORE.map(([tag, text]) => (
                  <div key={tag} style={{ display: "flex", flexDirection: "column", gap: 3, padding: "12px 0", borderBottom: "1px solid #f0f2f5" }}>
                    <span style={{ ...MONO, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>{tag}</span>
                    <span style={{ fontSize: 14 }}>{text}</span>
                  </div>
                ))
              : AFTER.map((a) => (
                  <div key={a.label} style={{ display: "flex", flexDirection: "column", gap: 3, padding: "12px 0", borderBottom: "1px solid #f0f2f5" }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: a.ok ? "var(--text-success)" : "var(--amber-500)" }}>{a.label}</span>
                    <span style={{ ...MONO, fontSize: 12, color: "var(--text-tertiary)" }}>{a.quote}</span>
                  </div>
                ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}
