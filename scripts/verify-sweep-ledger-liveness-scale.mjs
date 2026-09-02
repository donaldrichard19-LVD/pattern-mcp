#!/usr/bin/env node
/**
 * verify-sweep-ledger-liveness-scale.mjs
 *
 * Feature 1 P2's explicit scale requirement, per
 * pattern-ledger-integrity-and-provenance-spec.md: "Test sweep performance
 * at 200 and 1,000 synthetic entries; confirm it doesn't reintroduce the
 * latency Pattern already fixed with caching." This targets
 * sweep_ledger_liveness specifically (not check_ledger_liveness, already
 * covered at 200 entries in verify-ledger-liveness-scale.mjs) since sweep
 * adds a second pass -- feature_id grouping for dangling-cluster detection
 * -- with its own performance profile to characterize as the ledger grows.
 *
 * Run: node scripts/verify-sweep-ledger-liveness-scale.mjs (after `npm run build`)
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
const PROJECT_ID = "sweep-scale-project";

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ok: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

async function runAtScale(n) {
  const root = mkdtempSync(join(tmpdir(), `pattern-verify-sweep-scale-${n}-`));
  execFileSync("git", ["init", "-q"], { cwd: root });
  mkdirSync(join(root, "src"), { recursive: true });

  const ledgerPath = join(root, "ledger.jsonl");
  const livenessPath = join(root, "liveness.jsonl");

  // Mix: half the entries are singleton features with a real live file
  // each (never dangling, since a cluster needs 2+ entries); the other
  // half are grouped in pairs sharing one feature_id, neither half of the
  // pair pointing at a real file -- every such pair should flag dangling.
  let expectedDanglingClusters = 0;
  let expectedDanglingEntries = 0;
  const lines = [];
  let danglingIndex = 0;
  for (let i = 0; i < n; i++) {
    const isLiveSingleton = i % 2 === 0;
    if (isLiveSingleton) {
      const filePath = `src/Live${i}.tsx`;
      writeFileSync(join(root, filePath), `// renders Candidate${i}\n`);
      lines.push(
        JSON.stringify({
          id: `entry-${i}`,
          timestamp: new Date().toISOString(),
          project_id: PROJECT_ID,
          feature_id: `feature-singleton-${i}`,
          component_need: `need ${i}`,
          domain: "test",
          framework: "React",
          checklist: ["a"],
          checklist_source: "extracted",
          candidates_evaluated: [{ source: "shadcn", name: `Candidate${i}`, url: "https://example.com", coverage_pct: 100 }],
          verdict: "use_existing",
          chosen_candidate: `Candidate${i}`,
          confidence: "high",
          reason: "scored",
          coverage: "8/8 (100%)",
          cost_usd: 0,
          cache_hit: false,
          project_conventions_snapshot: null,
          file_path: filePath,
          snapshot_ref: null,
          last_verified_live: null,
          live_status: "unknown",
          reconstructed_snapshot_ref: null,
        })
      );
    } else {
      // Pair up consecutive dangling-candidate entries (every other i)
      // under one shared feature_id, no file_path at all -- a dangling
      // pair, once per two such entries. danglingIndex tracks position
      // among dangling candidates specifically, not the overall loop
      // index i, since i alternates live/dangling and floor(i/2) would
      // incorrectly pair a live entry's index with a dangling one's.
      const pairFeatureId = `feature-dangling-pair-${Math.floor(danglingIndex / 2)}`;
      danglingIndex++;
      lines.push(
        JSON.stringify({
          id: `entry-${i}`,
          timestamp: new Date().toISOString(),
          project_id: PROJECT_ID,
          feature_id: pairFeatureId,
          component_need: `need ${i}`,
          domain: "test",
          framework: "React",
          checklist: ["a"],
          checklist_source: "extracted",
          candidates_evaluated: [],
          verdict: "custom_build",
          chosen_candidate: null,
          confidence: "low",
          reason: "scored",
          coverage: null,
          cost_usd: 0,
          cache_hit: false,
          project_conventions_snapshot: null,
          file_path: null,
          snapshot_ref: null,
          last_verified_live: null,
          live_status: "unknown",
          reconstructed_snapshot_ref: null,
        })
      );
    }
  }
  // Each dangling pair is 2 consecutive odd-index entries sharing a
  // feature_id -- count pairs among the odd half.
  const oddCount = Math.floor(n / 2);
  expectedDanglingClusters = Math.floor(oddCount / 2);
  expectedDanglingEntries = expectedDanglingClusters * 2;

  writeFileSync(ledgerPath, lines.join("\n") + "\n", "utf8");

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "unused-not-needed-for-this-script",
      PATTERN_LEDGER_PATH: ledgerPath,
      PATTERN_LEDGER_LIVENESS_PATH: livenessPath,
      PATTERN_PROJECT_ROOT: root,
    },
  });
  const client = new Client({ name: "verify-sweep-ledger-liveness-scale", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);

  const start = performance.now();
  const result = JSON.parse(
    (await client.callTool({ name: "sweep_ledger_liveness", arguments: { project_id: PROJECT_ID } })).content[0].text
  );
  const elapsedMs = performance.now() - start;

  console.log(`N=${n}: swept in ${elapsedMs.toFixed(1)}ms (${(elapsedMs / n).toFixed(3)}ms/entry)`);
  check(`N=${n}: total_entries_checked matches the live-singleton half`, result.per_project[0]?.checked === Math.ceil(n / 2));
  check(`N=${n}: dangling cluster count matches expected (${expectedDanglingClusters})`, result.dangling_clusters.length === expectedDanglingClusters);
  const totalDanglingEntries = result.dangling_clusters.reduce((sum, c) => sum + c.entry_ids.length, 0);
  check(`N=${n}: total dangling entries matches expected (${expectedDanglingEntries})`, totalDanglingEntries === expectedDanglingEntries);
  check(`N=${n}: stays well under a search+score call's cost/latency class (<5s)`, elapsedMs < 5000);

  await client.close();
  rmSync(root, { recursive: true, force: true });
}

await runAtScale(200);
console.log();
await runAtScale(1000);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
