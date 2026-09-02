#!/usr/bin/env node
/**
 * verify-cost-attribution.mjs
 *
 * Standalone check for the cost-attribution build plan's Phase 1 (Gate 1
 * criteria): feature_id joins verdict cost and build cost with no orphaned
 * records, and the read_ledger feature_id rollup sums to the expected
 * total. Spawns the real MCP server over stdio against a temp ledger dir,
 * but never calls the Anthropic API -- the ledger cache-hit path (a seeded
 * high-confidence entry) and report_build_cost both short-circuit before
 * any API call, so this is free and deterministic to run repeatedly.
 *
 * Run: node scripts/verify-cost-attribution.mjs (after `npm run build`)
 * Exits non-zero on any failed assertion.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "pattern-verify-cost-attribution-"));
const ledgerPath = join(tmp, "ledger.jsonl");
const buildLedgerPath = join(tmp, "build_ledger.jsonl");

const PROJECT_ID = "verify-cost-attribution-project";
const FEATURE_ID = "verify-cost-attribution-feature";
const VERDICT_COST_USD = 0.5;
const BUILD_COST_USD = 1.25;

// A high-confidence seed entry, pre-written rather than fetched live, so
// the matching call below is guaranteed to be a ledger cache hit (no API
// call, no flakiness from a live model call landing on a different
// confidence/coverage than expected).
writeFileSync(
  ledgerPath,
  JSON.stringify({
    id: "seed-0000-0000-0000-000000000000",
    timestamp: new Date().toISOString(),
    project_id: PROJECT_ID,
    feature_id: FEATURE_ID,
    component_need: "success or failure toast notification",
    domain: "test domain",
    framework: "React + Tailwind",
    checklist: ["a", "b"],
    checklist_source: "extracted",
    candidates_evaluated: [{ source: "shadcn", name: "Sonner toast", url: "https://example.com", coverage_pct: 100 }],
    verdict: "use_existing",
    chosen_candidate: "Sonner toast",
    confidence: "high",
    reason: "scored",
    coverage: "8/8 (100%)",
    cost_usd: VERDICT_COST_USD,
    cache_hit: false,
    project_conventions_snapshot: null,
  }) + "\n",
  "utf8"
);

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ok: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(projectRoot, "dist/index.js")],
  env: {
    ...process.env,
    // Never reached by either path this script exercises, but the server
    // reads it eagerly at startup for the Anthropic client constructor.
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "unused-not-needed-for-this-script",
    PATTERN_LEDGER_PATH: ledgerPath,
    PATTERN_BUILD_LEDGER_PATH: buildLedgerPath,
  },
});
const client = new Client({ name: "verify-cost-attribution", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);

console.log("1. A matching call against a seeded high-confidence entry is served from the ledger, free");
const cacheHitResult = await client.callTool({
  name: "recommend_component",
  arguments: {
    component_need: "success or failure toast notification",
    domain: "test domain",
    framework: "React + Tailwind",
    project_id: PROJECT_ID,
  },
});
const parsedCacheHit = JSON.parse(cacheHitResult.content[0].text);
check("served_from_ledger is true", parsedCacheHit.served_from_ledger === true);
check("cost is $0", parsedCacheHit._meta?.estimated_cost_usd === 0);

console.log("2. report_build_cost records a build against the same feature_id");
const buildResult = await client.callTool({
  name: "report_build_cost",
  arguments: { feature_id: FEATURE_ID, project_id: PROJECT_ID, tokens_used: 9000, cost_usd: BUILD_COST_USD, outcome: "shipped" },
});
const parsedBuild = JSON.parse(buildResult.content[0].text);
check("recorded successfully", parsedBuild.status === "recorded");
check("record carries the right feature_id", parsedBuild.record?.feature_id === FEATURE_ID);

console.log("3. read_ledger's feature_id rollup joins both records with no orphans");
const rollupResult = await client.callTool({ name: "read_ledger", arguments: { project_id: PROJECT_ID, feature_id: FEATURE_ID } });
const rollup = JSON.parse(rollupResult.content[0].text);
check("2 verdict_entries: the seed plus the cache-hit write", rollup.verdict_entries.length === 2);
check("1 build_record", rollup.build_records.length === 1);
const cacheHitEntry = rollup.verdict_entries.find((e) => e.cache_hit === true);
check("the cache-hit entry exists and inherited the seed's feature_id", cacheHitEntry?.feature_id === FEATURE_ID);
check("the cache-hit entry's own cost is $0 (not double-counted)", cacheHitEntry?.cost_usd === 0);
check(
  `total_cost_usd (${rollup.total_cost_usd}) equals the seed's real cost + the build cost (${VERDICT_COST_USD + BUILD_COST_USD})`,
  rollup.total_cost_usd === VERDICT_COST_USD + BUILD_COST_USD
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
await client.close();
process.exit(failures === 0 ? 0 : 1);
