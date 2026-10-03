"use client";

import { DOCS, REPO } from "./constants";
import { H2, SECTION } from "./tokens";
import { Button, CopyBlock, Divider, Mark, Wordmark } from "./ui";
import { Reveal } from "./ui";

const INSTALL_LINES = ["npx pattern-mcp init --yes"];

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
            Your agent is going to keep choosing components.{" "}
            <span style={{ color: "var(--text-accent)" }}>Let&apos;s make sure it chooses well.</span>
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <div style={{ display: "grid", gap: 14, justifyItems: "center" }}>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
              <Button href="/#install" size="lg">
                Get started
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
        <span style={{ fontSize: "var(--text-caption)", color: "var(--text-tertiary)" }}>v0.20.0 &middot; MIT &middot; Don Richard</span>
      </div>
    </footer>
  );
}
