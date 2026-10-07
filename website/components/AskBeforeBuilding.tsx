"use client";

import { useEffect, useState } from "react";
import { BODY, H2, MONO, SECTION } from "./tokens";
import { Chip, Reveal } from "./ui";

const CHECKLIST: { item: string; met: boolean }[] = [
  { item: "Itemized line rows for rate, fees, and taxes", met: true },
  { item: "Nightly rate × nights subtotal", met: true },
  { item: "Collapsible fee explanation", met: false },
  { item: "Currency + locale formatting", met: false },
  { item: "Total row with emphasis", met: false },
  { item: "Discount / long-stay line", met: false },
  { item: "Tooltip on service fee", met: false },
  { item: "Mobile bottom-sheet layout", met: false },
];
const TOTAL = CHECKLIST.length;
// Steps 0..TOTAL score one row at a time, then hold on the finished state
// for a few ticks before looping.
const LOOP_AT = TOTAL + 5;

function ScoringMark({ spinning }: { spinning: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 64 64" aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
      {[
        [6, 10, 26, "var(--blue-500)", 1],
        [36, 10, 22, "var(--green-500)", 0.85],
        [6, 26, 22, "var(--amber-500)", 1],
        [32, 26, 26, "var(--blue-500)", 0.55],
        [6, 42, 30, "var(--green-500)", 1],
        [40, 42, 18, "var(--amber-500)", 0.7],
      ].map(([x, y, w, fill, o], i) => (
        <rect
          key={i}
          x={x as number}
          y={y as number}
          width={w as number}
          height={12}
          rx={6}
          fill={fill as string}
          opacity={o as number}
          className={spinning ? "pt-grow" : undefined}
          style={spinning ? { animationDelay: i * 0.14 + "s" } : undefined}
        />
      ))}
    </svg>
  );
}

function ChecklistPanel() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(TOTAL);
      return;
    }
    const t = setInterval(() => setStep((s) => (s >= LOOP_AT ? 0 : s + 1)), 700);
    return () => clearInterval(t);
  }, []);

  const finished = step >= TOTAL;
  const scored = Math.min(step, TOTAL);
  const met = CHECKLIST.slice(0, scored).filter((c) => c.met).length;

  return (
    <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          background: "var(--surface-sunken)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ScoringMark spinning={!finished} />
          <span style={{ ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>coverage scoring</span>
        </div>
        <Chip tone={finished ? "warning" : "accent"}>{finished ? "custom_build · high" : "scoring"}</Chip>
      </div>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)", fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)" }}>
        <span style={{ color: "var(--text-tertiary)" }}>Task · </span>
        Build the price breakdown for the booking checkout: nightly rate, cleaning fee, service fee, taxes.
      </div>
      <div style={{ padding: "6px 16px 10px", display: "flex", flexDirection: "column" }}>
        {CHECKLIST.map((c, i) => {
          const done = i < step;
          const active = i === step && step < TOTAL;
          return (
            <div key={c.item} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f0f2f5" }}>
              <span
                aria-hidden="true"
                style={{
                  width: 18,
                  flex: "none",
                  textAlign: "center",
                  fontSize: 13,
                  fontWeight: 600,
                  color: done && c.met ? "var(--text-success)" : "var(--text-tertiary)",
                }}
              >
                {done ? (c.met ? "✓" : "–") : active ? "·" : ""}
              </span>
              <span style={{ fontSize: 13, color: done ? (c.met ? "var(--text-primary)" : "var(--text-tertiary)") : active ? "var(--text-primary)" : "#a9b0bb" }}>
                {c.item}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 13 }}>
          <span style={{ color: "var(--text-tertiary)" }}>
            {met} of {scored} met
          </span>
          <span style={{ fontWeight: 500, color: finished ? "var(--text-primary)" : "var(--text-tertiary)" }}>
            {finished ? "Build custom" : "Scoring…"}
          </span>
        </div>
        <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: `repeat(${TOTAL}, 1fr)`, gap: 5 }}>
          {CHECKLIST.map((_, i) => (
            <span
              key={i}
              style={{ height: 3, borderRadius: 2, background: i < scored ? "var(--blue-500)" : "var(--border-subtle)", transition: "background .4s ease" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function AskBeforeBuilding() {
  return (
    <section
      id="how"
      className="pt-sec"
      style={{
        ...SECTION,
        padding: "80px 32px 40px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))",
        gap: 56,
        alignItems: "center",
      }}
    >
      <Reveal>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: "30em" }}>
          <h2 style={{ ...H2, lineHeight: 1.04 }}>Ask for the screen.</h2>
          <p style={{ ...BODY, fontSize: "var(--text-body-lg)" }}>
            Pattern tells your agent to check before it builds UI, especially from a Figma link, mockup, or screenshot. Buttons and small edits are left
            alone. Then it compares what the component must do with what your design system has.
          </p>
        </div>
      </Reveal>
      <Reveal delay={80}>
        <ChecklistPanel />
      </Reveal>
    </section>
  );
}
