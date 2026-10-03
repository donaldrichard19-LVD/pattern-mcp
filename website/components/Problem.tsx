"use client";

import { BODY, H2, LABEL, SECTION } from "./tokens";
import { Reveal } from "./ui";

const ITEMS: { h: string; p: string }[] = [
  {
    h: "It works from the prompt alone.",
    p: "Without your design system in view, building something new is the easy default.",
  },
  {
    h: "The choice is invisible.",
    p: "Whether to reuse or rebuild gets decided quietly inside a generated file, and nobody reviews a decision they never saw.",
  },
  {
    h: "Telling it to check doesn't last.",
    p: "It depends on someone remembering, every time, on every machine.",
  },
];

export function Problem() {
  return (
    <section style={{ padding: "80px 0", borderTop: "1px solid var(--border-subtle)", background: "#fff" }}>
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 32 }}>
        <Reveal>
          <div style={{ display: "grid", gap: 10 }}>
            <span style={LABEL}>The problem</span>
            <h2 style={{ ...H2, fontSize: "clamp(24px, 3.6vw, 30px)", maxWidth: 620 }}>
              The agent isn&apos;t careless.{" "}
              <span style={{ color: "var(--text-accent)" }}>It just can&apos;t see what you have.</span>
            </h2>
          </div>
        </Reveal>
        <div className="pt-cols-3" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 28 }}>
          {ITEMS.map((it, i) => (
            <Reveal key={it.h} delay={i * 70}>
              <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
                <h3 style={{ margin: 0, fontSize: "var(--text-body-lg)", fontWeight: 500, color: "var(--text-primary)" }}>{it.h}</h3>
                <p style={{ ...BODY, fontSize: "var(--text-body-sm)" }}>{it.p}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={220}>
          <p style={{ ...BODY, fontSize: "var(--text-body-md)", margin: 0, maxWidth: 620 }}>
            Duplicates collect, and each one has to be maintained, restyled, and eventually cleaned up by
            someone.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
