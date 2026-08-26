#!/usr/bin/env node
/**
 * Phase 2 smoke test for validation-plan-staged-pipeline.md -- confirms
 * the staged pipeline (src/staged/) actually runs end-to-end and
 * produces sane, independently-logged output before Phase 3's full
 * 25-case head-to-head comparison. Not the comparison itself.
 *
 * Usage: node scripts/phase2-staged-smoke-test.mjs
 * Writes: eval/phase2-smoke-test-log.json
 */
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

const { runStagedPipeline } = await import(resolve(projectRoot, "dist/staged/pipeline.js"));
const evalSet = JSON.parse(readFileSync(resolve(projectRoot, "eval/eval-set.json"), "utf8"));

// Deliberately small and varied: a clear custom_build (exercises the
// reference stage), a clear use_existing (confirms reference is skipped),
// and a skip-list-adjacent gut check is NOT included here since none of
// the 25 eval cases are skip-listed by design -- that path is already
// covered by isSkipListMatch's own unit-level behavior in src/index.ts.
const SMOKE_IDS = ["price-breakdown", "date-range-picker"];

const results = [];
for (const id of SMOKE_IDS) {
  const c = evalSet.cases.find((x) => x.id === id);
  console.log(`=== ${id} (gold: ${c.gold.verdict}) ===`);
  try {
    const { result, log } = await runStagedPipeline({
      component_need: c.component_need,
      domain: c.domain,
      framework: c.framework,
    });
    console.log("  verdict:", result.verdict, "| confidence:", result.confidence, "| reason:", result.reason, "| coverage:", result.coverage);
    console.log("  stages logged:", log.map((l) => `${l.stage}${l.ok ? "" : " (FAILED)"}`).join(" -> "));
    console.log("  ensemble:", JSON.stringify(result.ensemble));
    results.push({ id, gold_verdict: c.gold.verdict, ok: true, result, log });
  } catch (err) {
    console.log("  FAILED:", err.message);
    results.push({ id, gold_verdict: c.gold.verdict, ok: false, error: err.message });
  }
  console.log();
}

const outPath = resolve(projectRoot, "eval/phase2-smoke-test-log.json");
writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2));
console.log(`Wrote ${outPath}`);
