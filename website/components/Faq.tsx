"use client";

import { useState } from "react";
import { H2 } from "./tokens";
import { Reveal } from "./ui";

const FAQS: [string, string][] = [
  ["Who is Pattern for?", "Anyone whose agent builds UI against a design system: designers, engineers, and teams reviewing agent-written pull requests."],
  ["Which agents does it work with?", "Claude Code, Cursor, and Codex. The required check on your machine is Claude Code only. The pull request check works with any agent."],
  ["Do I need Figma?", "No. Connect a Figma file, a components folder, a Storybook export, or a JSON manifest."],
  ["What does Haiku do?", "It writes a text summary of each design, which your agent references while it builds."],
  [
    "How do I set it up?",
    "Run one command. Pattern walks you through five steps: add your Anthropic key, add a Figma token if you use Figma, connect your tools, register your design system, and turn on the required check (optional, off by default). Each key is checked on the spot.",
  ],
  ["What can't it verify?", 'How a page renders. "Unverified" means look at this.'],
  ["What if Pattern isn't sure?", "Close calls get a second look. If the runs disagree, you see low confidence and the requirements they split on."],
];

export function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <div className="pt-sec" style={{ maxWidth: 760, margin: "0 auto", padding: "80px 32px", display: "flex", flexDirection: "column", gap: 32 }}>
        <Reveal>
          <h2 style={{ ...H2, lineHeight: 1.1 }}>FAQ</h2>
        </Reveal>
        <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--border-subtle)" }}>
          {FAQS.map(([q, a], i) => {
            const isOpen = open === i;
            const panel = `faq-panel-${i}`;
            return (
              <div key={q} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <button
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  aria-expanded={isOpen}
                  aria-controls={panel}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: 0,
                    cursor: "pointer",
                    padding: "20px 0",
                    minHeight: 44,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 16,
                  }}
                >
                  <span style={{ fontSize: 16, fontWeight: 500, letterSpacing: "-0.008em", color: "var(--text-primary)" }}>{q}</span>
                  <span
                    aria-hidden="true"
                    style={{ flex: "none", fontSize: 18, color: "var(--text-tertiary)", transform: isOpen ? "rotate(45deg)" : "none", transition: "transform .25s ease" }}
                  >
                    +
                  </span>
                </button>
                <div id={panel} role="region" style={{ overflow: "hidden", maxHeight: isOpen ? 240 : 0, transition: "max-height .3s ease" }}>
                  <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)", maxWidth: "36em" }}>{a}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
