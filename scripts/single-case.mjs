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

const budgetEnv = process.argv[2] === "unlimited" ? {} : { PATTERN_SEARCH_BUDGET: process.argv[2] ?? "2" };

const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(projectRoot, "dist/index.js")],
  env: { ...process.env, ...budgetEnv },
  stderr: "pipe",
});
const client = new Client({ name: "single-case", version: "0.1.0" }, { capabilities: {} });
let stderrBuf = "";
await client.connect(transport);
transport.stderr.on("data", (c) => (stderrBuf += c.toString()));

const result = await client.callTool(
  {
    name: "recommend_component",
    arguments: {
      component_need: "cancellation policy display",
      domain: "Airbnb-style rental marketplace",
      framework: "React + Tailwind",
    },
  },
  undefined,
  { timeout: 180_000 }
);

await new Promise((r) => setTimeout(r, 300));
console.log("=== STDERR DIAGNOSTIC ===");
console.log(stderrBuf);
console.log("=== TOOL OUTPUT ===");
console.log(result.content[0].text);

await client.close();
