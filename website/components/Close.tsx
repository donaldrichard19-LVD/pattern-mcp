"use client";

import { DOCS, REPO } from "./constants";
import { BODY, H2, LABEL, PANEL, SECTION } from "./tokens";
import { Button, CopyBlock, Divider, Mark, Wordmark } from "./ui";
import { Reveal } from "./ui";

const INSTALL_LINES = ["npx pattern-mcp init --yes"];

const SETUP_STEPS: { h: string; p: string }[] = [
  { h: "Add your Anthropic key.", p: "Pattern checks it on the spot, so a bad paste shows up now and not in the middle of a build." },
  { h: "Add a Figma token, if your design system lives in Figma.", p: "It gets the same check." },
  { h: "Connect your tools.", p: "Pattern is added to Claude Code, Claude Desktop or Cursor, along with a skill that tells your agent to check before it builds UI." },
  { h: "Register your design system.", p: "Paste a Figma link or point it at your components folder. If a Figma file is huge, the setup offers to leave out the icon pages." },
  { h: "Turn on the required check, or leave it for later.", p: "It is optional and off by default." },
];

export function Close() {
  return (
    <footer id="docs" style={{ borderTop: "1px solid var(--border-subtle)", background: "#fff" }}>
      <div className="pt-sec" style={{ ...SECTION, padding: "80px 32px", display: "grid", justifyItems: "center", gap: 28, textAlign: "center" }}>
        <Reveal>
          <div className="pt-assemble" style={{ display: "inline-flex" }}>
            <Mark size={40} />
          </div>
        </Reveal>
        <Reveal delay={60}>
          <h2 style={{ ...H2, fontSize: "clamp(26px, 4.4vw, 36px)", maxWidth: 640 }}>
            Your agent picks a component for every screen it builds.{" "}
            <span style={{ color: "var(--text-accent)" }}>Make it pick from yours.</span>
          </h2>
        </Reveal>
        <Reveal delay={80}>
          <p style={{ margin: 0, fontSize: "var(--text-body-md)", color: "var(--text-secondary)" }}>
            Install it once. Then just ask for UI.
          </p>
        </Reveal>
        <Reveal delay={90}>
          <div style={{ ...PANEL, background: "var(--surface-sunken)", padding: "22px 24px", maxWidth: 560, width: "100%", textAlign: "left", display: "grid", gap: 14 }}>
            <span style={LABEL}>One command starts a guided setup</span>
            <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 10 }}>
              {SETUP_STEPS.map((st) => (
                <li key={st.h} style={{ ...BODY, fontSize: "var(--text-body-sm)" }}>
                  <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{st.h}</span> {st.p}
                </li>
              ))}
            </ol>
            <p style={{ ...BODY, fontSize: "var(--text-body-sm)", margin: 0 }}>
              The setup lists all five steps up front, then shows how many are done and which come next, so you can see where you are.
            </p>
          </div>
        </Reveal>
        <Reveal delay={100}>
          <div style={{ display: "grid", gap: 14, justifyItems: "center" }}>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
              <Button href="/#install" size="lg">
                Install Pattern
              </Button>
              <div style={{ width: 260 }}>
                <CopyBlock label="install command" lines={INSTALL_LINES} />
              </div>
            </div>
          </div>
        </Reveal>
      </div>
      <Divider />
      <div className="pt-sec" style={{ ...SECTION, padding: "26px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <Mark size={20} />
          <Wordmark size={16} />
        </div>
        <div style={{ display: "flex", gap: 22, fontSize: "var(--text-body-sm)", flexWrap: "wrap" }}>
          <a href={DOCS} target="_blank" rel="noreferrer" style={{ color: "var(--text-secondary)" }}>
            Docs
          </a>
          <a href="/reference" style={{ color: "var(--text-secondary)" }}>
            Reference
          </a>
          <a href={REPO} target="_blank" rel="noreferrer" style={{ color: "var(--text-secondary)" }}>
            GitHub
          </a>
          <a href={REPO + "/releases"} target="_blank" rel="noreferrer" style={{ color: "var(--text-secondary)" }}>
            Changelog
          </a>
        </div>
        {/* Vercel deploys this website/ directory in isolation, so it can't read
            the pattern-mcp package's version at build time -- update this literal
            by hand alongside each pattern-mcp release. */}
        <span style={{ fontSize: "var(--text-caption)", color: "var(--text-tertiary)" }}>v0.21.0 &middot; MIT &middot; Don Richard</span>
      </div>
    </footer>
  );
}
