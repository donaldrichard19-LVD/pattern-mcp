#!/usr/bin/env node
/**
 * Generalized eval-set runner: calls recommend_component against the real
 * shipped MCP server (dist/index.js) for each case in a given eval-set
 * JSON file, and compares the verdict against that case's gold answer.
 *
 * Works with any eval-set file following the eval/eval-set.json /
 * eval/eval-set-shelfline.json schema: a top-level { _meta: { domain,
 * framework }, cases: [{ id, component_need, domain?, framework?, gold }] }
 * shape, where per-case domain/framework override the file's _meta
 * defaults when present.
 *
 * Usage:
 *   node scripts/run-eval-set.mjs <path-to-eval-set.json> [--ids=id1,id2,...]
 *
 * --ids limits the run to specific case ids (comma-separated) -- useful
 * for cheaply re-running just a known regression case instead of paying
 * for the whole set. Omit to run every case in the file.
 *
 * Writes a sibling log file: <eval-set-file>.run-log.json
 *
 * Real cost: one recommend_component call per case run, some of which may
 * trigger the 3x boundary-risk ensemble.
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

const evalSetPath = process.argv[2];
if (!evalSetPath) {
  console.error("Usage: node scripts/run-eval-set.mjs <path-to-eval-set.json> [--ids=id1,id2,...]");
  process.exit(1);
}
const idsArg = process.argv.find((a) => a.startsWith("--ids="));
const idFilter = idsArg ? new Set(idsArg.slice("--ids=".length).split(",")) : null;

const evalSet = JSON.parse(readFileSync(resolve(projectRoot, evalSetPath), "utf8"));
const cases = idFilter ? evalSet.cases.filter((c) => idFilter.has(c.id)) : evalSet.cases;

console.log(`Running ${cases.length} case(s) from ${evalSetPath}${idFilter ? ` (filtered to: ${[...idFilter].join(", ")})` : ""}`);

const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(projectRoot, "dist/index.js")],
  env: { ...process.env },
  stderr: "pipe",
});
const client = new Client({ name: "run-eval-set", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);

const results = [];
for (const c of cases) {
  const domain = c.domain ?? evalSet._meta?.domain;
  const framework = c.framework ?? evalSet._meta?.framework;
  process.stdout.write(`\n[${c.id}] "${c.component_need.slice(0, 60)}${c.component_need.length > 60 ? "..." : ""}"\n`);
  const t0 = Date.now();
  try {
    const callResult = await client.callTool(
      { name: "recommend_component", arguments: { component_need: c.component_need, domain, framework } },
      undefined,
      { timeout: 240_000 }
    );
    const text = callResult.content[0].text;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.log(`  NON-JSON RESPONSE (elapsed ${Date.now() - t0}ms): ${text.slice(0, 300)}`);
      results.push({ id: c.id, error: "non-json response" });
      continue;
    }
    const verdictMatch = c.gold?.verdict ? parsed.verdict === c.gold.verdict : null;
    console.log(
      `  verdict=${parsed.verdict} (gold=${c.gold?.verdict ?? "n/a"}${verdictMatch === null ? "" : verdictMatch ? ", MATCH" : ", MISMATCH"}) confidence=${parsed.confidence} coverage=${parsed.coverage ?? "n/a"} ensemble=${parsed.ensemble?.triggered ?? false} elapsed=${Date.now() - t0}ms`
    );
    if (parsed._meta?.scoring_fetch) {
      console.log(`  scoring_fetch: ${JSON.stringify(parsed._meta.scoring_fetch)}`);
    }
    results.push({
      id: c.id,
      verdict: parsed.verdict,
      gold_verdict: c.gold?.verdict ?? null,
      verdict_match: verdictMatch,
      confidence: parsed.confidence,
      coverage: parsed.coverage,
      ensemble: parsed.ensemble,
      requirements_checked: parsed.requirements_checked,
      recommendation: parsed.recommendation,
      _meta: parsed._meta,
    });
  } catch (err) {
    console.log(`  ERROR (elapsed ${Date.now() - t0}ms): ${err.message}`);
    results.push({ id: c.id, error: err.message });
  }

  const logPath = evalSetPath.replace(/\.json$/, ".run-log.json");
  writeFileSync(resolve(projectRoot, logPath), JSON.stringify({ generated_at: new Date().toISOString(), eval_set: evalSetPath, results }, null, 2));
}

await client.close();
console.log(`\nWrote ${evalSetPath.replace(/\.json$/, ".run-log.json")}`);
