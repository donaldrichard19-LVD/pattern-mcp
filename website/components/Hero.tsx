"use client";

import { useState, type CSSProperties } from "react";
import { BODY, H2, MONO, PANEL, SECTION } from "./tokens";
import { Button, Chip, CopyBlock, Reveal } from "./ui";

// `init --yes` (not the bare server command) so this is safe for a coding
// agent to run non-interactively -- bare `npx pattern-mcp` starts a real
// process that just sits on stdin waiting for a client, which would hang
// an agent's shell tool call instead of completing. `init --yes` detects
// and connects every supported client and exits, no prompts.
const INSTALL_LINES = ["npx pattern-mcp init --yes"];

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

const REQS_MET = 2;
const REQS_TOTAL = 8;

function tabStyle(active: boolean): CSSProperties {
  return {
    flex: 1,
    padding: "11px 14px",
    fontSize: "var(--text-body-sm)",
    fontWeight: 500,
    color: active ? "var(--text-primary)" : "var(--text-tertiary)",
    background: "transparent",
    border: "none",
    borderBottom: active ? "2px solid var(--blue-500)" : "2px solid transparent",
    cursor: "pointer",
  };
}

function ReadableVerdict() {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ fontSize: "var(--text-caption)", color: "var(--text-tertiary)", ...MONO }}>The agent asks</div>
      <div style={{ display: "grid", gap: 2 }}>
        <span style={{ fontSize: "var(--text-body-md)", color: "var(--text-primary)" }}>Price breakdown with fees and taxes</span>
        <span style={{ fontSize: "var(--text-caption)", color: "var(--text-tertiary)" }}>Airbnb-style rental &middot; React + Tailwind</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: "var(--text-body-md)", fontWeight: 500, color: "var(--text-primary)" }}>Build custom</span>
        <Chip tone="warning">confidence: high</Chip>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ display: "flex", gap: 3 }} aria-hidden="true">
          {Array.from({ length: REQS_TOTAL }, (_, i) => (
            <span
              key={i}
              style={{
                flex: 1,
                height: 5,
                borderRadius: 3,
                background: i < REQS_MET ? "var(--blue-500)" : "var(--border-subtle)",
              }}
            />
          ))}
        </div>
        <span style={{ fontSize: "var(--text-caption)", color: "var(--text-tertiary)" }}>{REQS_MET} of {REQS_TOTAL} requirements met</span>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", ...PANEL, padding: 10 }}>
        <div
          aria-hidden="true"
          style={{
            width: 44,
            height: 44,
            borderRadius: "var(--radius-sm)",
            flexShrink: 0,
            backgroundImage: "repeating-linear-gradient(135deg, var(--border-subtle), var(--border-subtle) 4px, #fff 4px, #fff 8px)",
          }}
        />
        <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
          <span style={{ fontSize: "var(--text-body-sm)", color: "var(--text-primary)" }}>Mobbin &middot; &quot;Booking, price details&quot;</span>
          <Chip tone="success">verified direct link</Chip>
        </div>
      </div>
    </div>
  );
}

function VerdictCard() {
  const [tab, setTab] = useState<"you" | "agent">("you");
  return (
    <div style={{ ...PANEL, background: "#fff", overflow: "hidden" }}>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border-subtle)" }}>
        <button onClick={() => setTab("you")} style={tabStyle(tab === "you")}>
          For you
        </button>
        <button onClick={() => setTab("agent")} style={tabStyle(tab === "agent")}>
          For your agent
        </button>
      </div>
      <div className="pt-scroll-x" style={{ padding: 16 }}>
        {tab === "you" ? (
          <ReadableVerdict />
        ) : (
          <pre className="pt-json" style={{ margin: 0, ...MONO, fontSize: 12, lineHeight: 1.65, color: "var(--text-primary)" }}>
            {VERDICT_LINES.join("\n")}
          </pre>
        )}
      </div>
      <div style={{ padding: "9px 16px", borderTop: "1px solid var(--border-subtle)", ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>
        3 libraries checked &middot; 11s &middot; $0.19
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section
      id="top"
      className="pt-pad-y"
      style={{
        padding: "72px 0",
        backgroundImage:
          "radial-gradient(760px 300px at 88% -6%, rgba(26,115,232,.13), transparent 70%), radial-gradient(520px 260px at 8% 4%, rgba(14,159,110,.10), transparent 70%)",
      }}
    >
      <div
        className="pt-cols-2"
        style={{ ...SECTION, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "start" }}
      >
        <div style={{ display: "grid", gap: 22 }}>
          <Reveal>
            <h1
              style={{
                margin: 0,
                maxWidth: 560,
                fontWeight: 500,
                fontSize: "clamp(30px, 5vw, var(--text-display-md))",
                lineHeight: "var(--leading-display)",
                letterSpacing: "var(--tracking-display)",
                color: "var(--text-primary)",
                textWrap: "pretty",
              }}
            >
              Your agent is about to pick a UI component.{" "}
              <span style={{ color: "var(--text-accent)" }}>Pattern checks it first.</span>
            </h1>
          </Reveal>
          <Reveal delay={60}>
            <p style={{ ...BODY, maxWidth: 520, fontSize: "var(--text-body-lg)" }}>
              Pattern checks UI decisions against real components, your design system, and real product
              references before your agent builds. It tells your agent what to use, what to build, and why.
            </p>
          </Reveal>
          <Reveal delay={100}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Button href="#install" size="lg">
                Get started &rarr;
              </Button>
              <Button href="#step-01" variant="secondary" size="lg">
                See how it works &darr;
              </Button>
            </div>
          </Reveal>
          <Reveal delay={140}>
            <div id="install">
              <CopyBlock label="install command" lines={INSTALL_LINES} />
            </div>
          </Reveal>
        </div>
        <Reveal delay={120}>
          <VerdictCard />
        </Reveal>
      </div>
    </section>
  );
}
