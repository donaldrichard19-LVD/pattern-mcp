#!/usr/bin/env node
/**
 * verify-sweep-ledger-liveness.mjs
 *
 * Feature 1 P2/P3's test plan, per
 * pattern-ledger-integrity-and-provenance-spec.md:
 *  - P2: "Test sweep performance at 200 and 1,000 synthetic entries;
 *    confirm it doesn't reintroduce the latency Pattern already fixed
 *    with caching."
 *  - P3: "Build the exact repro case from the Reddit report: 13 entries,
 *    12 cross-linked with no live anchor, confirm all 12 flag as
 *    dangling."
 *
 * Also covers sweep_ledger_liveness's whole-ledger mode (no project_id ->
 * every project_id present), since that's the actual "scheduled sweep"
 * capability P2 adds on top of P1's on-demand, single-project
 * check_ledger_liveness.
 *
 * Run: node scripts/verify-sweep-ledger-liveness.mjs (after `npm run build`)
 * Exits non-zero on any failed assertion.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist/index.js");

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ok: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

async function connect(env) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "unused-not-needed-for-this-script", ...env },
  });
  const client = new Client({ name: "verify-sweep-ledger-liveness", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

function baseEntry(overrides) {
  return {
    id: overrides.id,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    project_id: overrides.project_id,
    feature_id: overrides.feature_id,
    component_need: overrides.component_need ?? `need for ${overrides.id}`,
    domain: "test domain",
    framework: "React + Tailwind",
    checklist: ["a"],
    checklist_source: "extracted",
    candidates_evaluated: [{ source: "shadcn", name: overrides.chosen_candidate ?? "Candidate", url: "https://example.com", coverage_pct: 100 }],
    verdict: "use_existing",
    chosen_candidate: overrides.chosen_candidate ?? "Candidate",
    confidence: "high",
    reason: "scored",
    coverage: "8/8 (100%)",
    cost_usd: 0,
    cache_hit: false,
    project_conventions_snapshot: null,
    file_path: overrides.file_path ?? null,
    snapshot_ref: null,
    last_verified_live: null,
    live_status: "unknown",
    reconstructed_snapshot_ref: null,
  };
}

// =========================================================================
// Part 1: the exact Reddit repro case -- 13 entries, 12 cross-linked (share
// one feature_id, none live), 1 separate entry with its own feature_id and
// a real, live file anchor.
// =========================================================================
console.log("=== Feature 1 P3: dangling-cluster repro (13 entries, 12 dangling) ===");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-verify-sweep-dangling-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "Real.tsx"), "// renders LiveComponent\n");
  const ledgerPath = join(root, "ledger.jsonl");
  const livenessPath = join(root, "liveness.jsonl");
  const PROJECT_ID = "dangling-repro-project";

  const lines = [];
  // 12 entries sharing feature_id "orphaned-feature", none with a live anchor:
  // 6 with no file_path at all (permanently unknown), 6 pointing at files
  // that don't exist (orphaned).
  for (let i = 0; i < 12; i++) {
    const filePath = i < 6 ? null : `src/DoesNotExist${i}.tsx`;
    lines.push(
      baseEntry({
        id: `dangling-${i}`,
        project_id: PROJECT_ID,
        feature_id: "orphaned-feature",
        chosen_candidate: `GhostComponent${i}`,
        file_path: filePath,
      })
    );
  }
  // The 13th entry: a different feature_id, a real live anchor.
  lines.push(
    baseEntry({
      id: "not-dangling-13",
      project_id: PROJECT_ID,
      feature_id: "live-feature",
      chosen_candidate: "LiveComponent",
      file_path: "src/Real.tsx",
    })
  );
  writeFileSync(ledgerPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");

  const client = await connect({
    PATTERN_LEDGER_PATH: ledgerPath,
    PATTERN_LEDGER_LIVENESS_PATH: livenessPath,
    PATTERN_PROJECT_ROOT: root,
  });

  const result = JSON.parse(
    (await client.callTool({ name: "sweep_ledger_liveness", arguments: { project_id: PROJECT_ID } })).content[0].text
  );

  check("projects_swept is 1", result.projects_swept === 1);
  check(
    "total_entries_checked counts the 6 orphaned + 1 live entry (the 6 null-file_path ones are never 'checked')",
    result.total_entries_checked === 7
  );
  check("exactly 1 dangling cluster found", result.dangling_clusters.length === 1);
  check("the dangling cluster is keyed by the shared feature_id", result.dangling_clusters[0]?.feature_id === "orphaned-feature");
  check("the dangling cluster contains all 12 entries, not 13", result.dangling_clusters[0]?.entry_ids.length === 12);
  check(
    "the live entry (different feature_id) is not in the dangling cluster",
    !result.dangling_clusters[0]?.entry_ids.includes("not-dangling-13")
  );

  console.log("read_ledger reflects the dangling flag for all 12, and 'live' for the 13th");
  const afterEntries = JSON.parse(
    (await client.callTool({ name: "read_ledger", arguments: { project_id: PROJECT_ID, limit: 20 } })).content[0].text
  ).entries;
  const dangling = afterEntries.filter((e) => e.live_status === "dangling");
  check("12 entries now show live_status 'dangling'", dangling.length === 12);
  const liveOne = afterEntries.find((e) => e.id === "not-dangling-13");
  check("the 13th entry's live_status is 'live', not 'dangling'", liveOne?.live_status === "live");

  await client.close();
}

// =========================================================================
// Part 2: whole-ledger sweep mode -- no project_id means every project_id
// present gets swept, without the caller needing to enumerate them.
// =========================================================================
console.log("\n=== Feature 1 P2: sweep with no project_id covers every project present ===");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-verify-sweep-allprojects-"));
  const ledgerPath = join(root, "ledger.jsonl");
  const livenessPath = join(root, "liveness.jsonl");

  const lines = [
    baseEntry({ id: "proj-a-1", project_id: "project-a", feature_id: "fa1" }),
    baseEntry({ id: "proj-b-1", project_id: "project-b", feature_id: "fb1" }),
    baseEntry({ id: "proj-c-1", project_id: "project-c", feature_id: "fc1" }),
  ];
  writeFileSync(ledgerPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");

  const client = await connect({ PATTERN_LEDGER_PATH: ledgerPath, PATTERN_LEDGER_LIVENESS_PATH: livenessPath, PATTERN_PROJECT_ROOT: root });

  const result = JSON.parse((await client.callTool({ name: "sweep_ledger_liveness", arguments: {} })).content[0].text);
  check("projects_swept is 3 without being told any project_id", result.projects_swept === 3);
  check(
    "per_project lists all three projects",
    ["project-a", "project-b", "project-c"].every((p) => result.per_project.some((pp) => pp.project_id === p))
  );

  await client.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
