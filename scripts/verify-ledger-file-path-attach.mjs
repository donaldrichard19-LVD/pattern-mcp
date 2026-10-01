#!/usr/bin/env node
/**
 * verify-ledger-file-path-attach.mjs
 *
 * Standalone check for record_component_decision's file_path: attaching an
 * implementing file to an existing ledger entry WITHOUT re-scoring, via an
 * append-only overlay (ledger_file_paths.jsonl), so the enforcement gate
 * (which reads readLedgerEntries) can match it. Covers the attach function,
 * the real pattern-check-gate CLI end to end, and the MCP handler's input
 * validation (spawned as a real stdio server). All state lives in temp
 * files, never ~/.pattern.
 *
 * Run: node scripts/verify-ledger-file-path-attach.mjs (after `npm run build`)
 * Exits non-zero on any failed assertion.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const tmp = mkdtempSync(join(tmpdir(), "pattern-attach-"));
const root = join(tmp, "repo");
mkdirSync(join(root, "components"), { recursive: true });
const paths = {
  PATTERN_LEDGER_PATH: join(tmp, "ledger.jsonl"),
  PATTERN_LEDGER_FILE_PATHS_PATH: join(tmp, "ledger_file_paths.jsonl"),
  PATTERN_LEDGER_LIVENESS_PATH: join(tmp, "ledger_liveness.jsonl"),
  PATTERN_SNAPSHOT_BACKFILL_PATH: join(tmp, "snapshot_backfill.jsonl"),
  PATTERN_MEMORY_PATH: join(tmp, "memory.json"),
  PATTERN_LOG_PATH: join(tmp, "calls.log"),
  PATTERN_PROJECT_ROOT: root,
  PATTERN_TELEMETRY: "0",
  PATTERN_NO_ENFORCEMENT_NOTICE: "1",
  PATTERN_NO_CONNECT_NOTICE: "1",
  PATTERN_INSTALL_ID_PATH: join(tmp, "install_id"),
  PATTERN_TELEMETRY_NOTICE_PATH: join(tmp, "tn"),
  PATTERN_ENFORCEMENT_NOTICE_PATH: join(tmp, "en"),
  PATTERN_CONNECT_NOTICE_PATH: join(tmp, "cn"),
};
Object.assign(process.env, paths, { PATTERN_NO_AUTOSTART: "1" });

const { attachFilePathToLedger, readLedgerEntries, normalizeRelPath } = await import(join(dist, "index.js"));

let failures = 0;
function check(label, condition) {
  if (condition) console.log(`  ok: ${label}`);
  else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

function entry(id, feature_id, need, timestamp, file_path = null) {
  return {
    id, timestamp, project_id: "proj", feature_id, component_need: need, domain: "d", framework: "f",
    checklist: [], checklist_source: "extracted", candidates_evaluated: [], verdict: "custom_build",
    chosen_candidate: null, confidence: "low", reason: "scored", coverage: null, cost_usd: 0, cache_hit: false,
    project_conventions_snapshot: null, file_path, snapshot_ref: null, last_verified_live: null, live_status: "unknown",
    reconstructed_snapshot_ref: null,
  };
}
const ledger = [
  entry("e1", "feat-a", "Confirm dialog", "2026-09-01T00:00:00.000Z"),
  entry("e2", "feat-a", "confirm DIALOG ", "2026-09-02T00:00:00.000Z"), // later, same need (case/space-insensitive)
  entry("e3", "feat-b", "Other thing", "2026-09-03T00:00:00.000Z"),
  entry("e4", "feat-c", "Confirm dialog", "2026-09-04T00:00:00.000Z"), // same need, different feature
];
writeFileSync(paths.PATTERN_LEDGER_PATH, ledger.map((e) => JSON.stringify(e)).join("\n") + "\n");
const ledgerBefore = readFileSync(paths.PATTERN_LEDGER_PATH, "utf8");

const COMPONENT = `import { useState } from "react";
export function Thing({ label }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return <div style={{ padding: 16 }}><span>{label}</span><button onClick={() => setOpen(false)}>x</button></div>;
}
`;
function gate(file) {
  const r = spawnSync("node", [join(dist, "check-gate.js"), "write", "--file", file, "--is-new", "--project-id", "proj", "--project-root", root], {
    input: COMPONENT, encoding: "utf8", env: { ...process.env },
  });
  let out = null;
  try { out = JSON.parse(r.stdout.trim()); } catch { /* leave null */ }
  return { out, status: r.status };
}

console.log("normalizeRelPath");
check("strips ./ and backslashes", normalizeRelPath(".\\components\\A.tsx") === "components/A.tsx" || normalizeRelPath("./components/A.tsx") === "components/A.tsx");

console.log("before attach: gate denies");
const g0 = gate("components/ConfirmDialog.tsx");
check("gate denies a new component with no file_path on any entry", g0.out && g0.out.ok === false);
check("deny message points at record_component_decision file_path", /record_component_decision/.test(g0.out?.reason ?? "") && /re-scoring/.test(g0.out?.reason ?? ""));

console.log("attach by component_need");
const a1 = attachFilePathToLedger({ project_id: "proj", component_need: "Confirm dialog", file_path: "./components/ConfirmDialog.tsx" });
check("attached", a1.attached === true);
check("latest matching entry wins (case/space-insensitive need) -> e4 (newest)", a1.ledger_entry_id === "e4");
check("path normalised", a1.file_path === "components/ConfirmDialog.tsx");
const read1 = readLedgerEntries("proj");
check("readLedgerEntries overlays file_path on e4", read1.find((e) => e.id === "e4").file_path === "components/ConfirmDialog.tsx");
check("other entries untouched", read1.filter((e) => e.id !== "e4").every((e) => e.file_path === null));
check("ledger.jsonl itself is never mutated", readFileSync(paths.PATTERN_LEDGER_PATH, "utf8") === ledgerBefore);

console.log("gate now passes, no re-scoring");
const g1 = gate("components/ConfirmDialog.tsx");
check("gate allows after attach", g1.out && g1.out.ok === true && g1.out.gated === true);
check("receipt names the attached feature_id", g1.out?.feature_id === "feat-c");
check("receipt file written in the consuming repo", existsSync(join(root, ".pattern", "receipts", "feat-c.json")));

console.log("attach by feature_id (disambiguation) and latest-attach-wins");
const a2 = attachFilePathToLedger({ project_id: "proj", component_need: "Confirm dialog", feature_id: "feat-a", file_path: "components/Other.tsx" });
check("feature_id targets feat-a's latest entry (e2)", a2.attached === true && a2.ledger_entry_id === "e2");
const a3 = attachFilePathToLedger({ project_id: "proj", component_need: "Confirm dialog", feature_id: "feat-a", file_path: "components/Renamed.tsx" });
check("re-attach to the same entry: latest wins", readLedgerEntries("proj").find((e) => e.id === "e2").file_path === "components/Renamed.tsx" && a3.attached === true);

console.log("no matching ledger entry");
const a4 = attachFilePathToLedger({ project_id: "proj", component_need: "Never judged", file_path: "components/X.tsx" });
check("returns attached:false with a clear warning, no throw", a4.attached === false && /call recommend_component/i.test(a4.warning) && /decision itself was recorded/.test(a4.warning));
check("unknown feature_id also warns", attachFilePathToLedger({ project_id: "proj", component_need: "Confirm dialog", feature_id: "nope", file_path: "c.tsx" }).attached === false);
check("other project is isolated", attachFilePathToLedger({ project_id: "other", component_need: "Confirm dialog", file_path: "c.tsx" }).attached === false);

console.log("MCP handler validation (real stdio server)");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
const client = new Client({ name: "verify-attach", version: "0.0.0" }, { capabilities: {} });
await client.connect(new StdioClientTransport({ command: "node", args: [join(dist, "index.js")], env: { ...process.env, PATTERN_NO_AUTOSTART: "", PATTERN_TOOLS: "full" } }));
const call = async (args) => {
  const r = await client.callTool({ name: "record_component_decision", arguments: { project_id: "proj", component_need: "Other thing", action: "custom_built", source: "custom", ...args } });
  return { isError: !!r.isError, text: r.content[0].text };
};
const memoryCount = () => { try { return (JSON.parse(readFileSync(paths.PATTERN_MEMORY_PATH, "utf8")).proj ?? []).length; } catch { return 0; } };
const m0 = memoryCount();
for (const bad of ["/etc/passwd", "../outside.tsx", "   "]) {
  const r = await call({ file_path: bad });
  check(`rejects file_path ${JSON.stringify(bad)} with an error`, r.isError && /relative to the project root/.test(r.text));
}
check("rejected calls recorded nothing", memoryCount() === m0);
const ok = await call({ file_path: "components/Other2.tsx" });
const okBody = JSON.parse(ok.text);
check("valid file_path records the decision AND attaches (e3)", !ok.isError && okBody.status === "recorded" && okBody.ledger?.attached === true && okBody.ledger.ledger_entry_id === "e3");
const none = JSON.parse((await call({ component_need: "Never judged", file_path: "components/N.tsx" })).text);
check("unmatched need: decision recorded, warning returned", none.status === "recorded" && none.ledger?.attached === false);
const plain = JSON.parse((await call({})).text);
check("no file_path: response unchanged (no ledger field)", plain.status === "recorded" && !("ledger" in plain));
await client.close();

rmSync(tmp, { recursive: true, force: true });
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
