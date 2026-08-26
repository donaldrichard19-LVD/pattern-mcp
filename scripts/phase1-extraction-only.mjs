#!/usr/bin/env node
/**
 * Phase 1 of validation-plan-staged-pipeline.md.
 *
 * Pulls requirement extraction out as its own isolated Anthropic API call
 * -- no web_search, no scoring, no threshold logic -- and runs it 3x per
 * case against a subset of eval/eval-set.json. This is a standalone
 * experimental script, not a change to src/index.ts's actual pipeline
 * (which stays bundled as-is; this only exists to answer whether
 * extraction instability is real and worth the cost of full staging
 * before committing to Phase 2).
 *
 * Usage: node scripts/phase1-extraction-only.mjs
 * Writes: eval/phase1-extraction-log.json
 */
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

const MODEL = process.env.PATTERN_MODEL ?? "claude-sonnet-5";

// Same wording as step 2 of the real system prompt in src/index.ts, so
// this is a fair isolation of that one step, not a rewritten version of it.
const EXTRACTION_SYSTEM_PROMPT = `You are the requirement-extraction step of a UI component judgment pipeline. Given a component need and domain, turn it into a concrete checklist of elements the component must contain -- specific enough to check against real code, not a vibe. Ground it in the stated domain, not the component name alone. Extract exactly 8 checklist items, ranked by importance to the component's core function (most important first) -- a fixed count, not a range, so coverage = met/total isn't itself a moving target across runs.

Respond with ONLY a JSON object, no prose before or after, no markdown code fences, matching this exact shape:
{ "requirements": ["string", "string", "string", "string", "string", "string", "string", "string"] }`;

const evalSet = JSON.parse(readFileSync(resolve(projectRoot, "eval/eval-set.json"), "utf8"));

// 10 cases spanning all 4 categories and a mix of expected difficulty
// (clear use_existing, clear custom_build, and the two known-boundary
// cases: image-gallery and manage-booking-screen).
const SELECTED_IDS = [
  "search-map-toggle",
  "filter-panel",
  "image-gallery",
  "host-profile-card",
  "availability-calendar",
  "price-breakdown",
  "guest-count-selector",
  "host-earnings-dashboard",
  "manage-booking-screen",
  "notification-preferences",
];

const RUNS_PER_CASE = 3;

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

async function runExtraction(componentNeed, domain, framework) {
  const userMessage = `component_need: ${componentNeed}\ndomain: ${domain}\nframework: ${framework}`;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: EXTRACTION_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }
  const data = await response.json();
  const text = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();
  const extracted = extractJson(text);
  try {
    const parsed = JSON.parse(extracted);
    return { ok: true, requirements: parsed.requirements };
  } catch {
    return { ok: false, raw: text };
  }
}

const results = [];
const cases = evalSet.cases.filter((c) => SELECTED_IDS.includes(c.id));

console.log(`Running ${RUNS_PER_CASE}x extraction on ${cases.length} cases (${cases.length * RUNS_PER_CASE} total calls)...\n`);

for (const c of cases) {
  console.log(`=== ${c.id} ===`);
  const runs = [];
  for (let i = 0; i < RUNS_PER_CASE; i++) {
    process.stdout.write(`  run ${i + 1}/${RUNS_PER_CASE}... `);
    const result = await runExtraction(c.component_need, c.domain, c.framework);
    console.log(result.ok ? "ok" : "PARSE FAILED");
    runs.push({ run: i + 1, timestamp: new Date().toISOString(), ...result });
  }
  results.push({
    id: c.id,
    category: c.category,
    component_need: c.component_need,
    gold_verdict: c.gold.verdict,
    gold_requirements: c.gold.requirements.map((r) => r.requirement),
    runs,
  });
  console.log();
}

const outPath = resolve(projectRoot, "eval/phase1-extraction-log.json");
writeFileSync(outPath, JSON.stringify({ model: MODEL, runs_per_case: RUNS_PER_CASE, generated_at: new Date().toISOString(), results }, null, 2));
console.log(`Wrote ${outPath}`);
