#!/usr/bin/env node
/**
 * verify-export-ledger-provenance-tool.mjs
 *
 * Complements verify-provenance-artifact.mjs (which tests
 * formatProvenanceArtifact as a pure function directly). This one spawns
 * the real MCP server over stdio and exercises the actual
 * export_ledger_provenance tool end to end: does it find the right entry
 * by id, does the markdown it returns match what the direct-import test
 * already proved is correct, and does it fail cleanly on an unknown id.
 *
 * Run: node scripts/verify-export-ledger-provenance-tool.mjs (after `npm run build`)
 * Exits non-zero on any failed assertion.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "pattern-verify-export-provenance-"));
const ledgerPath = join(tmp, "ledger.jsonl");

const PROJECT_ID = "verify-export-provenance-project";

writeFileSync(
  ledgerPath,
  JSON.stringify({
    id: "seed-provenance-0001",
    timestamp: "2026-09-02T12:00:00.000Z",
    project_id: PROJECT_ID,
    feature_id: "seed-feature",
    component_need: "success or failure toast notification",
    domain: "test domain",
    framework: "React + Tailwind",
    checklist: ["a", "b"],
    checklist_source: "extracted",
    candidates_evaluated: [{ source: "shadcn", name: "Sonner toast", url: "https://example.com", coverage_pct: 100 }],
    verdict: "use_existing",
    chosen_candidate: "Sonner toast",
    confidence: "high",
    reason: "scored",
    coverage: "8/8 (100%)",
    cost_usd: 0.14,
    cache_hit: false,
    project_conventions_snapshot: null,
    file_path: null,
    snapshot_ref: "deadbeef00112233445566778899aabbccddeeff",
    last_verified_live: null,
    live_status: "unknown",
  }) + "\n",
  "utf8"
);

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
    PATTERN_LEDGER_PATH: ledgerPath,
  },
});
const client = new Client({ name: "verify-export-ledger-provenance-tool", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);

console.log("1. export_ledger_provenance finds the seeded entry and returns markdown");
const result = await client.callTool({
  name: "export_ledger_provenance",
  arguments: { project_id: PROJECT_ID, ledger_entry_id: "seed-provenance-0001" },
});
const parsed = JSON.parse(result.content[0].text);
check("did not error", !result.isError);
check("ledger_entry_id echoes back the requested id", parsed.ledger_entry_id === "seed-provenance-0001");
check("markdown starts with the expected header", parsed.markdown?.startsWith("## Pattern decision: success or failure toast notification"));
check("markdown includes the real snapshot_ref", parsed.markdown?.includes("`deadbeef00112233445566778899aabbccddeeff`"));
check("markdown includes the chosen candidate marked as chosen", parsed.markdown?.includes("| shadcn | Sonner toast | 100 | ✓ |"));

console.log("\n2. export_ledger_provenance fails cleanly on an unknown ledger_entry_id");
const missing = await client.callTool({
  name: "export_ledger_provenance",
  arguments: { project_id: PROJECT_ID, ledger_entry_id: "does-not-exist" },
});
check("isError is true", missing.isError === true);
check("error message names the missing id", missing.content[0].text.includes("does-not-exist"));

console.log("\n3. export_ledger_provenance fails cleanly on a wrong project_id (entry exists, but not for this project)");
const wrongProject = await client.callTool({
  name: "export_ledger_provenance",
  arguments: { project_id: "some-other-project", ledger_entry_id: "seed-provenance-0001" },
});
check("isError is true", wrongProject.isError === true);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
await client.close();
process.exit(failures === 0 ? 0 : 1);
