"use client";

import { DOCS, QUICKSTART, REPO } from "./constants";
import { H2, SECTION } from "./tokens";
import { CopyBlock, Mark, Reveal, Wordmark, trackClick } from "./ui";

const INSTALL_LINES = ["npx pattern-mcp init --yes"];

const FOOT_LINK = { color: "var(--text-secondary)" } as const;

export function Close() {
  return (
    <>
      <section id="docs" style={{ borderTop: "1px solid var(--border-subtle)", marginTop: 40 }}>
        <div className="pt-sec" style={{ ...SECTION, padding: "88px 32px", display: "flex", flexDirection: "column", alignItems: "center", gap: 26, textAlign: "center" }}>
          <Reveal>
            <div className="pt-assemble" style={{ display: "inline-flex" }}>
              <Mark size={56} />
            </div>
          </Reveal>
          <Reveal delay={60}>
            <h2 style={{ ...H2, fontSize: "clamp(28px, 4.4vw, 40px)", textWrap: "balance", maxWidth: 720 }}>Make your agent follow your design system, languages and themes.</h2>
          </Reveal>
          <p style={{ margin: 0, fontSize: 17, color: "var(--text-secondary)" }}>Install once. Then ask for UI.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", alignItems: "stretch" }}>
            <a
              href={QUICKSTART}
              target="_blank"
              rel="noreferrer"
              onClick={() => trackClick("install_pattern_clicked", { location: "close" })}
              className="pt-btn-primary"
              style={{ background: "var(--blue-500)", color: "#fff", padding: "0 20px", minHeight: 48, display: "flex", alignItems: "center", borderRadius: 8, fontWeight: 500, fontSize: 15, textDecoration: "none" }}
            >
              Install Pattern
            </a>
            <div style={{ minWidth: 260, textAlign: "left" }}>
              <CopyBlock label="install command" lines={INSTALL_LINES} />
            </div>
          </div>
        </div>
      </section>
      <footer style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <div
          className="pt-sec"
          style={{ ...SECTION, padding: "28px 32px", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 16, fontSize: 13, color: "var(--text-tertiary)" }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 24 }}>
            <a href="#top" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none" }}>
              <Mark size={20} />
              <Wordmark size={16} />
            </a>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
              <a href={DOCS} target="_blank" rel="noreferrer" style={FOOT_LINK}>
                Docs
              </a>
              <a href={DOCS} target="_blank" rel="noreferrer" style={FOOT_LINK}>
                Reference
              </a>
              <a href={REPO} target="_blank" rel="noreferrer" style={FOOT_LINK}>
                GitHub
              </a>
              <a href={REPO + "/releases"} target="_blank" rel="noreferrer" style={FOOT_LINK}>
                Changelog
              </a>
            </div>
          </div>
          {/* Vercel deploys this website/ directory in isolation, so it can't read
              the pattern-mcp package's version at build time -- update this literal
              by hand alongside each pattern-mcp release. */}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>v0.21.0 &middot; MIT &middot; Don Richard</span>
        </div>
      </footer>
    </>
  );
}
