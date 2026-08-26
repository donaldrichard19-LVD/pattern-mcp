"use client";

import { Check, Minus } from "lucide-react";
import { BODY, H2, LABEL, MONO, SECTION } from "./tokens";
import { Reveal } from "./ui";

const GUIDANCE = [
  { on: true, t: "A component with real requirements", d: "Fee breakdowns, policy displays, dashboards, inboxes. Anything where fit requires judgment" },
  { on: true, t: "Before the agent starts writing UI", d: "The verdict is useful while there's still a decision to make" },
  { on: false, t: "Trivial primitives", d: "Buttons, inputs, badges, spinners. The skip-list already answers these for free" },
  { on: false, t: "Anything you'd cache and reuse", d: "Coverage is a snapshot with a computed_at date. Keep caching session-scoped, never across builds" },
];

export function Guidance() {
  return (
    <section className="pt-pad-y" style={{ padding: "80px 0", borderTop: "1px solid var(--border-subtle)", background: "var(--surface-sunken)" }}>
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 32 }}>
        <Reveal>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={LABEL}>Using it well</div>
            <h2 style={{ ...H2, maxWidth: 620 }}>When to let the agent call this, and when it&apos;s overkill</h2>
          </div>
        </Reveal>
        <div className="pt-cols-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {GUIDANCE.map((g, i) => (
            <Reveal key={g.t} delay={i * 70}>
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
                  {g.on ? <Check size={16} style={{ color: "var(--text-success)" }} /> : <Minus size={16} style={{ color: "var(--text-tertiary)" }} />}
                  <span style={{ fontSize: "var(--text-body-md)", color: "var(--text-primary)" }}>{g.t}</span>
                </div>
                <p style={{ ...BODY, fontSize: "var(--text-body-sm)" }}>{g.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal>
          <p style={{ ...BODY, fontSize: "var(--text-body-sm)", maxWidth: 720 }}>
            One limitation is worth knowing before you start: the model can judge the same evidence differently between runs on identical input. The
            ensemble catches cases where that could flip a verdict and reports them as <span style={MONO}>confidence: &quot;low&quot;</span> instead of
            hiding the disagreement.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
