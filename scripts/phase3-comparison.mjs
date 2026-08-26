#!/usr/bin/env node
/**
 * Phase 3 of validation-plan-staged-pipeline.md: head-to-head comparison
 * of the bundled pipeline (src/index.ts, invoked as a real MCP tool call
 * exactly as a production client would) against the staged pipeline
 * (src/staged/, invoked directly) on the same eval set.
 *
 * Measures, per the plan:
 *   1. Accuracy against gold answers
 *   2. Consistency across repeated (outer) runs
 *   3. Cost, by raw call count (same measurement convention the README's
 *      own Cost section already uses -- not token-level accounting)
 * Diagnosability (plan metric 3) is deliberately NOT automated here --
 * the plan calls for it to be "measured, not assumed" by a human timing
 * themselves root-causing real disagreements from this run's own output,
 * which happens as a follow-up analysis pass, not inside this script.
 *
 * Usage: node scripts/phase3-comparison.mjs [caseId1,caseId2,...]
 *   No args -> runs the default 5-case pilot.
 * Writes: eval/phase3-comparison-log.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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

const PILOT_IDS = ["search-map-toggle", "availability-calendar", "image-gallery", "date-range-picker", "host-earnings-dashboard"];
const caseIds = process.argv[2] ? process.argv[2].split(",") : PILOT_IDS;
const RUNS_PER_ARCH = 3;

const cases = evalSet.cases.filter((c) => caseIds.includes(c.id));

// ---- bundled architecture: real MCP tool call, one persistent server process ----
const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(projectRoot, "dist/index.js")],
  env: { ...process.env },
  stderr: "pipe",
});
const client = new Client({ name: "phase3-comparison", version: "0.1.0" }, { capabilities: {} });
let bundledStderr = "";
await client.connect(transport);
transport.stderr.on("data", (c) => (bundledStderr += c.toString()));

function countBundledCalls(stderrSlice) {
  // Each recommend_component invocation logs one or three
  // "search_calls" diagnostic lines (three only if the ensemble fired) --
  // count those as a proxy for total raw API calls this run made.
  const matches = stderrSlice.match(/"diagnostic":"search_calls"/g) ?? [];
  const ensembleTriggered = /"diagnostic":"ensemble_triggered"/.test(stderrSlice);
  return { llmCalls: matches.length, ensembleTriggered };
}

async function runBundledOnce(c) {
  const before = bundledStderr.length;
  const result = await client.callTool(
    { name: "recommend_component", arguments: { component_need: c.component_need, domain: c.domain, framework: c.framework } },
    undefined,
    { timeout: 240_000 }
  );
  await new Promise((r) => setTimeout(r, 300)); // let stderr flush
  const slice = bundledStderr.slice(before);
  const parsed = JSON.parse(result.content[0].text);
  const { llmCalls } = countBundledCalls(slice);
  return { parsed, llmCalls: llmCalls || 1 };
}

// ---- staged architecture: direct function call ----
function countStagedCalls(log) {
  return log.length; // one entry per stage call, already 1:1 with raw API calls
}

async function runStagedOnce(c) {
  const { result, log } = await runStagedPipeline({ component_need: c.component_need, domain: c.domain, framework: c.framework });
  return { parsed: result, llmCalls: countStagedCalls(log), log };
}

// ---- run both architectures, RUNS_PER_ARCH outer runs each, per case ----
const results = [];
for (const c of cases) {
  console.log(`\n=== ${c.id} (gold: ${c.gold.verdict}, ${c.gold.coverage_estimate ?? "no_candidates_found"}) ===`);

  const bundledRuns = [];
  for (let i = 0; i < RUNS_PER_ARCH; i++) {
    process.stdout.write(`  bundled run ${i + 1}/${RUNS_PER_ARCH}... `);
    try {
      const r = await runBundledOnce(c);
      console.log(r.parsed.verdict, "|", r.parsed.coverage ?? r.parsed.reason, "| calls:", r.llmCalls);
      bundledRuns.push({ ok: true, ...r });
    } catch (err) {
      console.log("FAILED:", err.message);
      bundledRuns.push({ ok: false, error: err.message });
    }
  }

  const stagedRuns = [];
  for (let i = 0; i < RUNS_PER_ARCH; i++) {
    process.stdout.write(`  staged  run ${i + 1}/${RUNS_PER_ARCH}... `);
    try {
      const r = await runStagedOnce(c);
      console.log(r.parsed.verdict, "|", r.parsed.coverage ?? r.parsed.reason, "| calls:", r.llmCalls);
      stagedRuns.push({ ok: true, ...r });
    } catch (err) {
      console.log("FAILED:", err.message);
      stagedRuns.push({ ok: false, error: err.message });
    }
  }

  results.push({ id: c.id, gold: c.gold, bundledRuns, stagedRuns });
}

await client.close();

const outPath = resolve(projectRoot, "eval/phase3-comparison-log.json");
writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), runs_per_arch: RUNS_PER_ARCH, case_ids: caseIds, results }, null, 2));
console.log(`\nWrote ${outPath}`);
