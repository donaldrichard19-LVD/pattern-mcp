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

const CASE = {
  component_need: "price breakdown with fees and taxes",
  domain: "Airbnb-style rental marketplace",
  framework: "React + Tailwind",
};
const RUNS = 5;
const outPath = resolve(projectRoot, "scripts", "variance-check-fixed-extraction-results.json");

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
  const client = new Client({ name: "variance-check-fixed-extraction", version: "0.1.0" }, { capabilities: {} });
  let stderrBuf = "";
  await client.connect(transport);
  transport.stderr.on("data", (c) => (stderrBuf += c.toString()));

  const results = [];
  for (let run = 1; run <= RUNS; run++) {
    const before = stderrBuf.length;
    const start = Date.now();
    const result = await client.callTool(
      { name: "recommend_component", arguments: CASE },
      undefined,
      { timeout: 180_000 }
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

    const itemCount = parsed?.requirements_checked?.length ?? null;
    const metCount = parsed?.requirements_checked?.filter((r) => r.met).length ?? null;

    results.push({ run, isError: !!result.isError, raw: text, parsed, diagnostics, elapsedSeconds: Number(elapsed) });
    console.log(
      `[run ${run}] (${elapsed}s) verdict=${parsed?.verdict ?? "PARSE_FAIL"} confidence=${parsed?.confidence} coverage=${parsed?.coverage} itemCount=${itemCount} met=${metCount} reason=${parsed?.reason}`
    );
    writeFileSync(outPath, JSON.stringify(results, null, 2));
  }

  await client.close();
  console.log(`\nWrote full results to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
