"use client";

import type { CSSProperties } from "react";
import { H2, LABEL, MONO, PANEL, SECTION } from "./tokens";
import { Reveal } from "./ui";

const INPUT_ROWS = [
  ["component_need", "string, required", 'Specific, not a category. "price breakdown with fees and taxes", not "pricing"'],
  ["domain", "string", "The product context the component lives in"],
  ["framework", "string", "e.g. React + Tailwind"],
  ["existing_stack", "string", "e.g. already using shadcn/ui"],
  ["project_id", "string, optional", "Enables per-project decision memory. Omit to skip memory entirely"],
];

const OUTPUT_ROWS = [
  ["verdict", "use_existing | custom_build", "Thresholded in code from the recounted coverage"],
  ["confidence", "high | medium | low", "Forced to low on a genuine 2/3 ensemble split"],
  ["reason", "scored | no_candidates_found | skip_list", "Zero candidates stays distinct from low coverage"],
  ["coverage", '"5/7 (71%)"', "Recomputed from requirements_checked, not taken from the model"],
  ["requirements_checked[]", "requirement, met, evidence", "The checklist, with the evidence behind each judgment"],
  ["recommendation.reference", "object | array | null", "Both sources grounded → array. One → object. Neither → null"],
  ["reference.url_type", "deep_link | entry_point", "Whether the URL is the actual screen or a browse page"],
  ["ensemble", "{ triggered, runs, agreement }", "Present on every response; runs and agreement only when it fired"],
  ["past_decision_signal", "{ considered, note }", "Only when project_id was passed and a real past decision applied"],
];

const CONFIG_ROWS = [
  ["ANTHROPIC_API_KEY", "required", "Your own Console key. Every call bills your account"],
  ["PATTERN_MODEL", "claude-sonnet-5", "Swap models without a code change. Re-run the five test cases first"],
  ["PATTERN_SESSION_CAP", "40", "Per-process call cap, a runaway-agent guard, not a usage budget"],
  ["PATTERN_MEMORY_PATH", "~/.pattern/memory.json", "Where confirmed decisions are stored, local only"],
  ["PATTERN_LOG_PATH", "~/.pattern/calls.log", "One JSON line per API-reaching call, local only"],
];

function Table({ head, rows, mono = 0 }: { head: string[]; rows: string[][]; mono?: number }) {
  return (
    <div className="pt-scroll-x" style={{ ...PANEL, background: "#fff", overflow: "auto" }}>
      <table className="pt-table" style={{ borderCollapse: "collapse", width: "100%", minWidth: 560, fontSize: "var(--text-body-sm)" }}>
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                style={{
                  ...LABEL,
                  textAlign: "left",
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--border-subtle)",
                  background: "var(--surface-sunken)",
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r[0]}>
              {r.map((c, ci) => {
                const cellStyle: CSSProperties = {
                  padding: "11px 14px",
                  verticalAlign: "top",
                  lineHeight: "var(--leading-body)",
                  borderTop: ri === 0 ? "none" : "1px solid var(--border-subtle)",
                  color: ci === 0 ? "var(--text-primary)" : "var(--text-secondary)",
                  ...(ci <= mono ? { ...MONO, fontSize: 11.5, whiteSpace: "nowrap" } : null),
                };
                return (
                  <td key={ci} style={cellStyle}>
                    {c}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Reference() {
  return (
    <section id="reference" className="pt-pad-y" style={{ padding: "80px 0", borderTop: "1px solid var(--border-subtle)" }}>
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 40 }}>
        <Reveal>
          <div style={{ display: "grid", gap: 12 }}>
            <h2 style={{ ...H2, maxWidth: 620 }}>Reference</h2>
          </div>
        </Reveal>
        <Reveal>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={LABEL}>recommend_component input</div>
            <Table head={["Field", "Type", "Notes"]} rows={INPUT_ROWS} mono={1} />
          </div>
        </Reveal>
        <Reveal>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={LABEL}>recommend_component output</div>
            <Table head={["Field", "Values", "Notes"]} rows={OUTPUT_ROWS} mono={1} />
          </div>
        </Reveal>
        <Reveal>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={LABEL}>Configuration</div>
            <Table head={["Env var", "Default", "Notes"]} rows={CONFIG_ROWS} mono={1} />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
