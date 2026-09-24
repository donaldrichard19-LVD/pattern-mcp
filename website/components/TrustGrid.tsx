"use client";

import type { ReactNode } from "react";
import { DOCS } from "./constants";
import { BODY, H2, LABEL, SECTION } from "./tokens";
import { Reveal } from "./ui";

const ITEMS: { glyph: string; h: string; p: string }[] = [
  {
    glyph: "?",
    h: "It says when it's unsure",
    p: "Close calls are re-checked. If the checks disagree, you get low confidence, not a confident wrong answer.",
  },
  {
    glyph: "↗",
    h: "Links are verified",
    p: "A direct link means Pattern opened the actual screen. Otherwise it tells you it's only a browse page.",
  },
  {
    glyph: "$",
    h: "You see the cost of every call",
    p: "Time, tokens and dollars are shown per decision, not buried in a usage budget.",
  },
];

function Glyph({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: "var(--radius-sm)",
        background: "var(--surface-sunken)",
        color: "var(--text-accent)",
        fontFamily: "var(--font-mono)",
        fontSize: 15,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

export function TrustGrid() {
  return (
    <section style={{ padding: "80px 0", borderTop: "1px solid var(--border-subtle)", background: "#fff" }}>
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 32 }}>
        <Reveal>
          <div style={{ display: "grid", gap: 10 }}>
            <span style={LABEL}>Why you can trust it</span>
            <h2 style={{ ...H2, fontSize: "clamp(24px, 3.6vw, 30px)", maxWidth: 620 }}>
              Built to be trusted. <span style={{ color: "var(--text-accent)" }}>It shows its work.</span>
            </h2>
          </div>
        </Reveal>
        <div className="pt-cols-3" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 28 }}>
          {ITEMS.map((it, i) => (
            <Reveal key={it.h} delay={i * 70}>
              <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
                <Glyph>{it.glyph}</Glyph>
                <h3 style={{ margin: 0, fontSize: "var(--text-body-lg)", fontWeight: 500, color: "var(--text-primary)" }}>{it.h}</h3>
                <p style={{ ...BODY, fontSize: "var(--text-body-sm)" }}>{it.p}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={220}>
          <p style={{ ...BODY, fontSize: "var(--text-body-md)", margin: 0 }}>
            Works with your own design system, in code or straight from Figma.{" "}
            <a href={DOCS} target="_blank" rel="noreferrer" style={{ fontWeight: 500 }}>
              Learn how &rarr;
            </a>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
