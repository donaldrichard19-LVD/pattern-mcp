"use client";

import { Terminal } from "lucide-react";
import { BODY, LABEL, MONO, PANEL, SECTION } from "./tokens";
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
            Empower your agents to ship great products with <em>taste</em>
          </h1>
        </Reveal>
        <Reveal delay={80}>
          <p style={{ ...BODY, maxWidth: 640, fontSize: "var(--text-body-lg)" }}>
            Pattern gives coding agents better design judgment by searching real component libraries, checking options against your
            framework, product domain, and requirements, then giving them a recommendation they can act on while they build
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
        <Reveal delay={260}>
          <div className="pt-cols-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
            <div style={{ ...PANEL, padding: 14, display: "grid", gap: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: "var(--text-body-sm)", color: "var(--text-primary)" }}>
                <Terminal size={16} /> Tell your coding agent
              </span>
              <p style={{ ...MONO, margin: 0, fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>{AGENT_PROMPT}</p>
            </div>
            <CopyBlock label="install command" lines={INSTALL_LINES} />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
