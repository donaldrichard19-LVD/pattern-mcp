#!/usr/bin/env node
/**
 * verify-design-system-summaries.mjs
 *
 * Free, deterministic check of register_design_system's opt-in `summarize`
 * (src/design-system-summaries.ts). Spawns the real MCP server over stdio
 * against temp paths, with STUB Anthropic (PATTERN_SUMMARY_API_URL) and STUB
 * Jev (TYPESAFE_API_URL) HTTP servers. Nothing here touches real APIs.
 *
 * Run: node scripts/verify-design-system-summaries.mjs (after `npm run build`)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist/index.js");
let failures = 0;
const check = (label, ok) => { if (ok) console.log(`  ok: ${label}`); else { console.error(`  FAIL: ${label}`); failures++; } };

const listen = (handler) => new Promise((r) => { const s = createServer(handler); s.listen(0, "127.0.0.1", () => r(s)); });
const readBody = (req) => new Promise((r) => { let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => r(JSON.parse(raw))); });

const anthropicRequests = [];
const anthropicStub = await listen(async (req, res) => {
  const body = await readBody(req);
  const prompt = body.messages[0].content;
  anthropicRequests.push({ key: req.headers["x-api-key"], model: body.model, prompt });
  if (prompt.includes("FAILME")) { res.writeHead(500); res.end("stub failure"); return; }
  const file = (prompt.match(/FILE: (\S+)/) ?? [])[1];
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ content: [{ type: "text", text: `Summary of ${file}: tabbed switcher widget.` }], usage: { input_tokens: 200, output_tokens: 30 } }));
});
const jevRequests = [];
const jevStub = await listen(async (req, res) => {
  const body = await readBody(req);
  jevRequests.push(body);
  const answers = {};
  for (const c of body.state.candidates) answers[c.id] = { type: "noul", noul: c.evidence.includes("tabbed switcher") ? 0.9 : 0.05 };
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ model: "stub", answers, usage: { input_tokens: 10, output_tokens: 1 } }));
});

const root = mkdtempSync(join(tmpdir(), "pattern-verify-summaries-"));
mkdirSync(join(root, "components"), { recursive: true });
const src = (name, extra = "") => `/** ${name} widget. */\nexport function ${name}() { return null; }\n${extra}`;
writeFileSync(join(root, "components", "Tabs.tsx"), src("Tabs"));
writeFileSync(join(root, "components", "Dialog.tsx"), src("Dialog"));
writeFileSync(join(root, "components", "Spinner.jsx"), src("Spinner"));
writeFileSync(join(root, "manifest.json"), JSON.stringify([{ name: "Alert", props: [] }]));

async function connect(extra = {}) {
  const t = new StdioClientTransport({ command: "node", args: [serverEntry], env: {
    ...process.env, ANTHROPIC_API_KEY: "sk-test", PATTERN_SUMMARY_API_URL: `http://127.0.0.1:${anthropicStub.address().port}/v1/messages`,
    TYPESAFE_API_KEY: "jev-test", TYPESAFE_API_URL: `http://127.0.0.1:${jevStub.address().port}/v1/systemone`,
    PATTERN_PROJECT_ROOT: root, PATTERN_DESIGN_SYSTEMS_PATH: join(root, `ds-${Math.random().toString(36).slice(2)}.json`),
    PATTERN_LEDGER_PATH: join(root, "ledger.jsonl"), PATTERN_LOG_PATH: join(root, "calls.log"), PATTERN_MEMORY_PATH: join(root, "memory.json"),
    PATTERN_TOOLS: "full", ...extra } });
  const c = new Client({ name: "verify-summaries", version: "0.1.0" }, { capabilities: {} });
  await c.connect(t);
  return c;
}
const parse = (r) => { const text = r.content?.[0]?.text ?? ""; try { return { isError: !!r.isError, body: JSON.parse(text), text }; } catch { return { isError: !!r.isError, body: null, text }; } };
const register = (c, project_id, args = {}) => c.callTool({ name: "register_design_system", arguments: { project_id, directory_path: "components", ...args } });

const client = await connect();

console.log("\n=== 1. Opt-in: no summarize -> no Anthropic call, no summaries ===");
{
  anthropicRequests.length = 0;
  const { body } = parse(await register(client, "plain"));
  check("registers fine", body?.status === "registered");
  check("no Anthropic request was made", anthropicRequests.length === 0);
  check("no candidate has a summary", body.registration.candidates.every((c) => !c.summary));
  check("no `summaries` block in the response", body.summaries === undefined);
}

console.log("\n=== 2. summarize: true generates one summary per file ===");
{
  anthropicRequests.length = 0;
  const { isError, body } = parse(await register(client, "s1", { summarize: true }));
  check("no error", !isError);
  check("3 files summarized, 0 failed, 0 reused", body?.summaries?.generated === 3 && body.summaries.failed === 0 && body.summaries.reused === 0);
  check("one Anthropic request per FILE", anthropicRequests.length === 3);
  check("uses the configured key and the Haiku model", anthropicRequests.every((r) => r.key === "sk-test" && /haiku/.test(r.model)));
  check("prompt carries the file's source", anthropicRequests.some((r) => r.prompt.includes("FILE: Tabs.tsx") && r.prompt.includes("export function Tabs")));
  check("tokens + cost reported from usage", body.summaries.tokens.input_tokens === 600 && body.summaries.tokens.output_tokens === 90 && body.summaries.estimated_cost_usd > 0);
  const tabs = body.registration.candidates.find((c) => c.name === "Tabs");
  check("summary and content hash stored on the candidate", /tabbed switcher/.test(tabs?.summary ?? "") && /^[0-9a-f]{10}$/.test(tabs?.summary_hash ?? ""));
}

console.log("\n=== 3. Re-registering unchanged files reuses cached summaries (free) ===");
{
  anthropicRequests.length = 0;
  const { body } = parse(await register(client, "s1", { summarize: true }));
  check("nothing generated, 3 reused", body?.summaries?.generated === 0 && body.summaries.reused === 3);
  check("no Anthropic request", anthropicRequests.length === 0);
  const noFlag = parse(await register(client, "s1"));
  check("even WITHOUT the flag, unchanged files keep their summary", noFlag.body.registration.candidates.every((c) => !!c.summary));
  check("and still no Anthropic request", anthropicRequests.length === 0);
}

console.log("\n=== 4. A changed file loses its stale summary and only it is regenerated ===");
{
  writeFileSync(join(root, "components", "Tabs.tsx"), src("Tabs", "// edited\n"));
  const noFlag = parse(await register(client, "s1"));
  const by = Object.fromEntries(noFlag.body.registration.candidates.map((c) => [c.name, c]));
  check("changed file's stale summary is dropped", !by.Tabs.summary);
  check("unchanged files keep theirs", !!by.Dialog.summary && !!by.Spinner.summary);
  anthropicRequests.length = 0;
  const { body } = parse(await register(client, "s1", { summarize: true }));
  check("exactly 1 regenerated, 2 reused", body.summaries.generated === 1 && body.summaries.reused === 2 && anthropicRequests.length === 1);
}

console.log("\n=== 5. Per-file failure does not fail the registration ===");
{
  writeFileSync(join(root, "components", "Broken.tsx"), src("Broken", "// FAILME\n"));
  const { isError, body } = parse(await register(client, "s2", { summarize: true }));
  check("no error", !isError && body?.status === "registered");
  check("1 failed, others summarized", body.summaries.failed === 1 && body.summaries.generated === 3);
  const broken = body.registration.candidates.find((c) => c.name === "Broken");
  check("failed file simply has no summary", !broken?.summary);
  unlinkSync(join(root, "components", "Broken.tsx"));
}

console.log("\n=== 6. Refusals leave things untouched ===");
{
  const manifest = parse(await client.callTool({ name: "register_design_system", arguments: { project_id: "m1", manifest_path: "manifest.json", summarize: true } }));
  check("summarize + manifest_path is refused with a clear message", manifest.isError && /needs directory_path/.test(manifest.text));
  const noKey = await connect({ ANTHROPIC_API_KEY: "" });
  await register(noKey, "k1");
  const refused = parse(await register(noKey, "k1", { summarize: true }));
  check("summarize without ANTHROPIC_API_KEY is refused", refused.isError === true);
  const stillThere = parse(await register(noKey, "k1"));
  check("plain registration still works without a key", stillThere.body?.status === "registered");
  await noKey.close();
}

console.log("\n=== 7. Cap on files per registration ===");
{
  const capped = await connect({ PATTERN_SUMMARY_MAX_FILES: "2" });
  anthropicRequests.length = 0;
  const { body } = parse(await register(capped, "cap1", { summarize: true }));
  check("only 2 summarized, the rest reported as over the cap", body.summaries.generated === 2 && body.summaries.skipped_over_cap === 1 && anthropicRequests.length === 2);
  await capped.close();
}

console.log("\n=== 8. Summaries reach the Jev scorer's evidence ===");
{
  const jev = await connect({ PATTERN_SCORER: "jev", ANTHROPIC_API_KEY: "sk-test" });
  await register(jev, "j1", { summarize: true });
  jevRequests.length = 0;
  const { body } = parse(await jev.callTool({ name: "recommend_component", arguments: { component_need: "a switcher for sections", domain: "t", framework: "React", project_id: "j1" } }));
  check("Jev was called and evidence includes the summary", jevRequests.length === 1 && jevRequests[0].state.candidates.every((c) => /summary: Summary of/.test(c.evidence)));
  check("scored via Jev, found a match", body?.scorer === "jev" && body?.verdict === "use_existing");
  await jev.close();
}

await client.close();
anthropicStub.close();
jevStub.close();
if (failures > 0) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log("\nAll checks passed.");
