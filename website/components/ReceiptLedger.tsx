"use client";

import { useState } from "react";
import { LABEL, MONO, SECTION } from "./tokens";
import { Mark, Reveal } from "./ui";

// Placeholder rows -- a real ledger feed (read_ledger) replaces these once
// this section is wired to live data. Values match the price-breakdown
// example used throughout the rest of the page.
const ROWS: { need: string; verdict: string; file: string; cost: string; stillIn: string }[] = [
  {
    need: "Price breakdown with fees and taxes",
    verdict: "Build custom",
    file: "app/checkout/PriceBreakdown.tsx",
    cost: "$0.19",
    stillIn: "Yes",
  },
  {
    need: "Host earnings dashboard",
    verdict: "Use existing",
    file: "app/host/Earnings.tsx",
    cost: "$0.24",
    stillIn: "Yes",
  },
  {
    need: "Cancellation policy display",
    verdict: "Build custom",
    file: "app/stay/CancellationPolicy.tsx",
    cost: "$0.16",
    stillIn: "No, component replaced",
  },
  {
    need: "Host and guest messaging thread",
    verdict: "Use existing",
    file: "not recorded",
    cost: "$0.22",
    stillIn: "Can't check, no file",
  },
];

const COLS = "1.6fr 1fr 1.6fr .7fr 1.3fr";

export function ReceiptLedger() {
  const [checked, setChecked] = useState(false);
  return (
    <section style={{ padding: "64px 0", borderTop: "1px solid var(--border-subtle)", background: "#fff" }}>
      <div style={SECTION}>
        <Reveal>
          <div
            style={{
              background: "#0b0f16",
              borderRadius: "var(--radius-lg)",
              padding: "32px 28px",
              display: "grid",
              gap: 24,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: 10, maxWidth: 560 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <Mark size={20} />
                  <span style={{ ...LABEL, color: "rgba(255,255,255,.55)" }}>03</span>
                </div>
                <h2 style={{ margin: 0, fontSize: "clamp(22px, 3.4vw, 28px)", fontWeight: 500, color: "#fff", lineHeight: 1.15 }}>
                  Every decision leaves a receipt.{" "}
                  <span style={{ color: "#6ca6ff" }}>What was checked, what it cost, and whether it&apos;s still in the code.</span>
                </h2>
              </div>
              <button
                onClick={() => setChecked((v) => !v)}
                style={{
                  border: "1px solid rgba(255,255,255,.28)",
                  background: "transparent",
                  color: "#fff",
                  borderRadius: 6,
                  padding: "10px 16px",
                  minHeight: 44,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                {checked ? "Reset" : "Check against today's code"}
              </button>
            </div>

            <div className="pt-scroll-x" style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 640 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: COLS,
                    gap: 12,
                    padding: "0 4px 10px",
                    borderBottom: "1px solid rgba(255,255,255,.14)",
                    ...MONO,
                    fontSize: 11,
                    color: "rgba(255,255,255,.5)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  <span>Component need</span>
                  <span>Verdict</span>
                  <span>File</span>
                  <span>Cost</span>
                  <span>Still in the code?</span>
                </div>
                {ROWS.map((r) => (
                  <div
                    key={r.need}
                    style={{
                      display: "grid",
                      gridTemplateColumns: COLS,
                      gap: 12,
                      padding: "12px 4px",
                      borderBottom: "1px solid rgba(255,255,255,.08)",
                      fontSize: "var(--text-body-sm)",
                      color: "rgba(255,255,255,.85)",
                      alignItems: "center",
                    }}
                  >
                    <span>{r.need}</span>
                    <span>{r.verdict}</span>
                    <span style={{ ...MONO, fontSize: 12, color: "rgba(255,255,255,.6)", wordBreak: "break-word" }}>{r.file}</span>
                    <span style={{ ...MONO, fontSize: 12 }}>{r.cost}</span>
                    <span style={{ color: checked ? (r.stillIn === "Yes" ? "#4fd8a6" : "rgba(255,255,255,.6)") : "rgba(255,255,255,.4)" }}>
                      {checked ? r.stillIn : "not checked"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <p style={{ margin: 0, fontSize: "var(--text-caption)", color: "rgba(255,255,255,.5)" }}>
              Each decision is pinned to a commit and can be exported as a shareable receipt on the PR.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
