#!/usr/bin/env node
/**
 * verify-figma-error-messages.mjs
 *
 * Standalone check that the common Figma setup failures produce actionable
 * messages: a saved API error body ({"status":403,"err":"Invalid token"}) is
 * called out as a failed download instead of "doesn't look like a Figma file",
 * and a missing FIGMA_ACCESS_TOKEN says where it must be set (the server's own
 * env, not the shell or a .env) and not to paste it into a chat. No network.
 *
 * Run: node scripts/verify-figma-error-messages.mjs (after `npm run build`)
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const { parseFigmaFile } = await import(join(dist, "design-system-figma.js"));
let failures = 0;
const check = (label, cond) => (cond ? console.log(`  ok: ${label}`) : (console.error(`  FAIL: ${label}`), failures++));
const msg = (fn) => { try { fn(); return null; } catch (e) { return String(e.message); } };

console.log("parseFigmaFile");
const e403 = msg(() => parseFigmaFile({ status: 403, err: "Invalid token" }, "figma-shadcn.json"));
check("error body is called out as a failed download with its status and message", /API error response \(status 403: Invalid token\)/.test(e403 ?? "") && /download failed/.test(e403));
check("403 mentions the token / file_content:read cause", /invalid token|file_content:read/i.test(e403 ?? ""));
check("it names the file", /figma-shadcn\.json/.test(e403 ?? ""));
const e404 = msg(() => parseFigmaFile({ status: 404, err: "Not found" }, "x.json"));
check("non-403 error body is also recognised", /status 404: Not found/.test(e404 ?? ""));
const generic = msg(() => parseFigmaFile({ hello: "world" }, "x.json"));
check("an unrelated object keeps the generic message", /doesn't look like a Figma file response/.test(generic ?? "") && !/API error response/.test(generic));
check("null keeps the generic message", /doesn't look like a Figma file response/.test(msg(() => parseFigmaFile(null, "x.json")) ?? ""));
const minimal = { document: { id: "0:0", type: "DOCUMENT", children: [] }, components: {}, componentSets: {} };
check("a real (empty) file still parses", msg(() => parseFigmaFile(minimal, "x.json")) === null);
check("a file that also carries status/err keys is not mistaken for an error", msg(() => parseFigmaFile({ ...minimal, status: 200, err: "x" }, "x.json")) === null);

console.log("register_design_system without FIGMA_ACCESS_TOKEN (real stdio server)");
const tmp = mkdtempSync(join(tmpdir(), "pattern-figma-msg-"));
const env = { ...process.env, PATTERN_TELEMETRY: "0", PATTERN_NO_ENFORCEMENT_NOTICE: "1", PATTERN_NO_CONNECT_NOTICE: "1", PATTERN_TOOLS: "full",
  PATTERN_DESIGN_SYSTEMS_PATH: join(tmp, "ds.json"), PATTERN_LOG_PATH: join(tmp, "calls.log"), PATTERN_MEMORY_PATH: join(tmp, "m.json"),
  PATTERN_INSTALL_ID_PATH: join(tmp, "id"), PATTERN_TELEMETRY_NOTICE_PATH: join(tmp, "tn"), PATTERN_ENFORCEMENT_NOTICE_PATH: join(tmp, "en"),
  PATTERN_CONNECT_NOTICE_PATH: join(tmp, "cn"), PATTERN_PROJECT_ROOT: tmp };
delete env.FIGMA_ACCESS_TOKEN;
const client = new Client({ name: "verify-figma-msg", version: "0.0.0" }, { capabilities: {} });
await client.connect(new StdioClientTransport({ command: "node", args: [join(dist, "index.js")], env }));
const r = await client.callTool({ name: "register_design_system", arguments: { project_id: "p", figma_file_key: "abc" } });
const text = r.content[0].text;
check("is an error", !!r.isError);
check("says the token goes in the server's own env block and needs a restart", /own environment/.test(text) && /\benv\b/.test(text) && /restart/.test(text));
check("says a shell export or .env does not reach it", /shell/.test(text) && /\.env/.test(text));
check("says never paste the token into a chat", /never paste/i.test(text));
check("still offers the figma_json_path alternative", /figma_json_path/.test(text));
await client.close();
rmSync(tmp, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
