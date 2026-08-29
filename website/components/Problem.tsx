"use client";

import { BODY, H2, SECTION } from "./tokens";
import { Reveal } from "./ui";

export function Problem() {
  return (
    <section className="pt-pad-y" style={{ padding: "80px 0", borderTop: "1px solid var(--border-subtle)" }}>
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 20 }}>
        <Reveal>
          <h2 style={{ ...H2, maxWidth: 680 }}>Every UI decision is a decision you haven&apos;t verified</h2>
        </Reveal>
        <Reveal delay={70}>
          <div style={{ display: "grid", gap: 14, maxWidth: 680 }}>
            <p style={{ ...BODY, fontSize: "var(--text-body-lg)" }}>
              An agent can pick a component in seconds. If it&apos;s wrong, you often don&apos;t find out until the
              component is already wired into your product.
            </p>
            <p style={{ ...BODY, fontSize: "var(--text-body-lg)" }}>
              Maybe it misses an important requirement. Maybe it technically works but is far more than your project
              needs. Maybe your agent builds something generic because it never found a better option.
            </p>
            <p style={{ ...BODY, fontSize: "var(--text-body-lg)" }}>
              That&apos;s when the real cost shows up: rework, unnecessary dependencies, and more code to maintain.
            </p>
            <p style={{ ...BODY, fontSize: "var(--text-body-lg)" }}>
              Pattern adds a check before the agent commits. A call costs a few cents and takes about 30 seconds. The
              alternative is discovering the mismatch after the build has already started.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
