#!/usr/bin/env node
/**
 * verify-session-failure-fixes.mjs
 *
 * Regression checks for the failure modes hit while using Pattern's tools to
 * rebuild the landing page (2026-10-27). Free and deterministic: no
 * Anthropic call is made. Each section names the failure it guards.
 *
 *   FM1  server root is a parent of the repo -> verify_component could not
 *        find the file, and receipts were read/written in the wrong place
 *   FM2  verify_component on a ledger entry with no checklist (Jev match)
 *   FM3  design-system registration whose component files were deleted
 *   FM4  gate: new file whose components carry reasoned skips
 *   FM5  recommend_component use_existing at partial coverage read as full
 *   FM6  Jev cost reported as 0 with no machine-readable "unknown"
 *
 * Run: node scripts/verify-session-failure-fixes.mjs (after `npm run build`)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.PATTERN_NO_AUTOSTART = "1";
const dist = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const { resolveProjectFile, toRootRelative } = await import(join(dist, "project-files.js"));

let failures = 0;
function check(label, ok) {
  if (ok) console.log(`  ok: ${label}`);
  else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}
const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });

// ---- FM1: path resolution ---------------------------------------------------
console.log("FM1: resolveProjectFile when the server root is a parent of the repo");
const root = mkdtempSync(join(tmpdir(), "pattern-fm-"));
const repo = join(root, "repo");
mkdirSync(join(repo, "pkg"), { recursive: true });
writeFileSync(join(repo, "pkg", "x.tsx"), "export function X() { return null }\n");
git(repo, "init", "-q");
{
  const a = resolveProjectFile(root, "repo/pkg/x.tsx");
  check("root-relative path resolves", a && a.repoRel === "pkg/x.tsx" && a.rootRel === "repo/pkg/x.tsx");
  const b = resolveProjectFile(root, "pkg/x.tsx");
  check("repo-relative path resolves via the nested repo", b && b.via === "nested_repo" && b.repoRoot === repo);
  const c = resolveProjectFile(root, join(repo, "pkg", "x.tsx"));
  check("absolute path inside the root resolves", c && c.via === "absolute" && c.repoRel === "pkg/x.tsx");
  check("every spelling is offered for ledger matching", b && ["pkg/x.tsx", "repo/pkg/x.tsx"].every((s) => b.spellings.includes(s)));
  check("../ escape is refused", resolveProjectFile(root, "../x.tsx") === null && resolveProjectFile(root, "repo/../../x.tsx") === null);
  check("absolute path outside the root is refused", resolveProjectFile(root, "/etc/hostname") === null);
  check("missing file -> null", resolveProjectFile(root, "pkg/nope.tsx") === null);
  const repo2 = join(root, "repo2");
  mkdirSync(join(repo2, "pkg"), { recursive: true });
  writeFileSync(join(repo2, "pkg", "x.tsx"), "export function Y() { return null }\n");
  git(repo2, "init", "-q");
  check("ambiguous repo-relative path (two repos) -> null, never a guess", resolveProjectFile(root, "pkg/x.tsx") === null);
  check("toRootRelative converts an absolute path inside the root", toRootRelative(root, join(repo, "pkg", "x.tsx")) === "repo/pkg/x.tsx");
  check("toRootRelative leaves relative paths alone", toRootRelative(root, "./pkg/x.tsx") === "pkg/x.tsx");
}

// ---- FM1/FM2 through the real server ------------------------------------
console.log("FM1/FM2: verify_component through the server (no API key, so it must stop at the key check)");
const solo = mkdtempSync(join(tmpdir(), "pattern-fm2-"));
const srepo = join(solo, "site");
mkdirSync(join(srepo, "components"), { recursive: true });
writeFileSync(join(srepo, "components", "Hero.tsx"), "export function Hero() { return null }\n");
git(srepo, "init", "-q");
const ledger = join(solo, "ledger.jsonl");
const entry = (id, file, checklist) =>
  JSON.stringify({ id, timestamp: "2026-10-01T00:00:00Z", project_id: "p", feature_id: "f", component_need: "hero", domain: "d", framework: "r", checklist, checklist_source: "provided", candidates_evaluated: [], verdict: "use_existing", chosen_candidate: null, confidence: "low", reason: "scored", coverage: "1/2", cost_usd: 0, cache_hit: false, project_conventions_snapshot: null, snapshot_ref: null, last_verified_live: null, live_status: "unknown", file_path: file });
writeFileSync(ledger, [entry("e1", "components/Hero.tsx", ["a", "b"])].join("\n") + "\n");
const env = { ...process.env, ANTHROPIC_API_KEY: "", PATTERN_PROJECT_ROOT: solo, PATTERN_LEDGER_PATH: ledger, PATTERN_LEDGER_FILE_PATHS_PATH: join(solo, "fp.jsonl"), PATTERN_LEDGER_VERIFICATIONS_PATH: join(solo, "v.jsonl"), PATTERN_NO_ENFORCEMENT_HOOK: "1", PATTERN_NO_CONNECT_NOTICE: "1", PATTERN_NO_ENFORCEMENT_NOTICE: "1" };
delete env.PATTERN_NO_AUTOSTART;
const transport = new StdioClientTransport({ command: "node", args: [join(dist, "index.js")], env, stderr: "pipe" });
const client = new Client({ name: "fm", version: "0" }, { capabilities: {} });
await client.connect(transport);
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return { isError: !!r.isError, text: r.content[0].text };
};
const notFound = /No file found|ledger entry|must be a path within/;
{
  const repoRel = await call("verify_component", { project_id: "p", file_path: "components/Hero.tsx" });
  check("repo-relative path (stored as typed) reaches the key check", /ANTHROPIC_API_KEY|API key/i.test(repoRel.text) && !notFound.test(repoRel.text));
  const rootRel = await call("verify_component", { project_id: "p", file_path: "site/components/Hero.tsx" });
  check("root-relative spelling finds the same ledger entry", /ANTHROPIC_API_KEY|API key/i.test(rootRel.text) && !notFound.test(rootRel.text));
  const abs = await call("verify_component", { project_id: "p", file_path: join(srepo, "components", "Hero.tsx") });
  check("absolute path inside the root is accepted", /ANTHROPIC_API_KEY|API key/i.test(abs.text) && !notFound.test(abs.text));
}
writeFileSync(ledger, [entry("e2", "components/Hero.tsx", [])].join("\n") + "\n");
{
  const r = await call("verify_component", { project_id: "p", file_path: "components/Hero.tsx" });
  check("entry with no checklist no longer errors with 'nothing to verify against'", !/nothing to verify against/.test(r.text) && /ANTHROPIC_API_KEY|API key/i.test(r.text));
}
await client.close();

// ---- FM3 / FM5: annotateRecommendation ---------------------------------------
console.log("FM3/FM5: annotateRecommendation");
{
  const staleRoot = mkdtempSync(join(tmpdir(), "pattern-fm3-"));
  mkdirSync(join(staleRoot, "components"), { recursive: true });
  const dsPath = join(staleRoot, "design_systems.json");
  const cand = (name, file) => ({ name, props: [], description: null, usage_example: null, file_path: file });
  writeFileSync(dsPath, JSON.stringify({ stale: { project_id: "stale", source_kind: "directory_scan", source_path: "components", registered_at: "2026-10-01T00:00:00Z", candidate_count: 2, candidates: [cand("Hero", "Hero.tsx"), cand("Faq", "Faq.tsx")] }, fresh: { project_id: "fresh", source_kind: "directory_scan", source_path: "components", registered_at: "2026-10-01T00:00:00Z", candidate_count: 1, candidates: [cand("Here", "Here.tsx")] } }));
  writeFileSync(join(staleRoot, "components", "Here.tsx"), "export function Here() { return null }\n");
  process.env.PATTERN_PROJECT_ROOT = staleRoot;
  process.env.PATTERN_DESIGN_SYSTEMS_PATH = dsPath;
  const idx = await import(join(dist, "index.js"));
  const w = JSON.parse(idx.annotateRecommendation(JSON.stringify({ verdict: "use_existing", coverage: "8/8 (100%)", design_system_match: { file: "Hero.tsx" } }), "stale"));
  check("registration whose files are gone gets a stale warning", w.design_system_warning?.stale === true && w.design_system_warning.missing_candidate_files === 2);
  check("the matched file being gone is named", w.design_system_warning?.matched_file_missing === "Hero.tsx");
  const f = JSON.parse(idx.annotateRecommendation(JSON.stringify({ verdict: "use_existing", coverage: "8/8 (100%)", design_system_match: { file: "Here.tsx" } }), "fresh"));
  check("a registration whose files exist gets no warning", f.design_system_warning === undefined);
  const base = { verdict: "use_existing", confidence: "low", reason: "scored", coverage: "6/8 (75%)", requirements_checked: [{ requirement: "copy pill", met: false }, { requirement: "pause on click", met: false }, { requirement: "x", met: true }] };
  const out = JSON.parse(idx.annotateRecommendation(JSON.stringify(base), undefined));
  check("partial-coverage use_existing gets a caveat naming the unmet items", /unmet: copy pill; pause on click/.test(out.caveat ?? ""));
  check("the verdict itself is unchanged", out.verdict === "use_existing" && out.coverage === base.coverage);
  const dis = JSON.parse(idx.annotateRecommendation(JSON.stringify({ ...base, jev_screen: { verdict: "custom_build" } }), undefined));
  check("a Jev screen that disagrees is called out", /Jev screen scored this need custom_build/.test(dis.caveat ?? ""));
  const full = JSON.parse(idx.annotateRecommendation(JSON.stringify({ verdict: "use_existing", coverage: "8/8 (100%)", requirements_checked: [{ requirement: "x", met: true }] }), undefined));
  check("full coverage gets no caveat", full.caveat === undefined);
  check("custom_build gets no caveat", JSON.parse(idx.annotateRecommendation(JSON.stringify({ verdict: "custom_build", coverage: "1/8 (12.5%)" }), undefined)).caveat === undefined);
  check("non-JSON passes through untouched", idx.annotateRecommendation("Error: nope", undefined) === "Error: nope");
}

// ---- FM4: gate, added file with reasoned skips ----------------------------
console.log("FM4: gate verify on an added file");
{
  const g = mkdtempSync(join(tmpdir(), "pattern-fm4-"));
  git(g, "init", "-q", "-b", "main");
  git(g, "config", "user.email", "t@t");
  git(g, "config", "user.name", "t");
  writeFileSync(join(g, "README.md"), "x\n");
  git(g, "add", "-A");
  git(g, "commit", "-qm", "base");
  mkdirSync(join(g, "components"), { recursive: true });
  const body = (name) => `import { useState } from "react";\n\nexport function ${name}() {\n  const [on, setOn] = useState(false);\n  const toggle = () => setOn(!on);\n  return (\n    <button onClick={toggle}>{on ? "on" : "off"}</button>\n  );\n}\n`;
  writeFileSync(join(g, "components", "Skipped.tsx"), body("Alpha").replace("export function", '// pattern-mcp:skip reason="static wrapper, no decision"\nexport function'));
  writeFileSync(join(g, "components", "Open.tsx"), body("Beta"));
  writeFileSync(join(g, "components", "Override.tsx"), `// pattern-mcp:override reason="trivial primitive"\n${body("Gamma")}`);
  const run = (file) => {
    const r = spawnSync("node", [join(dist, "check-gate.js"), "verify", "--files", file, "--project-root", g], { cwd: g, encoding: "utf8" });
    const line = r.stdout.trim().split("\n").filter(Boolean).pop() ?? "{}";
    let body = {};
    try {
      body = JSON.parse(line);
    } catch {}
    return { code: r.status, body };
  };
  const s = run("components/Skipped.tsx");
  check("added file whose component has a reasoned skip passes", s.code === 0 && s.body.ok === true && s.body.skipped_components?.[0]?.component === "Alpha");
  const o = run("components/Override.tsx");
  check("added file with a file-level override passes", o.code === 0 && o.body.ok === true);
  const open = run("components/Open.tsx");
  check("added file with no receipt and no skip still fails", open.code !== 0 && open.body.ok === false && open.body.ungated_files?.includes("components/Open.tsx"));
  check("failure message names both ways out", /pattern-check-gate write/.test(open.body.reason ?? "") && /pattern-mcp:skip/.test(open.body.reason ?? ""));
}

// ---- FM6: Jev cost -----------------------------------------------------------
console.log("FM6: Jev cost is flagged unknown");
{
  const src = readFileSync(join(dirname(dist), "src", "index.ts"), "utf8");
  check("Jev meta sets cost_known: false when no rate is configured", /cost_known: false, cost_note: "Jev scorer: cost unknown/.test(src));
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
