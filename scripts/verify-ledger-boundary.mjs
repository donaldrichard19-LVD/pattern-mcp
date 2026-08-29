#!/usr/bin/env node
/**
 * verify-ledger-boundary.mjs
 *
 * Standalone check for the data-minimization boundary (distillCandidate /
 * assertDistilledCandidateShape in src/index.ts): confirms a raw-shaped
 * judgment result gets reduced to only the 4 allowed DistilledCandidate
 * fields, and confirms a raw (non-distilled) object is rejected before it
 * could ever reach the ledger. Imports dist/index.js directly with
 * PATTERN_NO_AUTOSTART set so the server doesn't spin up on import.
 *
 * Run: node scripts/verify-ledger-boundary.mjs (after `npm run build`)
 * Exits non-zero on any failed assertion.
 */
process.env.PATTERN_NO_AUTOSTART = "1";

const { distillCandidate, assertDistilledCandidateShape } = await import("../dist/index.js");

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ok: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

console.log("1. distillCandidate reduces a raw-shaped result to only allowed fields");
{
  const rawShapedResult = {
    verdict: "use_existing",
    confidence: "high",
    reason: "scored",
    coverage: "7/8 (87.5%)",
    requirements_checked: [
      { requirement: "date range selection", met: true, evidence: "long raw evidence text..." },
    ],
    recommendation: {
      source: "shadcn/ui",
      install_command: "npx shadcn add calendar",
      component_description: "Calendar with range mode",
      // Deliberately raw/oversized content that must never survive distillation.
      reference: {
        source: "mobbin",
        url: "https://mobbin.com/screens/example",
        raw_html: "<div class='huge-scraped-blob'>".repeat(500),
        full_prop_table: new Array(200).fill({ prop: "x", type: "string", description: "..." }),
      },
    },
    _meta: {
      total_ms: 4200,
      breakdown_ms: { extract: 900, search: 1800, score: 1500 },
      tokens_used: { input: 5000, output: 800 },
      estimated_cost_usd: 0.018,
      scoring_fetch: { attempted: true, succeeded: true, url: "https://ui.shadcn.com/docs/components/calendar" },
    },
  };

  const distilled = distillCandidate(rawShapedResult);
  check("distillCandidate returned a non-null object", distilled !== null);
  const keys = Object.keys(distilled ?? {}).sort();
  check(`output has exactly the 4 allowed keys, got: ${keys.join(",")}`, JSON.stringify(keys) === JSON.stringify(["coverage_pct", "name", "source", "url"].sort()));
  check("source is the recommendation's source", distilled?.source === "shadcn/ui");
  check("name is the recommendation's component_description", distilled?.name === "Calendar with range mode");
  check("url comes from the verified scoring_fetch, not the raw Mobbin reference", distilled?.url === "https://ui.shadcn.com/docs/components/calendar");
  check("coverage_pct parsed correctly from the coverage string", distilled?.coverage_pct === 87.5);
  const serialized = JSON.stringify(distilled);
  check("serialized output contains no raw HTML blob", !serialized.includes("huge-scraped-blob"));
  check("serialized output contains no evidence text", !serialized.includes("long raw evidence text"));
  check("serialized output is small (< 500 bytes)", serialized.length < 500);
}

console.log("2. distillCandidate returns null for a custom_build verdict (no existing candidate)");
{
  const customBuildResult = {
    verdict: "custom_build",
    confidence: "high",
    reason: "scored",
    coverage: "2/8 (25%)",
    recommendation: null,
  };
  check("returned null", distillCandidate(customBuildResult) === null);
}

console.log("3. assertDistilledCandidateShape rejects a raw (non-distilled) object");
{
  const raw = {
    source: "shadcn/ui",
    name: "Calendar",
    url: "https://ui.shadcn.com/docs/components/calendar",
    coverage_pct: 87.5,
    raw_html: "<div>should not be here</div>",
  };
  let threw = false;
  try {
    assertDistilledCandidateShape(raw);
  } catch {
    threw = true;
  }
  check("threw on an object with a disallowed key", threw);
}

console.log("4. assertDistilledCandidateShape accepts a properly distilled object");
{
  const clean = { source: "shadcn/ui", name: "Calendar", url: null, coverage_pct: 87.5 };
  let threw = false;
  try {
    assertDistilledCandidateShape(clean);
  } catch {
    threw = true;
  }
  check("did not throw", !threw);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
