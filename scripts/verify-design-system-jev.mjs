#!/usr/bin/env node
/**
 * verify-design-system-jev.mjs
 *
 * Free, deterministic check of the PATTERN_SCORER=jev design-system path
 * (src/design-system-jev.ts + runDesignSystemJevPass in src/index.ts). Spawns
 * the real MCP server over stdio against temp paths and a STUB Jev HTTP
 * server (TYPESAFE_API_URL), with ANTHROPIC_API_KEY deliberately empty -- so
 * any accidental Anthropic call (scoring, web search) would surface as an
 * error and fail the run. Nothing here touches real APIs.
 *
 * Run: node scripts/verify-design-system-jev.mjs (after `npm run build`)
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

// ---- stub Jev: score 0.9 when the candidate evidence mentions the need's keyword, else 0.05 ----
const requests = [];
const stub = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw);
    requests.push({ auth: req.headers.authorization, body });
    const need = body.state.component_need;
    if (need.includes("boom")) { res.writeHead(500); res.end("stub failure"); return; }
    const keyword = need.split(" ")[0].toLowerCase();
    const answers = {};
    for (const c of body.state.candidates) answers[c.id] = { type: "noul", noul: c.evidence.toLowerCase().includes(keyword) ? 0.9 : 0.05 };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ model: "stub", answers, usage: { input_tokens: 100, output_tokens: 10 } }));
  });
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const stubUrl = `http://127.0.0.1:${stub.address().port}/v1/systemone`;

// ---- sandbox project ----
const root = mkdtempSync(join(tmpdir(), "pattern-verify-jev-"));
mkdirSync(join(root, "components"), { recursive: true });
writeFileSync(join(root, "components", "Tabs.tsx"), [
  "interface TabsProps { onValueChange?: () => void; secretPropName: string }",
  "/** Tabbed panel switcher. */",
  "const Tabs = () => null;",
  "const TabsList = () => null;",
  "export { Tabs, TabsList };",
  'export { TabsTrigger } from "./TabsTrigger";',
].join("\n"));
writeFileSync(join(root, "components", "Dialog.tsx"), "/** Modal window with title and footer. */\nexport function Dialog() { return null; }\n");
writeFileSync(join(root, "components", "Spinner.jsx"), "export function Spinner() { return null; }\n");
// a big library: many files with long docs, to force batching under a small budget
mkdirSync(join(root, "big"), { recursive: true });
for (let i = 0; i < 40; i++) writeFileSync(join(root, "big", `Widget${i}.tsx`), `/** ${"Widget number ".repeat(12)}${i} ${i === 27 ? "carousel slider" : ""} */\nexport function Widget${i}() { return null; }\n`);

async function connect(extra = {}) {
  const t = new StdioClientTransport({ command: "node", args: [serverEntry], env: {
    ...process.env, ANTHROPIC_API_KEY: "", TYPESAFE_API_KEY: "test-key", TYPESAFE_API_URL: stubUrl, PATTERN_SCORER: "jev",
    PATTERN_PROJECT_ROOT: root, PATTERN_DESIGN_SYSTEMS_PATH: join(root, "ds.json"), PATTERN_LEDGER_PATH: join(root, "ledger.jsonl"),
    PATTERN_LOG_PATH: join(root, "calls.log"), PATTERN_MEMORY_PATH: join(root, "memory.json"), PATTERN_TOOLS: "full", ...extra } });
  const c = new Client({ name: "verify-design-system-jev", version: "0.1.0" }, { capabilities: {} });
  await c.connect(t);
  return c;
}
const parse = (r) => { const text = r.content?.[0]?.text ?? ""; try { return { isError: !!r.isError, body: JSON.parse(text), text }; } catch { return { isError: !!r.isError, body: null, text }; } };
const recommend = (c, need, project_id, extra = {}) => c.callTool({ name: "recommend_component", arguments: { component_need: need, domain: "test", framework: "React", project_id, ...extra } });

const client = await connect();
await client.callTool({ name: "register_design_system", arguments: { project_id: "p1", directory_path: "components" } });

console.log("\n=== 1. A fitting component is found (no Anthropic key present) ===");
{
  requests.length = 0;
  const { isError, body } = parse(await recommend(client, "tabs for switching panel sections", "p1"));
  check("no error", !isError);
  check("verdict use_existing, reason scored, scorer jev", body?.verdict === "use_existing" && body?.reason === "scored" && body?.scorer === "jev");
  check("recommendation.source is design_system", body?.recommendation?.source === "design_system");
  check("design_system_match names Tabs.tsx", body?.design_system_match?.file === "Tabs.tsx" && body.design_system_match.components.includes("Tabs"));
  check("confidence is never 'high'", body?.confidence !== "high");
  check("ensemble not triggered (no Sonnet re-run)", body?.ensemble?.triggered === false);
  check("tokens come from Jev usage", body?._meta?.tokens_used?.input === 100 && body?._meta?.tokens_used?.output === 10);
  check("cost_note present when no rate configured", typeof body?._meta?.cost_note === "string");
  check("Jev called once with the bearer key", requests.length === 1 && requests[0].auth === "Bearer test-key");
  const sent = JSON.stringify(requests[0]?.body.state);
  check("one pool entry per FILE (3 files, not per component)", requests[0]?.body.state.candidates.length === 3);
  check("prop names are NOT sent to Jev", !sent.includes("secretPropName") && !sent.includes("onValueChange"));
  check("re-exported name IS sent", sent.includes("TabsTrigger"));
}

console.log("\n=== 2. Nothing fits -> honest not-found, no web search ===");
{
  const { isError, body } = parse(await recommend(client, "kanban drag and drop board", "p1"));
  check("no error (an Anthropic/web-search call would fail: key is empty)", !isError);
  check("verdict custom_build, reason no_candidates_found", body?.verdict === "custom_build" && body?.reason === "no_candidates_found");
  check("recommendation is null", body?.recommendation === null);
  check("plain-language not_found_message, mentions no web search", /Could not find/.test(body?.not_found_message ?? "") && /Web search is not used/.test(body?.not_found_message ?? ""));
  check("closest match still reported for transparency", body?.design_system_match?.score !== undefined);
}

console.log("\n=== 3. Large library is batched under the token budget ===");
{
  const c2 = await connect({ PATTERN_JEV_BATCH_TOKENS: "600" });
  await c2.callTool({ name: "register_design_system", arguments: { project_id: "p2", directory_path: "big" } });
  requests.length = 0;
  const { isError, body } = parse(await recommend(c2, "carousel for images", "p2"));
  check("no error", !isError);
  check("multiple Jev requests were made", requests.length > 1);
  check("every request stays under the budget (few entries each)", requests.every((r) => r.body.state.candidates.length < 40));
  check("all 40 files were scored across the batches", requests.reduce((n, r) => n + r.body.state.candidates.length, 0) === 40);
  check("best match found across batches (Widget27)", body?.design_system_match?.file === "Widget27.tsx");
  await c2.close();
}

console.log("\n=== 4. Opt-outs and failures ===");
{
  const skip = parse(await recommend(client, "button", "unregistered-project"));
  check("unregistered project + skip-list need takes the normal free path", skip.body?.reason === "skip_list");
  const withChecklist = parse(await recommend(client, "tabs for switching panels", "p1", { checklist: ["a", "b", "c", "d", "e", "f", "g", "h"] }));
  check("a supplied checklist opts out of Jev (falls to Anthropic path, which errors with no key)", withChecklist.isError === true);
  const boom = parse(await recommend(client, "boom tabs", "p1"));
  check("a Jev API failure surfaces as an error, no silent fallback", boom.isError === true && /TypeSafe API error 500/.test(boom.text));
}

await client.close();
stub.close();
if (failures > 0) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log("\nAll checks passed.");
