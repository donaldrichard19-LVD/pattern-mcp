#!/usr/bin/env node
/**
 * eval-search-budget-2.mjs
 *
 * Cost/latency reduction plan, step 3 (BACKLOG.md): "Evaluate dropping
 * PATTERN_SEARCH_BUDGET's default from 3 to 2... Check against the
 * existing validation cases... before shipping." Unlike step 2, this can
 * change which candidates get found at all -- an accuracy risk, not just
 * a cost one.
 *
 * Reuses the budget=3 baseline already gathered in
 * instrument-cost-sample.mjs's run (same 4 cases, same session) rather
 * than re-spending on a fresh baseline. Runs the same 4 cases with
 * PATTERN_SEARCH_BUDGET=2 and compares verdict/coverage against that
 * baseline.
 *
 * Scope note: this is a single run per case at budget=2, not the
 * 3-repeated-runs-per-case rigor the staged-pipeline evaluation used --
 * a deliberate cost/effort tradeoff given known judgment variance across
 * runs (documented elsewhere in this project). A single-run signal here
 * is a first pass, not a final accuracy verdict; flagged as such in the
 * output.
 *
 * COSTS REAL MONEY: 4 real Anthropic API calls.
 *
 * Run: node scripts/eval-search-budget-2.mjs (after `npm run build`)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist/index.js");

// Baseline: real budget=3 results from instrument-cost-sample.mjs's run
// earlier this session (not re-fetched here to avoid double-spending).
const BASELINE = {
  "Host-guest messaging": { verdict: "use_existing", confidence: "low", coverage: "6/8 (75%)", cost_usd: 0.3086 },
  "Price breakdown with fees and taxes": { verdict: "custom_build", confidence: "high", coverage: null, cost_usd: 0.2042 },
  "Photo gallery": { verdict: "custom_build", confidence: "medium", coverage: "3/8 (37.5%)", cost_usd: 0.5207 },
  "Host earnings dashboard": { verdict: "use_existing", confidence: "low", coverage: "5/8 (62.5%)", cost_usd: 0.1075 },
};

const CASES = [
  { label: "Host-guest messaging", component_need: "host-guest in-app messaging thread with read receipts and typing indicator" },
  { label: "Price breakdown with fees and taxes", component_need: "price breakdown with fees and taxes" },
  { label: "Photo gallery", component_need: "photo gallery with hero image and thumbnail grid" },
  { label: "Host earnings dashboard", component_need: "host earnings dashboard with payout history and upcoming payout estimate" },
];

const CONTEXT = { domain: "Airbnb-style rental marketplace", framework: "React + Tailwind", existing_stack: "already using shadcn/ui" };

const transport = new StdioClientTransport({
  command: "node",
  args: [serverEntry],
  env: { ...process.env, PATTERN_SEARCH_BUDGET: "2" },
});
const client = new Client({ name: "eval-search-budget-2", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);

const rows = [];
for (const c of CASES) {
  console.log(`\n=== ${c.label} (budget=2) ===`);
  const res = await client.callTool(
    { name: "recommend_component", arguments: { component_need: c.component_need, ...CONTEXT } },
    undefined,
    { timeout: 600_000, resetTimeoutOnProgress: false, maxTotalTimeout: 600_000 }
  );
  const parsed = JSON.parse(res.content[0].text);
  const meta = parsed._meta ?? {};
  const base = BASELINE[c.label];
  const verdictMatch = parsed.verdict === base.verdict;
  console.log(`  budget=2: verdict=${parsed.verdict}, confidence=${parsed.confidence}, coverage=${parsed.coverage}, cost=$${meta.estimated_cost_usd}`);
  console.log(`  budget=3 baseline: verdict=${base.verdict}, confidence=${base.confidence}, coverage=${base.coverage}, cost=$${base.cost_usd}`);
  console.log(`  verdict match: ${verdictMatch ? "YES" : "NO -- DIVERGED"}`);
  rows.push({
    case: c.label,
    "budget=3 verdict": base.verdict,
    "budget=2 verdict": parsed.verdict,
    match: verdictMatch ? "yes" : "NO",
    "budget=3 $": base.cost_usd,
    "budget=2 $": meta.estimated_cost_usd,
  });
}

console.log("\n\n=== Summary ===");
console.table(rows);
const diverged = rows.filter((r) => r.match === "NO");
console.log(
  diverged.length === 0
    ? "\nAll 4 verdicts matched between budget=2 and budget=3 (single run each -- see script header on scope limits)."
    : `\n${diverged.length} of 4 verdict(s) diverged: ${diverged.map((r) => r.case).join(", ")}`
);

await client.close();
