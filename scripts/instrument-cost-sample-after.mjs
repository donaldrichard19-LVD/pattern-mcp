#!/usr/bin/env node
/**
 * instrument-cost-sample-after.mjs
 *
 * Cost/latency reduction plan, step 2 remeasurement (BACKLOG.md: "Re-run
 * the same instrumented sample set after shipping and compare total cost
 * and the fresh/cache_read split directly"). Scoped to 2 of the original
 * 4 cases (not all 4) to control real spend: one use_existing case (step
 * 4's fetch actually exercised, confirming the new, lower
 * PATTERN_FETCH_MAX_CONTENT_TOKENS default doesn't truncate a real doc
 * page) and one custom_build case (confirms the Mobbin/Figma path still
 * works under the new cap).
 *
 * COSTS REAL MONEY: 2 real Anthropic API calls.
 *
 * Run: node scripts/instrument-cost-sample-after.mjs (after `npm run build`)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist/index.js");

const CASES = [
  {
    label: "Host-guest messaging (use_existing, exercises step 4's fetch)",
    component_need: "host-guest in-app messaging thread with read receipts and typing indicator",
  },
  {
    label: "Price breakdown with fees and taxes (custom_build, Mobbin/Figma path)",
    component_need: "price breakdown with fees and taxes",
  },
];

const CONTEXT = {
  domain: "Airbnb-style rental marketplace",
  framework: "React + Tailwind",
  existing_stack: "already using shadcn/ui",
};

const transport = new StdioClientTransport({ command: "node", args: [serverEntry], env: process.env });
const client = new Client({ name: "instrument-cost-sample-after", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);

const results = [];
for (const c of CASES) {
  console.log(`\n=== ${c.label} ===`);
  const res = await client.callTool(
    { name: "recommend_component", arguments: { component_need: c.component_need, ...CONTEXT } },
    undefined,
    { timeout: 600_000, resetTimeoutOnProgress: false, maxTotalTimeout: 600_000 }
  );
  const parsed = JSON.parse(res.content[0].text);
  const meta = parsed._meta ?? {};
  const breakdown = meta.tokens_used?.input_breakdown;
  const total = breakdown ? breakdown.fresh + breakdown.cache_write + breakdown.cache_read : null;

  console.log(`  verdict: ${parsed.verdict}, confidence: ${parsed.confidence}, coverage: ${parsed.coverage}`);
  console.log(`  ensemble triggered: ${parsed.ensemble?.triggered ?? false}`);
  console.log(`  estimated_cost_usd: $${meta.estimated_cost_usd}`);
  if (breakdown) {
    console.log(
      `  input_breakdown: fresh=${breakdown.fresh} (${((breakdown.fresh / total) * 100).toFixed(1)}%), cache_write=${breakdown.cache_write} (${((breakdown.cache_write / total) * 100).toFixed(1)}%), cache_read=${breakdown.cache_read} (${((breakdown.cache_read / total) * 100).toFixed(1)}%)`
    );
  }
  results.push({ label: c.label, verdict: parsed.verdict, cost_usd: meta.estimated_cost_usd, breakdown });
}

console.log("\n\n=== Summary (after PATTERN_FETCH_MAX_CONTENT_TOKENS=12000) ===");
console.table(results.map((r) => ({ case: r.label.split(" (")[0], verdict: r.verdict, cost_usd: r.cost_usd })));

await client.close();
