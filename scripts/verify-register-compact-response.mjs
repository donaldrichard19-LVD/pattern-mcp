#!/usr/bin/env node
/**
 * verify-register-compact-response.mjs
 *
 * Standalone check that register_design_system keeps big registrations out of
 * the caller's context: up to REGISTER_FULL_LIST_MAX candidates the full list
 * is returned as before; larger ones get a compact summary (count, preview,
 * per-page counts, warnings, hint); include_candidates overrides either way;
 * the STORED registration is always complete; and the response echoes the
 * resolved project root and design-systems path. Real stdio server, temp
 * files only, no network.
 *
 * Run: node scripts/verify-register-compact-response.mjs (after `npm run build`)
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

process.env.PATTERN_NO_AUTOSTART = "1";
const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const { registrationResponseView, REGISTER_FULL_LIST_MAX } = await import(join(dist, "index.js"));
let failures = 0;
const check = (label, cond) => (cond ? console.log(`  ok: ${label}`) : (console.error(`  FAIL: ${label}`), failures++));

console.log("registrationResponseView (pure)");
const cand = (i, page) => ({ name: `Comp${i}`, props: ["a", "b"], description: "d".repeat(60), usage_example: null, file_path: null, ...(page ? { figma: { node_id: `1:${i}`, page, section: null, variants: { State: ["A", "B"] }, properties: [], size: { w: 1, h: 1 } } } : {}) });
const mk = (n, kind = "figma", pageOf = (i) => (i % 2 ? "Button " : "Alert")) => ({ project_id: "p", source_kind: kind, source_path: "x.json", registered_at: "2026-01-01T00:00:00.000Z", candidate_count: n, candidates: Array.from({ length: n }, (_, i) => cand(i, kind === "figma" ? pageOf(i) : null)) });
const big = mk(95);
const slim = registrationResponseView(big, undefined);
check("default for 95 candidates: candidates list omitted", !("candidates" in slim) && slim.candidates_omitted === 95);
check("keeps count/source metadata", slim.candidate_count === 95 && slim.source_kind === "figma" && slim.source_path === "x.json");
check("preview has 10 names with their page", slim.candidates_preview.length === 10 && /Comp0 \(Alert\)/.test(slim.candidates_preview[0]));
check("per-page counts (trimmed page names)", slim.candidates_by_page.Alert === 48 && slim.candidates_by_page.Button === 47);
check("hint names include_candidates", /include_candidates: true/.test(slim.hint));
const fullSize = JSON.stringify(big).length, slimSize = JSON.stringify(slim).length;
check(`much smaller on the wire (${fullSize} -> ${slimSize} chars)`, slimSize < fullSize / 8);
check("include_candidates: true forces the full list", registrationResponseView(big, true).candidates.length === 95);
const small = mk(REGISTER_FULL_LIST_MAX);
check(`default at exactly ${REGISTER_FULL_LIST_MAX} candidates: full list`, registrationResponseView(small, undefined).candidates.length === REGISTER_FULL_LIST_MAX);
check(`default at ${REGISTER_FULL_LIST_MAX + 1}: summary`, !("candidates" in registrationResponseView(mk(REGISTER_FULL_LIST_MAX + 1), undefined)));
check("include_candidates: false forces the summary on a small one", !("candidates" in registrationResponseView(mk(3), false)));
check("tiny figma registration warns", registrationResponseView(mk(3), undefined).warnings?.[0]?.includes("Only 3 candidate"));
check("tiny manifest registration does not warn", !("warnings" in registrationResponseView(mk(3, "manifest"), undefined)));
check("zero candidates warns", /0 candidates/.test(registrationResponseView(mk(0, "manifest"), undefined).warnings?.[0] ?? ""));
check("no figma pages -> no candidates_by_page", !("candidates_by_page" in registrationResponseView(mk(30, "directory_scan"), undefined)));

console.log("register_design_system (real stdio server)");
const tmp = mkdtempSync(join(tmpdir(), "pattern-reg-compact-"));
const manifest = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ name: `Widget${i}`, props: ["size"], description: `widget ${i}`, usage_example: "<Widget />" })));
writeFileSync(join(tmp, "m30.json"), manifest(30));
writeFileSync(join(tmp, "m5.json"), manifest(5));
const dsPath = join(tmp, "ds.json");
const env = { ...process.env, PATTERN_NO_AUTOSTART: "", PATTERN_TELEMETRY: "0", PATTERN_NO_ENFORCEMENT_NOTICE: "1", PATTERN_NO_CONNECT_NOTICE: "1", PATTERN_TOOLS: "full",
  PATTERN_DESIGN_SYSTEMS_PATH: dsPath, PATTERN_LOG_PATH: join(tmp, "calls.log"), PATTERN_MEMORY_PATH: join(tmp, "m.json"), PATTERN_INSTALL_ID_PATH: join(tmp, "id"),
  PATTERN_TELEMETRY_NOTICE_PATH: join(tmp, "tn"), PATTERN_ENFORCEMENT_NOTICE_PATH: join(tmp, "en"), PATTERN_CONNECT_NOTICE_PATH: join(tmp, "cn"), PATTERN_PROJECT_ROOT: tmp };
const client = new Client({ name: "verify-reg-compact", version: "0.0.0" }, { capabilities: {} });
await client.connect(new StdioClientTransport({ command: "node", args: [join(dist, "index.js")], env }));
const reg = async (args) => { const r = await client.callTool({ name: "register_design_system", arguments: { project_id: "p", replace: true, ...args } }); return { err: !!r.isError, body: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) }; };
const a = await reg({ manifest_path: "m30.json" });
check("30-candidate manifest: summary by default", !a.err && !("candidates" in a.body.registration) && a.body.registration.candidates_omitted === 30 && a.body.registration.candidate_count === 30);
check("echoes the resolved root and design-systems path", a.body.resolved?.project_root === tmp && a.body.resolved?.design_systems_path === dsPath);
check("stored registration is complete regardless", JSON.parse(readFileSync(dsPath, "utf8")).p.candidates.length === 30);
const b = await reg({ manifest_path: "m30.json", include_candidates: true });
check("include_candidates: true returns all 30", b.body.registration.candidates.length === 30);
const c = await reg({ manifest_path: "m5.json" });
check("5-candidate manifest: full list by default (unchanged behaviour)", c.body.registration.candidates.length === 5 && c.body.resolved?.project_root === tmp);
check("status field unchanged", c.body.status === "registered");
await client.close();
rmSync(tmp, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
