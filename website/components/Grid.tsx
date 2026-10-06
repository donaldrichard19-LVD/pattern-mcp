"use client";

import { H2, MONO, SECTION } from "./tokens";
import { Reveal } from "./ui";

const ITEMS: [string, string, string][] = [
  ["◻", "Your design system", "A Figma file, components folder, Storybook export, or JSON manifest. Registered once, and the only source Pattern judges against."],
  ["≈", "Design summaries", "Haiku writes a text summary of each design, so your agent has it in words while it builds."],
  ["⇄", "Reuse or build", "A plain answer for every request: use this component, or build these missing pieces."],
  ["☰", "Requirements", "Each one is tagged as yours, inferred, or general practice."],
  ["✓", "Verified code", "Every pass comes with a quote from your file, confirmed by the server."],
  ["◆", "Required check", "Agents can't create a component until Pattern answers."],
  ["▤", "Decision record", "What was checked, what was decided, and what it cost, tied to a version of your code."],
  ["$", "Cost and confidence", "Time, tokens, and dollars beside every decision. Low confidence when runs disagree."],
];

export function Grid() {
  return (
    <section style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface-sunken)" }}>
      <div className="pt-sec pt-pad-y" style={{ ...SECTION, padding: "80px 32px" }}>
        <Reveal>
          <h2 style={{ ...H2, marginBottom: 40, maxWidth: "18em", lineHeight: 1.1 }}>Everything between the design and the code.</h2>
        </Reveal>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 250px), 1fr))",
            gap: 1,
            background: "var(--border-subtle)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          {ITEMS.map(([glyph, title, body]) => (
            <div key={title} style={{ background: "#fff", padding: 24, display: "flex", flexDirection: "column", gap: 10 }}>
              <div aria-hidden="true" style={{ ...MONO, fontSize: 14, color: "var(--text-accent)" }}>
                {glyph}
              </div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500, letterSpacing: "-0.006em" }}>{title}</h3>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary)" }}>{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
