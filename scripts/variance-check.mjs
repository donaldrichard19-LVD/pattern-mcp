#!/usr/bin/env node
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

const TEST_CASES = [
  { label: "price breakdown", args: { component_need: "price breakdown with fees and taxes", domain: "Airbnb-style rental marketplace", framework: "React + Tailwind" } },
  { label: "cancellation policy", args: { component_need: "cancellation policy display", domain: "Airbnb-style rental marketplace", framework: "React + Tailwind" } },
  { label: "host earnings dashboard", args: { component_need: "host earnings dashboard", domain: "Airbnb-style rental marketplace", framework: "React + Tailwind" } },
  { label: "image gallery", args: { component_need: "image gallery for property listing", domain: "Airbnb-style rental marketplace", framework: "React + Tailwind" } },
  { label: "host-guest messaging", args: { component_need: "host-guest messaging inbox", domain: "Airbnb-style rental marketplace", framework: "React + Tailwind" } },
];

const RUNS_PER_CASE = 3;
const outPath = resolve(projectRoot, "scripts", "variance-check-results.json");

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set. Aborting.");
    process.exit(1);
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: [resolve(projectRoot, "dist/index.js")],
    env: { ...process.env },
    stderr: "pipe",
  });
  const client = new Client({ name: "variance-check", version: "0.1.0" }, { capabilities: {} });
  let stderrBuf = "";
  await client.connect(transport);
  transport.stderr.on("data", (c) => (stderrBuf += c.toString()));

  const allResults = {};
  for (const tc of TEST_CASES) {
    allResults[tc.label] = [];
    for (let run = 1; run <= RUNS_PER_CASE; run++) {
      const before = stderrBuf.length;
      const start = Date.now();
      const result = await client.callTool(
        { name: "recommend_component", arguments: tc.args },
        undefined,
        { timeout: 300_000 }
      );
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      await new Promise((r) => setTimeout(r, 300));
      const newStderr = stderrBuf.slice(before);
      const diagnostics = newStderr
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const text = result.content?.[0]?.text ?? "";
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // leave null
      }

      const entry = { run, isError: !!result.isError, raw: text, parsed, diagnostics, elapsedSeconds: Number(elapsed) };
      allResults[tc.label].push(entry);

      const ens = parsed?.ensemble;
      const ensLabel = ens?.triggered ? `ENSEMBLE[${ens.agreement}]` : "single-run";
      console.log(
        `[${tc.label} #${run}] (${elapsed}s) verdict=${parsed?.verdict ?? "PARSE_FAIL"} confidence=${parsed?.confidence} coverage=${parsed?.coverage} reason=${parsed?.reason} ${ensLabel}`
      );

      // Save incrementally so an interruption doesn't lose completed runs.
      writeFileSync(outPath, JSON.stringify(allResults, null, 2));
    }
  }

  await client.close();
  console.log(`\nWrote full results to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
