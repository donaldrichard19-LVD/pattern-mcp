"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { REPO } from "./constants";
import { BODY, LABEL, SECTION } from "./tokens";
import { Reveal } from "./ui";

function useMonthlyDownloads(): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("https://api.npmjs.org/downloads/point/last-month/pattern-mcp")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && typeof d.downloads === "number" && d.downloads > 0) setN(d.downloads);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return n;
}

export function FounderNote() {
  const downloads = useMonthlyDownloads();
  return (
    <section style={{ padding: "72px 0", borderTop: "1px solid var(--border-subtle)", background: "var(--surface-sunken)" }}>
      <div style={{ ...SECTION, maxWidth: 760, margin: "0 auto", display: "grid", gap: 18 }}>
        <Reveal>
          <span style={LABEL}>Why I built Pattern</span>
        </Reveal>
        <Reveal delay={60}>
          <blockquote style={{ margin: 0, ...BODY, fontSize: "var(--text-body-lg)", color: "var(--text-primary)", fontStyle: "normal" }}>
            &ldquo;I kept watching agents hand-build a price table when a good one already existed, or reach for a
            generic card when the flow deserved real thought. Pattern is the check I wanted between the need and
            the code: specific, honest about what it doesn&apos;t know, and cheap enough to run every time.&rdquo;
          </blockquote>
        </Reveal>
        <Reveal delay={100}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                aria-hidden="true"
                title="Placeholder -- swap for a real photo"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: "var(--border-subtle)",
                  color: "var(--text-secondary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                DR
              </div>
              <div style={{ display: "grid" }}>
                <span style={{ fontSize: "var(--text-body-md)", color: "var(--text-primary)" }}>Don Richard</span>
                <span style={{ fontSize: "var(--text-caption)", color: "var(--text-tertiary)" }}>Creator of Pattern</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {downloads !== null && (
                <span style={{ fontSize: "var(--text-caption)", color: "var(--text-tertiary)" }}>
                  {downloads.toLocaleString()} installs / month
                </span>
              )}
              <a
                href={REPO}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  minHeight: 40,
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-subtle)",
                  background: "#fff",
                  color: "var(--text-primary)",
                  fontSize: "var(--text-body-sm)",
                }}
              >
                <Star size={14} /> Star on GitHub
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
