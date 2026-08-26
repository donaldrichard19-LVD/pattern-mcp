"use client";

import { Activity, CircleSlash, History, Link as LinkIcon, ListChecks, Receipt } from "lucide-react";
import type { ReactNode } from "react";
import { BODY, H2, LABEL, SECTION } from "./tokens";
import { Reveal } from "./ui";

const CAPS: { icon: ReactNode; h: string; p: string }[] = [
  {
    icon: <ListChecks size={18} />,
    h: "Requirement coverage, scored against evidence",
    p: "Each requirement is checked against something the search actually found, then recounted in code and thresholded into a verdict. This is not a similarity ranking",
  },
  {
    icon: <CircleSlash size={18} />,
    h: "Zero candidates stays its own answer",
    p: 'no_candidates_found stays distinct from low coverage, so "nothing exists for this" never gets turned into a bad match',
  },
  {
    icon: <LinkIcon size={18} />,
    h: "References that are verified, not implied",
    p: "A deep link survives only if it appears on a page the server fetched. Otherwise you get the browse page and a note saying exactly what it is",
  },
  {
    icon: <History size={18} />,
    h: "Per-project decision memory",
    p: "Confirmed decisions become a consistency signal on later calls. Coverage is still recomputed every time, and verdicts are never cached",
  },
  {
    icon: <Activity size={18} />,
    h: "Disagreement is disclosed, not smoothed",
    p: 'Near a verdict threshold, the judgment runs again and takes the majority. A genuine 2/3 split returns confidence: low with the runs attached',
  },
  {
    icon: <Receipt size={18} />,
    h: "Costs you can see",
    p: "A local call log for each API-reaching call, a 40-call session cap, prompt caching, and a bounded search budget. Skip-listed primitives never reach the API",
  },
];

export function Capabilities() {
  return (
    <section id="capabilities" className="pt-pad-y" style={{ padding: "80px 0", borderTop: "1px solid var(--border-subtle)" }}>
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 36 }}>
        <Reveal>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={LABEL}>Capabilities</div>
            <h2 style={{ ...H2, maxWidth: 620 }}>The design judgment happens here, and every part is visible in the output</h2>
          </div>
        </Reveal>
        <div className="pt-cols-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 28 }}>
          {CAPS.map((c, i) => (
            <Reveal key={c.h} delay={i * 70}>
              <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
                <span style={{ color: "var(--text-accent)" }}>{c.icon}</span>
                <h3 style={{ margin: 0, fontSize: "var(--text-body-lg)", fontWeight: 500, color: "var(--text-primary)", textWrap: "pretty" }}>{c.h}</h3>
                <p style={{ ...BODY, fontSize: "var(--text-body-sm)" }}>{c.p}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
