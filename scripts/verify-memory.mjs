#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, existsSync, rmSync } from "node:fs";
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

const MEMORY_PATH = resolve(projectRoot, "scripts/verify-memory-scratch.json");
if (existsSync(MEMORY_PATH)) rmSync(MEMORY_PATH);

const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(projectRoot, "dist/index.js")],
  env: { ...process.env, PATTERN_MEMORY_PATH: MEMORY_PATH, PATTERN_SEARCH_BUDGET: "2" },
  stderr: "pipe",
});
const client = new Client({ name: "verify-memory", version: "0.1.0" }, { capabilities: {} });
let stderrBuf = "";
await client.connect(transport);
transport.stderr.on("data", (c) => (stderrBuf += c.toString()));

const PROJECT_ID = "memory-test-airbnb-booking";

console.log("=== TOOL LIST ===");
const tools = await client.listTools();
console.log(tools.tools.map((t) => t.name).join(", "));

console.log("\n=== CALL 1: recommend_component (no project_id yet, establishing baseline) ===");
const first = await client.callTool(
  {
    name: "recommend_component",
    arguments: {
      component_need: "price breakdown with fees and taxes",
      domain: "Airbnb-style rental marketplace",
      framework: "React + Tailwind",
      project_id: PROJECT_ID,
    },
  },
  undefined,
  { timeout: 240_000 }
);
console.log(first.content[0].text);
const firstParsed = JSON.parse(first.content[0].text);

console.log("\n=== CALL 2: record_component_decision (confirming what was actually done) ===");
const recorded = await client.callTool(
  {
    name: "record_component_decision",
    arguments: {
      project_id: PROJECT_ID,
      component_need: "price breakdown with fees and taxes",
      domain: "Airbnb-style rental marketplace",
      action: firstParsed.verdict === "use_existing" ? "installed" : "custom_built",
      source: firstParsed.recommendation?.source ?? "custom",
    },
  },
  undefined,
  { timeout: 30_000 }
);
console.log(recorded.content[0].text);

console.log("\n=== memory.json on disk ===");
console.log(readFileSync(MEMORY_PATH, "utf8"));

console.log("\n=== CALL 3: recommend_component again, related-but-not-identical need, same project_id ===");
const second = await client.callTool(
  {
    name: "recommend_component",
    arguments: {
      component_need: "price breakdown with subtotal, fees, and taxes, with an expandable detail view",
      domain: "Airbnb-style rental marketplace",
      framework: "React + Tailwind",
      project_id: PROJECT_ID,
    },
  },
  undefined,
  { timeout: 240_000 }
);
console.log(second.content[0].text);

console.log("\n=== CALL 4: recommend_component, same need, NO project_id (control -- memory must not leak in) ===");
const control = await client.callTool(
  {
    name: "recommend_component",
    arguments: {
      component_need: "price breakdown with subtotal, fees, and taxes, with an expandable detail view",
      domain: "Airbnb-style rental marketplace",
      framework: "React + Tailwind",
    },
  },
  undefined,
  { timeout: 240_000 }
);
console.log(control.content[0].text);

await new Promise((r) => setTimeout(r, 300));
console.log("\n=== STDERR DIAGNOSTIC (tail) ===");
console.log(stderrBuf.split("\n").slice(-40).join("\n"));

await client.close();
