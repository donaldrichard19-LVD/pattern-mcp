#!/usr/bin/env node
/**
 * Figma components-mode eval on a REAL design system (the community shadcn/ui
 * Figma file, 135 MB, key eGmaKYgeO8AHj9FtE9aT5v): does the Jev design-system
 * path pick the right component family for a need? Graded by PAGE, since the
 * file often defines only sub-parts as component sets. Variants:
 *   comp-full           components mode, location + variant options + toggles/slots
 *   comp-novariants     same candidates, variant/slot text withheld
 *                       (PATTERN_JEV_FIGMA_VARIANTS=0) -- do variants help or hurt?
 *   comp-vision         comp-full + a Haiku VISION caption per rendered component
 *                       (figma_file_key + summarize: true; sends images to Anthropic)
 *   comp-vision-novariants   captions, variant text withheld
 *   comp-pagegroup[-novariants|-vision]  candidates collapsed to ONE entry per Figma page
 *                       (component family) -- now the product default (PATTERN_JEV_FIGMA_GROUP=off
 *                       restores per-set entries); -novariants is the shipped default
 * Needs TYPESAFE_API_KEY; FIGMA_EVAL_JSON=<saved file> or FIGMA_ACCESS_TOKEN to
 * fetch it; the vision variants need FIGMA_ACCESS_TOKEN + ANTHROPIC_API_KEY.
 * --sonnet adds a one-call Sonnet baseline over comp-full's evidence.
 * --repeats N (default 3) repeats the scoring per registration.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE_KEY = process.env.FIGMA_FILE_KEY || "eGmaKYgeO8AHj9FtE9aT5v";
const EVAL_SET = process.env.FIGMA_EVAL_SET || "eval/figma-shadcn-eval-set.json";
const EXCLUDE_PAGES = process.env.FIGMA_EXCLUDE_PAGES ? process.env.FIGMA_EXCLUDE_PAGES.split(",") : ["Icons"];
if (existsSync(join(root, ".env"))) {
  for (const l of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = l.match(/^(ANTHROPIC_API_KEY|FIGMA_ACCESS_TOKEN|TYPESAFE_API_KEY)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (!process.env.TYPESAFE_API_KEY) { console.error("Missing TYPESAFE_API_KEY"); process.exit(1); }
const WITH_SONNET = process.argv.includes("--sonnet");
const repeats = Number(process.argv[process.argv.indexOf("--repeats") + 1]) || 3;
const evalSet = JSON.parse(readFileSync(join(root, EVAL_SET), "utf8"));
const trim = (s) => (s ?? "").trim();

let jsonPath = process.env.FIGMA_EVAL_JSON;
if (!jsonPath) {
  if (!process.env.FIGMA_ACCESS_TOKEN) { console.error("Set FIGMA_EVAL_JSON or FIGMA_ACCESS_TOKEN"); process.exit(1); }
  const res = await fetch(`https://api.figma.com/v1/files/${FILE_KEY}`, { headers: { "X-Figma-Token": process.env.FIGMA_ACCESS_TOKEN } });
  if (!res.ok) { console.error(`Figma fetch failed: ${res.status}`); process.exit(1); }
  jsonPath = join(mkdtempSync(join(tmpdir(), "figma-shadcn-")), "file.json");
  writeFileSync(jsonPath, Buffer.from(await res.arrayBuffer()));
}
jsonPath = resolve(jsonPath);

// The product DEFAULT is page-family grouping with variant text withheld
// (= comp-pagegroup-novariants); the other variants set the env explicitly so
// their names stay true to what they measure.
const OLD = { PATTERN_JEV_FIGMA_GROUP: "off" };       // one entry per component set (the original behaviour)
const VARIANT_TEXT = { PATTERN_JEV_FIGMA_VARIANTS: "1" };
const VARIANTS = {
  "comp-full": { env: { ...OLD, ...VARIANT_TEXT }, vision: false },
  "comp-novariants": { env: { ...OLD }, vision: false },
  "comp-vision": { env: { ...OLD, ...VARIANT_TEXT }, vision: true },
  "comp-vision-novariants": { env: { ...OLD }, vision: true },
  "comp-pagegroup": { env: { ...VARIANT_TEXT }, vision: false },
  "comp-pagegroup-novariants": { env: {}, vision: false },          // <- shipped default
  "comp-pagegroup-vision": { env: {}, vision: true },
};
const RUNS = process.env.VARIANTS ? process.env.VARIANTS.split(",") : Object.keys(VARIANTS);

async function runVariant(name) {
  const v = VARIANTS[name];
  const dsPath = join(tmpdir(), `figma-shadcn-ds-${Math.random().toString(36).slice(2)}.json`);
  const t = new StdioClientTransport({ command: "node", args: ["--max-old-space-size=4096", join(root, "dist/index.js")], env: {
    ...process.env, ANTHROPIC_API_KEY: v.vision ? process.env.ANTHROPIC_API_KEY : "", FIGMA_ACCESS_TOKEN: v.vision ? process.env.FIGMA_ACCESS_TOKEN : "",
    PATTERN_SCORER: "jev", PATTERN_NO_SUMMARIES: "1", PATTERN_SESSION_CAP: "1000", PATTERN_PROJECT_ROOT: dirname(jsonPath), PATTERN_DESIGN_SYSTEMS_PATH: dsPath,
    PATTERN_LEDGER_PATH: join(tmpdir(), "figma-shadcn-ledger.jsonl"), PATTERN_LOG_PATH: join(tmpdir(), "figma-shadcn.log"),
    PATTERN_MEMORY_PATH: join(tmpdir(), "figma-shadcn-mem.json"), PATTERN_TOOLS: "full", ...v.env } });
  const c = new Client({ name: "figma-shadcn-eval", version: "1" }, { capabilities: {} });
  await c.connect(t);
  const args = v.vision
    ? { project_id: "sh", figma_file_key: FILE_KEY, figma_exclude_pages: EXCLUDE_PAGES, summarize: true }
    : { project_id: "sh", figma_json_path: basename(jsonPath), figma_exclude_pages: EXCLUDE_PAGES };
  const reg = await c.callTool({ name: "register_design_system", arguments: args }, undefined, { timeout: 900_000 });
  if (reg.isError) throw new Error(reg.content[0].text);
  const body = JSON.parse(reg.content[0].text);
  const pagesOf = new Map();
  for (const cand of body.registration.candidates) (pagesOf.get(cand.name) ?? pagesOf.set(cand.name, new Set()).get(cand.name)).add(trim(cand.figma.page));
  const rounds = [];
  for (let r = 0; r < repeats; r++) {
    const rows = [];
    let tokens = 0, ms = 0;
    for (const cs of evalSet.cases) {
      const res = await c.callTool({ name: "recommend_component", arguments: { component_need: cs.need, domain: "product UI", framework: "React", project_id: "sh" } }, undefined, { timeout: 300_000 });
      const b = JSON.parse(res.content[0].text);
      tokens += b._meta.tokens_used.input; ms += b._meta.total_ms;
      const m = b.design_system_match;
      const found = b.reason === "scored";
      const topPages = (n) => [...(pagesOf.get(n) ?? [])];
      rows.push({ id: cs.id, kind: cs.kind, gold: cs.gold_pages, found, top: m ? m.components[0] : null, topPages: m ? topPages(m.components[0]) : [],
        top4Pages: m ? [m.components[0], ...m.alternatives.map((a) => a.components[0])].flatMap(topPages) : [], score: m?.score ?? 0 });
    }
    rounds.push({ rows, avgTokens: Math.round(tokens / evalSet.cases.length), avgMs: Math.round(ms / evalSet.cases.length) });
  }
  await c.close();
  return { registration: body.registration, summaries: body.summaries, rounds };
}

function metrics(rows) {
  const pos = rows.filter((r) => r.kind === "positive"), none = rows.filter((r) => r.kind === "none"), gap = rows.filter((r) => r.kind === "gap");
  const ok = (r) => r.found && r.topPages.some((p) => r.gold.includes(p));
  const right = pos.filter(ok), top4 = pos.filter((r) => r.top4Pages.some((p) => r.gold.includes(p)));
  const noneOk = none.filter((r) => !r.found), gapNotFound = gap.filter((r) => !r.found);
  return { pos: pos.length, right: right.length, top4: top4.length, none: none.length, noneOk: noneOk.length, gap: gap.length, gapNotFound: gapNotFound.length,
    minRight: +Math.min(1, ...right.map((r) => r.score)).toFixed(2), maxNone: +Math.max(0, ...none.map((r) => r.score)).toFixed(2), maxGap: +Math.max(0, ...gap.map((r) => r.score)).toFixed(2),
    wrong: pos.filter((r) => !ok(r)).map((r) => `${r.id}->${r.found ? r.top + "@" + r.topPages.join("/") : "not found"}(${r.score})`) };
}

const results = [];
for (const name of RUNS) {
  process.stdout.write(`${name}... `);
  const out = await runVariant(name);
  console.log(`${out.registration.candidate_count} candidates${out.summaries ? `, captions ${out.summaries.generated} for $${out.summaries.estimated_cost_usd}` : ""}`);
  out.rounds.forEach((rd, i) => {
    const m = metrics(rd.rows);
    console.log(`   run ${i + 1}: right ${m.right}/${m.pos} (top-4 ${m.top4}) | nothing-fits ${m.noneOk}/${m.none} | gap-not-found ${m.gapNotFound}/${m.gap} | lowest correct ${m.minRight} vs highest none ${m.maxNone} | ${rd.avgMs}ms, ${rd.avgTokens} tok/need`);
    if (i === 0 && m.wrong.length) console.log(`      wrong: ${m.wrong.join("; ")}`);
  });
  results.push({ name, candidates: out.registration.candidate_count, summaries: out.summaries, rounds: out.rounds.map((rd) => ({ ...metrics(rd.rows), avgMs: rd.avgMs, avgTokens: rd.avgTokens })), firstRoundRows: out.rounds[0].rows, allRoundRows: out.rounds.map((rd) => rd.rows) });
}

if (WITH_SONNET) {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("--sonnet needs ANTHROPIC_API_KEY"); process.exit(1); }
  const { collapseForJev } = await import(join(root, "dist/design-system-jev.js"));
  const out = await runVariant("comp-full");
  const pool = collapseForJev(out.registration.candidates);
  const pagesOf = new Map();
  for (const cand of out.registration.candidates) (pagesOf.get(cand.name) ?? pagesOf.set(cand.name, new Set()).get(cand.name)).add(trim(cand.figma.page));
  const list = pool.map((e) => `- [${e.key}] ${e.evidence.replace(/\n/g, " ")}`).join("\n");
  const byKey = new Map(pool.map((e) => [e.key, e]));
  let right = 0, noneOk = 0, gapNF = 0, inTok = 0; const wrong = [];
  for (const cs of evalSet.cases) {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 100, messages: [{ role: "user", content:
        `You choose an existing component from a Figma design system for a UI need. Use ONLY the candidates listed; never invent one. If none can satisfy the need as-is, say none.\n\nNEED: ${cs.need}\n\nCANDIDATES:\n${list}\n\nReply with JSON only: {"match": "<the id in brackets, e.g. c12, or null>"}` }] }) });
    const j = await res.json();
    inTok += j.usage?.input_tokens ?? 0;
    let key = null; try { key = JSON.parse((j.content[0].text.match(/\{[\s\S]*\}/) ?? ["{}"])[0]).match; } catch {}
    if (typeof key === "string") key = key.replace(/[\[\]]/g, "");
    const entry = key ? byKey.get(key) : null;
    const pages = entry ? [...(pagesOf.get(entry.components[0]) ?? [])] : [];
    if (cs.kind === "positive") { if (entry && pages.some((p) => cs.gold_pages.includes(p))) right++; else wrong.push(`${cs.id}->${entry ? entry.components[0] + "@" + pages.join("/") : "null"}`); }
    else if (cs.kind === "none") { if (!entry) noneOk++; else wrong.push(`${cs.id}->${entry.components[0]}`); }
    else if (!entry) gapNF++;
  }
  const P = evalSet.cases.filter((c) => c.kind === "positive").length, N = evalSet.cases.filter((c) => c.kind === "none").length, G = evalSet.cases.filter((c) => c.kind === "gap").length;
  console.log(`\nSonnet baseline (comp-full evidence): right ${right}/${P} | nothing-fits ${noneOk}/${N} | gap-not-found ${gapNF}/${G} | ${Math.round(inTok / evalSet.cases.length)} tok/need`);
  if (wrong.length) console.log(`   wrong: ${wrong.join("; ")}`);
}
const LOG = process.env.FIGMA_LOG || "eval/figma-shadcn-log.json";
writeFileSync(join(root, LOG), JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 1));
console.log(`\nWrote ${LOG}`);
