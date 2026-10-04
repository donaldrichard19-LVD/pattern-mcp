"use client";

import { BODY, H2, LABEL, PANEL, SECTION } from "./tokens";
import { CopyBlock, Reveal } from "./ui";

const SETUP_STEPS: { h: string; p: string }[] = [
  { h: "Add your Anthropic key.", p: "Pattern checks it on the spot, so a bad paste shows up now and not in the middle of a build." },
  { h: "Add a Figma token, if your design system lives in Figma.", p: "It gets the same check." },
  { h: "Connect your tools.", p: "Pattern is added to Claude Code, Claude Desktop or Cursor, along with a skill that tells your agent to check before it builds UI." },
  { h: "Register your design system.", p: "Paste a Figma link or point it at your components folder. If a Figma file is huge, the setup offers to leave out the icon pages." },
  { h: "Turn on the required check, or leave it for later.", p: "It is optional and off by default." },
];

export function Setup() {
  return (
    <section id="setup" style={{ padding: "80px 0", borderTop: "1px solid var(--border-subtle)", background: "var(--surface-sunken)" }}>
      <div className="pt-cols-2" style={{ ...SECTION, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "start" }}>
        <Reveal>
          <div style={{ display: "grid", gap: 14 }}>
            <span style={LABEL}>Setup</span>
            <h2 style={{ ...H2, fontSize: "clamp(24px, 3.6vw, 30px)" }}>
              One command. <span style={{ color: "var(--text-accent)" }}>Five guided steps.</span>
            </h2>
            <p style={{ ...BODY, fontSize: "var(--text-body-md)" }}>
              The setup lists all five steps up front, then shows how many are done and which come next, so you
              always know where you are.
            </p>
            <div style={{ maxWidth: 360 }}>
              <CopyBlock label="install command" lines={["npx pattern-mcp init --yes"]} />
            </div>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <ol style={{ ...PANEL, background: "#fff", margin: 0, padding: "20px 22px 20px 44px", display: "grid", gap: 14 }}>
            {SETUP_STEPS.map((st) => (
              <li key={st.h} style={{ ...BODY, fontSize: "var(--text-body-sm)" }}>
                <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{st.h}</span> {st.p}
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
