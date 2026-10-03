"use client";

import { useEffect, useState } from "react";
import { Check, Minus } from "lucide-react";
import { BODY, H2, LABEL, MONO, PANEL, SECTION } from "./tokens";
import { Chip, Reveal } from "./ui";

const CHECKLIST: { item: string; met: boolean }[] = [
  { item: "Itemized line rows (rate, fees, taxes)", met: true },
  { item: "Nightly rate × nights subtotal", met: true },
  { item: "Collapsible fee explanation", met: false },
  { item: "Currency + locale formatting", met: false },
  { item: "Total row with emphasis", met: false },
  { item: "Discount / long-stay line", met: false },
  { item: "Tooltip on service fee", met: false },
  { item: "Mobile bottom-sheet layout", met: false },
];
const MET_COUNT = CHECKLIST.filter((c) => c.met).length;

function ChecklistPanel() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    // Flips the status chip once the last item's stagger + reveal transition
    // has had time to finish -- see Reveal's own delay/transition timing.
    const t = setTimeout(() => setDone(true), CHECKLIST.length * 90 + 700);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{ ...PANEL, background: "#fff", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "10px 14px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <span style={{ ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>checking against requirements</span>
        <Chip tone={done ? "warning" : "accent"}>{done ? "build new · high" : "scoring"}</Chip>
      </div>
      <div style={{ padding: 14, display: "grid", gap: 10 }}>
        <p style={{ ...BODY, fontSize: "var(--text-body-sm)", margin: 0 }}>
          Build the price breakdown for the booking checkout: nightly rate, cleaning fee, service fee, taxes.
        </p>
        <div style={{ display: "grid", gap: 7 }}>
          {CHECKLIST.map((c, i) => (
            <Reveal key={c.item} delay={i * 90}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "var(--text-body-sm)" }}>
                {c.met ? (
                  <Check size={15} style={{ flexShrink: 0, marginTop: 2, color: "var(--text-success)" }} />
                ) : (
                  <Minus size={15} style={{ flexShrink: 0, marginTop: 2, color: "var(--text-tertiary)" }} />
                )}
                <span style={{ color: c.met ? "var(--text-primary)" : "var(--text-tertiary)" }}>{c.item}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
      <div
        style={{
          padding: "10px 14px",
          borderTop: "1px solid var(--border-subtle)",
          display: "grid",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", gap: 3 }} aria-hidden="true">
          {CHECKLIST.map((c, i) => (
            <span
              key={i}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                background: c.met ? "var(--blue-500)" : "var(--border-subtle)",
              }}
            />
          ))}
        </div>
        <span style={{ ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>
          {MET_COUNT} of {CHECKLIST.length} met &middot; build new recommended
        </span>
      </div>
    </div>
  );
}

export function AskBeforeBuilding() {
  return (
    <section id="step-01" style={{ padding: "80px 0", borderTop: "1px solid var(--border-subtle)", background: "#fff" }}>
      <div
        className="pt-cols-2"
        style={{ ...SECTION, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "start" }}
      >
        <Reveal>
          <div style={{ display: "grid", gap: 14 }}>
            <span style={LABEL}>02</span>
            <h2 style={{ ...H2, fontSize: "clamp(24px, 3.6vw, 30px)" }}>
              Just ask for the screen.{" "}
              <span style={{ color: "var(--text-accent)" }}>Pattern is already in the loop.</span>
            </h2>
            <p style={{ ...BODY, fontSize: "var(--text-body-md)" }}>
              When your agent connects, Pattern tells it to check before it builds UI, especially when you hand
              it a Figma link, a mockup or a screenshot. Buttons and small edits are left alone. Then it
              compares a checklist of what the component must do with what your design system has.
            </p>
            <p style={{ ...BODY, fontSize: "var(--text-body-md)" }}>
              In a small Claude Code test, agents ran the check on their own in 6 of 6 UI builds, and skipped
              it on a typo fix 8 of 8 times.
            </p>
            <p style={{ ...BODY, fontSize: "var(--text-caption)", color: "var(--text-tertiary)" }}>
              A model can still ignore instructions. The rule in step 04 makes the check mandatory. Common
              basics like buttons and inputs are answered on your machine at no cost.
            </p>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <ChecklistPanel />
          <p style={{ ...BODY, fontSize: "var(--text-caption)", color: "var(--text-tertiary)", marginTop: 10 }}>
            The agent asked for a price breakdown. Your design system covered 2 of the 8 things it needs, so
            Pattern recommended building a new one and listed what was missing.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
