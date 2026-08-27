"use client";

import { Activity, CircleSlash, History, Link as LinkIcon, ListChecks, Receipt } from "lucide-react";
import type { ReactNode } from "react";
import { BODY, H2, SECTION } from "./tokens";
import { Reveal } from "./ui";

const CAPS: { icon: ReactNode; h: string; p: [string, string] | [string, string, string] }[] = [
  {
    icon: <ListChecks size={18} />,
    h: "Checks requirements against real evidence",
    p: [
      "Pattern breaks your UI need into specific requirements and checks each one against what it actually finds. It then calculates coverage and uses clear thresholds to recommend an existing component or a custom build.",
      "This is not a similarity score. It is a requirement-by-requirement judgment.",
      "Call extract_requirements on its own to see—or correct—that checklist before Pattern spends its search-and-score budget on it.",
    ],
  },
  {
    icon: <CircleSlash size={18} />,
    h: "Tells you when it finds nothing",
    p: [
      "Sometimes there simply isn't a good candidate.",
      'Pattern keeps no_candidates_found separate from low coverage, so "nothing exists for this" never gets mistaken for "this component is a bad match."',
    ],
  },
  {
    icon: <LinkIcon size={18} />,
    h: "Verifies references before returning them",
    p: [
      "Pattern checks whether a reference link actually points to the screen or flow it identified.",
      "If it can verify a direct link, it returns it. If not, it returns the browse page and clearly tells you that's what you're getting.",
    ],
  },
  {
    icon: <History size={18} />,
    h: "Remembers decisions within a project",
    p: [
      "When you confirm a component decision, Pattern can use it as context for future recommendations in the same project.",
      "It helps keep your UI consistent without locking you into past decisions. Every new recommendation still searches and scores from scratch.",
    ],
  },
  {
    icon: <Activity size={18} />,
    h: "Shows disagreement instead of hiding it",
    p: [
      "When a result is close to a decision threshold, Pattern runs the judgment again and takes the majority.",
      "If the runs genuinely disagree, Pattern shows the split and returns confidence: low instead of pretending the answer is certain.",
    ],
  },
  {
    icon: <Receipt size={18} />,
    h: "Makes costs visible",
    p: [
      "Every response carries its own accounting: time spent, tokens used, and an estimated dollar cost—not just an aggregate budget you have to trust.",
      "Pattern also keeps a local log of every call, limits each session to 40 calls by default, caches repeated instructions, and uses a bounded search budget. Simple primitives are handled locally, so they never reach the API.",
    ],
  },
];

export function Capabilities() {
  return (
    <section id="capabilities" className="pt-pad-y" style={{ padding: "80px 0", borderTop: "1px solid var(--border-subtle)" }}>
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 36 }}>
        <Reveal>
          <div style={{ display: "grid", gap: 12 }}>
            <h2 style={{ ...H2, maxWidth: 620 }}>Capabilities</h2>
            <p style={{ ...BODY, maxWidth: 620, fontSize: "var(--text-body-lg)" }}>
              Pattern evaluates components against your product&apos;s actual requirements, shows the evidence behind each decision, and makes
              uncertainty clear.
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
