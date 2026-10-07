"use client";

import { H2, MONO } from "./tokens";
import { Reveal } from "./ui";

const TILES: [string, string][] = [
  ["<1s", "A match with a TypeSafe key, no Anthropic call"],
  ["¢", "A full check with a build list"],
  ["$0", "Common basics, on your machine"],
];

export function Cost() {
  return (
    <section style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface-sunken)" }}>
      <div className="pt-sec" style={{ maxWidth: 860, margin: "0 auto", padding: "80px 32px", display: "flex", flexDirection: "column", gap: 28 }}>
        <Reveal>
          <h2 style={{ ...H2, lineHeight: 1.1 }}>Pay per check.</h2>
        </Reveal>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: "var(--text-secondary)", maxWidth: "34em", textWrap: "pretty" }}>
          Pattern is MIT licensed, and checks use your Anthropic key. A full check with a build list usually runs a few cents. With a TypeSafe key,
          a match is scored in under a second with no Anthropic call. Common basics like buttons and inputs are answered on your machine for free.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 1, background: "var(--border-subtle)", border: "1px solid var(--border-subtle)", borderRadius: 10, overflow: "hidden" }}>
          {TILES.map(([big, label], i) => (
            <div key={i} style={{ flex: 1, minWidth: 180, background: "#fff", padding: 20, display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ ...MONO, fontSize: 20, color: "var(--text-accent)" }}>{big}</span>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
