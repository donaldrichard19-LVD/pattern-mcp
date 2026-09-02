#!/usr/bin/env node
/**
 * verify-backfill-snapshot-ref.mjs
 *
 * Feature 2 P3's test plan, per
 * pattern-ledger-integrity-and-provenance-spec.md: "Test backfill against
 * the existing 200-entry synthetic ledger and Coop's real ledger
 * entries."
 *
 * Part 1: a real throwaway git repo with known commit history, so the
 * reconstructed SHA for an old entry's timestamp can be checked against
 * an exact expected value, not just "some SHA came back". Also covers a
 * 200-entry synthetic scale pass (all missing snapshot_ref) and the
 * already-had-snapshot_ref / no-git-history-yet edge cases.
 *
 * Part 2: a genuine read-only run against ~/.pattern/ledger.jsonl's real
 * "coop-commerce" project entries -- exactly the validation data the
 * spec calls for. This only reads that file and writes to a *separate*
 * snapshot_backfill.jsonl overlay (via PATTERN_SNAPSHOT_BACKFILL_PATH,
 * redirected to a throwaway path here) -- it never modifies
 * ~/.pattern/ledger.jsonl itself. Skipped gracefully if that file isn't
 * present (e.g. CI, or a machine that's never run Pattern for real).
 *
 * Run: node scripts/verify-backfill-snapshot-ref.mjs (after `npm run build`)
 * Exits non-zero on any failed assertion.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { homedir } from "node:os";

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

function baseEntry(overrides) {
  return {
    id: overrides.id,
    timestamp: overrides.timestamp,
    project_id: overrides.project_id,
    feature_id: overrides.id,
    component_need: `need for ${overrides.id}`,
    domain: "test",
    framework: "React",
    checklist: ["a"],
    checklist_source: "extracted",
    candidates_evaluated: [],
    verdict: "use_existing",
    chosen_candidate: null,
    confidence: "high",
    reason: "scored",
    coverage: "8/8 (100%)",
    cost_usd: 0,
    cache_hit: false,
    project_conventions_snapshot: null,
    file_path: null,
    snapshot_ref: overrides.snapshot_ref ?? null,
    last_verified_live: null,
    live_status: "unknown",
    reconstructed_snapshot_ref: null,
  };
}

console.log("=== Part 1: backfill against a real git repo with known history ===");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-verify-backfill-git-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });

  writeFileSync(join(root, "a.txt"), "1\n");
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "first"], { cwd: root });
  const firstSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  // git commit timestamps have 1-second resolution -- wait past that
  // boundary so the two commits land in strictly ordered, distinguishable
  // seconds and --before can tell them apart.
  await new Promise((r) => setTimeout(r, 1100));
  const midpoint = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 1100));

  writeFileSync(join(root, "b.txt"), "2\n");
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "second"], { cwd: root });
  const secondSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

  const ledgerPath = join(root, "ledger.jsonl");
  const backfillPath = join(root, "snapshot_backfill.jsonl");
  const PROJECT_ID = "backfill-git-project";

  const lines = [
    baseEntry({ id: "entry-missing-mid", project_id: PROJECT_ID, timestamp: midpoint }),
    baseEntry({ id: "entry-already-has-one", project_id: PROJECT_ID, timestamp: new Date().toISOString(), snapshot_ref: "existingsha1234567890existingsha1234567890" }),
    baseEntry({ id: "entry-before-any-commit", project_id: PROJECT_ID, timestamp: "2000-01-01T00:00:00.000Z" }),
  ];
  writeFileSync(ledgerPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "unused-not-needed-for-this-script",
      PATTERN_LEDGER_PATH: ledgerPath,
      PATTERN_SNAPSHOT_BACKFILL_PATH: backfillPath,
      PATTERN_PROJECT_ROOT: root,
    },
  });
  const client = new Client({ name: "verify-backfill-snapshot-ref", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);

  console.log("1. backfill_ledger_snapshot_ref against 3 fixtures with real, known git history");
  const result = JSON.parse(
    (await client.callTool({ name: "backfill_ledger_snapshot_ref", arguments: { project_id: PROJECT_ID } })).content[0].text
  );
  const byId = Object.fromEntries(result.results.map((r) => [r.ledger_entry_id, r]));

  check("attempted is 2 (the one with an existing snapshot_ref is skipped)", result.attempted === 2);
  check("reconstructed is 1 (only the mid-timestamp entry resolves to a real commit)", result.reconstructed === 1);
  check(
    `entry timestamped between the two commits reconstructs to the FIRST commit (${firstSha})`,
    byId["entry-missing-mid"]?.reconstructed_snapshot_ref === firstSha
  );
  check(
    "entry timestamped before any commit exists reconstructs to null (nothing to find)",
    byId["entry-before-any-commit"]?.reconstructed_snapshot_ref === null
  );
  check("entry that already had a real snapshot_ref is reported but not reconstructed", byId["entry-already-has-one"]?.already_had_snapshot_ref === true);

  console.log("\n2. read_ledger now overlays reconstructed_snapshot_ref onto the backfilled entry only");
  const afterEntries = JSON.parse(
    (await client.callTool({ name: "read_ledger", arguments: { project_id: PROJECT_ID, limit: 10 } })).content[0].text
  ).entries;
  const midEntry = afterEntries.find((e) => e.id === "entry-missing-mid");
  check("backfilled entry's reconstructed_snapshot_ref matches the first commit", midEntry?.reconstructed_snapshot_ref === firstSha);
  check("backfilled entry's real snapshot_ref is still null (backfill never fabricates the real field)", midEntry?.snapshot_ref === null);
  const alreadyHadEntry = afterEntries.find((e) => e.id === "entry-already-has-one");
  check(
    "entry with a real snapshot_ref shows reconstructed_snapshot_ref as null (never consulted once the real value exists)",
    alreadyHadEntry?.reconstructed_snapshot_ref === null && alreadyHadEntry?.snapshot_ref === "existingsha1234567890existingsha1234567890"
  );

  console.log("\n3. export_ledger_provenance clearly labels the reconstructed snapshot as reconstructed, not real");
  const exported = JSON.parse(
    (await client.callTool({ name: "export_ledger_provenance", arguments: { project_id: PROJECT_ID, ledger_entry_id: "entry-missing-mid" } }))
      .content[0].text
  );
  check(`exported markdown includes the reconstructed SHA (${firstSha})`, exported.markdown.includes(firstSha));
  check("exported markdown labels it as reconstructed/best-effort, not equivalent to a captured snapshot", exported.markdown.includes("reconstructed via backfill"));

  console.log("\n4. Re-running backfill on the same entry is safe (append-only, doesn't corrupt or duplicate meaning)");
  const second = JSON.parse(
    (await client.callTool({ name: "backfill_ledger_snapshot_ref", arguments: { project_id: PROJECT_ID, ledger_entry_id: "entry-missing-mid" } }))
      .content[0].text
  );
  check("re-running still resolves to the same commit", second.results[0]?.reconstructed_snapshot_ref === firstSha);

  await client.close();
}

console.log("\n=== Part 2: 200-entry synthetic ledger, all missing snapshot_ref, no git repo ===");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-verify-backfill-scale-"));
  const ledgerPath = join(root, "ledger.jsonl");
  const backfillPath = join(root, "snapshot_backfill.jsonl");
  const PROJECT_ID = "backfill-scale-project";
  const N = 200;

  const lines = [];
  for (let i = 0; i < N; i++) {
    lines.push(JSON.stringify(baseEntry({ id: `scale-entry-${i}`, project_id: PROJECT_ID, timestamp: new Date().toISOString() })));
  }
  writeFileSync(ledgerPath, lines.join("\n") + "\n", "utf8");

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "unused-not-needed-for-this-script",
      PATTERN_LEDGER_PATH: ledgerPath,
      PATTERN_SNAPSHOT_BACKFILL_PATH: backfillPath,
      PATTERN_PROJECT_ROOT: root, // deliberately NOT a git repo
    },
  });
  const client = new Client({ name: "verify-backfill-snapshot-ref-scale", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);

  const start = performance.now();
  const result = JSON.parse(
    (await client.callTool({ name: "backfill_ledger_snapshot_ref", arguments: { project_id: PROJECT_ID } })).content[0].text
  );
  const elapsedMs = performance.now() - start;
  console.log(`  backfill over ${N} entries (no git repo, every git call fails fast): ${elapsedMs.toFixed(1)}ms`);

  check(`attempted all ${N} entries`, result.attempted === N);
  check("reconstructed is 0 (PROJECT_ROOT isn't a git repo, nothing to find)", result.reconstructed === 0);
  check("every result explicitly reports null rather than throwing", result.results.every((r) => r.reconstructed_snapshot_ref === null));
  check("stays well under a search+score call's cost/latency class (<10s for 200 failed git spawns)", elapsedMs < 10000);

  await client.close();
}

console.log("\n=== Part 3: real Coop ledger entries (read-only validation, per the spec's own test plan) ===");
{
  const realLedgerPath = join(homedir(), ".pattern", "ledger.jsonl");
  if (!existsSync(realLedgerPath)) {
    console.log("  skipped: no ~/.pattern/ledger.jsonl on this machine.");
  } else {
    const tmp = mkdtempSync(join(tmpdir(), "pattern-verify-backfill-coop-"));
    // Copy, never touch the real file -- this script only ever reads a
    // copy and writes to a throwaway backfill overlay path.
    const ledgerCopy = join(tmp, "ledger.jsonl");
    copyFileSync(realLedgerPath, ledgerCopy);
    const backfillPath = join(tmp, "snapshot_backfill.jsonl");

    const raw = execFileSync("node", ["-e", `console.log(require('fs').readFileSync(${JSON.stringify(ledgerCopy)}, 'utf8').split('\\n').filter(Boolean).map(l => JSON.parse(l).project_id)[0])`]).toString().trim();
    const realProjectId = raw || "coop-commerce";

    const transport = new StdioClientTransport({
      command: "node",
      args: [serverEntry],
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "unused-not-needed-for-this-script",
        PATTERN_LEDGER_PATH: ledgerCopy,
        PATTERN_SNAPSHOT_BACKFILL_PATH: backfillPath,
        PATTERN_PROJECT_ROOT: process.env.HOME, // no assumption this is a git repo either way
      },
    });
    const client = new Client({ name: "verify-backfill-snapshot-ref-coop", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);

    const result = JSON.parse(
      (await client.callTool({ name: "backfill_ledger_snapshot_ref", arguments: { project_id: realProjectId } })).content[0].text
    );
    console.log(`  ran against real project_id "${realProjectId}": attempted=${result.attempted}, reconstructed=${result.reconstructed}`);
    check("ran against real data without throwing", Array.isArray(result.results));
    check("every result is well-formed (has ledger_entry_id and a boolean already_had_snapshot_ref)", result.results.every((r) => typeof r.ledger_entry_id === "string" && typeof r.already_had_snapshot_ref === "boolean"));

    await client.close();
  }
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
