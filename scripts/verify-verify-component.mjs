#!/usr/bin/env node
/**
 * verify-verify-component.mjs -- Phase 5, offline (no API call, no key).
 * Covers: quote reconciliation, receipt schema v1/v2, attaching a
 * verification to a receipt, verify_component's pre-API error paths, and the
 * CI verify-mode report. The model call itself is not exercised here.
 *
 * Run: node scripts/verify-verify-component.mjs (after `npm run build`)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
let failures = 0;
const check = (label, ok) => { if (ok) console.log(`  ok: ${label}`); else { console.error(`  FAIL: ${label}`); failures++; } };

process.env.PATTERN_NO_AUTOSTART = "1"; process.env.PATTERN_TELEMETRY = "0";
const idx = await import(join(dist, "index.js"));
const rc = await import(join(dist, "gate-receipt.js"));

console.log("reconcileVerification: a pass needs a quote that is really in the file");
const file = `export function Dialog() {\n  return <div style={{ width: 320,   height: 224 }} role="alertdialog" />;\n}`;
const list = ["fixed 320x224", "has alertdialog role", "traps focus", "has footer", "uses tokens", "missing index"];
const out = idx.reconcileVerification(list, [
  { index: 1, status: "pass", evidence: "width: 320, height: 224" },          // whitespace-normalized quote, real
  { index: 2, status: "pass", evidence: 'role="alertdialog"' },              // real
  { index: 3, status: "pass", evidence: "useFocusTrap()" },                   // invented quote -> unverified
  { index: 4, status: "fail", evidence: "" },                                 // absent -> fail kept
  { index: 5, status: "fail", evidence: "tokens.color.danger" },              // cited code not there -> unverified
  { index: 99, status: "pass", evidence: "x" },                               // out-of-range index ignored
], file);
check("real quote passes (whitespace-insensitive)", out[0].status === "pass" && out[0].evidence.includes("width: 320"));
check("real quote passes (2)", out[1].status === "pass");
check("invented quote -> unverified, evidence dropped", out[2].status === "unverified" && out[2].evidence === "");
check("fail by absence kept", out[3].status === "fail");
check("fail citing code that is not in the file -> unverified", out[4].status === "unverified");
check("item the model skipped -> unverified", out[5].status === "unverified");
check("one result per checklist item, in order", out.length === 6 && out.every((o, i) => o.item === list[i]));
check("garbage input -> all unverified", idx.reconcileVerification(["a", "b"], "nope", file).every((o) => o.status === "unverified"));
check("pass with no evidence -> unverified", idx.reconcileVerification(["a"], [{ index: 1, status: "pass" }], file)[0].status === "unverified");

console.log("receipt schema v1 / v2");
const base = { feature_id: "f", file_path: "src/D.tsx", ledger_entry_id: null, verdict: "custom_build", chosen_candidate: null, snapshot_ref: null, checked_at: "t", manual_override: false, override_reason: null };
const ver = { verified_at: "t", file_sha256: "abc", summary: { pass: 1, fail: 0, unverified: 0, total: 1 }, items: [{ item: "x", status: "pass", evidence: "y" }], divergences: [] };
const ok = (r) => { try { rc.assertGateReceiptShape(r); return true; } catch { return false; } };
check("v1 receipt still valid", ok({ schema_version: 1, ...base }));
check("v2 receipt without verification valid", ok({ schema_version: 2, ...base }));
check("v2 receipt with verification valid", ok({ schema_version: 2, ...base, verification: ver }));
check("verification on a v1 receipt rejected", !ok({ schema_version: 1, ...base, verification: ver }));
check("malformed verification rejected", !ok({ schema_version: 2, ...base, verification: { items: "no" } }));
check("unknown key still rejected", !ok({ schema_version: 2, ...base, extra: 1 }));
check("schema 3 rejected", !ok({ schema_version: 3, ...base }));

console.log("attachVerificationToReceipt");
const root = mkdtempSync(join(tmpdir(), "pattern-verify-"));
mkdirSync(join(root, "src"), { recursive: true });
const content = "export const D = () => null;\n";
writeFileSync(join(root, "src", "D.tsx"), content);
check("no receipt -> updated:false, nothing created", rc.attachVerificationToReceipt(root, "src/D.tsx", ver).updated === false && rc.readAllGateReceipts(root).length === 0);
rc.writeGateReceipt(root, { schema_version: 1, ...base });
const res = rc.attachVerificationToReceipt(root, "./src/D.tsx", ver);
const after = JSON.parse(readFileSync(join(root, ".pattern", "receipts", "f.json"), "utf8"));
check("attached by file_path (./ prefix tolerated)", res.updated && res.feature_id === "f");
check("receipt upgraded to v2 with verification", after.schema_version === 2 && after.verification?.summary.pass === 1);

console.log("verify_component pre-API errors");
const ledger = join(root, "ledger.jsonl");
writeFileSync(ledger, JSON.stringify({ id: "e1", timestamp: "2026-10-01T00:00:00Z", project_id: "p", feature_id: "f", component_need: "n", domain: "d", framework: "r", checklist: ["a", "b"], checklist_source: "provided", candidates_evaluated: [], verdict: "custom_build", chosen_candidate: null, confidence: "low", reason: "scored", coverage: "1/2", cost_usd: 0, cache_hit: false, project_conventions_snapshot: null, snapshot_ref: null, last_verified_live: null, live_status: "unknown", file_path: "src/D.tsx" }) + "\n");
const env = { ...process.env, ANTHROPIC_API_KEY: "", PATTERN_PROJECT_ROOT: root, PATTERN_LEDGER_PATH: ledger, PATTERN_LEDGER_FILE_PATHS_PATH: join(root, "fp.jsonl"), PATTERN_LEDGER_VERIFICATIONS_PATH: join(root, "v.jsonl"), PATTERN_NO_ENFORCEMENT_HOOK: "1", PATTERN_NO_CONNECT_NOTICE: "1", PATTERN_NO_ENFORCEMENT_NOTICE: "1", PATTERN_NO_AUTOSTART: "" };
delete env.PATTERN_NO_AUTOSTART;
const transport = new StdioClientTransport({ command: "node", args: [join(dist, "index.js")], env, stderr: "pipe" });
const client = new Client({ name: "vv", version: "0" }, { capabilities: {} });
await client.connect(transport);
const call = async (args) => { const r = await client.callTool({ name: "verify_component", arguments: args }); return { isError: !!r.isError, text: r.content[0].text }; };
check("listed in the DEFAULT (core) tier", (await client.listTools()).tools.some((t) => t.name === "verify_component"));
check("missing file -> clear error", /No file found/.test((await call({ project_id: "p", file_path: "src/Nope.tsx" })).text));
check("path escape refused", /within the project root/.test((await call({ project_id: "p", file_path: "../x.tsx" })).text));
writeFileSync(join(root, "src", "Other.tsx"), "x");
check("file with no ledger entry -> tells you to pass file_path to recommend_component", /No ledger entry.*recommend_component/.test((await call({ project_id: "p", file_path: "src/Other.tsx" })).text));
check("entry found, no API key -> key error (not a crash)", /ANTHROPIC_API_KEY/.test((await call({ project_id: "p", file_path: "src/D.tsx" })).text));
await client.close();

console.log("CI verify mode reports verification state (non-blocking)");
const gatedBody = (tag) => "export default function Gated() {\n" + Array.from({ length: 40 }, (_, i) => `  const v${i} = ${i};`).join("\n") + `\n  return <${tag}/>;\n}\n`;
writeFileSync(join(root, "src", "Gated.tsx"), gatedBody("div"));
const gatedSha = createHash("sha256").update(readFileSync(join(root, "src", "Gated.tsx"))).digest("hex");
const mkRcpt = (id, v) => rc.writeGateReceipt(root, { schema_version: v ? 2 : 1, ...base, feature_id: id, file_path: "src/Gated.tsx", ...(v ? { verification: v } : {}) });
const runCi = () => { try { return JSON.parse(execFileSync("node", [join(dist, "check-gate.js"), "verify", "--files", "src/Gated.tsx", "--project-root", root], { encoding: "utf8" }).trim().split("\n").pop()); } catch (e) { return { err: String(e.stdout ?? e) }; } };
mkRcpt("g", null);
check("v1 receipt: passes, counted as unverified", runCi().verification?.unverified_receipts === 1);
mkRcpt("g", { ...ver, file_sha256: gatedSha, summary: { pass: 0, fail: 2, unverified: 0, total: 2 } });
const fresh = runCi();
check("v2 receipt matching file hash: verified, failed items reported, still ok", fresh.ok === true && fresh.verification.verified === 1 && fresh.verification.failed_items === 2);
writeFileSync(join(root, "src", "Gated.tsx"), gatedBody("span"));
check("file edited after verification: stale", runCi().verification?.stale === 1);

console.log(failures ? `${failures} failed` : "All checks passed.");
process.exit(failures ? 1 : 0);
