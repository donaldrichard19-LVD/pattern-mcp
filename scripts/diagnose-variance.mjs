#!/usr/bin/env node
/**
 * diagnose-variance.mjs
 *
 * Standalone diagnostic -- does NOT touch src/index.ts, dist/index.js, or
 * the MCP server at all. Talks directly to the Anthropic Messages API to
 * isolate which stage of the recommend_component pipeline (requirement
 * extraction / search / evidence scoring) is actually responsible for the
 * verdict variance observed in variance-check-results.json.
 *
 * Stage A: extraction only, 5x, no tools.
 * Stage B: search only, 3x, fixed hand-written queries (not model-chosen),
 *          frozen checklist from Stage A run #1. Logs raw ground-truth
 *          candidates from the API's own web_search_tool_result blocks.
 * Stage C: scoring only, 5x, no tools at all. Frozen checklist (Stage A
 *          run #1) + a frozen plain-text evidence dossier (captured from
 *          one Stage B run) fed back as static context, byte-identical
 *          across all 5 calls.
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

const MODEL = "claude-sonnet-5";
const TEST_CASE = {
  component_need: "price breakdown with fees and taxes",
  domain: "Airbnb-style rental marketplace",
  framework: "React + Tailwind",
};
const outPath = resolve(projectRoot, "scripts", "diagnose-variance-results.json");

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    const arrStart = text.indexOf("[");
    const arrEnd = text.lastIndexOf("]");
    if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) return text.slice(arrStart, arrEnd + 1);
    return text;
  }
  return text.slice(start, end + 1);
}

async function callAnthropic({ system, messages, tools, max_tokens = 2048 }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens,
      system: [{ type: "text", text: system }],
      messages,
      ...(tools ? { tools } : {}),
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }
  return response.json();
}

function finalText(data) {
  return data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();
}

// ---------- STAGE A: requirement extraction only ----------
const STAGE_A_SYSTEM = `You are the requirement-extraction step of a UI component judgment pipeline. Given a component need and a domain, turn it into a concrete checklist of elements the component must contain -- specific enough to check against real code, not a vibe. Ground it in the stated domain, not the component name alone. Aim for 5-10 checklist items for non-trivial components.

Respond with ONLY a JSON array of strings, one requirement per string, no prose, no markdown fences, no numbering. Example shape: ["requirement one", "requirement two"]`;

async function runStageA(n) {
  console.log(`\n=== STAGE A: requirement extraction x${n} ===`);
  const runs = [];
  for (let i = 1; i <= n; i++) {
    const data = await callAnthropic({
      system: STAGE_A_SYSTEM,
      messages: [
        {
          role: "user",
          content: `component_need: ${TEST_CASE.component_need}\ndomain: ${TEST_CASE.domain}\nframework: ${TEST_CASE.framework}`,
        },
      ],
      max_tokens: 1024,
    });
    const text = finalText(data);
    let items = null;
    try {
      items = JSON.parse(extractJson(text));
    } catch {
      console.log(`  run${i}: FAILED TO PARSE: ${text}`);
    }
    console.log(`  run${i}: ${items ? items.length : "?"} items`);
    if (items) items.forEach((it) => console.log(`      - ${it}`));
    runs.push({ run: i, raw: text, items });
  }
  return runs;
}

// ---------- STAGE B: search only, fixed queries, frozen checklist ----------
const FIXED_QUERIES = ["shadcn/ui price breakdown fees taxes component", "21st.dev price breakdown fees taxes component React"];

function stageBSystem(checklist) {
  return `You are the candidate-search step of a UI component judgment pipeline. You will be given a fixed requirement checklist for context only -- do not score anything against it in this step.

You MUST call the web_search tool exactly twice, using these two queries verbatim, character for character, with no modification, combination, or additional searches:
1. "${FIXED_QUERIES[0]}"
2. "${FIXED_QUERIES[1]}"

Checklist (context only, do not score yet):
${checklist.map((c) => `- ${c}`).join("\n")}

After both searches return, respond with ONLY this JSON shape, no prose, no markdown fences:
{
  "raw_results": [ { "query": "string", "title": "string", "url": "string" } ],
  "evidence_dossier": [ { "name": "string", "url": "string", "description": "2-4 factual sentences on the candidate's actual structure/props/features as reported by the search result content you just read -- purely descriptive, no scoring against the checklist" } ]
}
List every result you received for both queries in raw_results, and write one evidence_dossier entry per distinct real candidate (skip irrelevant/off-topic results).`;
}

async function runStageB(checklist, n) {
  console.log(`\n=== STAGE B: search x${n} (fixed queries, frozen checklist) ===`);
  const runs = [];
  for (let i = 1; i <= n; i++) {
    const data = await callAnthropic({
      system: stageBSystem(checklist),
      messages: [{ role: "user", content: "Run the two searches now and report back per the required JSON shape." }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
      max_tokens: 4096,
    });

    // Ground truth: the API's own web_search_tool_result blocks, not the
    // model's transcription of them.
    const groundTruth = data.content
      .filter((b) => b.type === "web_search_tool_result")
      .flatMap((b) => (Array.isArray(b.content) ? b.content : []))
      .map((r) => ({ title: r.title, url: r.url, page_age: r.page_age }));

    const text = finalText(data);
    let parsed = null;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      console.log(`  run${i}: FAILED TO PARSE model output`);
    }

    console.log(`  run${i}: groundTruthResults=${groundTruth.length} modelReportedResults=${parsed?.raw_results?.length ?? "?"} dossierEntries=${parsed?.evidence_dossier?.length ?? "?"}`);
    groundTruth.forEach((r) => console.log(`      [ground truth] ${r.title} -- ${r.url}`));

    runs.push({ run: i, raw: text, parsed, groundTruth });
  }
  return runs;
}

// ---------- STAGE C: scoring only, frozen checklist + frozen dossier ----------
function stageCSystem() {
  return `You are the evidence-scoring step of a UI component judgment pipeline. You will be given (1) a requirement checklist and (2) a frozen evidence dossier describing real candidate components found via a prior search step. Score EACH checklist item as met or unmet strictly against the dossier evidence provided -- do not search, do not assume anything not stated in the dossier, do not invent capabilities.

Respond with ONLY this JSON shape, no prose, no markdown fences:
{
  "requirements_checked": [ { "requirement": "string", "met": true|false, "evidence": "string" } ],
  "coverage": "string like '5/7 (71%)'"
}`;
}

function stageCUserMessage(checklist, dossier) {
  const dossierText = dossier.map((d) => `- ${d.name} (${d.url}): ${d.description}`).join("\n");
  return `Checklist:\n${checklist.map((c) => `- ${c}`).join("\n")}\n\nEvidence dossier (frozen, from a prior search -- do not search again, score against this text only):\n${dossierText}`;
}

async function runStageC(checklist, dossier, n) {
  console.log(`\n=== STAGE C: scoring x${n} (frozen checklist + frozen dossier, no tools) ===`);
  const userMessage = stageCUserMessage(checklist, dossier);
  const system = stageCSystem();
  const runs = [];
  for (let i = 1; i <= n; i++) {
    const data = await callAnthropic({
      system,
      messages: [{ role: "user", content: userMessage }],
      max_tokens: 2048,
    });
    const text = finalText(data);
    let parsed = null;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      console.log(`  run${i}: FAILED TO PARSE: ${text}`);
    }
    const met = parsed?.requirements_checked?.filter((r) => r.met).length;
    const total = parsed?.requirements_checked?.length;
    console.log(`  run${i}: stated coverage="${parsed?.coverage}" recount=${met}/${total}`);
    runs.push({ run: i, raw: text, parsed, userMessage: i === 1 ? userMessage : undefined });
  }
  return { runs, frozenUserMessage: userMessage };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set. Aborting.");
    process.exit(1);
  }

  const results = {};

  results.stageA = await runStageA(5);
  writeFileSync(outPath, JSON.stringify(results, null, 2));

  const frozenChecklist = results.stageA.find((r) => r.items)?.items;
  if (!frozenChecklist) throw new Error("No Stage A run produced a parseable checklist -- cannot proceed to Stage B.");
  results.frozenChecklist = frozenChecklist;
  results.frozenChecklistSourceRun = results.stageA.find((r) => r.items).run;

  results.stageB = await runStageB(frozenChecklist, 3);
  writeFileSync(outPath, JSON.stringify(results, null, 2));

  const dossierRun = results.stageB.find((r) => r.parsed?.evidence_dossier?.length);
  if (!dossierRun) throw new Error("No Stage B run produced a parseable evidence_dossier -- cannot proceed to Stage C.");
  results.frozenDossier = dossierRun.parsed.evidence_dossier;
  results.frozenDossierSourceRun = dossierRun.run;

  const stageCResult = await runStageC(frozenChecklist, dossierRun.parsed.evidence_dossier, 5);
  results.stageC = stageCResult.runs;
  results.stageCFrozenUserMessage = stageCResult.frozenUserMessage;

  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nWrote full results to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
