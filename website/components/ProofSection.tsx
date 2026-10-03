"use client";

import { Check, HelpCircle } from "lucide-react";
import { BODY, H2, LABEL, MONO, PANEL, SECTION } from "./tokens";
import { Chip, Reveal } from "./ui";

// A real run (a confirmation dialog built from a registered Figma file and then
// verified), not an invented example: the Figma values are the file's own, and
// the quotes are lines the server found in the built file.
const REQS: { tone: "accent" | "neutral" | "warning"; tag: string; text: string }[] = [
  { tone: "accent", tag: "From your Figma", text: "Modal is 320×224, gap 16, radius 14" },
  { tone: "neutral", tag: "Inferred", text: "Cancel, then Confirm, in that order" },
  { tone: "warning", tag: "General practice", text: "Escape closes it; focus returns to the trigger" },
];

const CHECKS: { ok: boolean; text: string; quote?: string }[] = [
  { ok: true, text: "Modal is 320×224", quote: "width: 320, height: 224" },
  { ok: true, text: "Escape closes it", quote: 'if (e.key === "Escape")' },
  { ok: true, text: "Focus returns to the trigger", quote: "return () => trigger?.focus();" },
  { ok: false, text: "Styled from tokens.ts" },
];

// Text for screen readers only: status must not depend on an icon's shape or colour.
const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

function Row({ children }: { children: React.ReactNode }) {
  return <li style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "var(--text-body-sm)" }}>{children}</li>;
}

const LIST: React.CSSProperties = { display: "grid", gap: 10, listStyle: "none", margin: 0, padding: 0 };

export function ProofSection() {
  return (
    <section id="step-03" style={{ padding: "80px 0", borderTop: "1px solid var(--border-subtle)", background: "#fff" }}>
      <div
        className="pt-cols-2"
        style={{ ...SECTION, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "start" }}
      >
        <Reveal>
          <div style={{ display: "grid", gap: 14 }}>
            <span style={LABEL}>03</span>
            <h2 style={{ ...H2, fontSize: "clamp(24px, 3.6vw, 30px)" }}>
              Know what comes from your design.{" "}
              <span style={{ color: "var(--text-accent)" }}>Then see the proof.</span>
            </h2>
            <p style={{ ...BODY, fontSize: "var(--text-body-md)" }}>
              Every requirement is tagged: taken from your design file with its exact value, inferred from the
              request, or general practice that a design file can&apos;t show, like keyboard and screen-reader
              behavior. You know which ones are your system&apos;s and which are assumptions.
            </p>
            <p style={{ ...BODY, fontSize: "var(--text-body-md)" }}>
              After the build, Pattern checks the finished file against the list. Every pass comes with a quote
              from your file, and the server confirms the quote is really there. No quote, no pass. Things that
              must be absent, like &ldquo;no Tailwind classes,&rdquo; are searched for by the server, not taken
              on the model&apos;s word.
            </p>
            <p style={{ ...BODY, fontSize: "var(--text-caption)", color: "var(--text-tertiary)" }}>
              It reads the code. It can&apos;t judge how the page renders.
            </p>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div style={{ ...PANEL, background: "#fff", overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>
              from a real run: a confirmation dialog
            </div>
            <div style={{ padding: 14, display: "grid", gap: 10 }}>
              <span style={{ ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>Before: where each requirement comes from</span>
              <ul style={LIST}>
                {REQS.map((r) => (
                  <Row key={r.text}>
                    <span style={{ flexShrink: 0, display: "inline-block", width: 136 }}>
                      <Chip tone={r.tone}>{r.tag}</Chip>
                    </span>
                    <span style={{ color: "var(--text-primary)", paddingTop: 3 }}>{r.text}</span>
                  </Row>
                ))}
              </ul>
            </div>
            <div style={{ height: 1, background: "var(--border-subtle)" }} />
            <div style={{ padding: 14, display: "grid", gap: 10 }}>
              <span style={{ ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>After: checked against the built file</span>
              <ul style={LIST}>
              {CHECKS.map((c) => (
                <Row key={c.text}>
                  {c.ok ? (
                    <Check size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: "var(--text-success)" }} />
                  ) : (
                    <HelpCircle size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: "var(--text-tertiary)" }} />
                  )}
                  <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                    <span style={{ color: c.ok ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                      <span style={SR_ONLY}>{c.ok ? "Verified: " : "Unverified: "}</span>
                      {c.text}
                    </span>
                    {c.quote ? (
                      <code style={{ ...MONO, fontSize: 11, color: "var(--text-secondary)", wordBreak: "break-word", fontVariantLigatures: "none", fontFeatureSettings: '"liga" 0, "calt" 0' }}>{c.quote}</code>
                    ) : (
                      <span style={{ fontSize: "var(--text-caption)", color: "var(--text-tertiary)" }}>unverified: look at this</span>
                    )}
                  </div>
                </Row>
              ))}
              </ul>
            </div>
            <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border-subtle)", ...MONO, fontSize: 11, color: "var(--text-tertiary)" }}>
              a quote is shown only if the server found it in the file
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
