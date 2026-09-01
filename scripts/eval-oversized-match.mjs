#!/usr/bin/env node
/**
 * Minimal Oversized Match eval harness -- Track A only, 4 scenarios.
 *
 * Scoped-down version of the full pattern-eval-harness-plan.md (see
 * BACKLOG.md / project history): runs only the 4 focus-subset scenarios
 * (the 3 proportionality-risk cases + 1 regression-watch case) instead of
 * the full ~37-case Shelfline set, and Track A only (default extraction,
 * no hand-fixed checklist) -- Track B and the full regression sweep are
 * deferred until there's a reason to need them. See the harness plan for
 * why: this answers the actual decision-gate question (does the cheap
 * fix work?) for a fraction of the cost/time.
 *
 * Component need / domain / framework text is copied verbatim from
 * eval/eval-set-shelfline.json so results stay comparable with that
 * file's existing gold data, but this script does NOT read that file --
 * it's self-contained so a round's results can't accidentally pick up an
 * edit to the eval set mid-comparison.
 *
 * NOTE on "checkout": the eval harness plan describes this as a negative
 * control expected to stay custom_build regardless of round. That
 * assumption is wrong per this repo's own already-verified evidence --
 * eval/eval-set-shelfline.json's gold entry for "checkout" independently
 * confirmed (against real reui.io docs) that use_existing is the correct
 * answer, at ~75% coverage, low confidence. This script treats checkout
 * as a regression watch instead: its verdict/coverage/confidence should
 * stay roughly where they already were (use_existing, low confidence,
 * ensemble likely triggered), not flip to something that suggests the
 * Oversized Match change broke ordinary scoring.
 *
 * Usage:
 *   node scripts/eval-oversized-match.mjs <round-label>
 *   e.g. node scripts/eval-oversized-match.mjs round0-baseline
 *        node scripts/eval-oversized-match.mjs round1-oversized-match-fix
 *
 * Writes eval/oversized-match-<round-label>.json
 *
 * Deliberately never passes project_id -- passing one would risk a
 * ledger cache hit serving a stale verdict from an earlier round instead
 * of scoring fresh, which would silently break the whole comparison (see
 * findLedgerCacheHit in src/index.ts). Track A only, so no checklist
 * param either.
 *
 * Real cost: 4 recommend_component calls, one of which (checkout) is
 * already known to trigger the boundary-risk ensemble (~3x that call's
 * cost). Comfortably inside the default PATTERN_SESSION_CAP (40).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

if (!process.env.ANTHROPIC_API_KEY) {
  const envText = readFileSync(resolve(projectRoot, ".env"), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const roundLabel = process.argv[2];
if (!roundLabel) {
  console.error("Usage: node scripts/eval-oversized-match.mjs <round-label>");
  process.exit(1);
}

const DOMAIN =
  "Shelfline -- white-label e-commerce storefront + seller dashboard SaaS for independent brands (apparel, home goods, specialty food), starter tier (<500 SKUs)";
const FRAMEWORK = "Next.js (App Router) + Tailwind, TypeScript";

const SCENARIOS = [
  {
    id: "filter-sidebar",
    category: "proportionality_risk",
    component_need:
      "Category page filter sidebar with checkbox groups for size, color, and price range, collapsible on mobile into a slide-over panel",
  },
  {
    id: "product-table",
    category: "proportionality_risk",
    component_need:
      "Product list table with inline status toggle (active/draft), thumbnail, name, price, and inventory count, for a catalog of roughly 50-500 products, with basic column sort but no need for column reordering, grouping, or pivoting",
  },
  {
    id: "order-table",
    category: "proportionality_risk",
    component_need:
      "Order list table with filter by status and date range, and search by order number or customer name, for order volumes in the low thousands per month at this tier",
  },
  {
    id: "checkout",
    category: "regression_watch",
    component_need:
      "Multi-step checkout (shipping info -> payment -> review) for a simple single-address, single-payment-method flow -- no split payments, no multi-currency, no saved-address book beyond what Stripe Elements already handles",
  },
];

console.log(`Running ${SCENARIOS.length} scenario(s), round="${roundLabel}"`);
console.log("PATTERN_SESSION_CAP:", process.env.PATTERN_SESSION_CAP ?? "40 (default)");
console.log("PATTERN_TELEMETRY:", process.env.PATTERN_TELEMETRY ?? "unset (off)");

const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(projectRoot, "dist/index.js")],
  env: { ...process.env },
  stderr: "pipe",
});
const client = new Client({ name: "eval-oversized-match", version: "0.1.0" }, { capabilities: {} });
let stderrBuf = "";
await client.connect(transport);
transport.stderr?.on("data", (c) => (stderrBuf += c.toString()));

const results = [];
for (const s of SCENARIOS) {
  process.stdout.write(`\n[${s.id}] "${s.component_need.slice(0, 70)}..."\n`);
  const t0 = Date.now();
  try {
    const callResult = await client.callTool(
      {
        name: "recommend_component",
        arguments: { component_need: s.component_need, domain: DOMAIN, framework: FRAMEWORK },
      },
      undefined,
      { timeout: 300_000 }
    );
    const text = callResult.content[0].text;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.log(`  NON-JSON RESPONSE (elapsed ${Date.now() - t0}ms): ${text.slice(0, 300)}`);
      results.push({ id: s.id, category: s.category, error: "non-json response", raw: text.slice(0, 1000) });
      continue;
    }
    console.log(
      `  verdict=${parsed.verdict} confidence=${parsed.confidence} coverage=${parsed.coverage ?? "n/a"} ` +
        `ensemble=${parsed.ensemble?.triggered ?? false} cost=$${parsed._meta?.estimated_cost_usd ?? "n/a"} elapsed=${Date.now() - t0}ms`
    );
    if (parsed.recommendation?.component_description) {
      console.log(`  component_description: ${parsed.recommendation.component_description}`);
    }
    if (parsed.recommendation?.source) {
      console.log(`  source: ${parsed.recommendation.source}`);
    }
    results.push({
      id: s.id,
      category: s.category,
      round: roundLabel,
      component_need: s.component_need,
      verdict: parsed.verdict,
      confidence: parsed.confidence,
      reason: parsed.reason,
      coverage: parsed.coverage ?? null,
      ensemble: parsed.ensemble ?? null,
      requirements_checked: parsed.requirements_checked ?? null,
      recommendation: parsed.recommendation ?? null,
      _meta: parsed._meta ?? null,
    });
  } catch (err) {
    console.log(`  ERROR (elapsed ${Date.now() - t0}ms): ${err.message}`);
    results.push({ id: s.id, category: s.category, round: roundLabel, error: err.message });
  }
}

await client.close();

const outPath = resolve(projectRoot, `eval/oversized-match-${roundLabel}.json`);
writeFileSync(
  outPath,
  JSON.stringify({ generated_at: new Date().toISOString(), round: roundLabel, domain: DOMAIN, framework: FRAMEWORK, results }, null, 2)
);
console.log(`\nWrote ${outPath}`);
