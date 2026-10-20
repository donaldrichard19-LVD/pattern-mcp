#!/usr/bin/env node
/**
 * eval-verify-known-bad.mjs -- does verify_component actually fail bad code?
 *
 * "A pass is only as meaningful as the tool's ability to fail." This runs a
 * known-good component and a set of single-defect variants (eval/verify-known-bad-corpus.mjs)
 * through the real verify_component over MCP, then reports, per defect, whether the
 * target checklist item came back fail / unverified / pass, plus false failures on
 * the good component.
 *
 *   node scripts/eval-verify-known-bad.mjs --check        offline: corpus integrity + harness plumbing, no key
 *   node scripts/eval-verify-known-bad.mjs --selftest     offline: the scorer, against synthetic results
 *   ANTHROPIC_API_KEY=... node scripts/eval-verify-known-bad.mjs [--repeats 3] [--out results.json] [--only name,name] [--concurrency 3]
 *   node scripts/eval-verify-known-bad.mjs --fake         exercises the run/report loop with CANNED statuses (no model, no key).
 *                                                        Output is SIMULATED and says so; it is not a measurement.
 *
 * The live run makes (variants x repeats) model calls, a few cents each. The model is
 * nondeterministic, so repeats matter: a defect it catches 2 of 3 times is not caught.
 * Run after `npm run build`. Telemetry is off.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASELINE, buildVariants, CHECKLIST } from "../eval/verify-known-bad-corpus.mjs";

process.env.PATTERN_TELEMETRY ??= "0";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = "verify-known-bad";

// ---------- scoring (pure, exported for --selftest) ----------
export function scoreRun(variant, statuses) {
  // statuses: array of "pass" | "fail" | "unverified", one per checklist item
  const t = variant.target != null ? statuses[variant.target - 1] : null;
  const ignore = new Set([variant.target, ...(variant.alsoAffects ?? [])].filter((x) => x != null));
  const collateralFails = statuses.filter((s, i) => s === "fail" && !ignore.has(i + 1)).length;
  return { target: t, caughtStrict: t === "fail", caughtLenient: t != null && t !== "pass", missed: t === "pass", collateralFails };
}

export function summarize(rows) {
  // rows: [{ variant, runs: [{ statuses, cost }] }]
  const defects = rows.filter((r) => r.variant.group === "defect");
  const controls = rows.filter((r) => r.variant.group === "control");
  const flat = (rs) => rs.flatMap((r) => r.runs.map((run) => ({ r, run, s: scoreRun(r.variant, run.statuses) })));
  const d = flat(defects);
  const c = flat(controls);
  const rate = (n, total) => (total === 0 ? null : n / total);
  return {
    defect_runs: d.length,
    caught_strict: rate(d.filter((x) => x.s.caughtStrict).length, d.length),
    caught_lenient: rate(d.filter((x) => x.s.caughtLenient).length, d.length),
    missed: rate(d.filter((x) => x.s.missed).length, d.length),
    collateral_fail_rate: rate(d.filter((x) => x.s.collateralFails > 0).length, d.length),
    control_runs: c.length,
    control_false_fail_rate: rate(c.filter((x) => x.run.statuses.some((s) => s === "fail")).length, c.length),
    control_all_pass_rate: rate(c.filter((x) => x.run.statuses.every((s) => s === "pass")).length, c.length),
    inconsistent_defects: defects.filter((r) => new Set(r.runs.map((x) => scoreRun(r.variant, x.statuses).target)).size > 1).map((r) => r.variant.name),
    missed_defects: defects.filter((r) => r.runs.some((x) => scoreRun(r.variant, x.statuses).missed)).map((r) => r.variant.name),
    total_cost_usd: rows.reduce((a, r) => a + r.runs.reduce((b, x) => b + (x.cost ?? 0), 0), 0),
  };
}

const pct = (x) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);
function renderTable(rows, summary) {
  const out = [];
  out.push("| variant | group | breaks item | expected | target status per run | collateral fails |");
  out.push("|---|---|---|---|---|---|");
  for (const r of rows) {
    const v = r.variant;
    const per = r.runs.map((x) => (v.target != null ? x.statuses[v.target - 1] : x.statuses.map((s) => s[0]).join(""))).join(", ");
    const coll = r.runs.map((x) => scoreRun(v, x.statuses).collateralFails).join(",");
    out.push(`| ${v.name} | ${v.group} | ${v.target ?? "-"} | ${v.expect ?? (v.group === "control" ? "all pass" : "-")} | ${per} | ${coll} |`);
  }
  out.push("");
  out.push(`Defects caught as FAIL: ${pct(summary.caught_strict)}   caught as fail-or-unverified: ${pct(summary.caught_lenient)}   missed (item passed): ${pct(summary.missed)}   (${summary.defect_runs} runs)`);
  out.push(`Collateral false failures on defect runs: ${pct(summary.collateral_fail_rate)}`);
  out.push(`Control (good component): any item failed: ${pct(summary.control_false_fail_rate)}   all 8 passed: ${pct(summary.control_all_pass_rate)}   (${summary.control_runs} runs)`);
  if (summary.missed_defects.length) out.push(`Defects that passed at least once: ${summary.missed_defects.join(", ")}`);
  if (summary.inconsistent_defects.length) out.push(`Inconsistent across repeats: ${summary.inconsistent_defects.join(", ")}`);
  out.push(`Total model cost: $${summary.total_cost_usd.toFixed(3)}`);
  return out.join("\n");
}

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok: ${label}`); else { console.error(`  FAIL: ${label}${detail ? `\n    ${detail}` : ""}`); failures++; } };

// ---------- --selftest ----------
if (flag("--selftest")) {
  console.log("scorer self-test (synthetic results, no model)");
  const mk = (name, group, target, expect, alsoAffects) => ({ name, group, target, expect, alsoAffects });
  const P = Array(8).fill("pass");
  const withAt = (i, s) => P.map((x, k) => (k === i - 1 ? s : x));
  const esc = mk("escape-missing", "defect", 2, "fail");
  check("target fail -> caught strict + lenient", (({ caughtStrict: a, caughtLenient: b }) => a && b)(scoreRun(esc, withAt(2, "fail"))));
  check("target unverified -> lenient only", (({ caughtStrict: a, caughtLenient: b }) => !a && b)(scoreRun(esc, withAt(2, "unverified"))));
  check("target pass -> missed", scoreRun(esc, P).missed === true);
  check("another item failing -> collateral", scoreRun(esc, withAt(2, "fail").map((s, i) => (i === 4 ? "fail" : s))).collateralFails === 1);
  const cm = mk("cancel-missing", "defect", 8, "fail", [6]);
  check("alsoAffects item failing is not collateral", scoreRun(cm, withAt(8, "fail").map((s, i) => (i === 5 ? "fail" : s))).collateralFails === 0);
  const rows = [
    { variant: esc, runs: [{ statuses: withAt(2, "fail") }, { statuses: withAt(2, "fail") }, { statuses: P }] },
    { variant: mk("baseline", "control", null), runs: [{ statuses: P }, { statuses: withAt(3, "fail") }] },
  ];
  const s = summarize(rows);
  check("2 of 3 defect runs caught strictly", Math.abs(s.caught_strict - 2 / 3) < 1e-9);
  check("flagged as inconsistent and as missed", s.inconsistent_defects[0] === "escape-missing" && s.missed_defects[0] === "escape-missing");
  check("control false-fail 1 of 2", s.control_false_fail_rate === 0.5 && s.control_all_pass_rate === 0.5);
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

// ---------- corpus integrity (always) ----------
console.log("corpus integrity");
const variants = buildVariants();
check(`${variants.length} variants built, each from exactly one edit`, variants.length >= 10);
check("every defect variant differs from the baseline", variants.filter((v) => v.group !== "control").every((v) => v.source !== BASELINE));
check("the control is byte-identical to the baseline", variants.find((v) => v.group === "control").source === BASELINE);
check("every defect names a target item within the checklist", variants.filter((v) => v.group === "defect").every((v) => v.target >= 1 && v.target <= CHECKLIST.length));
for (const v of variants) {
  const missing = (v.mustContain ?? []).filter((s) => !v.source.includes(s));
  const present = (v.mustNotContain ?? []).filter((s) => v.source.includes(s));
  check(`${v.name}: the intended defect is really in the file`, missing.length === 0 && present.length === 0, `missing: ${JSON.stringify(missing)} unexpectedly present: ${JSON.stringify(present)}`);
}
const nameSet = new Set(variants.map((v) => v.name));
check("variant names are unique", nameSet.size === variants.length);
if (failures > 0) { console.error(`\n${failures} integrity check(s) FAILED.`); process.exit(1); }

// ---------- harness ----------
const only = opt("--only", null)?.split(",");
const selected = only ? variants.filter((v) => only.includes(v.name)) : variants;
const repeats = Math.max(1, Number(opt("--repeats", "3")));
const concurrency = Math.max(1, Number(opt("--concurrency", "3")));

const root = mkdtempSync(join(tmpdir(), "pattern-verify-known-bad-"));
mkdirSync(join(root, "src"), { recursive: true });
const ledgerPath = join(root, "ledger.jsonl");
const lines = [];
for (const v of selected) {
  writeFileSync(join(root, "src", `${v.name}.tsx`), v.source, "utf8");
  lines.push(JSON.stringify({
    id: `seed-${v.name}`, timestamp: new Date().toISOString(), project_id: PROJECT, feature_id: `f-${v.name}`,
    component_need: "confirmation dialog for a destructive action", domain: "SaaS admin", framework: "React", checklist: CHECKLIST,
    checklist_source: "provided", candidates_evaluated: [], verdict: "custom_build", chosen_candidate: null, confidence: "medium",
    reason: "scored", coverage: null, cost_usd: 0, cache_hit: false, project_conventions_snapshot: null, snapshot_ref: null,
    last_verified_live: null, live_status: "unknown", reconstructed_snapshot_ref: null, file_path: `src/${v.name}.tsx`,
  }));
}
writeFileSync(ledgerPath, lines.join("\n") + "\n", "utf8");

const env = {
  ...process.env,
  HOME: root,
  PATTERN_PROJECT_ROOT: root,
  PATTERN_LEDGER_PATH: ledgerPath,
  PATTERN_MEMORY_PATH: join(root, "memory.json"),
  PATTERN_DESIGN_SYSTEMS_PATH: join(root, "design-systems.json"),
  PATTERN_SESSION_CAP: "1000",
  PATTERN_NO_AUTOSTART: "",
  PATTERN_TELEMETRY: "0",
  PATTERN_NO_CONNECT_NOTICE: "1",
  PATTERN_NO_ENFORCEMENT_NOTICE: "1",
};
const hasKey = !!process.env.ANTHROPIC_API_KEY;
const transport = new StdioClientTransport({ command: process.execPath, args: [join(repo, "dist/index.js")], env, stderr: "ignore" });
const client = new Client({ name: "eval-verify-known-bad", version: "0" }, { capabilities: {} });
await client.connect(transport);

// --fake: canned statuses so the live loop, table and JSON can be exercised offline.
const FAKE_MISSES = new Set(["escape-dead-code", "named-color"]);
const fakeVerify = async (name) => {
  const v = variants.find((x) => x.name === name);
  const statuses = Array(CHECKLIST.length).fill("pass");
  if (v.target != null && !FAKE_MISSES.has(name)) statuses[v.target - 1] = v.expect === "not_pass" ? "unverified" : "fail";
  return { statuses, cost: 0.01 };
};
const verify = async (name) => {
  if (flag("--fake")) return fakeVerify(name);
  const r = await client.callTool({ name: "verify_component", arguments: { project_id: PROJECT, file_path: `src/${name}.tsx` } });
  const text = r.content?.[0]?.text ?? "";
  if (r.isError) return { error: text };
  const body = JSON.parse(text);
  return { statuses: body.items.map((i) => i.status), cost: body._meta?.estimated_cost_usd ?? 0, body };
};

console.log("\nharness plumbing");
const probe = flag("--fake") ? { statuses: [] } : await verify(selected[0].name);
if (flag("--fake")) console.log("\n*** --fake: SIMULATED statuses, no model was called. Not a measurement. ***");
if (probe.error && /ANTHROPIC_API_KEY is not set/.test(probe.error)) {
  check("ledger entry found and checklist loaded (verify reached the API-key check)", true);
  console.log(hasKey ? "" : "\nNo ANTHROPIC_API_KEY: the live model pass was not run.");
  if (!hasKey) {
    console.log(`Run it with a key:  ANTHROPIC_API_KEY=... node scripts/eval-verify-known-bad.mjs --repeats 3 --out verify-known-bad-results.json\n(${selected.length} variants x ${repeats} repeats = ${selected.length * repeats} model calls)`);
    await client.close();
    process.exit(flag("--check") ? 0 : 2);
  }
}
if (probe.error && !/ANTHROPIC_API_KEY is not set/.test(probe.error)) {
  check("verify_component call", false, probe.error.slice(0, 300));
  await client.close();
  process.exit(1);
}
if (flag("--check")) {
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  await client.close();
  process.exit(failures === 0 ? 0 : 1);
}

// ---------- live run ----------
console.log(`\nlive run: ${selected.length} variants x ${repeats} repeats, concurrency ${concurrency}`);
const jobs = selected.flatMap((v) => Array.from({ length: repeats }, (_, i) => ({ v, i })));
const results = new Map(selected.map((v) => [v.name, []]));
let next = 0, done = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < jobs.length) {
    const { v } = jobs[next++];
    let res = await verify(v.name);
    if (res.error) res = await verify(v.name); // one retry for transient API errors
    results.get(v.name).push(res.error ? { error: res.error, statuses: Array(CHECKLIST.length).fill("unverified"), cost: 0, errored: true } : res);
    process.stdout.write(`\r  ${++done}/${jobs.length}`);
  }
}));
console.log("");
await client.close();

const rows = selected.map((v) => ({ variant: v, runs: results.get(v.name) }));
const errored = rows.flatMap((r) => r.runs.filter((x) => x.errored).map((x) => `${r.variant.name}: ${x.error.slice(0, 120)}`));
const summary = summarize(rows);
if (flag("--fake")) console.log("\n*** SIMULATED RESULTS (canned) -- not a measurement of verify_component ***");
console.log("\n" + renderTable(rows, summary));
if (errored.length) console.log(`\n${errored.length} run(s) errored (counted as unverified, treat results with care):\n  ${errored.join("\n  ")}`);

const out = opt("--out", null);
if (out) {
  writeFileSync(out, JSON.stringify({
    ran_at: new Date().toISOString(), model: process.env.PATTERN_MODEL ?? "(default)", repeats, checklist: CHECKLIST, summary,
    rows: rows.map((r) => ({ name: r.variant.name, group: r.variant.group, description: r.variant.description, target: r.variant.target, expect: r.variant.expect ?? null,
      runs: r.runs.map((x) => ({ statuses: x.statuses, cost: x.cost, errored: !!x.errored, items: x.body?.items?.map((i) => ({ status: i.status, evidence: i.evidence })) })) })),
  }, null, 2));
  console.log(`\nWrote ${out}`);
}
process.exit(errored.length === rows.reduce((a, r) => a + r.runs.length, 0) ? 1 : 0);
