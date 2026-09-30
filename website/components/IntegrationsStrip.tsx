"use client";

import { H2, MONO, SECTION } from "./tokens";
import { Chip, Reveal } from "./ui";

const WORKS_WITH = ["Claude Code", "Cursor", "Codex", "Figma"];
const CONNECT_FROM = ["Figma files", "Component folders", "Storybook exports", "JSON manifests"];

export function IntegrationsStrip() {
  return (
    <section style={{ padding: "56px 0", borderTop: "1px solid var(--border-subtle)", background: "var(--surface-sunken)" }}>
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 28 }}>
        <Reveal>
          <h2 style={{ ...H2, fontSize: "clamp(22px, 3.2vw, 26px)", maxWidth: 640 }}>
            Pattern is a check between the need and the code.{" "}
            <span style={{ color: "var(--text-accent)" }}>It works where you build.</span>
          </h2>
        </Reveal>
        <Reveal delay={30}>
          <p style={{ margin: 0, maxWidth: 640, fontSize: "var(--text-body-md)", lineHeight: "var(--leading-body)", color: "var(--text-secondary)" }}>
            Before your agent builds a component, Pattern looks at what your design system already offers and
            tells the agent whether to reuse something or build what&apos;s missing, along with the reason.
          </p>
        </Reveal>
        <Reveal delay={60}>
          <div style={{ display: "grid", gap: 20 }}>
            <div style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: "var(--text-caption)", color: "var(--text-tertiary)" }}>Works with</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {WORKS_WITH.map((w) => (
                  <Chip key={w}>{w}</Chip>
                ))}
              </div>
              <span style={{ ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>Required check on your machine: Claude Code only</span>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: "var(--text-caption)", color: "var(--text-tertiary)" }}>Connect from</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {CONNECT_FROM.map((c) => (
                  <Chip key={c}>{c}</Chip>
                ))}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
