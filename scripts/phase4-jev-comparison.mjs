#!/usr/bin/env node
/**
 * Phase 4 (Pattern x Jev spike plan): head-to-head comparison of the
 * Sonnet scorer (src/staged/score.ts) against the Jev scorer
 * (src/staged/score-jev.ts) on IDENTICAL evidence, so the comparison
 * isolates the scoring step and nothing else.
 *
 * Why identical evidence matters: extraction and search stay on Sonnet
 * either way (Jev has no web_search), so this script runs the real
 * search stage ONCE per case, against eval-set.json's own hand-written
 * gold requirements (not re-extracted requirements -- using gold's
 * requirements directly means both scorers are graded against the exact
 * same per-requirement expected_met labels the eval set already has).
 * Both scorers then score that same candidate list. Any difference in
 * the results is attributable to the scorer, not to different evidence.
 *
 * Requires:
 *   ANTHROPIC_API_KEY  (search stage -- real web_search calls, real cost)
 *   TYPESAFE_API_KEY   (Jev scorer)
 *
 * Usage: node scripts/phase4-jev-comparison.mjs [caseId1,caseId2,...]
 *   No args -> runs all 25 cases in eval/eval-set.json.
 * Writes: eval/phase4-jev-comparison-log.json
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

for (const key of ["ANTHROPIC_API_KEY", "TYPESAFE_API_KEY"]) {
  if (!process.env[key] && existsSync(resolve(projectRoot, ".env"))) {
    const envText = readFileSync(resolve(projectRoot, ".env"), "utf8");
    for (const line of envText.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2];
    }
    break;
  }
}
for (const key of ["ANTHROPIC_API_KEY", "TYPESAFE_API_KEY"]) {
  if (!process.env[key]) {
    console.error(`Missing ${key}. Set it in the environment or in a .env file at the project root.`);
    process.exit(1);
  }
}

const { searchCandidates } = await import(resolve(projectRoot, "dist/staged/search.js"));
const { scoreCandidates } = await import(resolve(projectRoot, "dist/staged/score.js"));
const { scoreCandidatesJev } = await import(resolve(projectRoot, "dist/staged/score-jev.js"));

const evalSet = JSON.parse(readFileSync(resolve(projectRoot, "eval/eval-set.json"), "utf8"));
const caseIds = process.argv[2] ? process.argv[2].split(",") : null;
const cases = evalSet.cases.filter((c) => !caseIds || caseIds.includes(c.id));

function requirementTexts(c) {
  return c.gold.requirements.map((r) => r.requirement);
}

function goldMap(c) {
  const m = new Map();
  for (const r of c.gold.requirements) m.set(r.requirement, r.expected_met);
  return m;
}

function scoreAgainstGold(requirementsChecked, gold) {
  if (!requirementsChecked) return { correct: 0, total: gold.size, misses: [...gold.keys()] };
  let correct = 0;
  const misses = [];
  for (const item of requirementsChecked) {
    const expected = gold.get(item.requirement);
    if (expected === undefined) continue; // requirement text didn't round-trip exactly; shouldn't happen since we pass gold's own text in
    if (item.met === expected) correct += 1;
    else misses.push(item.requirement);
  }
  return { correct, total: gold.size, misses };
}

const results = [];
let caseIndex = 0;
for (const c of cases) {
  caseIndex += 1;
  console.log(`\n=== [${caseIndex}/${cases.length}] ${c.id} (gold verdict: ${c.gold.verdict}) ===`);
  const requirements = requirementTexts(c);
  const gold = goldMap(c);

  if (c.gold.reason === "no_candidates_found") {
    console.log("  gold expects no_candidates_found -- skipping scorer comparison (nothing to score), recording as-is.");
    results.push({ id: c.id, gold: c.gold, skipped: "no_candidates_found" });
    continue;
  }

  let search;
  try {
    process.stdout.write("  search (Sonnet, shared evidence for both scorers)... ");
    const t0 = Date.now();
    search = await searchCandidates({ component_need: c.component_need, domain: c.domain, framework: c.framework }, requirements);
    console.log(`${search.candidates.length} candidate(s), ${Date.now() - t0}ms`);
  } catch (err) {
    console.log("FAILED:", err.message);
    results.push({ id: c.id, gold: c.gold, error: `search: ${err.message}` });
    continue;
  }

  let sonnet;
  try {
    process.stdout.write("  score (Sonnet)... ");
    const t0 = Date.now();
    const raw = await scoreCandidates({ component_need: c.component_need, domain: c.domain, framework: c.framework }, requirements, search.candidates);
    const ms = Date.now() - t0;
    const grade = scoreAgainstGold(raw.requirements_checked, gold);
    console.log(`${raw.reason} | ${raw.coverage ?? "n/a"} | ${grade.correct}/${grade.total} vs gold | ${ms}ms`);
    sonnet = { raw, ms, grade };
  } catch (err) {
    console.log("FAILED:", err.message);
    sonnet = { error: err.message };
  }

  let jev;
  try {
    process.stdout.write("  score (Jev)...    ");
    const t0 = Date.now();
    const raw = await scoreCandidatesJev(c.component_need, c.domain, requirements, search.candidates);
    const ms = Date.now() - t0;
    const grade = scoreAgainstGold(raw.requirements_checked, gold);
    console.log(`${raw.reason} | ${raw.coverage ?? "n/a"} | ${grade.correct}/${grade.total} vs gold | ${ms}ms`);
    jev = { raw, ms, grade };
  } catch (err) {
    console.log("FAILED:", err.message);
    jev = { error: err.message };
  }

  results.push({ id: c.id, gold: c.gold, candidates: search.candidates, sonnet, jev });
}

// ---- summary ----
let sonnetCorrect = 0, sonnetTotal = 0, jevCorrect = 0, jevTotal = 0;
let sonnetMs = 0, jevMs = 0, comparableCases = 0;
const calibrationBuckets = {}; // "0.0-0.2" -> { metCount, total }
for (const r of results) {
  if (r.skipped || r.error) continue;
  comparableCases += 1;
  if (r.sonnet?.grade) { sonnetCorrect += r.sonnet.grade.correct; sonnetTotal += r.sonnet.grade.total; sonnetMs += r.sonnet.ms; }
  if (r.jev?.grade) { jevCorrect += r.jev.grade.correct; jevTotal += r.jev.grade.total; jevMs += r.jev.ms; }
  if (r.jev?.raw?.per_candidate) {
    const gold = goldMap(evalSet.cases.find((c) => c.id === r.id));
    for (const cand of r.jev.raw.per_candidate) {
      for (const [requirement, p] of Object.entries(cand.probabilities)) {
        const bucket = `${(Math.floor(p * 5) / 5).toFixed(1)}-${(Math.floor(p * 5) / 5 + 0.2).toFixed(1)}`;
        calibrationBuckets[bucket] ??= { metCount: 0, total: 0 };
        calibrationBuckets[bucket].total += 1;
        if (gold.get(requirement)) calibrationBuckets[bucket].metCount += 1;
      }
    }
  }
}

console.log("\n=== Summary ===");
console.log(`Comparable cases: ${comparableCases}/${cases.length}`);
console.log(`Sonnet per-requirement accuracy: ${sonnetTotal ? ((sonnetCorrect / sonnetTotal) * 100).toFixed(1) : "n/a"}% (${sonnetCorrect}/${sonnetTotal}), avg ${comparableCases ? Math.round(sonnetMs / comparableCases) : 0}ms/case`);
console.log(`Jev    per-requirement accuracy: ${jevTotal ? ((jevCorrect / jevTotal) * 100).toFixed(1) : "n/a"}% (${jevCorrect}/${jevTotal}), avg ${comparableCases ? Math.round(jevMs / comparableCases) : 0}ms/case`);
console.log("\nJev calibration (bucket -> fraction of gold-met requirements in that probability bucket; should roughly match the bucket if calibrated):");
for (const [bucket, { metCount, total }] of Object.entries(calibrationBuckets).sort()) {
  console.log(`  ${bucket}: ${((metCount / total) * 100).toFixed(0)}% met (n=${total})`);
}

const outPath = resolve(projectRoot, "eval/phase4-jev-comparison-log.json");
writeFileSync(
  outPath,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      case_ids: caseIds ?? "all",
      summary: {
        comparable_cases: comparableCases,
        sonnet: { correct: sonnetCorrect, total: sonnetTotal, avg_ms: comparableCases ? sonnetMs / comparableCases : null },
        jev: { correct: jevCorrect, total: jevTotal, avg_ms: comparableCases ? jevMs / comparableCases : null },
        jev_calibration_buckets: calibrationBuckets,
      },
      results,
    },
    null,
    2
  )
);
console.log(`\nWrote ${outPath}`);
