#!/usr/bin/env node
/**
 * verify-ledger-liveness-scale.mjs
 *
 * Feature 1 (Referential Integrity) P1's scale test, per
 * pattern-ledger-integrity-and-provenance-spec.md: run check_ledger_liveness
 * against a 200-entry synthetic ledger (mirroring the scale used for the
 * original caching benchmark, see project_pattern_ledger memory) with a
 * known mix of live/orphaned/unknown fixtures seeded in, and confirm both
 * correctness and that per-read latency stays cheap (this is on-demand
 * fs stat + a small file read per entry, not a search+score call).
 *
 * Run: node scripts/verify-ledger-liveness-scale.mjs (after `npm run build`)
 * Exits non-zero on any failed assertion.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist/index.js");
const PROJECT_ID = "scale-liveness-project";
const N = 200;

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ok: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

const root = mkdtempSync(join(tmpdir(), "pattern-verify-liveness-scale-"));
execFileSync("git", ["init", "-q"], { cwd: root });
mkdirSync(join(root, "src"), { recursive: true });

const ledgerPath = join(root, "ledger.jsonl");
const livenessPath = join(root, "liveness.jsonl");

// Seed N entries: roughly a third live (real file, content mentions the
// candidate), a third orphaned (file_path set, file doesn't exist), a
// third unknown (no file_path at all) -- known-orphaned fixtures called
// out explicitly by the P1 test plan.
const expected = { live: 0, orphaned: 0, unknown: 0 };
let lines = "";
for (let i = 0; i < N; i++) {
  const bucket = i % 3;
  const id = `entry-${i}`;
  let file_path = null;
  if (bucket === 0) {
    file_path = `src/Component${i}.tsx`;
    writeFileSync(join(root, file_path), `// renders Candidate${i}\nexport const C = () => null;\n`);
    expected.live++;
  } else if (bucket === 1) {
    file_path = `src/DoesNotExist${i}.tsx`;
    expected.orphaned++;
  } else {
    expected.unknown++;
  }
  lines +=
    JSON.stringify({
      id,
      timestamp: new Date().toISOString(),
      project_id: PROJECT_ID,
      feature_id: `feature-${i}`,
      component_need: `synthetic need ${i}`,
      domain: "test domain",
      framework: "React + Tailwind",
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
      file_path,
    }) + "\n";
}
writeFileSync(ledgerPath, lines, "utf8");

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
const client = new Client({ name: "verify-ledger-liveness-scale", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);

console.log(`1. check_ledger_liveness against ${N} synthetic entries`);
const start = performance.now();
const result = JSON.parse(
  (await client.callTool({ name: "check_ledger_liveness", arguments: { project_id: PROJECT_ID } })).content[0].text
);
const elapsedMs = performance.now() - start;

const counts = { live: 0, orphaned: 0, unknown: 0 };
for (const r of result.results) counts[r.live_status] = (counts[r.live_status] ?? 0) + 1;

check(`total_entries is ${N}`, result.total_entries === N);
check(`checked is ${expected.live + expected.orphaned} (unknown/no-file_path entries excluded)`, result.checked === expected.live + expected.orphaned);
check(`live count matches fixture (${expected.live})`, counts.live === expected.live);
check(`orphaned count matches fixture (${expected.orphaned})`, counts.orphaned === expected.orphaned);
check(`unknown count matches fixture (${expected.unknown})`, counts.unknown === expected.unknown);
console.log(`  latency: ${elapsedMs.toFixed(1)}ms for ${N} entries (${(elapsedMs / N).toFixed(2)}ms/entry)`);
check("stays well under a search+score call's cost/latency class (<3s total for 200 fs-only checks)", elapsedMs < 3000);

console.log("2. read_ledger for the same project reflects every checked entry's status");
const afterEntries = JSON.parse(
  (await client.callTool({ name: "read_ledger", arguments: { project_id: PROJECT_ID, limit: N } })).content[0].text
).entries;
const mismatches = afterEntries.filter((e) => {
  const expectedStatus = result.results.find((r) => r.ledger_entry_id === e.id)?.live_status;
  return expectedStatus !== undefined && e.live_status !== expectedStatus;
});
check("no entry's read_ledger status disagrees with its check_ledger_liveness result", mismatches.length === 0);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
await client.close();
rmSync(root, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
