#!/usr/bin/env node
/**
 * Manual verification for the extract_requirements tool, recommend_component's
 * optional `checklist` param, and the `_meta` block (see README.md's
 * "extract_requirements" section and "The `_meta` field").
 *
 * Runs three real MCP tool calls against dist/index.js:
 *   1. extract_requirements on its own
 *   2. recommend_component with no checklist (default path -- unchanged)
 *   3. recommend_component with checklist_1's checklist passed in
 *
 * Manually check the printed output for:
 *   - call 1 returns a checklist + extraction_confidence + a populated _meta
 *     with no search calls (breakdown_ms.search === 0)
 *   - call 2 has checklist_source: "extracted"
 *   - call 3 has checklist_source: "provided", requirements_checked using
 *     exactly call 1's checklist items, and a breakdown_ms.extract smaller
 *     than call 2's (checklist-provided path spends less pre-search time)
 *   - in every call, breakdown_ms.extract + search + score ~= total_ms
 *
 * Usage: node scripts/verify-checklist-and-meta.mjs
 * Costs ~3 real Anthropic API calls (one of which may trigger the
 * boundary-risk ensemble, i.e. 3 more calls).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
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

const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(projectRoot, "dist/index.js")],
  env: { ...process.env },
  stderr: "pipe",
});
const client = new Client({ name: "verify-checklist-and-meta", version: "0.1.0" }, { capabilities: {} });
let stderrBuf = "";
await client.connect(transport);
transport.stderr.on("data", (c) => (stderrBuf += c.toString()));

const componentNeed = "image gallery for a property listing";
const domain = "Airbnb-style rental marketplace";
const framework = "React + Tailwind";

console.log("\n=== 1. extract_requirements ===");
const t1 = Date.now();
const extractResult = await client.callTool(
  { name: "extract_requirements", arguments: { component_need: componentNeed, domain } },
  undefined,
  { timeout: 60_000 }
);
console.log(`elapsed: ${Date.now() - t1}ms`);
console.log(extractResult.content[0].text);
const extracted = JSON.parse(extractResult.content[0].text);

console.log("\n=== 2. recommend_component (default, no checklist) ===");
const t2 = Date.now();
const defaultResult = await client.callTool(
  { name: "recommend_component", arguments: { component_need: componentNeed, domain, framework } },
  undefined,
  { timeout: 180_000 }
);
console.log(`elapsed: ${Date.now() - t2}ms`);
console.log(defaultResult.content[0].text);

console.log("\n=== 3. recommend_component (checklist provided) ===");
const t3 = Date.now();
const providedResult = await client.callTool(
  {
    name: "recommend_component",
    arguments: { component_need: componentNeed, domain, framework, checklist: extracted.checklist },
  },
  undefined,
  { timeout: 180_000 }
);
console.log(`elapsed: ${Date.now() - t3}ms`);
console.log(providedResult.content[0].text);

await new Promise((r) => setTimeout(r, 300));
console.log("\n=== STDERR DIAGNOSTIC (tail) ===");
console.log(stderrBuf.split("\n").slice(-40).join("\n"));

await client.close();
