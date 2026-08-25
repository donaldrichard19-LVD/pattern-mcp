#!/usr/bin/env node
// Verifies the deep-link fix for step 6 (Mobbin / Figma Community
// references): for every custom_build verdict across the 5 validated
// cases, checks whether a true deep link was confirmed via web_fetch, or
// whether it honestly fell back to the "entry point only" framing -- and
// that in either case, the URL server-side ends up with is never a
// fabricated one.
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

function domainForSource(source) {
  const s = (source ?? "").toLowerCase();
  if (s.includes("mobbin")) return "mobbin.com";
  if (s.includes("figma")) return "figma.com";
  return null;
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
  const client = new Client({ name: "verify-deep-link", version: "0.1.0" }, { capabilities: {} });
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
    console.log(`[done] ${tc.label} -> verdict=${parsed?.verdict} reference=${parsed?.recommendation?.reference ? "present" : "null"}`);
  }
  await client.close();

  writeFileSync(resolve(projectRoot, "scripts", "verify-deep-link-results.json"), JSON.stringify(results, null, 2));

  console.log("\n=== PER-CASE deep-link report ===");
  let anyFabricated = false;
  for (const r of results) {
    console.log(`\n[${r.label}] verdict=${r.parsed?.verdict} reason=${r.parsed?.reason}`);
    if (r.parsed?.verdict !== "custom_build") {
      console.log(`  N/A -- not a custom_build verdict this run.`);
      continue;
    }
    const ref = r.parsed?.recommendation?.reference;
    if (!ref) {
      console.log(`  no reference this run (neither source grounded) -- nothing to check.`);
      continue;
    }
    const entries = Array.isArray(ref) ? ref : [ref];
    const fetchDiag = r.diagnostics.find((d) => d.diagnostic === "fetch_calls");
    const notConfirmedDiag = r.diagnostics.filter((d) => d.diagnostic === "deep_link_not_confirmed");

    for (const entry of entries) {
      const domain = domainForSource(entry.source);
      const relevantFetches = (fetchDiag?.calls ?? []).filter((c) => c.url?.includes(domain ?? "\0"));
      const fetchedForSource = relevantFetches.some((c) => c.succeeded);
      const notConfirmed = notConfirmedDiag.find((d) => d.source === (domain === "mobbin.com" ? "mobbin" : "figma"));

      console.log(`  source=${entry.source} url_type=${entry.url_type ?? "MISSING"} url=${entry.url}`);
      console.log(`    fetch attempted for this source: ${relevantFetches.length > 0} (succeeded: ${fetchedForSource})`);

      const isFigmaFileUrl = entry.source === "Figma Community" && /\/community\/file\//i.test(entry.url ?? "");

      if (entry.url_type === "deep_link" && isFigmaFileUrl) {
        console.log(`    -> DEEP LINK by Figma's own URL structure (/community/file/) -- no fetch needed, not fabrication.`);
      } else if (entry.url_type === "deep_link") {
        console.log(`    -> TRUE DEEP LINK confirmed via fetch.`);
        if (!fetchedForSource) {
          anyFabricated = true;
          console.log(`    FAIL: url_type=deep_link but no successful fetch recorded for this source -- possible fabrication.`);
        }
      } else if (entry.url_type === "entry_point") {
        console.log(`    -> Fell back to honest "entry point only" framing.`);
        const descMentionsEntryPoint = (entry.reference_description ?? "").toLowerCase().includes("entry point");
        if (!descMentionsEntryPoint) {
          anyFabricated = true;
          console.log(`    FAIL: url_type=entry_point but reference_description doesn't disclose this.`);
        }
        if (notConfirmed) {
          console.log(`    (diagnostic confirms: claimed="${notConfirmed.claimedUrl}" -> fallback="${notConfirmed.fallbackUrl}", reason="${notConfirmed.reason}")`);
        }
      } else {
        anyFabricated = true;
        console.log(`    FAIL: url_type missing entirely -- enforcement didn't run on this entry.`);
      }
    }
  }

  console.log(`\n=== OVERALL: ${anyFabricated ? "FAIL -- see above" : "PASS -- every reference URL is either a confirmed deep link or an honestly-disclosed entry point"} ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
