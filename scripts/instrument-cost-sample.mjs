#!/usr/bin/env node
/**
 * instrument-cost-sample.mjs
 *
 * Cost/latency reduction plan, step 1 (BACKLOG.md): "Expand the
 * instrumentation sample before sizing any cap change." Pulls the real
 * fresh/cache_write/cache_read token split from live recommend_component
 * calls spanning different shapes, to check whether the ~50% cache_read
 * share found on one prior toast-component call is stable regardless of
 * call complexity or scales with turn count.
 *
 * Reuses this project's own already-validated test cases (from
 * PRODUCT_BRIEF.md's five-case set) rather than new ones, so results are
 * comparable to prior documented findings, not a fresh unknown:
 *  - Host-guest messaging: clean single-pass use_existing (historically
 *    100% coverage, high confidence, consistent).
 *  - Price breakdown with fees and taxes: known custom_build case,
 *    triggers step 6's Mobbin/Figma Community fetches.
 *  - Photo gallery, Host earnings dashboard: both documented elsewhere in
 *    this project (README, Pattern Briefing) as boundary/inconsistent
 *    cases across repeated runs -- candidates for the ensemble actually
 *    firing live, though whether it does on any single run is inherently
 *    non-deterministic.
 *
 * No project_id is passed -- this is pure instrumentation, not something
 * that should write ledger entries.
 *
 * COSTS REAL MONEY: 4 real Anthropic API calls (one of which may
 * internally become 3 if the ensemble triggers). Run deliberately, not as
 * part of routine testing.
 *
 * Run: node scripts/instrument-cost-sample.mjs (after `npm run build`)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist/index.js");

const CASES = [
  {
    label: "Host-guest messaging (expected: clean use_existing)",
    component_need: "host-guest in-app messaging thread with read receipts and typing indicator",
  },
  {
    label: "Price breakdown with fees and taxes (expected: custom_build, Mobbin/Figma fetches)",
    component_need: "price breakdown with fees and taxes",
  },
  {
    label: "Photo gallery (expected: possible boundary/ensemble)",
    component_need: "photo gallery with hero image and thumbnail grid",
  },
  {
    label: "Host earnings dashboard (expected: possible boundary/ensemble)",
    component_need: "host earnings dashboard with payout history and upcoming payout estimate",
  },
];

const CONTEXT = {
  domain: "Airbnb-style rental marketplace",
  framework: "React + Tailwind",
  existing_stack: "already using shadcn/ui",
};

const transport = new StdioClientTransport({ command: "node", args: [serverEntry], env: process.env });
const client = new Client({ name: "instrument-cost-sample", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);

const results = [];
for (const c of CASES) {
  console.log(`\n=== ${c.label} ===`);
  const start = Date.now();
  const res = await client.callTool(
    {
      name: "recommend_component",
      arguments: { component_need: c.component_need, ...CONTEXT },
    },
    undefined,
    // Real calls run 55s-330s per this project's own documented data
    // (longer when the boundary-risk ensemble fires) -- well past the
    // MCP SDK's 60s default request timeout.
    { timeout: 600_000, resetTimeoutOnProgress: false, maxTotalTimeout: 600_000 }
  );
  const wallMs = Date.now() - start;
  const parsed = JSON.parse(res.content[0].text);
  const meta = parsed._meta ?? {};
  const breakdown = meta.tokens_used?.input_breakdown;
  const total = breakdown ? breakdown.fresh + breakdown.cache_write + breakdown.cache_read : null;
  const cacheReadShare = total ? ((breakdown.cache_read / total) * 100).toFixed(1) : "n/a";

  console.log(`  verdict: ${parsed.verdict}, confidence: ${parsed.confidence}, coverage: ${parsed.coverage}`);
  console.log(`  ensemble triggered: ${parsed.ensemble?.triggered ?? false}${parsed.ensemble?.triggered ? ` (${parsed.ensemble.agreement})` : ""}`);
  console.log(`  wall clock: ${wallMs}ms, reported total_ms: ${meta.total_ms}`);
  console.log(`  estimated_cost_usd: $${meta.estimated_cost_usd}`);
  if (breakdown) {
    console.log(`  tokens_used.input_breakdown: fresh=${breakdown.fresh}, cache_write=${breakdown.cache_write}, cache_read=${breakdown.cache_read} (total input=${total})`);
    console.log(`  cache_read share of input tokens: ${cacheReadShare}%`);
  } else {
    console.log(`  no input_breakdown present (unexpected -- check instrumentation)`);
  }

  results.push({
    label: c.label,
    verdict: parsed.verdict,
    ensemble_triggered: parsed.ensemble?.triggered ?? false,
    cost_usd: meta.estimated_cost_usd,
    total_ms: meta.total_ms,
    breakdown,
    cache_read_share_pct: cacheReadShare,
  });
}

console.log("\n\n=== Summary ===");
console.table(
  results.map((r) => ({
    case: r.label.split(" (")[0],
    verdict: r.verdict,
    ensemble: r.ensemble_triggered,
    cost_usd: r.cost_usd,
    total_ms: r.total_ms,
    cache_read_pct: r.cache_read_share_pct,
  }))
);

await client.close();
