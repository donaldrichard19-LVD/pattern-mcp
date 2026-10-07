"use client";

import { useEffect, useState } from "react";
import { LABEL } from "./tokens";
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
    <Reveal>
      <div className="pt-sec" style={{ maxWidth: 760, margin: "0 auto", padding: "56px 32px 0", display: "flex", flexDirection: "column", gap: 16, textAlign: "center", alignItems: "center" }}>
        <div style={LABEL}>Why I built Pattern</div>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, letterSpacing: "-0.008em", color: "var(--text-secondary)", maxWidth: "34em", textWrap: "pretty" }}>
          &ldquo;I kept watching agents hand-build a price table when a good one already existed, or reach for a generic card when the flow needed more
          thought. Pattern is the check I wanted between the product need and the code: specific about what to build, honest about what it doesn&apos;t
          know, and cheap enough to run every time.&rdquo;
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: "4px 10px" }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>Don Richard</span>
          <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>&middot; Creator of Pattern</span>
          {downloads !== null && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-tertiary)" }}>&middot; {downloads.toLocaleString("en-US")} installs/mo</span>
          )}
        </div>
      </div>
    </Reveal>
  );
}
