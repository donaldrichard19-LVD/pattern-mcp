"use client";

import { BODY, H2, LABEL, SECTION } from "./tokens";
import { CopyBlock, Reveal } from "./ui";

const INSTALL_LINES = ["npx pattern-mcp init --yes"];

const STEPS: [string, string][] = [
  ["Add your Anthropic key.", "Pattern checks it on the spot, so a bad paste shows up now and not in the middle of a build."],
  ["Add a Figma token, if your design system lives in Figma.", "It gets the same check."],
  ["Connect your tools.", "Pattern is added to Claude Code, Claude Desktop or Cursor, along with a skill that tells your agent to check before it builds UI."],
  ["Register your design system.", "Paste a Figma link or point it at your components folder. If a Figma file is huge, the setup offers to leave out the icon pages."],
  ["Turn on the required check, or leave it for later.", "It is optional and off by default."],
];

export function Setup() {
  return (
    <section style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface-sunken)" }}>
      <div
        className="pt-sec"
        style={{
          ...SECTION,
          padding: "80px 32px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))",
          gap: 56,
          alignItems: "start",
        }}
      >
        <Reveal>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: "30em" }}>
            <div style={LABEL}>Setup</div>
            <h2 style={{ ...H2, lineHeight: 1.1 }}>
              One command. <span style={{ color: "var(--blue-500)" }}>Five guided steps.</span>
            </h2>
            <p style={{ ...BODY, fontSize: "var(--text-body-lg)" }}>
              The setup lists all five steps up front, then shows how many are done and which come next, so you always know where you are.
            </p>
            <CopyBlock label="install command" lines={INSTALL_LINES} />
          </div>
        </Reveal>
        <Reveal delay={80}>
          <ol style={{ listStyle: "none", margin: 0, padding: 28, border: "1px solid var(--border-subtle)", borderRadius: 8, background: "#fff", display: "flex", flexDirection: "column", gap: 22 }}>
            {STEPS.map(([title, body], i) => (
              <li key={title} style={{ display: "flex", gap: 14 }}>
                <span aria-hidden="true" style={{ flex: "none", fontSize: 15, fontWeight: 500, color: "#a9b0bb" }}>
                  {i + 1}.
                </span>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: "var(--text-secondary)" }}>
                  <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>{title}</strong> {body}
                </p>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
