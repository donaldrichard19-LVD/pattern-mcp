"use client";

import { Activity, CircleSlash, Link as LinkIcon, Receipt, Scale } from "lucide-react";
import type { ReactNode } from "react";
import { BODY, H2, SECTION } from "./tokens";
import { Reveal } from "./ui";

const CAPS: { icon: ReactNode; h: string; p: [string, string] | [string, string, string] }[] = [
  {
    icon: <Scale size={18} />,
    h: "A technical match can still be the wrong choice",
    p: [
      "A component can satisfy every requirement and still be more than your project needs.",
      "A full data-table library might technically work for a five-row table. That doesn't automatically make it the right decision.",
      "Pattern helps surface the difference between something that qualifies and something that fits the scope of what you're building.",
    ],
  },
  {
    icon: <Activity size={18} />,
    h: "It shows uncertainty instead of hiding it",
    p: [
      "Some decisions are close. When a result lands near a decision threshold, Pattern runs the judgment again. If the results disagree, Pattern reports that disagreement and returns confidence: low.",
      "Your agent sees that the answer is uncertain instead of getting a confidently wrong recommendation.",
    ],
  },
  {
    icon: <CircleSlash size={18} />,
    h: '"Nothing found" is different from "bad match"',
    p: [
      "Sometimes there simply isn't a component that fits.",
      "Pattern keeps no_candidates_found separate from low coverage, so your agent knows whether an option is a weak match or whether nothing like it was found at all.",
    ],
  },
  {
    icon: <LinkIcon size={18} />,
    h: "References are verified before they're returned",
    p: [
      "Pattern checks direct links against pages it actually fetched.",
      "If it can verify the specific screen or file, it returns a direct link. If it only has a browse page, it tells you that clearly.",
    ],
  },
  {
    icon: <Receipt size={18} />,
    h: "Every call shows its cost",
    p: [
      "Pattern makes the cost of each decision visible.",
      "You can see the time, tokens, and estimated API cost instead of working from an opaque usage budget.",
    ],
  },
];

export function AvoidsMistakes() {
  return (
    <section
      className="pt-pad-y"
      style={{
        padding: "80px 0",
        borderTop: "1px solid var(--border-subtle)",
        background: "var(--surface-sunken)",
        backgroundImage: "radial-gradient(680px 280px at 88% 0%, rgba(199,125,10,.14), transparent 70%)",
      }}
    >
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 36 }}>
        <Reveal>
          <div style={{ display: "grid", gap: 18 }}>
            <div style={{ display: "flex", gap: 4 }} aria-hidden="true">
              <span style={{ width: 34, height: 8, borderRadius: 6, background: "var(--amber-500)" }} />
              <span style={{ width: 18, height: 8, borderRadius: 6, background: "var(--amber-500)", opacity: 0.45 }} />
            </div>
            <h2 style={{ ...H2, maxWidth: 680, margin: 0 }}>How Pattern helps avoid costly mistakes</h2>
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
