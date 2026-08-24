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

// Independent re-implementation of the server's threshold rule, so this
// check isn't just trusting the server's own enforcement code -- it
// verifies the *output* actually satisfies the stated rule.
function parseCoveragePercent(coverage) {
  if (!coverage) return null;
  const parenMatch = coverage.match(/\((\d+(?:\.\d+)?)%\)/);
  if (parenMatch) return Number.parseFloat(parenMatch[1]);
  const fracMatch = coverage.match(/(\d+)\s*\/\s*(\d+)/);
  if (fracMatch) {
    const met = Number.parseInt(fracMatch[1], 10);
    const total = Number.parseInt(fracMatch[2], 10);
    if (total > 0) return (met / total) * 100;
  }
  return null;
}
function expectedVerdict(pct) {
  if (pct >= 80) return { verdict: "use_existing", confidence: "high" };
  if (pct >= 40) return { verdict: "use_existing", confidence: "low" };
  return { verdict: "custom_build", confidence: null }; // no rule for confidence in this band
}

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
  const client = new Client({ name: "verify-fixes", version: "0.1.0" }, { capabilities: {} });
  let stderrBuf = "";
  await client.connect(transport);
  transport.stderr.on("data", (c) => (stderrBuf += c.toString()));

  const results = [];
  for (const tc of TEST_CASES) {
    const before = stderrBuf.length;
    const result = await client.callTool(
      { name: "recommend_component", arguments: tc.args },
      undefined,
      { timeout: 180_000 }
    );
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

    results.push({ label: tc.label, isError: !!result.isError, raw: text, parsed, diagnostics });
    console.log(`[done] ${tc.label} -> isError=${result.isError} verdict=${parsed?.verdict} confidence=${parsed?.confidence} coverage=${parsed?.coverage} reference=${parsed?.recommendation?.reference ? "present" : "null"}`);
  }
  await client.close();

  writeFileSync(resolve(projectRoot, "scripts", "verify-fixes-results.json"), JSON.stringify(results, null, 2));

  console.log("\n=== CHECK (a): no fabricated Mobbin references ===");
  let checkAOk = true;
  for (const r of results) {
    const ref = r.parsed?.recommendation?.reference;
    const searchDiag = r.diagnostics.find((d) => d.diagnostic === "search_calls");
    const strippedDiag = r.diagnostics.filter((d) => d.diagnostic === "reference_stripped");
    const groundedMobbinSearch = (searchDiag?.calls ?? []).some(
      (c) => c.succeeded && JSON.stringify(c.query).toLowerCase().includes("mobbin")
    );
    if (ref && !groundedMobbinSearch) {
      checkAOk = false;
      console.log(`  FAIL ${r.label}: reference present (${ref.url}) but no successful mobbin.com search call found in diagnostics.`);
    } else if (ref && groundedMobbinSearch) {
      console.log(`  OK   ${r.label}: reference present and grounded in a successful mobbin.com search.`);
    } else if (!ref && strippedDiag.length > 0) {
      console.log(`  OK   ${r.label}: reference correctly stripped server-side (ungrounded) -- ${strippedDiag[0].strippedReference?.url}`);
    } else {
      console.log(`  OK   ${r.label}: no reference returned (verdict=${r.parsed?.verdict}).`);
    }
  }
  console.log(checkAOk ? "CHECK (a): PASS" : "CHECK (a): FAIL");

  console.log("\n=== CHECK (b): verdict/confidence matches coded threshold for stated coverage ===");
  let checkBOk = true;
  for (const r of results) {
    if (r.parsed?.reason !== "scored") {
      console.log(`  SKIP ${r.label}: reason=${r.parsed?.reason} (no coverage to check)`);
      continue;
    }
    const pct = parseCoveragePercent(r.parsed.coverage);
    if (pct === null) {
      console.log(`  SKIP ${r.label}: coverage "${r.parsed.coverage}" unparseable`);
      continue;
    }
    const expected = expectedVerdict(pct);
    const verdictOk = r.parsed.verdict === expected.verdict;
    const confidenceOk = expected.confidence === null || r.parsed.confidence === expected.confidence;
    if (verdictOk && confidenceOk) {
      console.log(`  OK   ${r.label}: coverage=${pct}% -> verdict=${r.parsed.verdict} confidence=${r.parsed.confidence} (matches rule)`);
    } else {
      checkBOk = false;
      console.log(`  FAIL ${r.label}: coverage=${pct}% expected ${JSON.stringify(expected)} but got verdict=${r.parsed.verdict} confidence=${r.parsed.confidence}`);
    }
  }
  console.log(checkBOk ? "CHECK (b): PASS" : "CHECK (b): FAIL");

  console.log(`\n=== OVERALL: ${checkAOk && checkBOk ? "PASS" : "FAIL"} ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
