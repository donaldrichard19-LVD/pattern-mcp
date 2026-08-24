#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

if (!process.env.ANTHROPIC_API_KEY) {
  try {
    const envText = readFileSync(resolve(projectRoot, ".env"), "utf8");
    for (const line of envText.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match) process.env[match[1]] = match[2];
    }
  } catch {
    // ignore
  }
}

const TEST_CASES = [
  { label: "price breakdown", args: { component_need: "price breakdown with fees and taxes", domain: "Airbnb-style rental marketplace", framework: "React + Tailwind" } },
  { label: "cancellation policy", args: { component_need: "cancellation policy display", domain: "Airbnb-style rental marketplace", framework: "React + Tailwind" } },
  { label: "host earnings dashboard", args: { component_need: "host earnings dashboard", domain: "Airbnb-style rental marketplace", framework: "React + Tailwind" } },
  { label: "image gallery", args: { component_need: "image gallery for property listing", domain: "Airbnb-style rental marketplace", framework: "React + Tailwind" } },
  { label: "host-guest messaging", args: { component_need: "host-guest messaging inbox", domain: "Airbnb-style rental marketplace", framework: "React + Tailwind" } },
];

async function runBudget(budgetLabel, envOverrides) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [resolve(projectRoot, "dist/index.js")],
    env: { ...process.env, ...envOverrides },
    stderr: "pipe",
  });

  const client = new Client({ name: "budget-diff-client", version: "0.1.0" }, { capabilities: {} });

  let stderrBuf = "";
  await client.connect(transport);
  if (transport.stderr) {
    transport.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
    });
  }

  const results = [];
  for (const tc of TEST_CASES) {
    const before = stderrBuf.length;
    const start = Date.now();
    const result = await client.callTool(
      { name: "recommend_component", arguments: tc.args },
      undefined,
      { timeout: 180_000 }
    );
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const text = result.content?.[0]?.text ?? "";

    // Give stderr a moment to flush after the tool call resolves.
    await new Promise((r) => setTimeout(r, 200));
    const newStderr = stderrBuf.slice(before);
    let diagnostic = null;
    for (const line of newStderr.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.diagnostic === "search_calls") diagnostic = parsed;
      } catch {
        // non-JSON stderr line, ignore
      }
    }

    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave null
    }

    const status = result.isError ? `TOOL_ERROR: ${text}` : parsed?.verdict ?? "PARSE_FAIL (raw did not parse as JSON)";
    console.log(`[${budgetLabel}] ${tc.label} (${elapsed}s) searchCalls=${diagnostic?.count ?? "?"} stop_reason=${diagnostic?.stop_reason ?? "?"} -> ${status}`);

    results.push({
      label: tc.label,
      input: tc.args,
      isError: !!result.isError,
      raw: text,
      parsed,
      searchCallCount: diagnostic?.count ?? null,
      searchQueries: diagnostic?.queries ?? null,
      elapsedSeconds: Number(elapsed),
    });
  }

  await client.close();
  return results;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set. Aborting.");
    process.exit(1);
  }

  const outPath = resolve(projectRoot, "scripts", "budget-diff-results.json");
  const combined = { default: null, capped5: null };

  console.log("=== Running with DEFAULT budget (unset -> 2) ===");
  combined.default = await runBudget("default", {});
  writeFileSync(outPath, JSON.stringify(combined, null, 2));
  console.log(`(saved partial results to ${outPath})`);

  console.log("\n=== Running with UI_JUDGMENT_SEARCH_BUDGET=5 ===");
  combined.capped5 = await runBudget("capped5", { UI_JUDGMENT_SEARCH_BUDGET: "5" });
  writeFileSync(outPath, JSON.stringify(combined, null, 2));
  console.log(`\nWrote full results to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
