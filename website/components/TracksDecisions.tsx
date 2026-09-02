"use client";

import { FileText, History, Receipt } from "lucide-react";
import type { ReactNode } from "react";
import { BODY, H2, SECTION } from "./tokens";
import { Reveal } from "./ui";

const CAPS: { icon: ReactNode; h: string; p: [string, string] }[] = [
  {
    icon: <Receipt size={18} />,
    h: "Every decision tracks whether it was actually worth it",
    p: [
      "A verdict alone doesn't say whether it paid off. report_build_cost attaches the real build cost after the fact, and report_outcome_proxy adds a value signal (reworked, time to merge, kept or replaced) computed from your own repo, deliberately independent of Pattern's own verdict.",
      "read_ledger rolls both up per feature, so \"what did this decision cost end to end, and did it hold up\" is one call away, not a guess.",
    ],
  },
  {
    icon: <History size={18} />,
    h: "Old decisions get checked, not just logged",
    p: [
      "Every decision is pinned to the commit it was judged against. check_ledger_liveness can later confirm the file it was implemented in still exists and still uses what was recommended.",
      "sweep_ledger_liveness does the same across a whole project on your own schedule, and flags clusters of decisions that no longer connect to anything live at all.",
    ],
  },
  {
    icon: <FileText size={18} />,
    h: "Any decision can become a record you hand someone",
    p: [
      "export_ledger_provenance turns one decision (checklist, candidates compared, verdict, the exact commit it was judged against) into a single markdown block.",
      "post_ledger_provenance_to_github can attach it straight to the PR or issue it belongs to, so the reasoning behind a UI decision doesn't live only in an agent's chat history.",
    ],
  },
];

export function TracksDecisions() {
  return (
    <section className="pt-pad-y" style={{ padding: "80px 0", borderTop: "1px solid var(--border-subtle)" }}>
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 36 }}>
        <Reveal>
          <div style={{ display: "grid", gap: 12 }}>
            <h2 style={{ ...H2, maxWidth: 680 }}>Your agent made this decision. Here's the paper trail.</h2>
            <p style={{ ...BODY, fontSize: "var(--text-body-lg)", maxWidth: 640, margin: 0 }}>
              Without Pattern, that decision still happens, just with nothing to check afterward. Pattern keeps a
              real record of what was checked, what it cost, and whether it held up.
            </p>
          </div>
        </Reveal>
        <div className="pt-cols-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 28 }}>
          {CAPS.map((c, i) => (
            <Reveal key={c.h} delay={i * 70}>
              <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
                <span style={{ color: "var(--text-accent)" }}>{c.icon}</span>
                <h3 style={{ margin: 0, fontSize: "var(--text-body-lg)", fontWeight: 500, color: "var(--text-primary)", textWrap: "pretty" }}>{c.h}</h3>
                {c.p.map((para, pi) => (
                  <p key={pi} style={{ ...BODY, fontSize: "var(--text-body-sm)" }}>
                    {para}
                  </p>
                ))}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
