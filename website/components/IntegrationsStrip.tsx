"use client";

import { H2, SECTION } from "./tokens";
import { Chip, Reveal } from "./ui";

const WORKS_WITH = ["Claude Code", "Cursor", "Codex", "Figma"];
const CHECKS_AGAINST = ["Figma files", "Component folders", "Storybook exports", "JSON manifests"];

export function IntegrationsStrip() {
  return (
    <section style={{ padding: "56px 0", borderTop: "1px solid var(--border-subtle)", background: "var(--surface-sunken)" }}>
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 28 }}>
        <Reveal>
          <h2 style={{ ...H2, fontSize: "clamp(22px, 3.2vw, 26px)", maxWidth: 640 }}>
            Connect once. <span style={{ color: "var(--text-accent)" }}>Works where you build.</span>
          </h2>
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
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: "var(--text-caption)", color: "var(--text-tertiary)" }}>Register your design system from</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {CHECKS_AGAINST.map((c) => (
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
