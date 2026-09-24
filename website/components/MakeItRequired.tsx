"use client";

import { ArrowRight, Check, X } from "lucide-react";
import { BODY, H2, LABEL, MONO, PANEL, SECTION } from "./tokens";
import { CopyBlock, Reveal } from "./ui";

const COMMAND_LINES = ["npx pattern-check-gate init"];

function FlowDiagram() {
  const steps = ["Agent: write PriceBreakdown.tsx", "Hook", "Pattern: Decides", "Write"];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: "var(--text-body-sm)" }}>
      <span style={{ ...MONO, fontSize: 12 }}>{steps[0]}</span>
      <ArrowRight size={14} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--red-500)" }}>
        <X size={14} /> Blocked
      </span>
      <ArrowRight size={14} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
      <span style={{ ...MONO, fontSize: 12 }}>{steps[2]}</span>
      <ArrowRight size={14} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-success)" }}>
        <Check size={14} /> Allowed
      </span>
    </div>
  );
}

export function MakeItRequired() {
  return (
    <section id="enforce" style={{ padding: "80px 0", borderTop: "1px solid var(--border-subtle)", background: "var(--surface-sunken)" }}>
      <div
        className="pt-cols-2"
        style={{ ...SECTION, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "start" }}
      >
        <Reveal>
          <div style={{ display: "grid", gap: 14 }}>
            <span style={LABEL}>02</span>
            <h2 style={{ ...H2, fontSize: "clamp(24px, 3.6vw, 30px)" }}>
              Make it required. <span style={{ color: "var(--text-accent)" }}>A hook blocks the write. CI blocks the merge.</span>
            </h2>
            <p style={{ ...BODY, fontSize: "var(--text-body-md)" }}>
              Turn it on when you trust it. Your agent can&apos;t write a new component until Pattern has
              decided.
            </p>
            <CopyBlock label="turn on the required check" lines={COMMAND_LINES} />
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div style={{ ...PANEL, background: "#fff", padding: 16, display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gap: 8 }}>
              <span style={{ ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>On your machine</span>
              <FlowDiagram />
            </div>
            <div style={{ height: 1, background: "var(--border-subtle)" }} />
            <div style={{ display: "grid", gap: 8 }}>
              <span style={{ ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>On the pull request</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-body-sm)" }}>
                <Check size={15} style={{ color: "var(--text-success)", flexShrink: 0 }} />
                <span>Pattern decision recorded &mdash; required check &middot; passed</span>
              </div>
              <span style={{ fontSize: "var(--text-caption)", color: "var(--text-tertiary)" }}>
                Catches anything that got past the local hook
              </span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
