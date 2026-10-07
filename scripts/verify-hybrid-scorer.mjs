#!/usr/bin/env node
/**
 * verify-hybrid-scorer.mjs
 *
 * Free, offline check of the DEFAULT scorer mode: PATTERN_SCORER unset with
 * TYPESAFE_API_KEY set ("hybrid": Jev picks a match; Anthropic runs only to
 * write the custom-build gap list). A STUB Jev server stands in for Jev, and
 * ANTHROPIC_API_KEY is empty, so any accidental Anthropic call is an error.
 * The Anthropic gap-list pass itself needs a live key and is not exercised.
 *
 * Run: node scripts/verify-hybrid-scorer.mjs (after `npm run build`)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist/index.js");
let failures = 0;
const check = (label, ok) => { if (ok) console.log(`  ok: ${label}`); else { console.error(`  FAIL: ${label}`); failures++; } };

let jevCalls = 0;
const stub = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    jevCalls++;
    const body = JSON.parse(raw);
    const keyword = body.state.component_need.split(" ")[0].toLowerCase();
    const answers = {};
    for (const c of body.state.candidates) answers[c.id] = { type: "noul", noul: c.evidence.toLowerCase().includes(keyword) ? 0.9 : 0.05 };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ model: "stub", answers, usage: { input_tokens: 100, output_tokens: 10 } }));
  });
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const stubUrl = `http://127.0.0.1:${stub.address().port}/v1/systemone`;

const root = mkdtempSync(join(tmpdir(), "pattern-verify-hybrid-"));
mkdirSync(join(root, "components"), { recursive: true });
writeFileSync(join(root, "components", "Tabs.tsx"), "/** Tabbed panel switcher. */\nexport const Tabs = () => null;\n");
writeFileSync(join(root, "components", "Dialog.tsx"), "/** Modal window with title and footer. */\nexport function Dialog() { return null; }\n");

async function connect(extra = {}) {
  const env = { ...process.env, ANTHROPIC_API_KEY: "", TYPESAFE_API_KEY: "test-key", TYPESAFE_API_URL: stubUrl,
    PATTERN_PROJECT_ROOT: root, PATTERN_DESIGN_SYSTEMS_PATH: join(root, "ds.json"), PATTERN_LEDGER_PATH: join(root, "ledger.jsonl"),
    PATTERN_LOG_PATH: join(root, "calls.log"), PATTERN_MEMORY_PATH: join(root, "memory.json"), PATTERN_TOOLS: "full",
    PATTERN_TELEMETRY: "0", PATTERN_NO_ENFORCEMENT_HOOK: "1", PATTERN_NO_CONNECT_NOTICE: "1", PATTERN_NO_ENFORCEMENT_NOTICE: "1", ...extra };
  delete env.PATTERN_SCORER; // the point: unset == hybrid
  if (extra.PATTERN_SCORER) env.PATTERN_SCORER = extra.PATTERN_SCORER;
  const c = new Client({ name: "verify-hybrid", version: "0" }, { capabilities: {} });
  await c.connect(new StdioClientTransport({ command: "node", args: [serverEntry], env, stderr: "pipe" }));
  return c;
}
const parse = (r) => { const text = r.content?.[0]?.text ?? ""; try { return { isError: !!r.isError, body: JSON.parse(text), text }; } catch { return { isError: !!r.isError, body: null, text }; } };
const rec = (c, need, project_id, extra = {}) => c.callTool({ name: "recommend_component", arguments: { component_need: need, domain: "test", framework: "React", project_id, ...extra } });

const client = await connect();
await client.callTool({ name: "register_design_system", arguments: { project_id: "p", directory_path: "components", summarize: false } });

console.log("PATTERN_SCORER unset + TYPESAFE_API_KEY => Jev scores (hybrid default)");
{
  jevCalls = 0;
  const { isError, body } = parse(await rec(client, "tabs for switching sections", "p"));
  check("match found with no Anthropic key", !isError && body?.verdict === "use_existing" && body?.scorer === "jev");
  check("design_system_match names Tabs", body?.design_system_match?.components?.includes("Tabs"));
  check("exactly one Jev call, no ensemble", jevCalls === 1 && body?.ensemble?.triggered === false);
}

console.log("Jev finds nothing + no Anthropic key => plain Jev not-found (gap pass skipped, no key error)");
{
  const { isError, body } = parse(await rec(client, "kanban drag board", "p"));
  check("returns custom_build / no_candidates_found without erroring", !isError && body?.verdict === "custom_build" && body?.reason === "no_candidates_found");
  check("no jev_screen field (that is only for the Anthropic gap pass)", body?.jev_screen === undefined);
}

console.log("A caller-supplied checklist bypasses Jev (documented behavior)");
{
  jevCalls = 0;
  const { isError, text } = parse(await rec(client, "tabs for switching sections", "p", { checklist: ["a", "b", "c", "d", "e", "f", "g", "h"] }));
  check("goes to the Anthropic path (no key => key error)", isError && /ANTHROPIC_API_KEY/.test(text));
  check("Jev was not called", jevCalls === 0);
}

console.log("PATTERN_SCORER=anthropic ignores TYPESAFE_API_KEY");
{
  const c2 = await connect({ PATTERN_SCORER: "anthropic" });
  jevCalls = 0;
  const { isError, text } = parse(await rec(c2, "tabs for switching sections", "p"));
  check("Anthropic path => key error", isError && /ANTHROPIC_API_KEY/.test(text));
  check("Jev not called", jevCalls === 0);
  await c2.close();
}

console.log("No design system registered, Jev mode, no Anthropic key => says so (not a key error)");
{
  const { isError, text } = parse(await rec(client, "tabs for switching sections", "unregistered"));
  check("no-design-system message first", isError && /register_design_system/.test(text) && !/ANTHROPIC_API_KEY is not set/.test(text));
}

console.log("verify_component on a Jev-only result has nothing to verify against");
{
  writeFileSync(join(root, "Built.tsx"), "export const B = () => null;\n");
  await client.callTool({ name: "record_component_decision", arguments: { project_id: "p", component_need: "tabs for switching sections", action: "installed", source: "design_system", file_path: "Built.tsx" } });
  const { isError, text } = parse(await client.callTool({ name: "verify_component", arguments: { project_id: "p", file_path: "Built.tsx" } }));
  check("clear error, no crash", isError && /(No ledger entry|no checklist|ANTHROPIC)/i.test(text));
}

await client.close();
stub.close();
console.log(failures ? `${failures} failed` : "All checks passed.");
process.exit(failures ? 1 : 0);
