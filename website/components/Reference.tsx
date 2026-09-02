"use client";

import type { CSSProperties } from "react";
import { H2, LABEL, MONO, PANEL, SECTION } from "./tokens";
import { Reveal } from "./ui";

const INPUT_ROWS = [
  ["component_need", "string, required", 'Specific, not a category. "price breakdown with fees and taxes", not "pricing"'],
  ["domain", "string", "The product context the component lives in"],
  ["framework", "string", "e.g. React + Tailwind"],
  ["existing_stack", "string", "e.g. already using shadcn/ui"],
  ["project_id", "string, optional", "Enables per-project decision memory and the ledger. Omit to skip both entirely"],
  ["checklist", "string[], optional", "Skip internal extraction and score against this instead. Pairs with extract_requirements"],
  ["feature_id", "string, optional", "Joins this call's cost with a later report_build_cost/report_outcome_proxy call for the same feature"],
  ["file_path", "string, optional", "Where this decision is expected to be implemented, if known. Enables a later check_ledger_liveness check"],
];

const OUTPUT_ROWS = [
  ["verdict", "use_existing | custom_build", "Thresholded in code from the recounted coverage"],
  ["confidence", "high | medium | low", "Forced to low on a genuine 2/3 ensemble split"],
  ["reason", "scored | no_candidates_found | skip_list | ledger_cache_hit", "Zero candidates stays distinct from low coverage"],
  ["coverage", '"5/7 (71%)"', "Recomputed from requirements_checked, not taken from the model"],
  ["requirements_checked[]", "requirement, met, evidence", "The checklist, with the evidence behind each judgment"],
  ["recommendation.reference", "object | array | null", "Both sources grounded → array. One → object. Neither → null"],
  ["reference.url_type", "deep_link | entry_point", "Whether the URL is the actual screen or a browse page"],
  ["ensemble", "{ triggered, runs, agreement }", "Present on every response; runs and agreement only when it fired"],
  ["past_decision_signal", "{ considered, note }", "Only when project_id was passed and a real past decision applied"],
  ["checklist_source", "extracted | provided", "Which path actually produced the checklist that got scored"],
  ["served_from_ledger", "boolean", "True when this verdict was replayed from a recent, high-confidence ledger entry at $0 instead of freshly scored"],
  ["_meta", "{ total_ms, breakdown_ms, tokens_used, estimated_cost_usd }", "Real timing, tokens, and cost for this call. Summed across all 3 runs when the ensemble fires"],
];

const READ_LEDGER_INPUT_ROWS = [
  ["project_id", "string, required", "The project_id used in prior recommend_component calls"],
  ["component_need", "string, optional", "Keyword filter against stored entries. Omit to list everything for the project"],
  ["limit", "number, optional", "Defaults to 20, most recent first"],
  ["feature_id", "string, optional", "Returns a full cost rollup for one feature instead of a keyword listing"],
];

const READ_LEDGER_OUTPUT_ROWS = [
  ["entries[]", "verdict, confidence, coverage, chosen_candidate, ...", "Distilled fields only — never the raw per-requirement evidence text"],
  ["entries[].snapshot_ref", "string | null", "Commit SHA of the project at the moment this entry was written, or null outside a git repo"],
  ["entries[].live_status", "live | orphaned | unknown | dangling", "Whether file_path (if set) still exists and still references chosen_candidate — see check_ledger_liveness"],
  ["entries[].last_verified_live", "string | null", "Timestamp of the most recent check_ledger_liveness check, or null if never checked"],
  ["total_cost_usd", "number", "Only present when feature_id is passed — judgment cost plus report_build_cost, summed"],
];

const CHECK_LIVENESS_INPUT_ROWS = [
  ["project_id", "string, required", "The project_id whose ledger entries to check"],
  ["ledger_entry_id", "string, optional", "Check just one entry instead of every entry with a file_path set"],
];

const CHECK_LIVENESS_OUTPUT_ROWS = [
  ["checked", "number", "Entries actually checked — entries with no file_path are listed but skipped"],
  ["results[].live_status", "live | orphaned | unknown", "unknown on anything ambiguous, by design — a false orphaned is worse than a lingering unknown"],
  ["results[].note", "string | null", 'e.g. "no file_path recorded on this entry — nothing to check"'],
];

const REPORT_BUILD_COST_INPUT_ROWS = [
  ["feature_id", "string, required", "Same value used in the feature's recommend_component call(s)"],
  ["cost_usd", "number, required", "Your own real spend building this feature end to end"],
  ["outcome", "shipped | abandoned | replaced_with_existing", "What actually happened to this build"],
  ["project_id", "string, optional", "Recommended, so read_ledger's feature_id rollup can find this record"],
];

const REPORT_OUTCOME_INPUT_ROWS = [
  ["feature_id", "string, required", "Same value used in the feature's other calls"],
  ["reworked", "boolean, optional", "Computed by you from real git history — never guessed"],
  ["time_to_merge_hours", "number, optional", "Hours from first commit to merge"],
  ["status_at_30d", "kept | replaced | removed", "Report only once a real ~30-day horizon has passed"],
];

const EXTRACT_INPUT_ROWS = [
  ["component_need", "string, required", "Same field as recommend_component's input"],
  ["domain", "string, required", "Extraction is grounded in this, not the component name alone"],
];

const EXTRACT_OUTPUT_ROWS = [
  ["checklist", "string[]", "Exactly 8 items, ranked most-important first, unless the need hit the skip-list"],
  ["extraction_confidence", "high | medium | low", "A word-count heuristic today, not a calibrated signal. Treat low as a prompt to reread the input"],
  ["_meta", "{ total_ms, tokens_used, estimated_cost_usd }", "No search happens here, so this is typically a few seconds and a fraction of a cent"],
];

const CONFIG_ROWS = [
  ["ANTHROPIC_API_KEY", "required", "Your own Console key. Every call bills your account"],
  ["PATTERN_MODEL", "claude-sonnet-5", "Swap models without a code change. Re-run the five test cases first"],
  ["PATTERN_SESSION_CAP", "40", "Per-process call cap, a runaway-agent guard, not a usage budget"],
  ["PATTERN_MEMORY_PATH", "~/.pattern/memory.json", "Where confirmed decisions are stored, local only"],
  ["PATTERN_LOG_PATH", "~/.pattern/calls.log", "One JSON line per API-reaching call, local only"],
  ["PATTERN_LEDGER_PATH", "~/.pattern/ledger.jsonl", "Every judgment that reaches the API, plus $0 ledger cache hits"],
  ["PATTERN_LEDGER_TTL_DAYS", "30", "How recent a ledger entry must be to serve as a cache hit"],
  ["PATTERN_PROJECT_ROOT", "process.cwd()", "Root check_ledger_liveness reads files from, and snapshot_ref's git commands run in"],
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
            <div style={LABEL}>extract_requirements input — optional, runs extraction on its own</div>
            <Table head={["Field", "Type", "Notes"]} rows={EXTRACT_INPUT_ROWS} mono={1} />
          </div>
        </Reveal>
        <Reveal>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={LABEL}>extract_requirements output</div>
            <Table head={["Field", "Values", "Notes"]} rows={EXTRACT_OUTPUT_ROWS} mono={1} />
          </div>
        </Reveal>
        <Reveal>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={LABEL}>read_ledger input — every past judgment for a project_id</div>
            <Table head={["Field", "Type", "Notes"]} rows={READ_LEDGER_INPUT_ROWS} mono={1} />
          </div>
        </Reveal>
        <Reveal>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={LABEL}>read_ledger output</div>
            <Table head={["Field", "Values", "Notes"]} rows={READ_LEDGER_OUTPUT_ROWS} mono={1} />
          </div>
        </Reveal>
        <Reveal>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={LABEL}>check_ledger_liveness input — is a past decision's file still alive?</div>
            <Table head={["Field", "Type", "Notes"]} rows={CHECK_LIVENESS_INPUT_ROWS} mono={1} />
          </div>
        </Reveal>
        <Reveal>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={LABEL}>check_ledger_liveness output</div>
            <Table head={["Field", "Values", "Notes"]} rows={CHECK_LIVENESS_OUTPUT_ROWS} mono={1} />
          </div>
        </Reveal>
        <Reveal>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={LABEL}>report_build_cost input — self-reported, free</div>
            <Table head={["Field", "Type", "Notes"]} rows={REPORT_BUILD_COST_INPUT_ROWS} mono={1} />
          </div>
        </Reveal>
        <Reveal>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={LABEL}>report_outcome_proxy input — self-reported, free</div>
            <Table head={["Field", "Type", "Notes"]} rows={REPORT_OUTCOME_INPUT_ROWS} mono={1} />
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
