#!/usr/bin/env node
/**
 * Design-system-scored eval: Jev (and a Sonnet baseline) picking the right
 * existing component from a project's OWN component library, or saying
 * nothing fits. No web search anywhere. Tests four ways of turning source
 * files into evidence text ("extraction variants"):
 *   E0  approximation of Pattern's current register_design_system scanner
 *       (only `export function/const Name`; prop names only)
 *   E1  free regex: also `export { A, B }` lists, all Props types, doc comment
 *   E2  E1 + first ~1000 chars of source (imports stripped)
 *   E3  E1 + cached Haiku-written capability summary (costs tokens; measured)
 *   R   the candidates the SHIPPED register_design_system tool actually
 *       produces (name-level, recursive, incl. sub-components), obtained by
 *       spawning dist/index.js. Requires `npm run build` first.
 *   R2  the same shipped-scanner output collapsed to ONE candidate per file
 *       (exports joined, props unioned, file name in evidence, like E1).
 *   R3  R2 + the cached Haiku capability summary (like E3, on shipped output).
 * Requires ANTHROPIC_API_KEY (.env ok) and TYPESAFE_API_KEY (env).
 * Usage: node scripts/design-system-jev-eval.mjs [--no-sonnet]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.ANTHROPIC_API_KEY && existsSync(join(root, ".env"))) {
  for (const l of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = l.match(/^ANTHROPIC_API_KEY=(.*)$/);
    if (m) process.env.ANTHROPIC_API_KEY = m[1].replace(/^["']|["']$/g, "");
  }
}
for (const k of ["ANTHROPIC_API_KEY", "TYPESAFE_API_KEY"]) if (!process.env[k]) { console.error(`Missing ${k}`); process.exit(1); }
const RUN_SONNET = !process.argv.includes("--no-sonnet");
const evalSet = JSON.parse(readFileSync(join(root, "eval/design-system-eval-set.json"), "utf8"));
const home = (p) => p.replace(/^~/, homedir());

// ---------- inventory + extraction ----------
function balanced(content, from) {
  const i = content.indexOf("{", from); if (i < 0) return null;
  let d = 0;
  for (let j = i; j < content.length; j++) { if (content[j] === "{") d++; else if (content[j] === "}" && --d === 0) return content.slice(i + 1, j); }
  return null;
}
const propNames = (body) => [...body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*[:,]/gm)].map((m) => m[1]);
function currentScanner(content) { // approximation of scanComponentFile
  const names = new Map(); let m;
  const fnRe = /export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g;
  const constRe = /export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*(?::[^=\n]+)?=/g;
  while ((m = fnRe.exec(content))) names.set(m[1], m.index);
  while ((m = constRe.exec(content))) if (!names.has(m[1])) names.set(m[1], m.index);
  const out = [];
  for (const [name, idx] of names) {
    let props = [];
    const im = content.match(new RegExp(`(?:interface|type)\\s+${name}Props\\b`));
    if (im) { const b = balanced(content, im.index); if (b) props = propNames(b); }
    if (!props.length) { const pm = content.match(new RegExp(`${name}\\.propTypes\\s*=`)); if (pm) { const b = balanced(content, pm.index); if (b) props = propNames(b); } }
    if (!props.length) { const seg = content.slice(idx, idx + 500); const d = seg.match(/\(\s*\{([^}]*)\}/); if (d) props = d[1].split(",").map((s) => s.trim().split(/[=:\s]/)[0]).filter(Boolean); }
    out.push({ name, props });
  }
  return out;
}
function freeExtract(content) {
  const names = new Set(currentScanner(content).map((c) => c.name));
  for (const m of content.matchAll(/export\s*\{([^}]*)\}/g)) for (const n of m[1].split(",")) { const nm = n.trim().split(/\s+as\s+/).pop(); if (/^[A-Z]/.test(nm)) names.add(nm); }
  const props = new Set();
  for (const m of content.matchAll(/(?:interface|type)\s+[A-Za-z0-9_]*Props\b/g)) { const b = balanced(content, m.index); if (b) propNames(b).forEach((p) => props.add(p)); }
  const doc = (content.match(/\/\*\*([\s\S]*?)\*\//) ?? [])[1]?.replace(/^\s*\*\s?/gm, "").trim().slice(0, 300) ?? "";
  return { names: [...names], props: [...props].slice(0, 25), doc };
}
const stripImports = (c) => c.split("\n").filter((l) => !/^\s*(import\b|\} from )/.test(l)).join("\n").trim();

const pools = {}; // system -> [{file, content}]
for (const [sys, cfg] of Object.entries(evalSet._meta.systems)) {
  const dir = home(cfg.dir);
  pools[sys] = readdirSync(dir).filter((f) => cfg.exts.some((e) => f.endsWith(e)) && !/\.(test|spec|stories)\.|\.d\.ts$/.test(f))
    .map((file) => ({ file, content: readFileSync(join(dir, file), "utf8") }));
}

// ---------- API helpers ----------
async function anthropic(model, prompt, max_tokens = 300) {
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens, messages: [{ role: "user", content: prompt }] }) });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json(); return { text: j.content.map((c) => c.text ?? "").join(""), usage: j.usage };
}
async function jev(state, questions) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch("https://api.typesafe.ai/v1/systemone", { method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.TYPESAFE_API_KEY}` },
      body: JSON.stringify({ model: process.env.PATTERN_JEV_MODEL ?? "jev-latest", state, questions }) });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 1500 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`TypeSafe ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  throw new Error("TypeSafe: retries exhausted");
}

// ---------- Haiku summaries (cached, cost measured) ----------
const cachePath = join(root, "eval/design-system-summaries.json");
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
let haikuIn = 0, haikuOut = 0, haikuCalls = 0;
async function summary(sys, f) {
  const key = `${sys}/${f.file}:${createHash("sha1").update(f.content).digest("hex").slice(0, 10)}`;
  if (cache[key]) return cache[key];
  const r = await anthropic("claude-haiku-4-5-20251001",
    `Below is a UI component source file from a design system. In 2-3 sentences, state what UI capability it provides, when a developer would reach for it, and its notable variants/features. Plain prose, no preamble, no code.\n\nFILE: ${f.file}\n\n${f.content.slice(0, 8000)}`, 200);
  haikuIn += r.usage.input_tokens; haikuOut += r.usage.output_tokens; haikuCalls++;
  return (cache[key] = r.text.trim());
}

// ---------- shipped scanner (variant R) ----------
const REAL = { buzz: { root: "~/projects/buzz", rel: "desktop/src/shared/ui" }, calvin: { root: "~/family-hq", rel: "frontend/src/components" } };
async function shippedCandidates(sys) {
  const t = new StdioClientTransport({ command: "node", args: [join(root, "dist/index.js")], env: { ...process.env, PATTERN_PROJECT_ROOT: home(REAL[sys].root), PATTERN_DESIGN_SYSTEMS_PATH: join(tmpdir(), `ds-eval-${sys}.json`), PATTERN_TOOLS: "full" } });
  const c = new Client({ name: "ds-eval", version: "1" }, { capabilities: {} });
  await c.connect(t);
  const r = await c.callTool({ name: "register_design_system", arguments: { project_id: `eval-${sys}`, directory_path: REAL[sys].rel } });
  await c.close();
  return JSON.parse(r.content[0].text).registration.candidates;
}

// ---------- evidence variants ----------
async function buildPool(sys, variant) {
  const out = [];
  if (variant === "R2" || variant === "R3") {
    const byFile = new Map();
    for (const c of await shippedCandidates(sys)) {
      const f = c.file_path ?? c.name;
      const g = byFile.get(f) ?? { names: [], props: new Set(), description: c.description };
      g.names.push(c.name); c.props.forEach((p) => g.props.add(p)); byFile.set(f, g);
    }
    for (const [file, g] of byFile) {
      let ev = `file: ${file}; exports: ${g.names.join(", ")}; props: ${[...g.props].slice(0, 25).join(", ") || "none listed"}${g.description ? `; doc: ${g.description}` : ""}`;
      if (variant === "R3") {
        const abs = join(home(REAL[sys].root), REAL[sys].rel, file);
        ev += `\nsummary: ${await summary(sys, { file, content: readFileSync(abs, "utf8") })}`;
      }
      out.push({ file, evidence: ev });
    }
    return out;
  }
  if (variant === "R") {
    for (const c of await shippedCandidates(sys))
      out.push({ file: c.file_path ?? c.name, name: c.name, evidence: `${c.name}(props: ${c.props.join(", ") || "none listed"})${c.description ? `; ${c.description}` : ""}` });
    return out;
  }
  for (const f of pools[sys]) {
    const cur = currentScanner(f.content);
    if (variant === "E0") {
      if (!cur.length) continue; // scanner finds nothing -> file never enters the candidate pool
      out.push({ file: f.file, evidence: cur.map((c) => `${c.name}(props: ${c.props.join(", ") || "none listed"})`).join("; ") });
      continue;
    }
    const x = freeExtract(f.content);
    let ev = `file: ${f.file}; exports: ${x.names.join(", ") || "none detected"}; props: ${x.props.join(", ") || "none listed"}` + (x.doc ? `; doc: ${x.doc}` : "");
    if (variant === "E2") ev += `\nsource head:\n${stripImports(f.content).slice(0, 1000)}`;
    if (variant === "E3") ev += `\nsummary: ${await summary(sys, f)}`;
    out.push({ file: f.file, evidence: ev });
  }
  return out;
}

// ---------- scorers ----------
async function scoreJev(need, pool) {
  const state = { component_need: need, candidates: pool.map((c, i) => ({ id: `c${i}`, evidence: c.evidence })) };
  const questions = Object.fromEntries(pool.map((c, i) => [`c${i}`, { type: "noul", instructions: `Candidate c${i} (${c.name ?? ""} ${c.file}) can fully satisfy the component_need as-is, without being rebuilt.` }]));
  const res = await jev(state, questions);
  const ranked = pool.map((c, i) => ({ file: c.file, p: res.answers[`c${i}`]?.noul ?? 0 })).sort((a, b) => b.p - a.p);
  return { ranked, usage: res.usage };
}
async function scoreSonnet(need, pool) {
  const list = pool.map((c) => `- [${c.file}] ${c.evidence.replace(/\n/g, " ")}`).join("\n");
  const r = await anthropic("claude-sonnet-5",
    `You choose an existing component from a project's own design system for a UI need. Use ONLY the candidates listed; never invent one. If none can satisfy the need as-is, say none.\n\nNEED: ${need}\n\nCANDIDATES:\n${list}\n\nReply with JSON only: {"match": "<file name in brackets, or null>"}`, 100);
  let match = null; try { match = JSON.parse(r.text.match(/\{[\s\S]*\}/)[0]).match; if (typeof match === "string") match = match.match(/[\w.\/-]+\.(?:tsx?|jsx?)/)?.[0] ?? null; } catch {}
  return { match, usage: r.usage };
}

// ---------- run ----------
const VARIANTS = (process.env.VARIANTS ?? "E0,E1,E2,E3,R,R2").split(","), THRESH = 0.5;
const runs = {}, poolSizes = {}, evidenceSamples = {};
for (const v of VARIANTS) {
  process.stdout.write(`\n[${v}] building pools... `);
  const pool = {}; for (const sys of Object.keys(pools)) pool[sys] = await buildPool(sys, v);
  console.log(Object.entries(pool).map(([s, p]) => `${s}:${p.length}/${pools[s].length} files`).join("  "));
  evidenceSamples[v] = Object.fromEntries(Object.entries(pool).flatMap(([sy, p]) => p.filter((x) => ["markdown.tsx", "ChatDrawer.jsx", "tooltip.tsx"].includes(x.file)).map((x) => [`${sy}/${x.file}`, x.evidence])));
  poolSizes[v] = Object.fromEntries(Object.entries(pool).map(([sy, p]) => [sy, p.length]));
  const rows = [];
  for (let i = 0; i < evalSet.cases.length; i += 4) {
    const batch = evalSet.cases.slice(i, i + 4);
    rows.push(...await Promise.all(batch.map(async (c) => {
      const p = pool[c.system]; const row = { id: c.id, gold: c.gold, goldInPool: c.gold.length === 0 || c.gold.some((g) => p.some((x) => x.file === g)) };
      try { const t0 = Date.now(); const j = await scoreJev(c.need, p); row.jev = { ...j, ms: Date.now() - t0 }; } catch (e) { row.jev = { error: e.message }; }
      if (RUN_SONNET && (v === "E0" || v === "E3" || v === "R" || v === "R2" || v === "R3")) { try { row.sonnet = await scoreSonnet(c.need, p); } catch (e) { row.sonnet = { error: e.message }; } }
      return row;
    })));
    process.stdout.write(".");
  }
  runs[v] = rows;
}

// ---------- metrics ----------
function metrics(rows, pick) {
  let pos = 0, top1 = 0, top3 = 0, neg = 0, negOk = 0, inPool = 0, errors = 0, sumPos = 0, sumNeg = 0;
  for (const r of rows) {
    const s = pick(r); if (!s || s.error) { errors++; continue; }
    if (r.gold.length) { pos++; if (r.goldInPool) inPool++;
      if (s.top1 && s.found && r.gold.includes(s.top1)) top1++;
      if (s.top3?.some((f) => r.gold.includes(f))) top3++; if (s.maxp != null) sumPos += s.maxp;
    } else { neg++; if (!s.found) negOk++; if (s.maxp != null) sumNeg += s.maxp; }
  }
  return { pos, neg, "top1(found&right)": `${top1}/${pos}`, "top3(any rank)": s3(top3, pos), "neg correctly none": `${negOk}/${neg}`, "overall": `${top1 + negOk}/${pos + neg}`, "gold in pool": `${inPool}/${pos}`, "mean max-p pos/neg": neg ? `${(sumPos / Math.max(pos, 1)).toFixed(2)} / ${(sumNeg / neg).toFixed(2)}` : "-", errors };
}
const s3 = (a, b) => `${a}/${b}`;
const jevPick = (r) => r.jev?.ranked ? { top1: r.jev.ranked[0].file, top3: [...new Set(r.jev.ranked.map((x) => x.file))].slice(0, 3), maxp: r.jev.ranked[0].p, found: r.jev.ranked[0].p >= THRESH } : r.jev;
const sonPick = (r) => r.sonnet?.usage ? { top1: r.sonnet.match, top3: r.sonnet.match ? [r.sonnet.match] : [], found: !!r.sonnet.match } : r.sonnet;
console.log("\n\n=== Results (Jev found iff max p >= " + THRESH + ") ===");
const summary_ = {};
for (const v of VARIANTS) {
  summary_[v] = { pool_sizes: poolSizes[v], jev: metrics(runs[v], jevPick) };
  const jt = runs[v].reduce((a, r) => a + (r.jev?.usage?.input_tokens ?? 0), 0), jo = runs[v].reduce((a, r) => a + (r.jev?.usage?.output_tokens ?? 0), 0);
  summary_[v].jev_tokens = { input: jt, output: jo, avg_ms: Math.round(runs[v].reduce((a, r) => a + (r.jev?.ms ?? 0), 0) / runs[v].length) };
  console.log(`\n${v} Jev:`, JSON.stringify(summary_[v].jev), "\n    tokens:", JSON.stringify(summary_[v].jev_tokens));
  if (runs[v][0].sonnet) {
    summary_[v].sonnet = metrics(runs[v], sonPick);
    const si = runs[v].reduce((a, r) => a + (r.sonnet?.usage?.input_tokens ?? 0), 0), so = runs[v].reduce((a, r) => a + (r.sonnet?.usage?.output_tokens ?? 0), 0);
    summary_[v].sonnet_tokens = { input: si, output: so };
    console.log(`${v} Sonnet:`, JSON.stringify(summary_[v].sonnet), "\n    tokens:", JSON.stringify(summary_[v].sonnet_tokens));
  }
}
console.log(`\nHaiku summaries generated this run: ${haikuCalls} calls, ${haikuIn} in / ${haikuOut} out tokens (cached in eval/design-system-summaries.json)`);
writeFileSync(cachePath, JSON.stringify(cache, null, 1));
writeFileSync(join(root, "eval/design-system-jev-log.json"), JSON.stringify({ generated_at: new Date().toISOString(), threshold: THRESH, haiku: { calls: haikuCalls, input_tokens: haikuIn, output_tokens: haikuOut }, summary: summary_, evidenceSamples, runs }, null, 1));
console.log("Wrote eval/design-system-jev-log.json");
