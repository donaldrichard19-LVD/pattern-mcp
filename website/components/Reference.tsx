"use client";

import { useMemo, useState } from "react";
import { H2, LABEL, SECTION } from "./tokens";
import { Reveal } from "./ui";

type Row = [string, string, string];

const RECORD_DECISION_INPUT_ROWS: Row[] = [
  ["project_id", "string, required", "Stable per project: a directory path or project name works well"],
  ["component_need", "string, required", "The same need passed to recommend_component"],
  ["action", "installed | custom_built", "What the agent actually did with the verdict"],
  ["source", "shadcn | 21st.dev | reui | custom", "Where the installed component came from, or custom for a build"],
  ["time_saved_minutes", "number, optional", "Your own estimate, self-reported, never computed or verified by Pattern"],
];

const RECORD_DECISION_OUTPUT_ROWS: Row[] = [
  ["status", '"recorded"', "Confirms the decision was saved"],
  ["entry", "object", "The stored decision, including project_id and the fields above"],
];

const INPUT_ROWS: Row[] = [
  ["component_need", "string, required", 'Specific, not a category. "price breakdown with fees and taxes", not "pricing"'],
  ["domain", "string", "The product context the component lives in"],
  ["framework", "string", "e.g. React + Tailwind"],
  ["existing_stack", "string", "e.g. already using shadcn/ui"],
  ["project_id", "string, optional", "Enables per-project decision memory and the ledger. Omit to skip both entirely"],
  ["checklist", "string[], optional", "Skip internal extraction and score against this instead. Pairs with extract_requirements"],
  ["feature_id", "string, optional", "Joins this call's cost with a later report_build_cost/report_outcome_proxy call for the same feature"],
  ["file_path", "string, optional", "Where this decision is expected to be implemented, if known. Enables a later check_ledger_liveness check"],
];

const OUTPUT_ROWS: Row[] = [
  ["verdict", "use_existing | custom_build", "Thresholded in code from the recounted coverage"],
  ["confidence", "high | medium | low", "Forced to low on a genuine 2/3 ensemble split"],
  ["reason", "scored | no_candidates_found | skip_list | ledger_cache_hit", "Zero candidates stays distinct from low coverage"],
  ["coverage", '"5/7 (71%)"', "Recomputed from requirements_checked, not taken from the model"],
  ["computed_at", '"2026-08-25"', "Coverage is a snapshot at this point in time, not a permanent fact — component libraries change"],
  ["requirements_checked[]", "requirement, met, evidence", "The checklist, with the evidence behind each judgment"],
  ["recommendation.reference", "object | array | null", "Both sources grounded → array. One → object. Neither → null"],
  ["reference.url_type", "deep_link | entry_point", "Whether the URL is the actual screen or a browse page"],
  ["ensemble", "{ triggered, runs, agreement }", "Present on every response; runs and agreement only when it fired"],
  ["past_decision_signal", "{ considered, note }", "Only when project_id was passed and a real past decision applied"],
  ["checklist_source", "extracted | provided", "Which path actually produced the checklist that got scored"],
  ["served_from_ledger", "boolean", "True when this verdict was replayed from a recent, high-confidence ledger entry at $0 instead of freshly scored"],
  ["design_system_recall_check", "{ possible_missed_candidates, note } | absent", "Design-system mode only: present when a custom_build/no_candidates_found verdict shares real keywords with a registered candidate it didn't select. A hint to double-check, never an override of the verdict"],
  ["_meta", "{ total_ms, breakdown_ms, tokens_used, estimated_cost_usd }", "Real timing, tokens, and cost for this call. Summed across all 3 runs when the ensemble fires"],
];

const READ_LEDGER_INPUT_ROWS: Row[] = [
  ["project_id", "string, required", "The project_id used in prior recommend_component calls"],
  ["component_need", "string, optional", "Keyword filter against stored entries. Omit to list everything for the project"],
  ["limit", "number, optional", "Defaults to 20, most recent first"],
  ["feature_id", "string, optional", "Returns a full cost rollup for one feature instead of a keyword listing"],
];

const READ_LEDGER_OUTPUT_ROWS: Row[] = [
  ["entries[]", "verdict, confidence, coverage, chosen_candidate, ...", "Distilled fields only, never the raw per-requirement evidence text"],
  ["entries[].snapshot_ref", "string | null", "Commit SHA of the project at the moment this entry was written, or null outside a git repo"],
  ["entries[].live_status", "live | orphaned | unknown | dangling", "Whether file_path (if set) still exists and still references chosen_candidate. See check_ledger_liveness"],
  ["entries[].last_verified_live", "string | null", "Timestamp of the most recent check_ledger_liveness check, or null if never checked"],
  ["total_cost_usd", "number", "Only present when feature_id is passed: judgment cost plus report_build_cost, summed"],
];

const CHECK_LIVENESS_INPUT_ROWS: Row[] = [
  ["project_id", "string, required", "The project_id whose ledger entries to check"],
  ["ledger_entry_id", "string, optional", "Check just one entry instead of every entry with a file_path set"],
];

const CHECK_LIVENESS_OUTPUT_ROWS: Row[] = [
  ["checked", "number", "Entries actually checked; entries with no file_path are listed but skipped"],
  ["results[].live_status", "live | orphaned | unknown", "unknown on anything ambiguous, by design: a false orphaned is worse than a lingering unknown"],
  ["results[].note", "string | null", 'e.g. "no file_path recorded on this entry, nothing to check"'],
];

const REPORT_BUILD_COST_INPUT_ROWS: Row[] = [
  ["feature_id", "string, required", "Same value used in the feature's recommend_component call(s)"],
  ["cost_usd", "number, required", "Your own real spend building this feature end to end"],
  ["outcome", "shipped | abandoned | replaced_with_existing", "What actually happened to this build"],
  ["project_id", "string, optional", "Recommended, so read_ledger's feature_id rollup can find this record"],
];

const REPORT_OUTCOME_INPUT_ROWS: Row[] = [
  ["feature_id", "string, required", "Same value used in the feature's other calls"],
  ["reworked", "boolean, optional", "Computed by you from real git history, never guessed"],
  ["time_to_merge_hours", "number, optional", "Hours from first commit to merge"],
  ["status_at_30d", "kept | replaced | removed", "Report only once a real ~30-day horizon has passed"],
];

const EXPORT_PROVENANCE_INPUT_ROWS: Row[] = [
  ["project_id", "string, required", "The project_id used in the recommend_component call that produced this entry"],
  ["ledger_entry_id", "string, required", "The specific entry to export, from read_ledger or check_ledger_liveness"],
];

const EXPORT_PROVENANCE_OUTPUT_ROWS: Row[] = [
  ["markdown", "string", "Checklist, candidates compared, verdict, confidence, and snapshot_ref as one markdown block"],
];

const POST_PROVENANCE_INPUT_ROWS: Row[] = [
  ["project_id", "string, required", "The project_id used in the recommend_component call that produced this entry"],
  ["ledger_entry_id", "string, required", "The specific entry to post"],
  ["repo", "string, required", 'GitHub repo in "owner/repo" form'],
  ["issue_number", "number, required", "The PR or issue number to comment on; GitHub treats both identically"],
];

const POST_PROVENANCE_OUTPUT_ROWS: Row[] = [
  ["posted", "boolean", "false when a matching comment already exists (idempotent, never double-posts)"],
  ["comment_url", "string", "The new or existing comment's URL"],
  ["reason", '"already_posted" | undefined', "Present only when posted is false"],
];

const SWEEP_LIVENESS_INPUT_ROWS: Row[] = [["project_id", "string, optional", "Omit to sweep every project_id present in the ledger in one call"]];

const SWEEP_LIVENESS_OUTPUT_ROWS: Row[] = [
  ["projects_swept", "number", "How many project_ids were covered"],
  ["total_entries_checked", "number", "Sum of checked across all swept projects"],
  ["dangling_clusters", "{ project_id, feature_id, entry_ids }[]", "2+ entries sharing a feature_id where none resolved to live_status live"],
  ["per_project", "{ project_id, checked, total_entries, dangling_clusters }[]", "Per-project breakdown"],
];

const BACKFILL_INPUT_ROWS: Row[] = [
  ["project_id", "string, required", "The project_id whose ledger entries to backfill"],
  ["ledger_entry_id", "string, optional", "Omit to backfill every entry in the project missing snapshot_ref"],
];

const BACKFILL_OUTPUT_ROWS: Row[] = [
  ["attempted", "number", "Entries missing snapshot_ref that backfill actually tried (entries with a real one are skipped)"],
  ["reconstructed", "number", "How many of those attempts found a commit"],
  ["results[].reconstructed_snapshot_ref", "string | null", "Always labeled as reconstructed wherever rendered, never presented as a real captured snapshot_ref"],
];

const EXTRACT_INPUT_ROWS: Row[] = [
  ["component_need", "string, required", "Same field as recommend_component's input"],
  ["domain", "string, required", "Extraction is grounded in this, not the component name alone"],
];

const EXTRACT_OUTPUT_ROWS: Row[] = [
  ["checklist", "string[]", "Exactly 8 items, ranked most-important first, unless the need hit the skip-list"],
  ["extraction_confidence", "high | medium | low", "A word-count heuristic today, not a calibrated signal. Treat low as a prompt to reread the input"],
  ["_meta", "{ total_ms, tokens_used, estimated_cost_usd }", "No search happens here, so this is typically a few seconds and a fraction of a cent"],
];

const REGISTER_DESIGN_SYSTEM_INPUT_ROWS: Row[] = [
  ["project_id", "string, required", "Must match the project_id used in later recommend_component calls"],
  ["manifest_path", "string, optional", "A hand-authored JSON manifest or a Storybook-exported stories/index file, relative to the project root"],
  ["directory_path", "string, optional", "A real components folder, scanned for exported components and their props. Exactly one of manifest_path or directory_path is required"],
];

const REGISTER_DESIGN_SYSTEM_OUTPUT_ROWS: Row[] = [
  ["status", '"registered"', "Confirms the registration was saved"],
  ["registration.source_kind", "manifest | directory_scan", "Which input mode produced this registration"],
  ["registration.candidate_count", "number", "How many components were found"],
  ["registration.candidates[]", "name, props, description, usage_example, file_path", "The full list, so you can sanity-check what got captured before it's scored against"],
];

const CONFIG_ROWS: Row[] = [
  ["ANTHROPIC_API_KEY", "required", "Your own Console key. Every call bills your account"],
  ["PATTERN_MODEL", "claude-sonnet-5", "Swap models without a code change. Re-run the five test cases first"],
  ["PATTERN_SESSION_CAP", "40", "Per-process call cap, a runaway-agent guard, not a usage budget"],
  ["PATTERN_MEMORY_PATH", "~/.pattern/memory.json", "Where confirmed decisions are stored, local only"],
  ["PATTERN_LOG_PATH", "~/.pattern/calls.log", "One JSON line per API-reaching call, local only"],
  ["PATTERN_LEDGER_PATH", "~/.pattern/ledger.jsonl", "Every judgment that reaches the API, plus $0 ledger cache hits"],
  ["PATTERN_LEDGER_TTL_DAYS", "30", "How recent a ledger entry must be to serve as a cache hit"],
  ["PATTERN_PROJECT_ROOT", "process.cwd()", "Root check_ledger_liveness reads files from, and snapshot_ref's git commands run in"],
  ["GITHUB_TOKEN", "required for post_ledger_provenance_to_github", "Personal access token, repo scope. Not needed for any other tool"],
  ["PATTERN_SNAPSHOT_BACKFILL_PATH", "~/.pattern/snapshot_backfill.jsonl", "Every backfill_ledger_snapshot_ref attempt, including failures"],
  ["PATTERN_DESIGN_SYSTEMS_PATH", "~/.pattern/design_systems.json", "Registered design systems, one per project_id, local only"],
];

type Group = "Make the judgment call" | "Track cost and outcome" | "Verify and export later";

type Tool = {
  name: string;
  group: Group;
  cost: "API call" | "free";
  description: string;
  inputRows: Row[];
  outputRows: Row[];
};

const TOOLS: Tool[] = [
  {
    name: "recommend_component",
    group: "Make the judgment call",
    cost: "API call",
    description: "Checks a UI component need against real evidence and returns one verdict: use an existing component, or build custom from a grounded reference.",
    inputRows: INPUT_ROWS,
    outputRows: OUTPUT_ROWS,
  },
  {
    name: "extract_requirements",
    group: "Make the judgment call",
    cost: "API call",
    description: "Optional standalone step: runs the requirement-extraction that recommend_component does internally, without scoring any candidates.",
    inputRows: EXTRACT_INPUT_ROWS,
    outputRows: EXTRACT_OUTPUT_ROWS,
  },
  {
    name: "register_design_system",
    group: "Make the judgment call",
    cost: "free",
    description: "Points recommend_component at your own design system — a manifest, a Storybook export, or a real component directory — instead of shadcn/ui, 21st.dev, and ReUI. Never calls the Anthropic API.",
    inputRows: REGISTER_DESIGN_SYSTEM_INPUT_ROWS,
    outputRows: REGISTER_DESIGN_SYSTEM_OUTPUT_ROWS,
  },
  {
    name: "record_component_decision",
    group: "Track cost and outcome",
    cost: "free",
    description: "Call after acting on a verdict, not on every call — records what the agent actually did with it.",
    inputRows: RECORD_DECISION_INPUT_ROWS,
    outputRows: RECORD_DECISION_OUTPUT_ROWS,
  },
  {
    name: "read_ledger",
    group: "Track cost and outcome",
    cost: "free",
    description: "Lists every past judgment for a project_id, or rolls up the full cost and outcome history for one feature_id.",
    inputRows: READ_LEDGER_INPUT_ROWS,
    outputRows: READ_LEDGER_OUTPUT_ROWS,
  },
  {
    name: "report_build_cost",
    group: "Track cost and outcome",
    cost: "free",
    description: "Self-reported, free. Attaches the real cost of building a feature end to end, after the fact.",
    inputRows: REPORT_BUILD_COST_INPUT_ROWS,
    outputRows: [],
  },
  {
    name: "report_outcome_proxy",
    group: "Track cost and outcome",
    cost: "free",
    description: "Self-reported, free. Adds a value signal — reworked, time to merge, kept or replaced — computed from your own git history.",
    inputRows: REPORT_OUTCOME_INPUT_ROWS,
    outputRows: [],
  },
  {
    name: "check_ledger_liveness",
    group: "Verify and export later",
    cost: "free",
    description: "Is a past decision's file still alive? Confirms file_path still exists and still references what was recommended.",
    inputRows: CHECK_LIVENESS_INPUT_ROWS,
    outputRows: CHECK_LIVENESS_OUTPUT_ROWS,
  },
  {
    name: "sweep_ledger_liveness",
    group: "Verify and export later",
    cost: "free",
    description: "Batch/scheduled, meant for your own cron or CI. Runs check_ledger_liveness across a whole project and flags dangling clusters.",
    inputRows: SWEEP_LIVENESS_INPUT_ROWS,
    outputRows: SWEEP_LIVENESS_OUTPUT_ROWS,
  },
  {
    name: "export_ledger_provenance",
    group: "Verify and export later",
    cost: "free",
    description: "Turns one decision into a paste-able markdown block: checklist, candidates compared, verdict, and the commit it was judged against.",
    inputRows: EXPORT_PROVENANCE_INPUT_ROWS,
    outputRows: EXPORT_PROVENANCE_OUTPUT_ROWS,
  },
  {
    name: "backfill_ledger_snapshot_ref",
    group: "Verify and export later",
    cost: "free",
    description: "Reconstructs a snapshot_ref for entries written before this feature shipped, so liveness checks work retroactively.",
    inputRows: BACKFILL_INPUT_ROWS,
    outputRows: BACKFILL_OUTPUT_ROWS,
  },
  {
    name: "post_ledger_provenance_to_github",
    group: "Verify and export later",
    cost: "free",
    description: "The one tool here with a real, visible side effect off your machine — attaches an exported decision straight to a PR or issue.",
    inputRows: POST_PROVENANCE_INPUT_ROWS,
    outputRows: POST_PROVENANCE_OUTPUT_ROWS,
  },
];

const GROUPS: Group[] = ["Make the judgment call", "Track cost and outcome", "Verify and export later"];

function inferType(field: string, valueCol: string, notes: string, isOutput: boolean): string {
  if (field.endsWith("[]")) return "array";
  const notesTrim = notes.trim();
  const valueTrim = valueCol.trim();
  if (notesTrim.startsWith("{") || valueTrim.startsWith("{")) return "object";
  const hay = (valueCol + " " + notes).toLowerCase();
  if (/\bboolean\b/.test(hay)) return "boolean";
  if (/\bnumber\b/.test(hay)) return "number";
  if (/\bstring\b/.test(hay)) return "string";
  return isOutput ? "result" : "string";
}

type FieldRow = { field: string; type: string; notes: string; isOutput: boolean };

function mergedRows(tool: Tool): FieldRow[] {
  const input = tool.inputRows.map(([field, valueCol, notes]) => ({
    field,
    type: inferType(field, valueCol, notes, false),
    notes,
    isOutput: false,
  }));
  const output = tool.outputRows.map(([field, valueCol, notes]) => ({
    field: "→ " + field,
    type: inferType(field, valueCol, notes, true),
    notes,
    isOutput: true,
  }));
  return [...input, ...output];
}

function FieldTable({ tool }: { tool: Tool }) {
  const rows = mergedRows(tool);
  return (
    <div role="table" aria-label={tool.name + " fields"} style={{ border: "1px solid var(--border-subtle)", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
      <div
        role="row"
        style={{
          display: "grid",
          gridTemplateColumns: "220px 96px 1fr",
          gap: 16,
          padding: "10px 16px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--surface-sunken)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "var(--tracking-caps)",
          color: "var(--text-tertiary)",
        }}
      >
        <span role="columnheader">field</span>
        <span role="columnheader">type</span>
        <span role="columnheader">notes</span>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.field + i}
          role="row"
          style={{
            display: "grid",
            gridTemplateColumns: "220px 96px 1fr",
            gap: 16,
            padding: "10px 16px",
            borderBottom: i === rows.length - 1 ? "none" : "1px solid #eef1f4",
            alignItems: "baseline",
          }}
        >
          <span
            role="cell"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              wordBreak: "break-all",
              color: r.isOutput ? "var(--text-accent)" : "var(--text-primary)",
            }}
          >
            {r.field}
          </span>
          <span role="cell" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-tertiary)" }}>
            {r.type}
          </span>
          <span role="cell" style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)" }}>
            {r.notes}
          </span>
        </div>
      ))}
    </div>
  );
}

function ConfigTable() {
  return (
    <div className="pt-scroll-x" style={{ border: "1px solid var(--border-subtle)", borderRadius: 12, background: "#fff", overflow: "auto" }}>
      <table className="pt-table" style={{ borderCollapse: "collapse", width: "100%", minWidth: 560, fontSize: "var(--text-body-sm)" }}>
        <thead>
          <tr>
            {["Env var", "Default", "Notes"].map((h) => (
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
          {CONFIG_ROWS.map((r, ri) => (
            <tr key={r[0]}>
              {r.map((c, ci) => (
                <td
                  key={ci}
                  style={{
                    padding: "11px 14px",
                    verticalAlign: "top",
                    lineHeight: "var(--leading-body)",
                    borderTop: ri === 0 ? "none" : "1px solid var(--border-subtle)",
                    color: ci === 0 ? "var(--text-primary)" : "var(--text-secondary)",
                    ...(ci <= 1 ? { fontFamily: "var(--font-mono)", fontSize: 11.5, whiteSpace: "nowrap" as const } : null),
                  }}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Reference() {
  const [filter, setFilter] = useState("");
  const [activeGroups, setActiveGroups] = useState<Set<Group>>(new Set());
  const [selected, setSelected] = useState(TOOLS[0].name);

  const toggleGroup = (g: Group) => {
    setActiveGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return TOOLS.filter((t) => {
      const matchesQuery = !q || t.name.toLowerCase().includes(q);
      const matchesGroup = activeGroups.size === 0 || activeGroups.has(t.group);
      return matchesQuery && matchesGroup;
    });
  }, [filter, activeGroups]);

  const selectedTool = TOOLS.find((t) => t.name === selected) ?? filtered[0] ?? TOOLS[0];

  return (
    <section id="reference" className="pt-pad-y" style={{ padding: "64px 0", borderTop: "1px solid var(--border-subtle)", background: "var(--surface-sunken)" }}>
      <div className="pt-sec" style={{ ...SECTION, display: "grid", gap: 8 }}>
        <Reveal>
          <div style={{ display: "flex", gap: 4, marginBottom: 18 }} aria-hidden="true">
            <span style={{ width: 34, height: 8, borderRadius: 6, background: "var(--blue-500)" }} />
            <span style={{ width: 22, height: 8, borderRadius: 6, background: "var(--green-500)" }} />
            <span style={{ width: 14, height: 8, borderRadius: 6, background: "var(--amber-500)" }} />
          </div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, marginBottom: 8 }}>
            <h2 style={{ ...H2, margin: 0 }}>Reference</h2>
          </div>
          <p style={{ margin: "0 0 24px", fontSize: "var(--text-body-md)", lineHeight: "var(--leading-body)", color: "var(--text-secondary)", maxWidth: "70ch" }}>
            Twelve tools in three groups: the judgment call itself, tracking what it cost and what happened, and
            verifying or exporting old decisions later.
          </p>
        </Reveal>

        <Reveal delay={60}>
          <div className="pt-cols-2" style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, alignItems: "start" }}>
            <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
              <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-sunken)" }}>
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="filter tools"
                  style={{
                    width: "100%",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 6,
                    padding: "9px 10px",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11.5,
                    minHeight: 38,
                    background: "#fff",
                    marginBottom: 8,
                    boxSizing: "border-box",
                  }}
                />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {GROUPS.map((g) => {
                    const active = activeGroups.has(g);
                    return (
                      <button
                        key={g}
                        onClick={() => toggleGroup(g)}
                        style={{
                          fontSize: 11,
                          padding: "5px 10px",
                          borderRadius: 999,
                          minHeight: 28,
                          cursor: "pointer",
                          border: "1px solid " + (active ? "var(--text-accent)" : "var(--border-subtle)"),
                          background: active ? "rgba(26,115,232,.09)" : "#fff",
                          color: active ? "var(--text-accent)" : "var(--text-secondary)",
                        }}
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ maxHeight: 520, overflow: "auto" }}>
                {filtered.map((t) => {
                  const active = t.name === selectedTool.name;
                  return (
                    <button
                      key={t.name}
                      onClick={() => setSelected(t.name)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        border: 0,
                        borderBottom: "1px solid #eef1f4",
                        padding: "11px 13px",
                        cursor: "pointer",
                        background: active ? "rgba(26,115,232,.07)" : "#fff",
                      }}
                    >
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, wordBreak: "break-all", color: active ? "var(--text-accent)" : "var(--text-primary)" }}>
                        {t.name}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 3 }}>
                        {t.group} · {t.cost}
                      </div>
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <div style={{ padding: 16, fontSize: 12.5, color: "var(--text-tertiary)" }}>No tools match that filter.</div>
                )}
              </div>
            </div>

            <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 12, overflow: "hidden", display: "grid", gap: 20, padding: 16, background: "#fff" }}>
              <div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-primary)", marginBottom: 8 }}>{selectedTool.name}</div>
                <p style={{ margin: 0, fontSize: 14, lineHeight: "var(--leading-body)", color: "var(--text-secondary)" }}>{selectedTool.description}</p>
              </div>
              <FieldTable tool={selectedTool} />
            </div>
          </div>
        </Reveal>

        <Reveal delay={100}>
          <div style={{ display: "grid", gap: 12, marginTop: 40 }}>
            <div style={LABEL}>Configuration</div>
            <ConfigTable />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
