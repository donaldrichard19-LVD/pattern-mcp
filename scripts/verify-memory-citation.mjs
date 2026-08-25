#!/usr/bin/env node
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

// Reuse the memory.json already populated by verify-memory.mjs's run --
// same project_id, same recorded decision -- just fire one more
// recommend_component call with an even more directly related need.
const MEMORY_PATH = resolve(projectRoot, "scripts/verify-memory-scratch.json");
const PROJECT_ID = "memory-test-airbnb-booking";

console.log("=== existing memory.json ===");
console.log(readFileSync(MEMORY_PATH, "utf8"));

const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(projectRoot, "dist/index.js")],
  env: { ...process.env, UI_JUDGMENT_MEMORY_PATH: MEMORY_PATH, UI_JUDGMENT_SEARCH_BUDGET: "2" },
  stderr: "pipe",
});
const client = new Client({ name: "verify-memory-citation", version: "0.1.0" }, { capabilities: {} });
let stderrBuf = "";
await client.connect(transport);
transport.stderr.on("data", (c) => (stderrBuf += c.toString()));

console.log("\n=== recommend_component: near-identical need to the recorded decision, same project_id ===");
const res = await client.callTool(
  {
    name: "recommend_component",
    arguments: {
      component_need: "price breakdown with fees and taxes for the booking checkout page",
      domain: "Airbnb-style rental marketplace",
      framework: "React + Tailwind",
      project_id: PROJECT_ID,
    },
  },
  undefined,
  { timeout: 240_000 }
);
console.log(res.content[0].text);

await new Promise((r) => setTimeout(r, 300));
console.log("\n=== STDERR (past_decisions_context lines only) ===");
console.log(stderrBuf.split("\n").filter((l) => l.includes("past_decisions_context")).join("\n"));

await client.close();
