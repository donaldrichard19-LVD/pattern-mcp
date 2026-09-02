#!/usr/bin/env node
/**
 * verify-ledger-integrity-and-provenance.mjs
 *
 * Standalone check for Feature 1 (Referential Integrity, P0-P1) and
 * Feature 2 (Decision Provenance, P0) from
 * pattern-ledger-integrity-and-provenance-spec.md. Spawns the real MCP
 * server over stdio against a temp ledger dir and a temp PROJECT_ROOT, so
 * every filesystem/git assertion below is against a throwaway sandbox,
 * never this repo. Never calls the Anthropic API -- every case here is
 * either a seeded ledger cache hit or a pure ledger/liveness read.
 *
 * Run: node scripts/verify-ledger-integrity-and-provenance.mjs (after `npm run build`)
 * Exits non-zero on any failed assertion.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "unused-not-needed-for-this-script",
      ...env,
    },
  });
  const client = new Client({ name: "verify-ledger-integrity-and-provenance", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

function seedLedgerLine(ledgerPath, overrides) {
  const base = {
    id: overrides.id,
    timestamp: new Date().toISOString(),
    project_id: overrides.project_id,
    feature_id: "seed-feature",
    component_need: overrides.component_need,
    domain: "test domain",
    framework: "React + Tailwind",
    checklist: ["a", "b"],
    checklist_source: "extracted",
    candidates_evaluated: overrides.chosen_candidate
      ? [{ source: "shadcn", name: overrides.chosen_candidate, url: "https://example.com", coverage_pct: 100 }]
      : [],
    verdict: "use_existing",
    chosen_candidate: overrides.chosen_candidate ?? null,
    confidence: "high",
    reason: "scored",
    coverage: "8/8 (100%)",
    cost_usd: 0.5,
    cache_hit: false,
    project_conventions_snapshot: null,
  };
  if ("file_path" in overrides) base.file_path = overrides.file_path;
  // Deliberately NOT setting snapshot_ref/last_verified_live/live_status
  // on some lines below -- that's the backward-compatibility case P0's
  // migration test needs (an old-shaped line predating these fields).
  writeFileSync(ledgerPath, JSON.stringify(base) + "\n", { flag: "a" });
}

// ---------------------------------------------------------------------
// Sandbox 1: a real, throwaway git repo, used for the snapshot_ref /
// happy-path liveness checks.
// ---------------------------------------------------------------------
const gitTmp = mkdtempSync(join(tmpdir(), "pattern-verify-ledger-git-"));
execFileSync("git", ["init", "-q"], { cwd: gitTmp });
execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: gitTmp });
execFileSync("git", ["config", "user.name", "Test"], { cwd: gitTmp });
mkdirSync(join(gitTmp, "src", "components"), { recursive: true });
writeFileSync(join(gitTmp, "src", "components", "Toast.tsx"), "// uses Sonner toast under the hood\nexport const Toast = () => null;\n");
writeFileSync(join(gitTmp, "README.md"), "placeholder\n");
execFileSync("git", ["add", "-A"], { cwd: gitTmp });
execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: gitTmp });
const expectedSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: gitTmp, encoding: "utf8" }).trim();

const gitLedgerPath = join(gitTmp, ".pattern-ledger.jsonl");
const gitLivenessPath = join(gitTmp, ".pattern-liveness.jsonl");

console.log("=== Feature 2 (Provenance) P0: snapshot_ref ===");
{
  const client = await connect({
    PATTERN_LEDGER_PATH: gitLedgerPath,
    PATTERN_BUILD_LEDGER_PATH: join(gitTmp, ".pattern-build.jsonl"),
    PATTERN_PROJECT_ROOT: gitTmp,
  });

  // Seed a high-confidence entry so the matching call is a free ledger
  // cache hit (see verify-cost-attribution.mjs) -- this exercises the
  // cache-hit branch of buildLedgerEntry, not just the fresh-judgment one.
  seedLedgerLine(gitLedgerPath, {
    id: "seed-git-0001",
    project_id: "snapshot-ref-project",
    component_need: "success or failure toast notification",
    chosen_candidate: "Sonner toast",
  });

  console.log("1. A ledger cache hit in a real git repo captures HEAD as snapshot_ref");
  await client.callTool({
    name: "recommend_component",
    arguments: {
      component_need: "success or failure toast notification",
      domain: "test domain",
      framework: "React + Tailwind",
      project_id: "snapshot-ref-project",
    },
  });
  const rollup = JSON.parse(
    (await client.callTool({ name: "read_ledger", arguments: { project_id: "snapshot-ref-project", feature_id: "seed-feature" } }))
      .content[0].text
  );
  const cacheHitEntry = rollup.verdict_entries.find((e) => e.cache_hit === true);
  check("cache-hit entry exists", !!cacheHitEntry);
  check(`cache-hit entry's snapshot_ref (${cacheHitEntry?.snapshot_ref}) equals real HEAD (${expectedSha})`, cacheHitEntry?.snapshot_ref === expectedSha);
  check("seed entry itself (pre-dating this field) normalizes to snapshot_ref: null", rollup.verdict_entries.find((e) => e.id === "seed-git-0001")?.snapshot_ref === null);

  await client.close();
}

console.log("\n=== Feature 2 (Provenance) P0: graceful degradation outside a git repo ===");
{
  const nonGitTmp = mkdtempSync(join(tmpdir(), "pattern-verify-ledger-nogit-"));
  const ledgerPath = join(nonGitTmp, "ledger.jsonl");
  const client = await connect({
    PATTERN_LEDGER_PATH: ledgerPath,
    PATTERN_BUILD_LEDGER_PATH: join(nonGitTmp, "build.jsonl"),
    PATTERN_PROJECT_ROOT: nonGitTmp,
  });

  seedLedgerLine(ledgerPath, {
    id: "seed-nogit-0001",
    project_id: "no-git-project",
    component_need: "success or failure toast notification",
    chosen_candidate: "Sonner toast",
  });

  console.log("2. A ledger cache hit outside any git repo still succeeds, snapshot_ref null");
  const result = await client.callTool({
    name: "recommend_component",
    arguments: {
      component_need: "success or failure toast notification",
      domain: "test domain",
      framework: "React + Tailwind",
      project_id: "no-git-project",
    },
  });
  const parsed = JSON.parse(result.content[0].text);
  check("call did not fail (isError unset)", !result.isError);
  check("served_from_ledger is still true", parsed.served_from_ledger === true);

  const rollup = JSON.parse(
    (await client.callTool({ name: "read_ledger", arguments: { project_id: "no-git-project", feature_id: "seed-feature" } })).content[0]
      .text
  );
  const cacheHitEntry = rollup.verdict_entries.find((e) => e.cache_hit === true);
  check("cache-hit entry's snapshot_ref degrades to null (no git repo)", cacheHitEntry?.snapshot_ref === null);

  await client.close();
  rmSync(nonGitTmp, { recursive: true, force: true });
}

console.log("\n=== Feature 1 (Referential Integrity) P0: schema migration / backward compatibility ===");
{
  const client = await connect({
    PATTERN_LEDGER_PATH: gitLedgerPath,
    PATTERN_LEDGER_LIVENESS_PATH: gitLivenessPath,
    PATTERN_BUILD_LEDGER_PATH: join(gitTmp, ".pattern-build.jsonl"),
    PATTERN_PROJECT_ROOT: gitTmp,
  });

  console.log("3. An old-shaped entry (predating these fields) normalizes to safe defaults");
  const entries = JSON.parse(
    (await client.callTool({ name: "read_ledger", arguments: { project_id: "snapshot-ref-project" } })).content[0].text
  ).entries;
  const oldEntry = entries.find((e) => e.id === "seed-git-0001");
  check("file_path defaults to null", oldEntry?.file_path === null);
  check("last_verified_live defaults to null", oldEntry?.last_verified_live === null);
  check("live_status defaults to 'unknown'", oldEntry?.live_status === "unknown");

  await client.close();
}

console.log("\n=== Feature 1 (Referential Integrity) P1: live-check function ===");
{
  const client = await connect({
    PATTERN_LEDGER_PATH: gitLedgerPath,
    PATTERN_LEDGER_LIVENESS_PATH: gitLivenessPath,
    PATTERN_BUILD_LEDGER_PATH: join(gitTmp, ".pattern-build.jsonl"),
    PATTERN_PROJECT_ROOT: gitTmp,
  });

  seedLedgerLine(gitLedgerPath, {
    id: "live-entry",
    project_id: "liveness-project",
    component_need: "live case",
    chosen_candidate: "Sonner toast",
    file_path: "src/components/Toast.tsx",
  });
  seedLedgerLine(gitLedgerPath, {
    id: "orphaned-entry",
    project_id: "liveness-project",
    component_need: "orphaned case",
    chosen_candidate: "Sonner toast",
    file_path: "src/components/DeletedThing.tsx",
  });
  seedLedgerLine(gitLedgerPath, {
    id: "unknown-no-path-entry",
    project_id: "liveness-project",
    component_need: "unknown case (no file_path)",
    chosen_candidate: "Sonner toast",
    file_path: null,
  });
  seedLedgerLine(gitLedgerPath, {
    id: "unknown-mismatch-entry",
    project_id: "liveness-project",
    component_need: "unknown case (file exists, candidate not mentioned)",
    chosen_candidate: "Some Other Component Nobody Wrote",
    file_path: "README.md",
  });
  seedLedgerLine(gitLedgerPath, {
    id: "traversal-entry",
    project_id: "liveness-project",
    component_need: "path traversal guard case",
    chosen_candidate: "Sonner toast",
    file_path: "../../../etc/passwd",
  });

  console.log("4. check_ledger_liveness resolves each fixture to the expected status");
  const liveness = JSON.parse(
    (await client.callTool({ name: "check_ledger_liveness", arguments: { project_id: "liveness-project" } })).content[0].text
  );
  const byId = Object.fromEntries(liveness.results.map((r) => [r.ledger_entry_id, r]));
  check("total_entries counts all 5 seeded entries", liveness.total_entries === 5);
  check("checked excludes the no-file_path entry (4 of 5)", liveness.checked === 4);
  check("existing file + content match -> live", byId["live-entry"]?.live_status === "live");
  check("missing file -> orphaned", byId["orphaned-entry"]?.live_status === "orphaned");
  check("no file_path -> unknown, not checked (checked_at null)", byId["unknown-no-path-entry"]?.live_status === "unknown" && byId["unknown-no-path-entry"]?.checked_at === null);
  check("file exists but candidate name absent -> unknown (conservative)", byId["unknown-mismatch-entry"]?.live_status === "unknown");
  check("path escaping PROJECT_ROOT -> unknown, not orphaned/live", byId["traversal-entry"]?.live_status === "unknown");

  console.log("5. read_ledger reflects the latest liveness check via the overlay");
  const afterCheck = JSON.parse(
    (await client.callTool({ name: "read_ledger", arguments: { project_id: "liveness-project" } })).content[0].text
  ).entries;
  const liveAfter = afterCheck.find((e) => e.id === "live-entry");
  check("read_ledger's live_status now reflects 'live'", liveAfter?.live_status === "live");
  check("read_ledger's last_verified_live is now a real timestamp, not null", typeof liveAfter?.last_verified_live === "string" && !Number.isNaN(Date.parse(liveAfter.last_verified_live)));
  const orphanedAfter = afterCheck.find((e) => e.id === "orphaned-entry");
  check("read_ledger's live_status now reflects 'orphaned'", orphanedAfter?.live_status === "orphaned");

  console.log("6. check_ledger_liveness with ledger_entry_id checks only that one entry");
  const single = JSON.parse(
    (
      await client.callTool({
        name: "check_ledger_liveness",
        arguments: { project_id: "liveness-project", ledger_entry_id: "orphaned-entry" },
      })
    ).content[0].text
  );
  check("total_entries is 1 when scoped to one ledger_entry_id", single.total_entries === 1);
  check("that one result is the orphaned entry", single.results[0]?.ledger_entry_id === "orphaned-entry");

  await client.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
rmSync(gitTmp, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
