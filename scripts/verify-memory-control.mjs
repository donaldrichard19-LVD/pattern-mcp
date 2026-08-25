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

// Fresh project_id with no recorded history -- past_decision_signal must
// not appear at all (not even { considered: false }).
const MEMORY_PATH = resolve(projectRoot, "scripts/verify-memory-scratch.json");

const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(projectRoot, "dist/index.js")],
  env: { ...process.env, UI_JUDGMENT_MEMORY_PATH: MEMORY_PATH, UI_JUDGMENT_SEARCH_BUDGET: "2" },
  stderr: "pipe",
});
const client = new Client({ name: "verify-memory-control", version: "0.1.0" }, { capabilities: {} });
let stderrBuf = "";
await client.connect(transport);
transport.stderr.on("data", (c) => (stderrBuf += c.toString()));

console.log("=== recommend_component: fresh project_id, no history ===");
const res = await client.callTool(
  {
    name: "recommend_component",
    arguments: {
      component_need: "host earnings dashboard",
      domain: "Airbnb-style rental marketplace",
      framework: "React + Tailwind",
      project_id: "memory-test-fresh-project-no-history",
    },
  },
  undefined,
  { timeout: 240_000 }
);
const parsed = JSON.parse(res.content[0].text);
console.log("has past_decision_signal key:", "past_decision_signal" in parsed);
console.log(res.content[0].text);

await new Promise((r) => setTimeout(r, 300));
console.log("\n=== STDERR (past_decisions_context / cleared lines only) ===");
console.log(
  stderrBuf
    .split("\n")
    .filter((l) => l.includes("past_decisions_context") || l.includes("past_decision_signal_cleared"))
    .join("\n")
);

await client.close();
