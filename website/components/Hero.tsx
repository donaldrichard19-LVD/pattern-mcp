"use client";

import { BODY, SECTION } from "./tokens";
import { CopyBlock, Reveal } from "./ui";

const INSTALL_LINES = ["npm install pattern-mcp"];

const PILL_ROWS: { widths: [number, number]; colors: [string, string]; opacities: [number, number] }[] = [
  { widths: [150, 104], colors: ["var(--blue-500)", "var(--green-500)"], opacities: [1, 0.85] },
  { widths: [104, 150], colors: ["var(--amber-500)", "var(--blue-500)"], opacities: [1, 0.55] },
  { widths: [176, 78], colors: ["var(--green-500)", "var(--amber-500)"], opacities: [1, 0.7] },
];

function PillStack() {
  return (
    <div style={{ display: "grid", gap: 5, maxWidth: 520 }} aria-hidden="true">
      {PILL_ROWS.map((row, ri) => (
        <div key={ri} style={{ display: "flex", gap: 5 }}>
          {row.widths.map((w, ci) => (
            <span
              key={ci}
              style={{
                width: w,
                height: 11,
                borderRadius: 7,
                background: row.colors[ci],
                opacity: row.opacities[ci],
                transformOrigin: "left",
                animation: "pt-breathe 5.2s ease-in-out infinite",
                animationDelay: `${(ri * 2 + ci) * 0.5}s`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Hero() {
  return (
    <section
      id="top"
      className="pt-pad-y"
      style={{
        padding: "64px 0 26px",
        backgroundImage:
          "radial-gradient(760px 300px at 88% -6%, rgba(26,115,232,.13), transparent 70%), radial-gradient(520px 260px at 8% 4%, rgba(14,159,110,.10), transparent 70%), radial-gradient(420px 220px at 60% 30%, rgba(199,125,10,.08), transparent 70%)",
      }}
    >
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 24 }}>
        <Reveal>
          <PillStack />
        </Reveal>
        <Reveal delay={60}>
          <h1
            style={{
              margin: 0,
              maxWidth: 840,
              fontWeight: 500,
              fontSize: "clamp(32px, 5.4vw, var(--text-display-md))",
              lineHeight: "var(--leading-display)",
              letterSpacing: "var(--tracking-display)",
              color: "var(--text-primary)",
              textWrap: "pretty",
            }}
          >
            Catch the{" "}
            <span style={{ backgroundImage: "linear-gradient(transparent 62%, rgba(199,125,10,.32) 62%)" }}>
              wrong UI decision
            </span>{" "}
            before your agent builds it
          </h1>
        </Reveal>
        <Reveal delay={120}>
          <p style={{ ...BODY, maxWidth: 660, fontSize: "var(--text-body-lg)" }}>
            Pattern checks a UI component need against real evidence, not a name and a guess. It returns one verdict,
            a component that actually fits or a grounded product reference when nothing does, so you find out before
            it&apos;s built, not after.
          </p>
        </Reveal>
        <Reveal delay={180}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <div style={{ minWidth: 340 }}>
              <CopyBlock label="install command" lines={INSTALL_LINES} />
            </div>
            <p style={{ margin: 0, maxWidth: 320, fontSize: "12.5px", lineHeight: 1.5, color: "var(--text-tertiary)" }}>
              Runs locally on your own Anthropic API key from the Console, not a Claude subscription. Roughly $0.06
              to $0.30 a call, billed to your account and itemised on every response.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
