"use client";

import { FileJson, Folder, Palette } from "lucide-react";
import { BODY, H2, LABEL, MONO, PANEL, SECTION } from "./tokens";
import { Reveal } from "./ui";

const SOURCES: { icon: typeof Palette; h: string; p: string }[] = [
  { icon: Palette, h: "A Figma file", p: "Components, variants, and their exact sizes and spacing." },
  { icon: Folder, h: "A components folder", p: "Exported components and the props they take." },
  { icon: FileJson, h: "A manifest", p: "A JSON list, or a Storybook index." },
];

export function OneAuthority() {
  return (
    <section id="step-01" style={{ padding: "80px 0", borderTop: "1px solid var(--border-subtle)", background: "var(--surface-sunken)" }}>
      <div
        className="pt-cols-2"
        style={{ ...SECTION, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "start" }}
      >
        <Reveal>
          <div style={{ display: "grid", gap: 14 }}>
            <span style={LABEL}>01</span>
            <h2 style={{ ...H2, fontSize: "clamp(24px, 3.6vw, 30px)" }}>
              One authority: <span style={{ color: "var(--text-accent)" }}>yours.</span>
            </h2>
            <p style={{ ...BODY, fontSize: "var(--text-body-md)" }}>
              Register your Figma file, your components folder, or a manifest, once. From then on Pattern judges
              every request against that and nothing else: no outside libraries, no generic best guess. The agent
              gets a plain answer: reuse this component, or build these specific missing pieces.
            </p>
            <p style={{ ...BODY, fontSize: "var(--text-body-md)", color: "var(--text-tertiary)" }}>
              Search tools hand an agent a list and leave the decision to it. Pattern makes the decision against
              your system.
            </p>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div style={{ ...PANEL, background: "#fff", overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>
              register once per project
            </div>
            <div style={{ display: "grid" }}>
              {SOURCES.map((s, i) => (
                <div
                  key={s.h}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    padding: "14px",
                    borderTop: i === 0 ? "none" : "1px solid var(--border-subtle)",
                  }}
                >
                  <s.icon size={18} style={{ flexShrink: 0, marginTop: 2, color: "var(--text-accent)" }} />
                  <div style={{ display: "grid", gap: 2 }}>
                    <span style={{ fontSize: "var(--text-body-md)", color: "var(--text-primary)", fontWeight: 500 }}>{s.h}</span>
                    <span style={{ fontSize: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{s.p}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border-subtle)", ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>
              every request is judged against this, and nothing else
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
