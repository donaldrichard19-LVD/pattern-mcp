"use client";

import { Check, X } from "lucide-react";
import { BODY, H2, LABEL, MONO, SECTION } from "./tokens";
import { Reveal } from "./ui";

const DO = [
  { t: "A component with unique requirements", d: "Fee breakdowns, policy displays, dashboards, inboxes. Anything where fit requires judgment" },
  { t: "Before the agent starts writing UI", d: "The verdict is useful while there's still a decision to make" },
];

const AVOID = [
  { t: "Trivial primitives", d: "Buttons, inputs, badges, spinners. The skip-list already answers these for free" },
  { t: "Anything you'd cache and reuse", d: "Coverage is a snapshot with a computed_at date. Keep caching session-scoped, never across builds" },
];

function GuidanceCard({ on, t, d, delay }: { on: boolean; t: string; d: string; delay: number }) {
  return (
    <Reveal delay={delay}>
      <div
        style={{
          background: "#fff",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          padding: 16,
          display: "grid",
          gap: 8,
          height: "100%",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {on ? <Check size={16} style={{ color: "var(--text-success)" }} /> : <X size={16} style={{ color: "var(--red-500)" }} />}
          <span style={{ fontSize: "var(--text-body-md)", color: "var(--text-primary)" }}>{t}</span>
        </div>
        <p style={{ ...BODY, fontSize: "var(--text-body-sm)" }}>{d}</p>
      </div>
    </Reveal>
  );
}

export function Guidance() {
  return (
    <section className="pt-pad-y" style={{ padding: "80px 0", borderTop: "1px solid var(--border-subtle)", background: "var(--surface-sunken)" }}>
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 32 }}>
        <Reveal>
          <div style={{ display: "grid", gap: 12 }}>
            <h2 style={{ ...H2, maxWidth: 620 }}>Best Practices</h2>
          </div>
        </Reveal>

        <div style={{ display: "grid", gap: 12 }}>
          <div style={LABEL}>Use Pattern for:</div>
          <div className="pt-cols-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {DO.map((g, i) => (
              <GuidanceCard key={g.t} on delay={i * 70} {...g} />
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div style={LABEL}>Avoid using Pattern for:</div>
          <div className="pt-cols-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {AVOID.map((g, i) => (
              <GuidanceCard key={g.t} on={false} delay={i * 70} {...g} />
            ))}
          </div>
        </div>

        <Reveal>
          <p style={{ ...BODY, fontSize: "var(--text-body-sm)", maxWidth: 720 }}>
            Model judgment can vary: two runs can find the same components through the same searches but judge the same evidence differently. The
            boundary-risk ensemble exists to detect and surface that uncertainty, reporting it as{" "}
            <span style={MONO}>confidence: &quot;low&quot;</span> rather than hiding it.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
