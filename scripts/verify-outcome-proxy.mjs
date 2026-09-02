#!/usr/bin/env node
/**
 * verify-outcome-proxy.mjs
 *
 * Standalone check for the cost-attribution build plan's Phase 2 (Gate 2
 * criteria): report_outcome_proxy records join to a feature_id, multiple
 * reports over time merge into one latest-value-per-field view without
 * losing earlier fields, and 2.4's exclusion holds (nothing here ever
 * reads coverage_pct/confidence/any Pattern-produced field -- true by
 * construction, since this whole path takes only what the caller passes).
 * Spawns the real MCP server over stdio against a temp ledger dir, no
 * Anthropic API call at any point -- free and deterministic to run.
 *
 * Run: node scripts/verify-outcome-proxy.mjs (after `npm run build`)
 * Exits non-zero on any failed assertion.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "pattern-verify-outcome-proxy-"));

const PROJECT_ID = "verify-outcome-proxy-project";
const FEATURE_ID = "verify-outcome-proxy-feature";

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ok: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(projectRoot, "dist/index.js")],
  env: {
    ...process.env,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "unused-not-needed-for-this-script",
    PATTERN_LEDGER_PATH: join(tmp, "ledger.jsonl"),
    PATTERN_BUILD_LEDGER_PATH: join(tmp, "build_ledger.jsonl"),
    PATTERN_OUTCOME_PROXY_PATH: join(tmp, "outcome_proxies.jsonl"),
  },
});
const client = new Client({ name: "verify-outcome-proxy", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);

console.log("1. report_outcome_proxy rejects an empty report (no metric fields)");
const emptyResult = await client.callTool({
  name: "report_outcome_proxy",
  arguments: { feature_id: FEATURE_ID, project_id: PROJECT_ID },
});
check("call errors rather than silently recording nothing", emptyResult.isError === true);

console.log("2. First report: time_to_merge_hours only, right after merge");
const r1 = await client.callTool({
  name: "report_outcome_proxy",
  arguments: { feature_id: FEATURE_ID, project_id: PROJECT_ID, time_to_merge_hours: 3.5 },
});
check("recorded successfully", JSON.parse(r1.content[0].text).status === "recorded");

console.log("3. Second report, later: reworked + days_to_rework, does NOT carry time_to_merge_hours");
const r2 = await client.callTool({
  name: "report_outcome_proxy",
  arguments: { feature_id: FEATURE_ID, project_id: PROJECT_ID, reworked: true, days_to_rework: 12 },
});
check("recorded successfully", JSON.parse(r2.content[0].text).status === "recorded");

console.log("4. Third report, even later: status_at_30d only");
const r3 = await client.callTool({
  name: "report_outcome_proxy",
  arguments: { feature_id: FEATURE_ID, project_id: PROJECT_ID, status_at_30d: "kept" },
});
check("recorded successfully", JSON.parse(r3.content[0].text).status === "recorded");

console.log("5. read_ledger's feature_id rollup merges all 3 reports into one latest-value-per-field view");
const rollupResult = await client.callTool({ name: "read_ledger", arguments: { project_id: PROJECT_ID, feature_id: FEATURE_ID } });
const rollup = JSON.parse(rollupResult.content[0].text);
check("outcome_proxy.time_to_merge_hours survived from report 1", rollup.outcome_proxy?.time_to_merge_hours === 3.5);
check("outcome_proxy.reworked survived from report 2", rollup.outcome_proxy?.reworked === true);
check("outcome_proxy.days_to_rework survived from report 2", rollup.outcome_proxy?.days_to_rework === 12);
check("outcome_proxy.status_at_30d survived from report 3", rollup.outcome_proxy?.status_at_30d === "kept");
check("outcome_proxy_history has all 3 raw reports, not just the merged view", rollup.outcome_proxy_history?.length === 3);
check("no coverage_pct/confidence/verdict field anywhere on the outcome proxy", !("coverage_pct" in (rollup.outcome_proxy ?? {})) && !("confidence" in (rollup.outcome_proxy ?? {})) && !("verdict" in (rollup.outcome_proxy ?? {})));

console.log("6. A feature with no outcome proxy reports gets outcome_proxy: null, not an error");
const noProxyResult = await client.callTool({ name: "read_ledger", arguments: { project_id: PROJECT_ID, feature_id: "some-other-feature-never-reported" } });
const noProxy = JSON.parse(noProxyResult.content[0].text);
check("outcome_proxy is null", noProxy.outcome_proxy === null);
check("outcome_proxy_history is an empty array", Array.isArray(noProxy.outcome_proxy_history) && noProxy.outcome_proxy_history.length === 0);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
await client.close();
process.exit(failures === 0 ? 0 : 1);
