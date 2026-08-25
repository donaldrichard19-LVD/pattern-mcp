#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// Load ANTHROPIC_API_KEY from local .env (not committed) if not already set.
if (!process.env.ANTHROPIC_API_KEY) {
  try {
    const envText = readFileSync(resolve(projectRoot, ".env"), "utf8");
    for (const line of envText.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match) process.env[match[1]] = match[2];
    }
  } catch {
    // ignore, will fail loudly below if still unset
  }
}

const TEST_CASES = [
  {
    label: "price breakdown",
    args: {
      component_need: "price breakdown with fees and taxes",
      domain: "Airbnb-style rental marketplace",
      framework: "React + Tailwind",
      existing_stack: "already using shadcn/ui",
    },
  },
  {
    label: "cancellation policy",
    args: {
      component_need: "cancellation policy display with refund tiers by date",
      domain: "Airbnb-style rental marketplace",
      framework: "React + Tailwind",
      existing_stack: "already using shadcn/ui",
    },
  },
  {
    label: "host earnings dashboard",
    args: {
      component_need: "host earnings dashboard with payout history and upcoming payouts",
      domain: "Airbnb-style rental marketplace",
      framework: "React + Tailwind",
      existing_stack: "already using shadcn/ui",
    },
  },
  {
    label: "image gallery",
    args: {
      component_need: "listing image gallery with lightbox and thumbnail grid",
      domain: "Airbnb-style rental marketplace",
      framework: "React + Tailwind",
      existing_stack: "already using shadcn/ui",
    },
  },
  {
    label: "host-guest messaging",
    args: {
      component_need: "host-guest messaging thread with booking context",
      domain: "Airbnb-style rental marketplace",
      framework: "React + Tailwind",
      existing_stack: "already using shadcn/ui",
    },
  },
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set (checked env and .env). Aborting.");
    process.exit(1);
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: [resolve(projectRoot, "dist/index.js")],
    env: { ...process.env },
  });

  const client = new Client(
    { name: "pattern-test-client", version: "0.1.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  const toolsResult = await client.listTools();
  console.log("=== listTools ===");
  console.log(JSON.stringify(toolsResult, null, 2));

  const onlyLabel = process.argv[2];
  const cases = onlyLabel
    ? TEST_CASES.filter((tc) => tc.label === onlyLabel)
    : TEST_CASES;

  if (onlyLabel && cases.length === 0) {
    console.error(`No test case named "${onlyLabel}". Options: ${TEST_CASES.map((t) => t.label).join(", ")}`);
    process.exit(1);
  }

  const results = [];
  for (const tc of cases) {
    console.log(`\n=== ${tc.label} ===`);
    console.log("input:", JSON.stringify(tc.args));
    const start = Date.now();
    try {
      const result = await client.callTool({
        name: "recommend_component",
        arguments: tc.args,
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const text = result.content?.[0]?.text ?? "";
      console.log(`(${elapsed}s) raw output:`);
      console.log(text);
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        console.log("!! output did not parse as JSON");
      }
      results.push({ label: tc.label, isError: !!result.isError, parsed, raw: text });
    } catch (err) {
      console.error(`!! tool call threw: ${err.message}`);
      results.push({ label: tc.label, isError: true, error: err.message });
    }
  }

  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    if (r.error) {
      console.log(`${r.label}: THREW - ${r.error}`);
    } else if (r.isError) {
      console.log(`${r.label}: TOOL ERROR - ${r.raw}`);
    } else if (!r.parsed) {
      console.log(`${r.label}: NON-JSON OUTPUT`);
    } else {
      console.log(
        `${r.label}: verdict=${r.parsed.verdict} confidence=${r.parsed.confidence} reason=${r.parsed.reason} coverage=${r.parsed.coverage}`
      );
    }
  }

  await client.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
