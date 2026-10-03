#!/usr/bin/env node
/**
 * verify-figma-evidence.mjs
 *
 * Free, deterministic, offline: register_design_system (figma_json_path)
 * stores raw Figma facts per project and get_figma_evidence returns them.
 * Fixture follows Figma's documented node fields (layoutMode, itemSpacing,
 * padding*, cornerRadius, TEXT.characters, INSTANCE.componentId).
 *
 * Run: node scripts/verify-figma-evidence.mjs (after `npm run build`)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist/index.js");
let failures = 0;
const check = (label, ok) => { if (ok) console.log(`  ok: ${label}`); else { console.error(`  FAIL: ${label}`); failures++; } };

const FIXTURE = {
  name: "Demo",
  components: { "9:1": { name: "Variant=Outline, Size=lg", componentSetId: "9:0", description: "" } },
  componentSets: { "9:0": { name: "Button", description: "" } },
  document: { id: "0:0", type: "DOCUMENT", name: "Document", children: [
    { id: "0:1", type: "CANVAS", name: "Overlays", children: [
      { id: "1:1", type: "COMPONENT", name: "Button", children: [] },
      { id: "2:1", type: "COMPONENT_SET", name: "Alert Dialog",
        componentPropertyDefinitions: { Dir: { type: "VARIANT", variantOptions: ["LTR", "RTL"] } },
        children: [
          { id: "2:2", type: "COMPONENT", name: "Dir=LTR",
            absoluteBoundingBox: { width: 320, height: 224 },
            layoutMode: "VERTICAL", itemSpacing: 16, paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24, cornerRadius: 10,
            children: [
              { id: "3:1", type: "TEXT", name: "Title", characters: "Are you absolutely sure?" },
              { id: "3:2", type: "TEXT", name: "Description", characters: "This action cannot be undone." },
              { id: "3:3", type: "FRAME", name: "Footer", children: [
                { id: "3:4", type: "INSTANCE", name: "Cancel", componentId: "9:1" },
                { id: "3:5", type: "INSTANCE", name: "Continue", componentId: "9:1" } ] } ] },
          { id: "2:3", type: "COMPONENT", name: "Dir=RTL", absoluteBoundingBox: { width: 999, height: 999 }, children: [] } ] },
    ] },
  ] },
};

const root = mkdtempSync(join(tmpdir(), "pattern-figev-"));
writeFileSync(join(root, "kit.json"), JSON.stringify(FIXTURE));
const transport = new StdioClientTransport({
  command: "node", args: [serverEntry], stderr: "pipe",
  env: { ...process.env, PATTERN_TOOLS: "full", PATTERN_TELEMETRY: "0", PATTERN_PROJECT_ROOT: root, PATTERN_DESIGN_SYSTEMS_PATH: join(root, "ds.json"),
         PATTERN_NO_ENFORCEMENT_HOOK: "1", PATTERN_NO_CONNECT_NOTICE: "1", PATTERN_NO_ENFORCEMENT_NOTICE: "1" },
});
const client = new Client({ name: "verify-figma-evidence", version: "0" }, { capabilities: {} });
await client.connect(transport);
const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); return { isError: !!r.isError, text: r.content[0].text }; };

console.log("tool is listed (full tier)");
check("get_figma_evidence advertised", (await client.listTools()).tools.some((t) => t.name === "get_figma_evidence"));

console.log("register, then read evidence");
const reg = await call("register_design_system", { project_id: "p", figma_json_path: "kit.json", summarize: false });
check("registered", !reg.isError);
check("evidence file written next to ds.json", existsSync(join(root, "figma_evidence", "p.json")));

const byName = await call("get_figma_evidence", { project_id: "p", name: "alert dialog" });
const m = JSON.parse(byName.text).matches?.[0];
check("found by case-insensitive name", !byName.isError && m?.name === "Alert Dialog");
check("size read from FIRST variant (320x224, not the RTL 999x999)", m?.size?.w === 320 && m?.size?.h === 224);
check("auto-layout: vertical, gap 16, radius 10", m?.layout?.direction === "vertical" && m?.layout?.gap === 16 && m?.layout?.radius === 10);
check("padding 24 all sides", JSON.stringify(m?.layout?.padding) === JSON.stringify({ top: 24, right: 24, bottom: 24, left: 24 }));
check("dependency list uses the SET name (Button), once, not the variant name", JSON.stringify(m?.instances) === JSON.stringify(["Button"]));
check("texts captured in order", JSON.stringify(m?.texts) === JSON.stringify(["Are you absolutely sure?", "This action cannot be undone."]));
check("tree has Footer with 2 instances", m?.tree?.children?.find((c) => c.name === "Footer")?.children?.length === 2);

const byId = await call("get_figma_evidence", { project_id: "p", node_id: "2:1" });
check("found by node_id", !byId.isError && JSON.parse(byId.text).matches[0].name === "Alert Dialog");

console.log("top-k ranking + scorer-facing format (Phase 4b)");
const fm = await import("../dist/design-system-figma.js");
const cands = [
  { name: "Card", description: null, figma: { node_id: "a", page: "Card", section: null, variants: {}, properties: [] } },
  { name: "Alert Dialog", description: null, figma: { node_id: "2:1", page: "Alert Dialog", section: null, variants: {}, properties: [] } },
  { name: "Tooltip", description: null, figma: { node_id: "c", page: "Tooltip", section: null, variants: {}, properties: [] } },
];
check("dialog need ranks Alert Dialog first", fm.rankFigmaCandidates(cands, "Confirmation dialog before a destructive action", ["modal with title"], 2)[0] === 1);
check("no overlap -> empty (never pads with arbitrary candidates)", fm.rankFigmaCandidates(cands, "zzz qqq", [], 3).length === 0);
check("k=0 -> empty", fm.rankFigmaCandidates(cands, "dialog", [], 0).length === 0);
const txt = fm.formatFigmaEvidence(m);
check("format states size, gap, padding, radius, dependency", /size 320x224/.test(txt) && /gap 16/.test(txt) && /padding T24 R24 B24 L24/.test(txt) && /radius 10/.test(txt) && /uses components: Button/.test(txt));

console.log("errors");
check("unknown name -> isError", (await call("get_figma_evidence", { project_id: "p", name: "nope" })).isError);
check("unknown project -> isError with hint", /No Figma evidence stored/.test((await call("get_figma_evidence", { project_id: "zzz", name: "x" })).text));
check("missing selector -> isError", (await call("get_figma_evidence", { project_id: "p" })).isError);

console.log("re-registering from a non-Figma source clears stale evidence");
writeFileSync(join(root, "m.json"), JSON.stringify([{ name: "Card", props: ["title"] }]));
await call("register_design_system", { project_id: "p", manifest_path: "m.json", summarize: false, replace: true });
check("evidence file removed", !existsSync(join(root, "figma_evidence", "p.json")));

await client.close();
console.log(failures ? `${failures} failed` : "All checks passed.");
process.exit(failures ? 1 : 0);
