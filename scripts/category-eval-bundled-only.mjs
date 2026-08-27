#!/usr/bin/env node
/**
 * Follow-up to validation-plan-staged-pipeline.md's Phase 3 pilot and
 * this project's "Category-level accuracy" section.
 *
 * Runs the bundled (shipped) pipeline ONLY -- no staged comparison, that
 * question is already settled -- 3 repeated runs per case, against
 * whichever eval/eval-set.json cases aren't already covered by
 * eval/phase3-comparison-log.json's 5-case pilot. Same methodology as
 * scripts/phase3-comparison.mjs's bundled arm: a real MCP tool call
 * against dist/index.js, one persistent server process.
 *
 * Usage: node scripts/category-eval-bundled-only.mjs
 * Writes: eval/category-bundled-only-log.json
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

const evalSet = JSON.parse(readFileSync(resolve(projectRoot, "eval/eval-set.json"), "utf8"));
const priorLog = JSON.parse(readFileSync(resolve(projectRoot, "eval/phase3-comparison-log.json"), "utf8"));
const alreadyCovered = new Set(priorLog.results.map((r) => r.id));

const RUNS_PER_ARCH = 3;
const cases = evalSet.cases.filter((c) => !alreadyCovered.has(c.id));

console.log(`${cases.length} cases to run (${alreadyCovered.size} already covered by the Phase 3 pilot):`);
console.log(cases.map((c) => `  ${c.id} (${c.category})`).join("\n"));

// ---- bundled architecture: real MCP tool call, one persistent server process ----
const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(projectRoot, "dist/index.js")],
  env: { ...process.env },
  stderr: "pipe",
});
const client = new Client({ name: "category-eval-bundled-only", version: "0.1.0" }, { capabilities: {} });
let bundledStderr = "";
await client.connect(transport);
transport.stderr.on("data", (c) => (bundledStderr += c.toString()));

function countBundledCalls(stderrSlice) {
  const matches = stderrSlice.match(/"diagnostic":"search_calls"/g) ?? [];
  return { llmCalls: matches.length };
}

async function runBundledOnce(c) {
  const before = bundledStderr.length;
  const result = await client.callTool(
    { name: "recommend_component", arguments: { component_need: c.component_need, domain: c.domain, framework: c.framework } },
    undefined,
    { timeout: 240_000 }
  );
  await new Promise((r) => setTimeout(r, 300));
  const slice = bundledStderr.slice(before);
  const parsed = JSON.parse(result.content[0].text);
  const { llmCalls } = countBundledCalls(slice);
  return { parsed, llmCalls: llmCalls || 1 };
}

const results = [];
for (const c of cases) {
  console.log(`\n=== ${c.id} (${c.category}) (gold: ${c.gold.verdict}, ${c.gold.coverage_estimate ?? "no_candidates_found"}) ===`);

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

  results.push({ id: c.id, category: c.category, gold: c.gold, bundledRuns });

  // flush after every case so a mid-run failure doesn't lose completed work
  const outPath = resolve(projectRoot, "eval/category-bundled-only-log.json");
  writeFileSync(
    outPath,
    JSON.stringify({ generated_at: new Date().toISOString(), runs_per_arch: RUNS_PER_ARCH, case_ids: cases.map((c) => c.id), results }, null, 2)
  );
}

await client.close();
console.log(`\nWrote eval/category-bundled-only-log.json (${results.length} cases)`);
