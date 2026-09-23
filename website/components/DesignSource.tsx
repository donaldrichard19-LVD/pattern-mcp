"use client";

import { Eye, Figma, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { BODY, H2, SECTION } from "./tokens";
import { Reveal } from "./ui";

const CAPS: { icon: ReactNode; h: string; p: [string, string] | [string, string, string] }[] = [
  {
    icon: <Figma size={18} />,
    h: "Register a Figma file directly",
    p: [
      "register_design_system takes figma_file_key or a saved figma_json_path — no export step, no code required.",
      "Works on files built with real Figma components, and on files that only use plain frames and groups.",
    ],
  },
  {
    icon: <Eye size={18} />,
    h: "It reads what's drawn, not just what's named",
    p: [
      "Layer and page names alone get some needs right and miss the rest — names can't say what's actually rendered.",
      "An opt-in Claude vision caption of each design closes that gap, at a measured cost of about $0.04 for 43 designs.",
      "Opt-in only: it sends images of your designs to Anthropic, and is refused when you register from a saved local file instead of a live one.",
    ],
  },
  {
    icon: <ShieldCheck size={18} />,
    h: "Checked before a single component gets built",
    p: [
      "Point Pattern at the Figma file your team already maintains, and an agent's UI plan gets scored against it before any code exists to check against.",
      "The same verdict, ledger, and enforcement boundary that already cover a code-based design system apply here too.",
    ],
  },
];

export function DesignSource() {
  return (
    <section
      className="pt-pad-y"
      style={{
        padding: "80px 0",
        borderTop: "1px solid var(--border-subtle)",
        backgroundImage: "radial-gradient(680px 280px at 12% 0%, rgba(26,115,232,.10), transparent 70%)",
      }}
    >
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 36 }}>
        <Reveal>
          <div style={{ display: "grid", gap: 18 }}>
            <div style={{ display: "flex", gap: 4 }} aria-hidden="true">
              <span style={{ width: 34, height: 8, borderRadius: 6, background: "var(--blue-500)" }} />
              <span style={{ width: 18, height: 8, borderRadius: 6, background: "var(--blue-500)", opacity: 0.45 }} />
            </div>
            <h2 style={{ ...H2, maxWidth: 680, margin: 0 }}>Your design system doesn&apos;t have to be code yet</h2>
          </div>
        </Reveal>
        <div className="pt-cols-3" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 28 }}>
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
