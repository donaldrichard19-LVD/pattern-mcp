#!/usr/bin/env node
// Runs real register_design_system + recommend_component calls against the built
// server and saves each result to out/verdict-<label>.json and out/verdict-<label>.txt.
// Usage (from the repo root, after `npm run build`):
//   DEMO_COMPONENTS_DIR=/path/to/your/src/components node docs/demo/source/capture-live-verdicts.mjs
// Keys come from the environment (ANTHROPIC_API_KEY, TYPESAFE_API_KEY) or the repo's .env.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.PATTERN_TELEMETRY ??= "0"; // keep demo traffic out of production analytics
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
if (existsSync(join(root, ".env"))) {
  for (const l of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const dir = process.env.DEMO_COMPONENTS_DIR;
if (!dir) { console.error("Set DEMO_COMPONENTS_DIR to your components folder."); process.exit(1); }
if (!process.env.ANTHROPIC_API_KEY && !process.env.TYPESAFE_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY and/or TYPESAFE_API_KEY."); process.exit(1);
}
const projectId = process.env.DEMO_PROJECT_ID ?? "booking-app";
const outDir = resolve(here, "out");
mkdirSync(outDir, { recursive: true });

const transport = new StdioClientTransport({ command: "node", args: [join(root, "dist/index.js")], env: { ...process.env }, stderr: "pipe" });
const client = new Client({ name: "demo-capture", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);

const parse = (r) => { const t = r.content?.[0]?.text ?? ""; try { return JSON.parse(t); } catch { return t; } };

const reg = await client.callTool({ name: "register_design_system", arguments: { project_id: projectId, directory_path: resolve(dir), replace: true } });
console.log("register:", reg.isError ? "ERROR" : "ok");
writeFileSync(join(outDir, "register.json"), JSON.stringify(parse(reg), null, 2));
if (reg.isError) { console.error(parse(reg)); process.exit(1); }

for (const n of JSON.parse(readFileSync(join(here, "needs.json"), "utf8"))) {
  const { label, ...args } = n;
  const t0 = Date.now();
  const res = await client.callTool({ name: "recommend_component", arguments: { ...args, project_id: projectId } });
  const body = parse(res);
  writeFileSync(join(outDir, `verdict-${label}.json`), JSON.stringify(body, null, 2));
  writeFileSync(join(outDir, `verdict-${label}.txt`), typeof body === "string" ? body : JSON.stringify(body, null, 2));
  console.log(`${label}: ${res.isError ? "ERROR" : body.verdict ?? "?"} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
await client.close();
