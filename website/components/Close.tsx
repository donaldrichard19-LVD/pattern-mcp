"use client";

import { DOCS, REPO } from "./constants";
import { BODY, H2, SECTION } from "./tokens";
import { Button, Divider, Mark, Wordmark, trackClick } from "./ui";
import { Reveal } from "./ui";

export function Close() {
  return (
    <footer id="docs" style={{ borderTop: "1px solid var(--border-subtle)", background: "#fff" }}>
      <div className="pt-sec pt-stack" style={{ ...SECTION, padding: "72px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 32 }}>
        <Reveal style={{ maxWidth: 560 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <h2 style={H2}>Agents will keep making UI decisions on their own.</h2>
            <p style={{ ...BODY, fontSize: "var(--text-body-lg)", margin: 0 }}>
              The question is whether you can afford to find out they were wrong after the fact.
            </p>
          </div>
        </Reveal>
        <Reveal delay={100}>
          <div className="pt-stack" style={{ display: "flex", gap: 12, flexShrink: 0, flexWrap: "wrap" }}>
            <Button
              size="lg"
              onClick={() => {
                trackClick("cta_click", { label: "Get the repo", destination: REPO });
                window.open(REPO, "_blank");
              }}
            >
              Get the repo
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => {
                trackClick("cta_click", { label: "Read the docs", destination: DOCS });
                window.open(DOCS, "_blank");
              }}
            >
              Read the docs
            </Button>
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
          <a href={REPO} target="_blank" rel="noreferrer" style={{ color: "var(--text-secondary)" }}>
            GitHub
          </a>
          <a href={DOCS} target="_blank" rel="noreferrer" style={{ color: "var(--text-secondary)" }}>
            Docs
          </a>
          <a href="#reference" style={{ color: "var(--text-secondary)" }}>
            Reference
          </a>
        </div>
        {/* Vercel deploys this website/ directory in isolation, so it can't read
            the pattern-mcp package's version at build time -- update this literal
            by hand alongside each pattern-mcp release. */}
        <span style={{ fontSize: "var(--text-caption)", color: "var(--text-tertiary)" }}>v0.5.0 · MIT · Don Richard</span>
      </div>
    </footer>
  );
}
