"use client";

import { BookOpen, CircleSlash, History, ListChecks, Search } from "lucide-react";
import type { ReactNode } from "react";
import { BODY, H2, SECTION } from "./tokens";
import { Reveal } from "./ui";

const CAPS: { icon: ReactNode; h: string; p: [string, string] }[] = [
  {
    icon: <ListChecks size={18} />,
    h: "Turns vague needs into clear requirements",
    p: [
      "Pattern turns a UI need into a specific checklist before it searches.",
      'Your agent gets a clearer definition of what the component needs to do instead of guessing what "pricing" or "a table" actually means.',
    ],
  },
  {
    icon: <Search size={18} />,
    h: "Finds and checks real components",
    p: [
      "Pattern searches real component libraries and checks each requirement against the evidence it finds.",
      "It returns a decision your agent can act on immediately: use an existing component or build something custom.",
    ],
  },
  {
    icon: <CircleSlash size={18} />,
    h: "Skips the decisions that don't need checking",
    p: ["Buttons, inputs, badges, and other simple primitives are handled locally.", "No API call. No added cost. No extra wait."],
  },
  {
    icon: <BookOpen size={18} />,
    h: "Gives custom builds a real starting point",
    p: [
      "When nothing fits, Pattern returns a grounded reference from Mobbin or Figma Community.",
      "Your agent builds from a real example instead of starting from a blank page.",
    ],
  },
  {
    icon: <History size={18} />,
    h: "Keeps decisions consistent within a project",
    p: [
      "Confirmed decisions can inform future recommendations in the same project.",
      "Pattern uses that history as context without letting old decisions override better evidence.",
    ],
  },
];

export function SavesTime() {
  return (
    <section
      id="capabilities"
      className="pt-pad-y"
      style={{
        padding: "80px 0",
        borderTop: "1px solid var(--border-subtle)",
        backgroundImage: "radial-gradient(680px 260px at 12% 0%, rgba(14,159,110,.12), transparent 70%)",
      }}
    >
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 36 }}>
        <Reveal>
          <div style={{ display: "grid", gap: 18 }}>
            <div style={{ display: "flex", gap: 4 }} aria-hidden="true">
              <span style={{ width: 34, height: 8, borderRadius: 6, background: "var(--green-500)" }} />
              <span style={{ width: 18, height: 8, borderRadius: 6, background: "var(--green-500)", opacity: 0.45 }} />
            </div>
            <h2 style={{ ...H2, maxWidth: 680, margin: 0 }}>How Pattern saves time</h2>
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
