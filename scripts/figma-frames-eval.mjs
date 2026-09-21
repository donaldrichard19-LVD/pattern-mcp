#!/usr/bin/env node
/**
 * Figma frames-mode eval: does the Jev design-system path pick the right DESIGN
 * from a real Figma file for a need, or correctly say nothing fits? Runs the
 * real product path (register_design_system -> recommend_component with
 * PATTERN_SCORER=jev) over eval/figma-eval-set.json, across evidence variants:
 *   components     figma_mode "components" (the default) -- the baseline that
 *                  motivated frames mode: this file defines only 4 components
 *   frames-full    frames mode, Design page only, layers + text evidence
 *   frames-notext  same candidates, name + location only (PATTERN_JEV_FIGMA_TEXT=0)
 *   frames-allpages frames mode over EVERY page (adds cover/style-guide junk)
 *   frames-vision  frames-full + a Haiku VISION caption per design (the design
 *                  rendered by Figma's images API and described by Claude Haiku),
 *                  stored as the candidate `summary` -- text and layer names
 *                  don't say "candlestick" or "gauge", the drawing does.
 *                  Sends the rendered designs to Anthropic. Needs FIGMA_ACCESS_TOKEN
 *                  and ANTHROPIC_API_KEY; captions are cached in eval/figma-captions.json.
 * Needs TYPESAFE_API_KEY, and the Figma file: FIGMA_EVAL_JSON=<path to saved
 * GET /v1/files/TkX9ifsyzkjZtIY0Lkzj3K> or FIGMA_ACCESS_TOKEN (env / .env) to fetch it.
 * Optional --sonnet adds a one-call Sonnet baseline over the same evidence
 * (needs ANTHROPIC_API_KEY, costs real money).  --repeats N (default 3) repeats
 * frames-full to show Jev's run-to-run spread.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE_KEY = "TkX9ifsyzkjZtIY0Lkzj3K";
if (existsSync(join(root, ".env"))) {
  for (const l of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = l.match(/^(ANTHROPIC_API_KEY|FIGMA_ACCESS_TOKEN)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (!process.env.TYPESAFE_API_KEY) { console.error("Missing TYPESAFE_API_KEY"); process.exit(1); }
const WITH_SONNET = process.argv.includes("--sonnet");
const repeats = Number(process.argv[process.argv.indexOf("--repeats") + 1]) || 3;

let jsonPath = process.env.FIGMA_EVAL_JSON;
if (!jsonPath) {
  if (!process.env.FIGMA_ACCESS_TOKEN) { console.error("Set FIGMA_EVAL_JSON or FIGMA_ACCESS_TOKEN"); process.exit(1); }
  const res = await fetch(`https://api.figma.com/v1/files/${FILE_KEY}`, { headers: { "X-Figma-Token": process.env.FIGMA_ACCESS_TOKEN } });
  if (!res.ok) { console.error(`Figma fetch failed: ${res.status}`); process.exit(1); }
  jsonPath = join(mkdtempSync(join(tmpdir(), "figma-eval-")), "file.json");
  writeFileSync(jsonPath, Buffer.from(await res.arrayBuffer()));
}
jsonPath = resolve(jsonPath);
const projectRoot = dirname(jsonPath), rel = basename(jsonPath);
const evalSet = JSON.parse(readFileSync(join(root, "eval/figma-eval-set.json"), "utf8"));

const VARIANTS = {
  components: { args: {}, env: {} },
  "frames-full": { args: { figma_mode: "frames", figma_pages: ["Design"] }, env: {} },
  "frames-notext": { args: { figma_mode: "frames", figma_pages: ["Design"] }, env: { PATTERN_JEV_FIGMA_TEXT: "0" } },
  "frames-allpages": { args: { figma_mode: "frames" }, env: {} },
  "frames-vision": { args: { figma_mode: "frames", figma_pages: ["Design"] }, env: {}, vision: true },
};
const RUNS = (process.env.VARIANTS ? process.env.VARIANTS.split(",") : ["components", ...Array(repeats).fill("frames-full"), "frames-notext", "frames-allpages", ...Array(repeats).fill("frames-vision")]);
const CAPTION_CACHE = join(root, "eval/figma-captions.json");
const captions = existsSync(CAPTION_CACHE) ? JSON.parse(readFileSync(CAPTION_CACHE, "utf8")) : {};
const captionStats = { generated: 0, input_tokens: 0, output_tokens: 0 };

async function captionDesigns(candidates) {
  const token = process.env.FIGMA_ACCESS_TOKEN, key = process.env.ANTHROPIC_API_KEY;
  if (!token || !key) throw new Error("frames-vision needs FIGMA_ACCESS_TOKEN and ANTHROPIC_API_KEY");
  const need = candidates.filter((c) => !captions[c.figma.node_id]);
  if (need.length > 0) {
    // Scale each render so its longest side is <= 1400px (the vision API rejects > 8000px, and
    // the page-shell "Dashboard" groups are huge). Sizes come from the saved file's bounding boxes.
    const file = JSON.parse(readFileSync(jsonPath, "utf8"));
    const boxes = new Map();
    (function walk(n) { if (n.absoluteBoundingBox) boxes.set(n.id, n.absoluteBoundingBox); (n.children ?? []).forEach(walk); })(file.document);
    // Figma's images endpoint rate-limits hard, so group nodes into a few scale buckets and
    // make one request per bucket instead of one per node.
    const bucketFor = (c) => {
      const box = boxes.get(c.figma.node_id);
      const want = box ? Math.min(1, 1400 / Math.max(box.width, box.height)) : 0.5;
      return [1, 0.5, 0.25, 0.1, 0.05].find((b) => b <= want) ?? 0.05;
    };
    const urls = new Map();
    for (const bucket of [...new Set(need.map(bucketFor))]) {
      const ids = need.filter((c) => bucketFor(c) === bucket).map((c) => c.figma.node_id).join(",");
      for (let attempt = 0; ; attempt++) {
        const imgs = await (await fetch(`https://api.figma.com/v1/images/${FILE_KEY}?ids=${encodeURIComponent(ids)}&format=png&scale=${bucket}`, { headers: { "X-Figma-Token": token } })).json();
        if (imgs.err === "Rate limit exceeded" && attempt < 6) { await new Promise((r) => setTimeout(r, 15000 * (attempt + 1))); continue; }
        if (imgs.err) throw new Error(`Figma images: ${imgs.err}`);
        for (const [id, u] of Object.entries(imgs.images ?? {})) urls.set(id, u);
        break;
      }
    }
    for (const c of need) {
      const url = urls.get(c.figma.node_id);
      if (!url) continue;
      const b64 = Buffer.from(await (await fetch(url)).arrayBuffer()).toString("base64");
      const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 150, messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
          { type: "text", text: "This is one chart/UI component design from a Figma dashboard template. In 2 sentences, state the chart type and what is drawn (e.g. candlestick, semicircular gauge, concentric rings, donut, stacked bars, sparkline), then notable interactive or annotation elements (tooltip, toggle, legend, callouts, selectors). Plain prose, no preamble." }] }] }) });
      const j = await res.json();
      if (!res.ok) throw new Error(`Anthropic vision ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
      captions[c.figma.node_id] = j.content.map((x) => x.text ?? "").join("").trim();
      captionStats.generated++; captionStats.input_tokens += j.usage.input_tokens; captionStats.output_tokens += j.usage.output_tokens;
      writeFileSync(CAPTION_CACHE, JSON.stringify(captions, null, 1));
    }
    writeFileSync(CAPTION_CACHE, JSON.stringify(captions, null, 1));
  }
  return captions;
}

async function runVariant(name) {
  const v = VARIANTS[name];
  const dsPath = join(tmpdir(), `figma-eval-ds-${Math.random().toString(36).slice(2)}.json`);
  const t = new StdioClientTransport({ command: "node", args: [join(root, "dist/index.js")], env: {
    ...process.env, ANTHROPIC_API_KEY: "", PATTERN_SCORER: "jev", PATTERN_NO_SUMMARIES: "1", PATTERN_PROJECT_ROOT: projectRoot,
    PATTERN_DESIGN_SYSTEMS_PATH: dsPath,
    PATTERN_LEDGER_PATH: join(tmpdir(), "figma-eval-ledger.jsonl"), PATTERN_LOG_PATH: join(tmpdir(), "figma-eval.log"),
    PATTERN_MEMORY_PATH: join(tmpdir(), "figma-eval-mem.json"), PATTERN_TOOLS: "full", ...v.env } });
  const c = new Client({ name: "figma-eval", version: "1" }, { capabilities: {} });
  await c.connect(t);
  const reg = await c.callTool({ name: "register_design_system", arguments: { project_id: "figma-eval", figma_json_path: rel, ...v.args } });
  if (reg.isError) throw new Error(reg.content[0].text);
  const registration = JSON.parse(reg.content[0].text).registration;
  if (v.vision) {
    // Prototype: write the captions into the stored registration as `summary`
    // (the Jev path reads the registration from disk on every call).
    const caps = await captionDesigns(registration.candidates);
    const stored = JSON.parse(readFileSync(dsPath, "utf8"));
    for (const cand of stored["figma-eval"].candidates) cand.summary = caps[cand.figma.node_id] ?? null;
    writeFileSync(dsPath, JSON.stringify(stored));
    for (const cand of registration.candidates) cand.summary = caps[cand.figma.node_id] ?? null;
  }
  const rows = [];
  let tokens = 0, ms = 0;
  for (const cs of evalSet.cases) {
    const r = await c.callTool({ name: "recommend_component", arguments: { component_need: cs.need, domain: "analytics dashboard", framework: "React", project_id: "figma-eval" } });
    const b = JSON.parse(r.content[0].text);
    tokens += b._meta.tokens_used.input; ms += b._meta.total_ms;
    const m = b.design_system_match;
    const found = b.reason === "scored";
    const top = m ? [m.components[0], ...m.alternatives.map((a) => a.components[0])] : [];
    rows.push({ id: cs.id, gold: cs.gold, found, top, score: m?.score ?? 0 });
  }
  await c.close();
  return { registration, rows, tokens, ms };
}

function metrics(rows) {
  const pos = rows.filter((r) => r.gold.length), neg = rows.filter((r) => !r.gold.length);
  const top1 = pos.filter((r) => r.found && r.gold.includes(r.top[0]));
  const top4 = pos.filter((r) => r.top.some((n) => r.gold.includes(n)));
  const negOk = neg.filter((r) => !r.found);
  const minRight = Math.min(1, ...top1.map((r) => r.score)), maxNeg = Math.max(0, ...neg.map((r) => r.score));
  return { pos: pos.length, top1: top1.length, top4: top4.length, neg: neg.length, negOk: negOk.length, overall: `${top1.length + negOk.length}/${rows.length}`,
    minRightScore: +minRight.toFixed(2), maxNegScore: +maxNeg.toFixed(2), wrong: pos.filter((r) => !(r.found && r.gold.includes(r.top[0]))).map((r) => `${r.id}->${r.found ? r.top[0] : "not found"}(${r.score})`) };
}

const results = [];
for (const name of RUNS) {
  process.stdout.write(`${name}... `);
  const out = await runVariant(name);
  const m = metrics(out.rows);
  results.push({ name, candidates: out.registration.candidate_count, ...m, avgMs: Math.round(out.ms / evalSet.cases.length), avgInputTokens: Math.round(out.tokens / evalSet.cases.length), rows: out.rows });
  console.log(`${out.registration.candidate_count} candidates | right ${m.top1}/${m.pos} (top-4 ${m.top4}) | nothing-fits ${m.negOk}/${m.neg} | overall ${m.overall} | lowest correct ${m.minRightScore} vs highest none ${m.maxNegScore} | ${Math.round(out.ms / evalSet.cases.length)}ms, ${Math.round(out.tokens / evalSet.cases.length)} tok/need`);
  if (m.wrong.length) console.log(`   wrong: ${m.wrong.join("; ")}`);
}

if (WITH_SONNET) {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("--sonnet needs ANTHROPIC_API_KEY"); process.exit(1); }
  const { collapseForJev } = await import(join(root, "dist/design-system-jev.js"));
  const out = await runVariant("frames-full");
  const pool = collapseForJev(out.registration.candidates);
  const list = pool.map((e) => `- [${e.components[0]}] ${e.evidence.replace(/\n/g, " ")}`).join("\n");
  let ok = 0, negOk = 0, wrong = [], inTok = 0;
  for (const cs of evalSet.cases) {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 100, messages: [{ role: "user", content:
        `You choose an existing design from a Figma file for a UI need. Use ONLY the candidates listed; never invent one. If none can satisfy the need as-is, say none.\n\nNEED: ${cs.need}\n\nCANDIDATES:\n${list}\n\nReply with JSON only: {"match": "<exact name in brackets, or null>"}` }] }) });
    const j = await res.json();
    inTok += j.usage?.input_tokens ?? 0;
    let match = null; try { match = JSON.parse((j.content[0].text.match(/\{[\s\S]*\}/) ?? ["{}"])[0]).match; } catch {}
    if (typeof match === "string") match = match.replace(/^\[|\]$/g, "");
    if (cs.gold.length) { if (match && cs.gold.includes(match)) ok++; else wrong.push(`${cs.id}->${match}`); } else if (!match) negOk++; else wrong.push(`${cs.id}->${match}`);
  }
  const pos = evalSet.cases.filter((c) => c.gold.length).length, neg = evalSet.cases.length - pos;
  console.log(`\nSonnet baseline (frames-full evidence): right ${ok}/${pos} | nothing-fits ${negOk}/${neg} | overall ${ok + negOk}/${evalSet.cases.length} | ${Math.round(inTok / evalSet.cases.length)} tok/need`);
  if (wrong.length) console.log(`   wrong: ${wrong.join("; ")}`);
}
if (captionStats.generated > 0) console.log(`\nVision captions generated: ${captionStats.generated} (${captionStats.input_tokens} in / ${captionStats.output_tokens} out tokens, ~$${((captionStats.input_tokens * 1 + captionStats.output_tokens * 5) / 1e6).toFixed(3)} at Haiku rates)`);
writeFileSync(join(root, "eval/figma-frames-log.json"), JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 1));
console.log("\nWrote eval/figma-frames-log.json");
