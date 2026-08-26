#!/usr/bin/env node
/**
 * Support script for tightening eval/eval-set.json's gold answers.
 * Runs the real staged extraction stage (src/staged/extract.ts) once
 * per case across the full 25-case eval set, as an independent
 * cross-check against the hand-written gold requirements -- not to
 * replace hand judgment, but to catch cases where gold was graded more
 * loosely than a rigorous, specific checklist actually demands (as
 * happened with date-range-picker during the Phase 2 smoke test).
 *
 * Usage: node scripts/phase0-tighten-gold-extraction.mjs
 * Writes: eval/gold-tightening-extraction.json
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

const { extractRequirements } = await import(resolve(projectRoot, "dist/staged/extract.js"));
const evalSet = JSON.parse(readFileSync(resolve(projectRoot, "eval/eval-set.json"), "utf8"));

const results = [];
for (const c of evalSet.cases) {
  process.stdout.write(`${c.id}... `);
  try {
    const { requirements } = await extractRequirements({ component_need: c.component_need, domain: c.domain, framework: c.framework });
    console.log("ok");
    results.push({ id: c.id, gold_requirements: c.gold.requirements.map((r) => r.requirement), model_requirements: requirements });
  } catch (err) {
    console.log("FAILED:", err.message);
    results.push({ id: c.id, error: err.message });
  }
}

const outPath = resolve(projectRoot, "eval/gold-tightening-extraction.json");
writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2));
console.log(`\nWrote ${outPath}`);
