"use client";

import { Info, Terminal } from "lucide-react";
import { BODY, H2, LABEL, MONO, PANEL, SECTION } from "./tokens";
import { CopyBlock, Reveal } from "./ui";

const CALL_LINES = [
  "recommend_component({",
  '  component_need: "price breakdown with fees and taxes",',
  '  domain: "Airbnb-style rental marketplace",',
  '  framework: "React + Tailwind",',
  '  existing_stack: "already using shadcn/ui",',
  '  project_id: "my-booking-app"',
  "})",
];

const VERDICT_LINES = [
  "{",
  '  "verdict": "custom_build",',
  '  "confidence": "high",',
  '  "reason": "scored",',
  '  "coverage": "2/8 (25%)",',
  '  "computed_at": "2026-08-25",',
  '  "recommendation": {',
  '    "source": null,',
  '    "reference": {',
  '      "source": "Mobbin",',
  '      "url_type": "deep_link",',
  '      "flow_name": "Booking, price details"',
  "    }",
  "  },",
  '  "ensemble": { "triggered": false }',
  "}",
];

const INSTALL_LINES = ["npm install pattern-mcp"];

const AGENT_PROMPT =
  "Use recommend_component before picking a UI component: pass the specific need, my domain, and framework, then act on the verdict. Install what it recommends, or build from the reference it returns";

export function Hero() {
  return (
    <section id="top" className="pt-pad-y" style={{ padding: "72px 0 24px" }}>
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 28 }}>
        <Reveal>
          <h1
            style={{
              margin: 0,
              maxWidth: 820,
              fontWeight: 500,
              fontSize: "clamp(32px, 5.4vw, var(--text-display-md))",
              lineHeight: "var(--leading-display)",
              letterSpacing: "var(--tracking-display)",
              color: "var(--text-primary)",
              textWrap: "pretty",
            }}
          >
            Catch the wrong UI decision before your agent builds it
          </h1>
        </Reveal>
        <Reveal delay={80}>
          <p style={{ ...BODY, maxWidth: 640, fontSize: "var(--text-body-lg)" }}>
            Pattern checks a UI component need against real evidence, not a name and a guess. It returns one verdict,
            a component that actually fits or a grounded product reference when nothing does, so you find out before
            it&apos;s built, not after.
          </p>
        </Reveal>
        <Reveal delay={140}>
          <div style={{ maxWidth: 520 }}>
            <CopyBlock label="install command" lines={INSTALL_LINES} />
          </div>
        </Reveal>
        <Reveal delay={200}>
          <div style={{ ...PANEL, background: "#fff", overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 14px",
                borderBottom: "1px solid var(--border-subtle)",
                flexWrap: "wrap",
              }}
            >
              <span style={{ ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>one call, mid-build</span>
            </div>
            <div className="pt-cols-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
              <div className="pt-scroll-x" style={{ padding: 16, borderRight: "1px solid var(--border-subtle)" }}>
                <div style={{ ...LABEL, marginBottom: 8 }}>The agent asks</div>
                <pre className="pt-json" style={{ margin: 0, ...MONO, fontSize: 12, lineHeight: 1.65, color: "var(--text-primary)" }}>
                  {CALL_LINES.join("\n")}
                </pre>
              </div>
              <div className="pt-scroll-x" style={{ padding: 16, background: "var(--surface-sunken)" }}>
                <div style={{ ...LABEL, marginBottom: 8 }}>Pattern answers</div>
                <pre className="pt-json" style={{ margin: 0, ...MONO, fontSize: 12, lineHeight: 1.65, color: "var(--text-primary)" }}>
                  {VERDICT_LINES.join("\n")}
                </pre>
              </div>
            </div>
          </div>
        </Reveal>
        <Reveal delay={210}>
          <div style={{ display: "grid", gap: 10, maxWidth: 640 }}>
            <span style={LABEL}>Pattern checks</span>
            <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
              <li style={{ ...BODY, fontSize: "var(--text-body-sm)" }}>What the component needs to do</li>
              <li style={{ ...BODY, fontSize: "var(--text-body-sm)" }}>What existing components actually support</li>
              <li style={{ ...BODY, fontSize: "var(--text-body-sm)" }}>How well each option covers the requirements</li>
              <li style={{ ...BODY, fontSize: "var(--text-body-sm)" }}>Whether an existing component is the right fit</li>
              <li style={{ ...BODY, fontSize: "var(--text-body-sm)" }}>What real references to use when nothing fits</li>
            </ul>
            <p style={{ ...BODY, fontSize: "var(--text-body-sm)", margin: 0 }}>
              The agent gets a verdict: <strong>use an existing component</strong> or <strong>build it custom from a real
              reference</strong>, with the evidence behind the decision.
            </p>
          </div>
        </Reveal>
        <Reveal delay={220}>
          <h2 id="install" style={H2}>
            Installation
          </h2>
        </Reveal>
        <Reveal delay={260}>
          <div className="pt-cols-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
            <CopyBlock label="install command" lines={INSTALL_LINES} />
            <div style={{ ...PANEL, padding: 14, display: "grid", gap: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: "var(--text-body-sm)", color: "var(--text-primary)" }}>
                <Terminal size={16} /> Tell your coding agent
              </span>
              <p style={{ ...MONO, margin: 0, fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>{AGENT_PROMPT}</p>
            </div>
          </div>
        </Reveal>
        <Reveal delay={300}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "12px 14px",
              borderRadius: "var(--radius-md)",
              border: "1px solid color-mix(in oklab, var(--blue-500) 40%, transparent)",
              background: "color-mix(in oklab, var(--blue-500) 8%, transparent)",
            }}
          >
            <Info size={16} style={{ flexShrink: 0, marginTop: 2, color: "var(--blue-500)" }} />
            <p style={{ ...BODY, margin: 0, fontSize: "var(--text-body-sm)", color: "var(--text-primary)" }}>
              Requires your own Anthropic API key from the Console, not a Claude subscription. Every call bills your account
              directly, roughly $0.06 to $0.30 per call depending on whether the boundary-risk ensemble triggers.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
