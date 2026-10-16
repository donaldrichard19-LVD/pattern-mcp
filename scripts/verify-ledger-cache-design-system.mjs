#!/usr/bin/env node
/**
 * verify-ledger-cache-design-system.mjs -- a cached "fits" verdict must not
 * outlive a change to the registered component it was scored against.
 *
 * The ledger cache-hit (findLedgerCacheHit in src/index.ts) used to match only
 * on the request (need/domain/framework/conventions) + high confidence + TTL,
 * so changing a registered component's props or docs could still be answered
 * from a stale entry for up to 30 days. Entries now carry
 * design_system_fingerprint (a CONTENT hash of the registered candidates), and
 * a hit requires it to equal the current one.
 *
 * Offline, no API key: the "not served from the ledger" cases fall through to
 * the scoring path, which fails fast with the missing-key error here.
 *
 * Run: node scripts/verify-ledger-cache-design-system.mjs (after `npm run build`)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.PATTERN_TELEMETRY ??= "0";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = mkdtempSync(join(tmpdir(), "pattern-verify-cache-ds-"));
const env = {
  HOME: root,
  PATTERN_PROJECT_ROOT: root,
  PATTERN_DESIGN_SYSTEMS_PATH: join(root, "design-systems.json"),
  PATTERN_LEDGER_PATH: join(root, "ledger.jsonl"),
  PATTERN_MEMORY_PATH: join(root, "memory.json"),
  PATTERN_NO_SUMMARIES: "1",
  ANTHROPIC_API_KEY: "",
  TYPESAFE_API_KEY: "",
};
Object.assign(process.env, env, { PATTERN_NO_AUTOSTART: "1" });
const { designSystemFingerprint } = await import(join(repo, "dist/index.js"));

const PROJECT = "cache-ds-project";
const ARGS = { component_need: "success or failure toast notification", domain: "test domain", framework: "React + Tailwind", project_id: PROJECT };
let failures = 0;
const check = (label, ok) => { if (ok) console.log(`  ok: ${label}`); else { console.error(`  FAIL: ${label}`); failures++; } };

const writeManifest = (props) =>
  writeFileSync(join(root, "manifest.json"), JSON.stringify([{ name: "Toast", props, description: "Transient notification." }]));
const seed = (fingerprint) =>
  writeFileSync(env.PATTERN_LEDGER_PATH, JSON.stringify({
    id: "seed-0000-0000-0000-000000000000", timestamp: new Date().toISOString(), project_id: PROJECT, feature_id: "f",
    component_need: ARGS.component_need, domain: ARGS.domain, framework: ARGS.framework, checklist: ["a"], checklist_source: "extracted",
    candidates_evaluated: [{ source: "design_system", name: "Toast", url: "", coverage_pct: 100 }],
    verdict: "use_existing", chosen_candidate: "Toast", confidence: "high", reason: "scored", coverage: "8/8 (100%)",
    cost_usd: 0.1, cache_hit: false, project_conventions_snapshot: null,
    ...(fingerprint === undefined ? {} : { design_system_fingerprint: fingerprint }),
  }) + "\n");

const transport = new StdioClientTransport({ command: process.execPath, args: [join(repo, "dist/index.js")], env: { ...process.env, PATTERN_NO_AUTOSTART: "" }, stderr: "ignore" });
const client = new Client({ name: "verify-ledger-cache-design-system", version: "0" }, { capabilities: {} });
await client.connect(transport);
const register = (props) => { writeManifest(props); return client.callTool({ name: "register_design_system", arguments: { project_id: PROJECT, manifest_path: "manifest.json", replace: true } }); };
const recommend = async () => {
  const r = await client.callTool({ name: "recommend_component", arguments: ARGS });
  const text = r.content?.[0]?.text ?? "";
  let body = null; try { body = JSON.parse(text); } catch {}
  return { served: body?.served_from_ledger === true, isError: !!r.isError, text };
};
const pause = () => new Promise((r) => setTimeout(r, 25));

console.log("1. an entry scored against the current design system is served from the ledger");
check("registration succeeded", !(await register(["variant", "duration"])).isError);
const fpA = designSystemFingerprint(PROJECT);
check("a fingerprint exists for a registered design system", typeof fpA === "string" && fpA.length === 16);
seed(fpA);
check("served_from_ledger", (await recommend()).served);

console.log("2. changing a registered component's props invalidates it");
await pause();
await register(["variant", "duration", "action"]);
const fpB = designSystemFingerprint(PROJECT);
check("the fingerprint changed", fpB !== fpA);
const afterChange = await recommend();
check("NOT served from the ledger", !afterChange.served);
check("fell through to scoring (no key here, so it errors)", afterChange.isError && /ANTHROPIC_API_KEY is not set/.test(afterChange.text));

console.log("3. it is a content hash: re-registering identical content (new registered_at) keeps entries valid");
seed(fpB);
await pause();
await register(["variant", "duration", "action"]);
check("same content, same fingerprint", designSystemFingerprint(PROJECT) === fpB);
check("still served from the ledger", (await recommend()).served);
await pause();
await register(["variant", "duration"]);
check("restoring the original content restores the original fingerprint", designSystemFingerprint(PROJECT) === fpA);

console.log("4. an entry written before fingerprints existed is not served while a design system is registered");
seed(undefined);
const legacy = await recommend();
check("NOT served from the ledger", !legacy.served);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
await client.close();
process.exit(failures === 0 ? 0 : 1);
