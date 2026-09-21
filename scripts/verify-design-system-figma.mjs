#!/usr/bin/env node
/**
 * verify-design-system-figma.mjs
 *
 * Free, deterministic check of the Figma design-system source
 * (src/design-system-figma.ts): register_design_system with `figma_json_path`
 * (local) and `figma_file_key` (BYO token, fetched from a STUB Figma server),
 * plus how Figma candidates reach the Jev scorer (STUB Jev). The fixture is
 * modelled on Figma's documented GET /v1/files/:key response. It is NOT a real
 * Figma export: this proves the parser handles the documented shape, not that
 * it handles every real file.
 *
 * Run: node scripts/verify-design-system-figma.mjs (after `npm run build`)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist/index.js");
let failures = 0;
const check = (label, ok) => { if (ok) console.log(`  ok: ${label}`); else { console.error(`  FAIL: ${label}`); failures++; } };
const listen = (h) => new Promise((r) => { const s = createServer(h); s.listen(0, "127.0.0.1", () => r(s)); });

const FIXTURE = {
  name: "Demo UI Kit",
  document: { id: "0:0", type: "DOCUMENT", name: "Document", children: [
    { id: "0:1", type: "CANVAS", name: "Inputs", children: [
      { id: "1:1", type: "FRAME", name: "Buttons", children: [
        { id: "2:1", type: "COMPONENT_SET", name: "Button",
          componentPropertyDefinitions: {
            Size: { type: "VARIANT", defaultValue: "M", variantOptions: ["S", "M", "L"] },
            State: { type: "VARIANT", defaultValue: "Default", variantOptions: ["Default", "Hover", "Disabled", "Loading"] },
            "Show icon#12:0": { type: "BOOLEAN", defaultValue: false },
            "Label#12:1": { type: "TEXT", defaultValue: "Button" },
          },
          children: [{ id: "2:2", type: "COMPONENT", name: "Size=S, State=Default" }, { id: "2:3", type: "COMPONENT", name: "Size=M, State=Hover" }] },
        { id: "2:9", type: "INSTANCE", name: "Button", children: [{ id: "2:10", type: "COMPONENT", name: "should-never-be-a-candidate" }] },
        { id: "3:1", type: "COMPONENT", name: "Toggle" },
        { id: "3:2", type: "COMPONENT", name: "._hidden helper" },
        { id: "3:3", type: "COMPONENT_SET", name: "_Internal" },
      ] },
    ] },
    { id: "0:2", type: "CANVAS", name: "Feedback", children: [
      { id: "1:2", type: "SECTION", name: "Alerts", children: [
        { id: "4:1", type: "COMPONENT_SET", name: "Alert", children: [
          { id: "4:2", type: "COMPONENT", name: "Type=Info, Closable=True" },
          { id: "4:3", type: "COMPONENT", name: "Type=Error, Closable=False" },
        ] },
      ] },
      { id: "4:5", type: "COMPONENT", name: "Toggle" },
    ] },
  ] },
  components: { "3:1": { description: "On/off switch for a setting." }, "4:5": { description: "Feedback toggle chip." } },
  componentSets: { "2:1": { description: "Primary action button with sizes and states." } },
};

// Frames-mode fixture: a template that draws its designs as plain frames/groups (no components).
const layer = (id, name, type = "RECTANGLE") => ({ id, type, name });
const text = (id, characters) => ({ id, type: "TEXT", name: characters, characters });
const chart = (id, name, layers, texts) => ({ id, type: "GROUP", name, children: [...layers.map((n, i) => layer(`${id}:l${i}`, n)), ...texts.map((t, i) => text(`${id}:t${i}`, t))] });
const FRAMES_FIXTURE = {
  name: "Chart Templates",
  document: { id: "0:0", type: "DOCUMENT", name: "Document", children: [
    { id: "0:1", type: "CANVAS", name: "Design", children: [
      { id: "10:1", type: "FRAME", name: "Bar Charts", children: [
        chart("11:1", "Chart 1", ["Rectangle 4", "Bars", "Bar", "Card Info."], ["Online users", "JAN", "FEB", "JAN"]),
        chart("11:2", "Chart 2", ["Ellipse 9", "Legend", "Tooltip"], ["Demographic", "Masculine", "Feminine"]),
        { ...chart("11:3", "Chart 3", ["Bars", "Highlighted Bar"], ["Average views", "MON", "TUE"]), children: [layer("11:3:x", "Bars"), text("11:3:y", "Average views"), text("11:3:z", "MON"), layer("11:3:q", "Highlighted Bar"), { id: "11:3:i", type: "INSTANCE", name: "Button", children: [layer("11:3:ij", "inner-instance-layer"), layer("11:3:ik", "another"), layer("11:3:il", "third"), layer("11:3:im", "fourth"), layer("11:3:in", "fifth")] }] },
        chart("11:4", "Heading", ["Line"], ["Bar charts"]),
      ] },
      { id: "10:2", type: "GROUP", name: "CHART TYPE - Bar", children: [layer("12:1", "a"), layer("12:2", "b"), text("12:3", "Bar")] },
      { id: "10:3", type: "FRAME", name: "Standalone Dashboard", children: [layer("13:1", "Sidebar"), layer("13:2", "Header"), text("13:3", "Overview"), layer("13:4", "Content"), layer("13:5", "Footer")] },
    ] },
    { id: "0:2", type: "CANVAS", name: "Cover", children: [
      { id: "20:1", type: "FRAME", name: "Community Cover", children: [layer("21:1", "Logo"), layer("21:2", "Title"), text("21:3", "Free template"), layer("21:4", "Art"), layer("21:5", "Badge")] },
    ] },
  ] },
  components: {}, componentSets: {},
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const imageRequests = [];
let rateLimitNextImageRequest = false;
const modifiedFrames = JSON.parse(JSON.stringify(FRAMES_FIXTURE));
modifiedFrames.document.children[0].children[0].children[0].children.push(text("11:1:new", "A brand new label"));
const failFrames = JSON.parse(JSON.stringify(FRAMES_FIXTURE));
failFrames.document.children[0].children[0].children[1].name = "Chart 2 FAIL";
const figmaRequests = [];
const figmaStub = await listen((req, res) => {
  if (req.url.startsWith("/img/")) { res.writeHead(200, { "content-type": "image/png" }); res.end(PNG); return; }
  if (req.url.startsWith("/v1/images/")) {
    const u = new URL(req.url, "http://x");
    imageRequests.push({ ids: u.searchParams.get("ids").split(","), scale: u.searchParams.get("scale"), token: req.headers["x-figma-token"] });
    if (rateLimitNextImageRequest) { rateLimitNextImageRequest = false; res.writeHead(429, { "content-type": "application/json" }); res.end(JSON.stringify({ err: "Rate limit exceeded" })); return; }
    const images = {};
    for (const id of u.searchParams.get("ids").split(",")) images[id] = `http://127.0.0.1:${figmaStub.address().port}/img/${encodeURIComponent(id)}.png`;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ err: null, images }));
    return;
  }
  figmaRequests.push({ url: req.url, token: req.headers["x-figma-token"] });
  if (req.url.startsWith("/v1/files/forbidden")) { res.writeHead(403); res.end("no"); return; }
  if (req.url.startsWith("/v1/files/missing")) { res.writeHead(404); res.end("no"); return; }
  if (req.headers["x-figma-token"] !== "figd_test_token") { res.writeHead(403); res.end("bad token"); return; }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(req.url.startsWith("/v1/files/framesfile3") ? failFrames : req.url.startsWith("/v1/files/framesfile2") ? modifiedFrames : req.url.startsWith("/v1/files/framesfile") ? FRAMES_FIXTURE : FIXTURE));
});
const anthropicRequests = [];
const anthropicStub = await listen((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw);
    const blocks = body.messages[0].content;
    const prompt = blocks.find((b) => b.type === "text")?.text ?? "";
    anthropicRequests.push({ key: req.headers["x-api-key"], model: body.model, blocks, prompt });
    if (prompt.includes("Chart 2 FAIL")) { res.writeHead(500); res.end("stub failure"); return; }
    const name = (prompt.match(/Design name: (.*)$/m) ?? [])[1];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: `Caption of ${name}: a stacked bar chart with a legend.` }], usage: { input_tokens: 300, output_tokens: 40 } }));
  });
});
const jevRequests = [];
const jevStub = await listen((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw); jevRequests.push(body);
    const answers = {};
    for (const c of body.state.candidates) answers[c.id] = { type: "noul", noul: /Alert/.test(c.evidence) ? 0.9 : 0.05 };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ model: "stub", answers, usage: { input_tokens: 5, output_tokens: 1 } }));
  });
});

const root = mkdtempSync(join(tmpdir(), "pattern-verify-figma-"));
writeFileSync(join(root, "kit.json"), JSON.stringify(FIXTURE));
writeFileSync(join(root, "not-json.json"), "this is { not json");
writeFileSync(join(root, "frames.json"), JSON.stringify(FRAMES_FIXTURE));
writeFileSync(join(root, "not-figma.json"), JSON.stringify({ hello: "world" }));

async function connect(extra = {}) {
  const t = new StdioClientTransport({ command: "node", args: [serverEntry], env: {
    ...process.env, ANTHROPIC_API_KEY: "", TYPESAFE_API_KEY: "jev-test", TYPESAFE_API_URL: `http://127.0.0.1:${jevStub.address().port}/v1/systemone`,
    FIGMA_API_URL: `http://127.0.0.1:${figmaStub.address().port}`, PATTERN_PROJECT_ROOT: root,
    PATTERN_SUMMARY_API_URL: `http://127.0.0.1:${anthropicStub.address().port}/v1/messages`, PATTERN_FIGMA_RATE_BACKOFF_MS: "10",
    PATTERN_DESIGN_SYSTEMS_PATH: join(root, `ds-${Math.random().toString(36).slice(2)}.json`), PATTERN_LEDGER_PATH: join(root, "ledger.jsonl"),
    PATTERN_LOG_PATH: join(root, "calls.log"), PATTERN_MEMORY_PATH: join(root, "memory.json"), PATTERN_TOOLS: "full", ...extra } });
  const c = new Client({ name: "verify-figma", version: "0.1.0" }, { capabilities: {} });
  await c.connect(t);
  return c;
}
const parse = (r) => { const text = r.content?.[0]?.text ?? ""; try { return { isError: !!r.isError, body: JSON.parse(text), text }; } catch { return { isError: !!r.isError, body: null, text }; } };
const reg = (c, args) => c.callTool({ name: "register_design_system", arguments: args });

const client = await connect();

console.log("\n=== 1. Local saved file (figma_json_path) ===");
{
  const { isError, body } = parse(await reg(client, { project_id: "f1", figma_json_path: "kit.json" }));
  check("no error", !isError && body?.status === "registered");
  check("source_kind is figma, source_path is the relative path", body?.registration?.source_kind === "figma" && body.registration.source_path === "kit.json");
  const c = body.registration.candidates;
  const names = c.map((x) => x.name).sort();
  check("exactly 4 candidates: Button, Toggle x2, Alert", JSON.stringify(names) === JSON.stringify(["Alert", "Button", "Toggle", "Toggle"]));
  check("instances and their children are never candidates", !c.some((x) => x.name === "should-never-be-a-candidate") && c.filter((x) => x.name === "Button").length === 1);
  check("hidden components/sets (._ / _ prefix) are skipped", !c.some((x) => /hidden|Internal/.test(x.name)));
  const button = c.find((x) => x.name === "Button");
  check("component set carries its VARIANT options", JSON.stringify(button?.figma?.variants) === JSON.stringify({ Size: ["S", "M", "L"], State: ["Default", "Hover", "Disabled", "Loading"] }));
  check("non-variant properties recorded, '#id' suffix stripped", JSON.stringify(button?.figma?.properties) === JSON.stringify(["Show icon", "Label"]));
  check("page and section recorded", button?.figma?.page === "Inputs" && button.figma.section === "Buttons");
  check("description comes from the top-level componentSets map", button?.description === "Primary action button with sizes and states.");
  const alert = c.find((x) => x.name === "Alert");
  check("variants recovered from child names when no property definitions", JSON.stringify(alert?.figma?.variants) === JSON.stringify({ Type: ["Info", "Error"], Closable: ["True", "False"] }));
  check("SECTION ancestors count as the section", alert?.figma?.section === "Alerts" && alert.figma.page === "Feedback");
  const toggles = c.filter((x) => x.name === "Toggle");
  check("same-named components on different pages stay separate", toggles.length === 2 && new Set(toggles.map((t) => t.figma.node_id)).size === 2);
  check("standalone component descriptions come from the components map", toggles.some((t) => t.description === "On/off switch for a setting.") && toggles.some((t) => t.description === "Feedback toggle chip."));
  check("no summaries block (nothing to read source from) and no Anthropic call", body.summaries === undefined);
}

console.log("\n=== 2. Bad input is refused clearly ===");
{
  const bad = parse(await reg(client, { project_id: "f2", figma_json_path: "not-json.json" }));
  check("invalid JSON -> clear error", bad.isError && /not valid JSON/.test(bad.text));
  const notFigma = parse(await reg(client, { project_id: "f2", figma_json_path: "not-figma.json" }));
  check("valid JSON that isn't a Figma file -> tells you what to save", notFigma.isError && /GET https:\/\/api\.figma\.com\/v1\/files/.test(notFigma.text));
  const escape = parse(await reg(client, { project_id: "f2", figma_json_path: "../etc/passwd" }));
  check("path escaping the project root -> refused", escape.isError && /within the project root/.test(escape.text));
  const two = parse(await reg(client, { project_id: "f2", figma_json_path: "kit.json", directory_path: "." }));
  check("two sources at once -> refused", two.isError === true);
}

console.log("\n=== 3. Live fetch (figma_file_key) uses the token from the environment ===");
{
  const noToken = parse(await reg(client, { project_id: "f3", figma_file_key: "abc123" }));
  check("no FIGMA_ACCESS_TOKEN -> refused, points at the token-free alternative", noToken.isError && /FIGMA_ACCESS_TOKEN/.test(noToken.text) && /figma_json_path/.test(noToken.text));
  const withTok = await connect({ FIGMA_ACCESS_TOKEN: "figd_test_token" });
  figmaRequests.length = 0;
  const ok = parse(await reg(withTok, { project_id: "f3", figma_file_key: "abc123" }));
  check("fetches and registers", !ok.isError && ok.body?.registration?.candidate_count === 4);
  check("source_path is figma:<key>", ok.body?.registration?.source_path === "figma:abc123");
  check("token sent in X-Figma-Token to the right file", figmaRequests.length === 1 && figmaRequests[0].token === "figd_test_token" && figmaRequests[0].url === "/v1/files/abc123");
  check("the token never appears in the tool response", !ok.text.includes("figd_test_token"));
  const forbidden = parse(await reg(withTok, { project_id: "f3", figma_file_key: "forbidden" }));
  check("403 -> clear message", forbidden.isError && /403/.test(forbidden.text) && /FIGMA_ACCESS_TOKEN/.test(forbidden.text));
  const missing = parse(await reg(withTok, { project_id: "f3", figma_file_key: "missing" }));
  check("404 -> clear message", missing.isError && /404/.test(missing.text));
  const both = parse(await reg(withTok, { project_id: "f3", figma_file_key: "abc123", figma_json_path: "kit.json" }));
  check("figma_file_key + another source -> refused", both.isError === true);
  await withTok.close();
}

console.log("\n=== 4. Figma candidates reach the Jev scorer ===");
{
  const jev = await connect({ PATTERN_SCORER: "jev" });
  await reg(jev, { project_id: "j1", figma_json_path: "kit.json" });
  jevRequests.length = 0;
  const { isError, body } = parse(await jev.callTool({ name: "recommend_component", arguments: { component_need: "a dismissible alert banner", domain: "t", framework: "React", project_id: "j1" } }));
  check("no error, no Anthropic key needed", !isError);
  const evidence = jevRequests[0]?.state.candidates.map((c) => c.evidence) ?? [];
  check("4 pool entries (one per component; same-named Toggles not merged)", evidence.length === 4);
  check("evidence carries variants, location and description", evidence.some((e) => /variants: Type: Info \| Error; Closable: True \| False/.test(e) && /located: Feedback > Alerts/.test(e)));
  check("Alert is found", body?.verdict === "use_existing" && body?.design_system_match?.components?.includes("Alert"));
  check("match has no file (Figma components aren't files)", body?.design_system_match?.file === null);
  await jev.close();
  const noVariants = await connect({ PATTERN_SCORER: "jev", PATTERN_JEV_FIGMA_VARIANTS: "0" });
  await reg(noVariants, { project_id: "j2", figma_json_path: "kit.json" });
  jevRequests.length = 0;
  await noVariants.callTool({ name: "recommend_component", arguments: { component_need: "a dismissible alert banner", domain: "t", framework: "React", project_id: "j2" } });
  const ev2 = jevRequests[0]?.state.candidates.map((c) => c.evidence) ?? [];
  check("PATTERN_JEV_FIGMA_VARIANTS=0 drops variant text but keeps location", ev2.every((e) => !/variants:/.test(e)) && ev2.some((e) => /located:/.test(e)));
  await noVariants.close();
}

console.log("\n=== 5. Frames mode: designs drawn as plain frames/groups ===");
{
  const noComps = parse(await reg(client, { project_id: "fr0", figma_json_path: "frames.json" }));
  check("components mode on a file with no components -> error pointing at frames mode", noComps.isError && /figma_mode: "frames"/.test(noComps.text));
  const { isError, body } = parse(await reg(client, { project_id: "fr1", figma_json_path: "frames.json", figma_mode: "frames", figma_pages: ["design"] }));
  check("no error", !isError && body?.status === "registered");
  const c = body.registration.candidates;
  const names = c.map((x) => x.name).sort();
  check("sheet children become candidates named 'Sheet > Design'; standalone frame is its own", JSON.stringify(names) === JSON.stringify(["Bar Charts > Chart 1", "Bar Charts > Chart 2", "Bar Charts > Chart 3", "Standalone Dashboard"]));
  check("small headings/labels are skipped (Heading group, 3-layer 'CHART TYPE' group)", !c.some((x) => /Heading|CHART TYPE/.test(x.name)));
  check("figma_pages filter is case-insensitive substring and drops the Cover page", !c.some((x) => x.figma.page === "Cover"));
  const c1 = c.find((x) => x.name === "Bar Charts > Chart 1");
  check("kind is frame; page and section recorded", c1.figma.kind === "frame" && c1.figma.page === "Design" && c1.figma.section === "Bar Charts");
  check("default layer names (Rectangle 4) are dropped, meaningful ones kept", !c1.figma.layers.includes("Rectangle 4") && c1.figma.layers.includes("Bars") && c1.figma.layers.includes("Card Info."));
  check("text contents are collected and de-duplicated", JSON.stringify(c1.figma.texts) === JSON.stringify(["Online users", "JAN", "FEB"]));
  const c3 = c.find((x) => x.name === "Bar Charts > Chart 3");
  check("instances are never descended into (their inner layers are not evidence)", !c3.figma.layers.includes("inner-instance-layer") && c3.figma.layers.includes("Highlighted Bar"));
  const all = parse(await reg(client, { project_id: "fr2", figma_json_path: "frames.json", figma_mode: "frames" }));
  check("no page filter includes every page (cover junk appears)", all.body.registration.candidates.some((x) => x.figma.page === "Cover"));
  const noMatch = parse(await reg(client, { project_id: "fr3", figma_json_path: "frames.json", figma_mode: "frames", figma_pages: ["nope"] }));
  check("a page filter that matches nothing -> clear error", noMatch.isError && /figma_pages/.test(noMatch.text));
  const withTok = await connect({ FIGMA_ACCESS_TOKEN: "figd_test_token" });
  const live = parse(await reg(withTok, { project_id: "fr4", figma_file_key: "framesfile", figma_mode: "frames", figma_pages: ["Design"] }));
  check("figma_mode works with figma_file_key too", !live.isError && live.body.registration.candidate_count === 4);
  await withTok.close();
  const jev = await connect({ PATTERN_SCORER: "jev" });
  await reg(jev, { project_id: "fj", figma_json_path: "frames.json", figma_mode: "frames", figma_pages: ["Design"] });
  jevRequests.length = 0;
  await jev.callTool({ name: "recommend_component", arguments: { component_need: "Alert something", domain: "t", framework: "React", project_id: "fj" } });
  const ev = jevRequests[0]?.state.candidates.map((x) => x.evidence) ?? [];
  check("Jev evidence carries location, layers and text", ev.some((e) => /located: Design > Bar Charts/.test(e) && /layers: Bars, Bar, Card Info\./.test(e) && /text: Online users \| JAN \| FEB/.test(e)));
  await jev.close();
  const noText = await connect({ PATTERN_SCORER: "jev", PATTERN_JEV_FIGMA_TEXT: "0" });
  await reg(noText, { project_id: "fj2", figma_json_path: "frames.json", figma_mode: "frames", figma_pages: ["Design"] });
  jevRequests.length = 0;
  await noText.callTool({ name: "recommend_component", arguments: { component_need: "Alert something", domain: "t", framework: "React", project_id: "fj2" } });
  const ev2 = jevRequests[0]?.state.candidates.map((x) => x.evidence) ?? [];
  check("PATTERN_JEV_FIGMA_TEXT=0 drops layers/text but keeps location", ev2.every((e) => !/layers:|text:/.test(e)) && ev2.some((e) => /located:/.test(e)));
  await noText.close();
}

console.log("\n=== 6. Vision captions (opt-in): renders designs, sends images to Anthropic ===");
{
  const cap = await connect({ FIGMA_ACCESS_TOKEN: "figd_test_token", ANTHROPIC_API_KEY: "sk-test" });
  const captionArgs = { figma_file_key: "framesfile", figma_mode: "frames", figma_pages: ["Design"] };

  const withJson = parse(await reg(cap, { project_id: "v0", figma_json_path: "frames.json", figma_mode: "frames", summarize: true }));
  check("summarize: true + figma_json_path is refused (a saved JSON stays fully local)", withJson.isError && /figma_file_key/.test(withJson.text));
  const noAnthropic = await connect({ FIGMA_ACCESS_TOKEN: "figd_test_token", ANTHROPIC_API_KEY: "" });
  const noKey = parse(await reg(noAnthropic, { project_id: "v0", ...captionArgs, summarize: true }));
  check("summarize: true without ANTHROPIC_API_KEY is refused", noKey.isError === true);
  await noAnthropic.close();

  imageRequests.length = 0; anthropicRequests.length = 0;
  const dflt = parse(await reg(cap, { project_id: "v1", ...captionArgs }));
  check("DEFAULT (summarize unset) sends nothing: no render request, no Anthropic call, no summaries block", !dflt.isError && imageRequests.length === 0 && anthropicRequests.length === 0 && dflt.body.summaries === undefined);
  const off = parse(await reg(cap, { project_id: "v1", ...captionArgs, summarize: false }));
  check("summarize: false sends nothing either", imageRequests.length === 0 && anthropicRequests.length === 0 && off.body.summaries === undefined);

  rateLimitNextImageRequest = true;
  const on = parse(await reg(cap, { project_id: "v2", ...captionArgs, summarize: true }));
  check("summarize: true captions every design (4 generated, 0 failed)", !on.isError && on.body.summaries?.generated === 4 && on.body.summaries.failed === 0);
  check("a rate-limited images request is retried, then succeeds", imageRequests.length >= 2 && imageRequests[0].ids.length === imageRequests[1].ids.length);
  check("the Figma token is sent on render requests", imageRequests.every((r) => r.token === "figd_test_token"));
  check("one vision request per design, image sent as base64 PNG", anthropicRequests.length === 4 && anthropicRequests.every((r) => r.blocks.some((b) => b.type === "image" && b.source.media_type === "image/png" && b.source.data.length > 20)));
  check("uses the configured key and the Haiku model", anthropicRequests.every((r) => r.key === "sk-test" && /haiku/.test(r.model)));
  check("tokens and cost are reported", on.body.summaries.tokens.input_tokens === 1200 && on.body.summaries.estimated_cost_usd > 0);
  check("response says images were sent to Anthropic", /images of 4 design/.test(on.body.summaries.notice ?? "") && /api\.anthropic\.com/.test(on.body.summaries.notice));
  const chart1 = on.body.registration.candidates.find((x) => x.name === "Bar Charts > Chart 1");
  check("caption stored as the summary, with a hash", /Caption of Bar Charts > Chart 1/.test(chart1.summary ?? "") && /^[0-9a-f]{10}$/.test(chart1.summary_hash ?? ""));
  check("the token never appears in the response", !JSON.stringify(on.body).includes("figd_test_token") && !JSON.stringify(on.body).includes("sk-test"));

  imageRequests.length = 0; anthropicRequests.length = 0;
  const again = parse(await reg(cap, { project_id: "v2", ...captionArgs, summarize: true }));
  check("re-registering an unchanged file reuses all captions: nothing rendered or sent", again.body.summaries.generated === 0 && again.body.summaries.reused === 4 && imageRequests.length === 0 && anthropicRequests.length === 0);
  const plain = parse(await reg(cap, { project_id: "v2", figma_file_key: "framesfile", figma_mode: "frames", figma_pages: ["Design"] }));
  check("captions survive a re-registration without the flag", plain.body.registration.candidates.every((x) => !!x.summary) && imageRequests.length === 0);

  const changed = parse(await reg(cap, { project_id: "v2", figma_file_key: "framesfile2", figma_mode: "frames", figma_pages: ["Design"], summarize: true }));
  check("only the design whose contents changed is re-captioned", changed.body.summaries.generated === 1 && changed.body.summaries.reused === 3 && anthropicRequests.length === 1 && /Chart 1/.test(anthropicRequests[0].prompt));

  const failing = parse(await reg(cap, { project_id: "v4", figma_file_key: "framesfile3", figma_mode: "frames", figma_pages: ["Design"], summarize: true }));
  check("one design failing to caption doesn't fail the registration", !failing.isError && failing.body.summaries.failed === 1 && failing.body.summaries.generated === 3);
  check("the failed design just has no caption", !failing.body.registration.candidates.find((x) => /Chart 2 FAIL/.test(x.name))?.summary);

  const jev = await connect({ FIGMA_ACCESS_TOKEN: "figd_test_token", ANTHROPIC_API_KEY: "sk-test", PATTERN_SCORER: "jev" });
  await reg(jev, { project_id: "v3", ...captionArgs, summarize: true });
  jevRequests.length = 0;
  await jev.callTool({ name: "recommend_component", arguments: { component_need: "a stacked bar chart", domain: "t", framework: "React", project_id: "v3" } });
  const ev = jevRequests[0]?.state.candidates.map((x) => x.evidence) ?? [];
  check("captions reach the Jev scorer as `summary:` evidence", ev.length > 0 && ev.every((e) => /summary: Caption of/.test(e)));
  await jev.close();
  await cap.close();
}

await client.close();
anthropicStub.close();
figmaStub.close();
jevStub.close();
if (failures > 0) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log("\nAll checks passed.");
