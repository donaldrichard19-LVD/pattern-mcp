"use client";

import { BODY, H2, SECTION } from "./tokens";
import { Reveal } from "./ui";

export function Transition() {
  return (
    <section className="pt-pad-y" style={{ padding: "80px 0", borderTop: "1px solid var(--border-subtle)" }}>
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 14 }}>
        <Reveal>
          <h2 style={{ ...H2, maxWidth: 680 }}>Find the right component, or know when there isn&apos;t one</h2>
        </Reveal>
        <Reveal delay={70}>
          <p style={{ ...BODY, maxWidth: 680, fontSize: "var(--text-body-lg)" }}>
            Pattern checks real, current evidence before your agent commits to a UI decision. It shows what it found,
            how well it fits, and how confident it is in the result. Because the goal isn&apos;t to give your agent
            better taste. It&apos;s to catch the wrong decision before it&apos;s built.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
