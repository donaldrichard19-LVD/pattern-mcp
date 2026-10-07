"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { QUICKSTART } from "./constants";
import { MONO } from "./tokens";
import { Chip, CopyBlock, SegTabs, trackClick } from "./ui";

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
  '  "coverage": "2/8 (25%)",',
  '  "missing": [',
  '    "collapsible fee explanation",',
  '    "currency + locale formatting",',
  '    "total row with emphasis",',
  '    "discount / long-stay line",',
  '    "tooltip on service fee",',
  '    "mobile bottom-sheet layout"',
  "  ]",
  "}",
];

const REQS_MET = 2;
const REQS_TOTAL = 8;

const AGENTS: { name: string; glyph: string; bg: string; round?: boolean; delay: number }[] = [
  { name: "Claude Code", glyph: "✦", bg: "var(--amber-500)", delay: 0.15 },
  { name: "Codex", glyph: "◎", bg: "var(--text-primary)", round: true, delay: 0.3 },
  { name: "Cursor", glyph: "➤", bg: "var(--blue-500)", round: true, delay: 0.6 },
];

function Pill({ glyph, bg, round, delay, children }: { glyph: string; bg: string; round?: boolean; delay: number; children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        verticalAlign: "middle",
        alignItems: "center",
        gap: 8,
        background: "#eef1f4",
        borderRadius: 999,
        padding: "5px 16px 5px 7px",
        margin: "0 2px",
        whiteSpace: "nowrap",
      }}
    >
      <span
        className="pt-bob"
        style={{
          width: 28,
          height: 28,
          borderRadius: round ? 999 : 8,
          background: bg,
          flex: "none",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 13,
          fontWeight: 700,
          animationDelay: delay + "s",
        }}
      >
        {glyph}
      </span>
      {children}
    </span>
  );
}

const ROW: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "104px 1fr",
  gap: 12,
  padding: "12px 0",
  alignItems: "center",
};

function ReadableVerdict() {
  return (
    <div style={{ padding: "4px 20px", display: "flex", flexDirection: "column" }}>
      <div style={{ ...ROW, borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Verdict</div>
        <div style={{ display: "flex" }}>
          <Chip tone="warning">custom_build</Chip>
        </div>
      </div>
      <div style={{ ...ROW, borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Confidence</div>
        <div style={{ fontSize: 15, fontWeight: 500 }}>High</div>
      </div>
      <div style={{ ...ROW, borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Coverage</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 500 }}>
            {REQS_MET} of {REQS_TOTAL} requirements met
          </div>
          <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: `repeat(${REQS_TOTAL}, 1fr)`, gap: 5, maxWidth: 220 }}>
            {Array.from({ length: REQS_TOTAL }, (_, i) => (
              <span key={i} style={{ height: 3, borderRadius: 2, background: i < REQS_MET ? "var(--green-500)" : "var(--border-subtle)" }} />
            ))}
          </div>
        </div>
      </div>
      <div style={{ ...ROW, alignItems: "start" }}>
        <div style={{ fontSize: 13, color: "var(--text-tertiary)", paddingTop: 2 }}>Missing</div>
        <div style={{ fontSize: 14, lineHeight: 1.5, color: "var(--text-secondary)" }}>
          Collapsible fee explanation, currency formatting, total row, discount line, fee tooltip, mobile layout
        </div>
      </div>
    </div>
  );
}

function VerdictCard() {
  const [tab, setTab] = useState<"you" | "agent">("you");
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border-subtle)", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", background: "var(--surface-sunken)", borderBottom: "1px solid var(--border-subtle)" }}>
        <SegTabs
          value={tab}
          onChange={setTab}
          options={[
            ["you", "For you"],
            ["agent", "For your agent"],
          ]}
        />
      </div>
      <div
        style={{
          padding: "20px 20px 16px",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 600 }}>
          The agent asks
        </div>
        <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: "-0.012em" }}>&ldquo;Price breakdown with fees and taxes&rdquo;</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Airbnb-style rental &middot; React + Tailwind</div>
      </div>
      {tab === "you" ? (
        <ReadableVerdict />
      ) : (
        <pre
          className="pt-json pt-scroll-x"
          style={{
            margin: 0,
            padding: "16px 20px",
            background: "var(--surface-sunken)",
            ...MONO,
            fontSize: 12,
            lineHeight: 1.65,
            color: "var(--text-primary)",
            overflow: "auto",
          }}
        >
          {VERDICT_LINES.join("\n")}
        </pre>
      )}
      <div
        style={{
          padding: "10px 20px",
          background: "var(--surface-sunken)",
          borderTop: "1px solid var(--border-subtle)",
          ...MONO,
          fontSize: 11,
          color: "var(--text-tertiary)",
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 14px",
        }}
      >
        <span>checked against your design system</span>
        <span>&middot;</span>
        <span>12s</span>
        <span>&middot;</span>
        <span>$0.03</span>
      </div>
    </div>
  );
}

const WORKS_WITH: { name: string; bg: string }[] = [
  { name: "Claude Code", bg: "var(--amber-500)" },
  { name: "Cursor", bg: "var(--text-primary)" },
  { name: "Codex", bg: "var(--green-500)" },
  { name: "Figma", bg: "var(--blue-500)" },
];

export function Hero() {
  return (
    <>
      <header
        id="top"
        className="pt-sec pt-hero"
        style={{ maxWidth: 1080, margin: "0 auto", padding: "72px 32px 24px", display: "flex", flexDirection: "column", gap: 12 }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(30px, 5vw, 46px)",
            lineHeight: 1.5,
            letterSpacing: "-0.02em",
            fontWeight: 400,
            color: "var(--text-primary)",
            textWrap: "balance",
            maxWidth: "19em",
          }}
        >
          A tool to build exactly what you designed in{" "}
          <Pill glyph="◆" bg="linear-gradient(135deg,#F24E1E,#A259FF 50%,#1ABCFE)" delay={0}>
            Figma
          </Pill>{" "}
          using{" "}
          {AGENTS.map((a, i) => (
            <span key={a.name}>
              {/* Keep the pill and its punctuation on one line so a comma never wraps alone. */}
              <span style={{ whiteSpace: "nowrap" }}>
                <Pill glyph={a.glyph} bg={a.bg} round={a.round} delay={a.delay}>
                  {a.name}
                </Pill>
                {i < AGENTS.length - 1 ? "," : "."}
              </span>
              {i === AGENTS.length - 2 ? " and " : " "}
            </span>
          ))}
        </h1>
      </header>

      <section
        id="install"
        className="pt-sec pt-hero pt-cols-2"
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: "28px 32px 80px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)",
          gap: 28,
          alignItems: "start",
          animationDelay: ".08s",
        }}
      >
        <VerdictCard />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <CopyBlock label="install command" lines={INSTALL_LINES} />
          <a
            href={QUICKSTART}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackClick("install_pattern_clicked", { location: "hero" })}
            className="pt-btn-primary"
            style={{
              background: "var(--blue-500)",
              color: "#fff",
              padding: "0 18px",
              minHeight: 46,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
              fontWeight: 500,
              fontSize: 15,
              textDecoration: "none",
            }}
          >
            Install Pattern
          </a>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
            <span>Works with</span>
            {WORKS_WITH.map((w, i) => (
              <span key={w.name} style={{ display: "contents" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: w.bg, flex: "none" }} />
                  {w.name}
                </span>
                {i < WORKS_WITH.length - 1 && <span>&middot;</span>}
              </span>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
