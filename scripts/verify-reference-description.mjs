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

const TEST_CASES = [
  { label: "price breakdown", args: { component_need: "price breakdown with fees and taxes", domain: "Airbnb-style rental marketplace", framework: "React + Tailwind" } },
  { label: "cancellation policy", args: { component_need: "cancellation policy display", domain: "Airbnb-style rental marketplace", framework: "React + Tailwind" } },
  { label: "host earnings dashboard", args: { component_need: "host earnings dashboard", domain: "Airbnb-style rental marketplace", framework: "React + Tailwind" } },
  { label: "image gallery", args: { component_need: "image gallery for property listing", domain: "Airbnb-style rental marketplace", framework: "React + Tailwind" } },
  { label: "host-guest messaging", args: { component_need: "host-guest messaging inbox", domain: "Airbnb-style rental marketplace", framework: "React + Tailwind" } },
];

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
  const client = new Client({ name: "verify-reference-description", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);

  const results = [];
  for (const tc of TEST_CASES) {
    const start = Date.now();
    const result = await client.callTool(
      { name: "recommend_component", arguments: tc.args },
      undefined,
      { timeout: 180_000 }
    );
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const text = result.content?.[0]?.text ?? "";
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave null
    }

    const ref = parsed?.recommendation?.reference;
    const compDesc = parsed?.recommendation?.component_description;
    results.push({ label: tc.label, isError: !!result.isError, parsed, raw: text });

    console.log(`\n[${tc.label}] (${elapsed}s)`);
    console.log(`  verdict=${parsed?.verdict} confidence=${parsed?.confidence} reason=${parsed?.reason} coverage=${parsed?.coverage} ensemble.triggered=${parsed?.ensemble?.triggered}`);
    if (parsed?.verdict === "custom_build") {
      if (ref) {
        console.log(`  reference: url=${ref.url}`);
        console.log(`  reference_description: ${ref.reference_description ? JSON.stringify(ref.reference_description) : "MISSING"}`);
      } else {
        console.log(`  reference: null (no grounded Mobbin search this run -- correctly stripped/absent)`);
      }
      console.log(`  component_description: ${compDesc === null || compDesc === undefined ? "null (correct, custom_build)" : "UNEXPECTED: " + JSON.stringify(compDesc)}`);
    } else if (parsed?.verdict === "use_existing") {
      console.log(`  component_description: ${compDesc ? JSON.stringify(compDesc) : "MISSING"}`);
    }
  }

  await client.close();

  console.log("\n=== SUMMARY ===");
  let allOk = true;
  for (const r of results) {
    if (!r.parsed) {
      allOk = false;
      console.log(`${r.label}: PARSE FAIL -- ${r.raw}`);
      continue;
    }
    if (r.parsed.verdict === "custom_build") {
      const ref = r.parsed.recommendation?.reference;
      if (ref && !ref.reference_description) {
        allOk = false;
        console.log(`${r.label}: FAIL -- reference present but reference_description missing`);
      } else if (ref) {
        console.log(`${r.label}: OK -- reference_description present (${ref.reference_description.length} chars)`);
      } else {
        console.log(`${r.label}: OK -- no reference this run (ungrounded/no Mobbin search, correctly omitted)`);
      }
    } else if (r.parsed.verdict === "use_existing") {
      const cd = r.parsed.recommendation?.component_description;
      if (!cd) {
        allOk = false;
        console.log(`${r.label}: FAIL -- use_existing but component_description missing`);
      } else {
        console.log(`${r.label}: OK -- component_description present (${cd.length} chars)`);
      }
    } else {
      console.log(`${r.label}: OK -- reason=${r.parsed.reason}`);
    }
  }
  console.log(allOk ? "\nOVERALL: PASS (no schema regressions)" : "\nOVERALL: FAIL");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
