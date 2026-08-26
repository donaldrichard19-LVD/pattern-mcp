"use client";

import { Check } from "lucide-react";
import { DOCS } from "./constants";
import { H2, SECTION } from "./tokens";
import { Button, Reveal } from "./ui";

const AUDIENCES = [
  {
    points: [
      "One config block, any MCP client. It's a standard server, not a plugin for one tool",
      "Your agent stops inventing generic UI when something real already fits",
      "Every verdict is readable: the checklist, coverage, evidence, and timestamp",
      "Five validated test cases let you sanity-check the tool before trusting it on your own work",
    ],
    cta: "Read the setup",
    href: DOCS,
  },
];

export function Audiences() {
  return (
    <section id="audiences" className="pt-pad-y" style={{ padding: "80px 0", borderTop: "1px solid var(--border-subtle)" }}>
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 48, maxWidth: 720 }}>
        <Reveal>
          <h2 style={H2}>Who it&apos;s for</h2>
        </Reveal>
        {AUDIENCES.map((a, i) => (
          <Reveal key={a.cta} delay={i * 100}>
            <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
              <div style={{ display: "grid", gap: 10, marginTop: 2 }}>
                {a.points.map((p) => (
                  <div key={p} style={{ display: "flex", gap: 9, fontSize: "var(--text-body-md)", color: "var(--text-secondary)", lineHeight: "var(--leading-body)" }}>
                    <Check size={16} style={{ color: "var(--text-success)", flexShrink: 0, marginTop: 3 }} />
                    <span style={{ textWrap: "pretty" }}>{p}</span>
                  </div>
                ))}
              </div>
              <div>
                <Button variant="secondary" onClick={() => window.open(a.href, "_blank")} style={{ marginTop: 4 }}>
                  {a.cta}
                </Button>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
