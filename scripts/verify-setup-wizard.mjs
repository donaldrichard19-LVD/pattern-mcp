#!/usr/bin/env node
/**
 * verify-setup-wizard.mjs
 *
 * Offline checks for the guided `pattern-mcp init` steps (src/setup-wizard.ts):
 * pure helpers with a fake fetch, then a real `init` subprocess against a
 * scratch HOME and project that registers a components folder end to end.
 * Never touches the real ~/.pattern or any real client config, never calls
 * the network.
 *
 * Run: node scripts/verify-setup-wizard.mjs (after `npm run build`)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

let failures = 0;
function check(label, ok) {
  if (ok) console.log(`  ok: ${label}`);
  else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

const wiz = await import(new URL("../dist/setup-wizard.js", import.meta.url));
const indexPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const fakeFetch = (status) => async () => ({ ok: status >= 200 && status < 300, status });
const throwingFetch = async () => {
  throw new Error("offline");
};

console.log("1. parseFigmaFileKey");
check("design URL", wiz.parseFigmaFileKey("https://www.figma.com/design/AbC123xyz90/My-Kit?node-id=1-2") === "AbC123xyz90");
check("legacy file URL", wiz.parseFigmaFileKey("https://figma.com/file/AbC123xyz90/Kit") === "AbC123xyz90");
check("bare key", wiz.parseFigmaFileKey("AbC123xyz90") === "AbC123xyz90");
check("rejects prose", wiz.parseFigmaFileKey("my design file") === null);
check("rejects empty", wiz.parseFigmaFileKey("  ") === null);

console.log("2. key checks (fake fetch)");
check("anthropic valid", (await wiz.checkAnthropicKey("sk-ant-x", fakeFetch(200))).status === "valid");
check("anthropic 401 invalid", (await wiz.checkAnthropicKey("sk-ant-x", fakeFetch(401))).status === "invalid");
check("anthropic wrong prefix invalid without a request", (await wiz.checkAnthropicKey("nope", throwingFetch)).status === "invalid");
check("anthropic offline unverified", (await wiz.checkAnthropicKey("sk-ant-x", throwingFetch)).status === "unverified");
check("anthropic 500 unverified", (await wiz.checkAnthropicKey("sk-ant-x", fakeFetch(500))).status === "unverified");
{
  const wsBody = async () => ({ ok: false, status: 400, text: async () => '{"error":{"message":"This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header"}}' });
  const r = await wiz.checkAnthropicKey("sk-ant-x", wsBody);
  check("anthropic 400 about workspace asks for a workspace id", r.status === "unverified" && r.needsWorkspace === true);
  let sent = null;
  const ok = async (_u, init) => { sent = init.headers["anthropic-workspace-id"]; return { ok: true, status: 200 }; };
  const r2 = await wiz.checkAnthropicKey("sk-ant-x", ok, "wrkspc_123");
  check("workspace id is sent as a header and accepted", r2.status === "valid" && sent === "wrkspc_123");
  const r3 = await wiz.checkAnthropicKey("sk-ant-x", wsBody, "wrkspc_bad");
  check("a rejected workspace id is invalid, not asked again", r3.status === "invalid" && !r3.needsWorkspace);
}
check("figma valid", (await wiz.checkFigmaToken("figd_abc", fakeFetch(200))).status === "valid");
check("figma 403 invalid", (await wiz.checkFigmaToken("figd_abc", fakeFetch(403))).status === "invalid");
check("figma wrong prefix invalid", (await wiz.checkFigmaToken("abc", throwingFetch)).status === "invalid");
check("figma with space invalid", (await wiz.checkFigmaToken("figd_a bc", throwingFetch)).status === "invalid");
check("figma offline unverified", (await wiz.checkFigmaToken("figd_abc", throwingFetch)).status === "unverified");

console.log("2b. parseOversizedPages");
{
  const msg = '"figma:x" produced 14220 candidates, over the 3000 limit (PATTERN_FIGMA_MAX_CANDIDATES). Biggest pages: "Tabler Icons" (4963), "Remix Icons" (1654), "Buttons" (40). Icon libraries are the usual cause';
  const pages = wiz.parseOversizedPages(msg);
  check("parses names and counts", pages?.length === 3 && pages[0].name === "Tabler Icons" && pages[0].count === 4963);
  check("ignores other errors", wiz.parseOversizedPages("Figma returned 403") === null);
}

console.log("3. guessComponentsDir + summary");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-wiz-guess-"));
  check("none found", wiz.guessComponentsDir(root) === null);
  mkdirSync(join(root, "src", "components"), { recursive: true });
  check("finds src/components", wiz.guessComponentsDir(root) === "src/components");
  mkdirSync(join(root, "src", "components", "ui"), { recursive: true });
  check("prefers the more specific ui folder", wiz.guessComponentsDir(root) === "src/components/ui");
  rmSync(root, { recursive: true, force: true });
  const s = wiz.newWizardState();
  const empty = wiz.wizardSummary(s, "p");
  check("empty summary lists what is left", empty.includes("Register a design system") && empty.includes("Restart your client"));
  s.anthropicKey = "valid";
  s.clientConnected = true;
  s.skill = "installed";
  s.designSystem = { source: "src/components", candidateCount: 7 };
  const done = wiz.wizardSummary(s, "p");
  check("complete summary shows count and a try-it line", done.includes("7 components") && done.includes("Try it"));
  check("key, client and design system = 3 of 5 (figma not yet answered, enforcement off)", done.includes("Setup: 3 of 5 steps done"));
  s.figmaNotNeeded = true;
  check("key, no-figma, client and design system = 4 of 5", wiz.wizardSummary(s, "p").includes("Setup: 4 of 5 steps done"));
  s.gate = "set up";
  check("all five = 5 of 5", wiz.wizardSummary(s, "p").includes("Setup: 5 of 5 steps done"));
  check("empty state = 0 of 5", empty.includes("Setup: 0 of 5 steps done"));
}

console.log("4. real init: register a components folder, no enforcement");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-wiz-root-"));
  const home = mkdtempSync(join(tmpdir(), "pattern-wiz-home-"));
  mkdirSync(join(root, ".cursor"), { recursive: true });
  mkdirSync(join(root, "src", "components"), { recursive: true });
  writeFileSync(join(root, "src", "components", "Button.tsx"), "export function Button(props: { label: string }) { return <button>{props.label}</button>; }\n");
  writeFileSync(join(root, "src", "components", "Modal.tsx"), "export function Modal(props: { open: boolean }) { return props.open ? <div role=\"dialog\" /> : null; }\n");
  // key: skip, figma: no, write cursor config: y, design system: default (2), path: default, enforcement: no
  const run = (stdin) =>
    spawnSync("node", [indexPath, "init"], {
      input: stdin,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, PATTERN_PROJECT_ROOT: root, HOME: home, PATTERN_TELEMETRY: "0", PATH: "/usr/bin:/bin", ANTHROPIC_API_KEY: "" },
    });
  const result = run("\n\ny\n\n\n\n");
  check("exits 0", result.status === 0);
  check("shows the five steps", result.stdout.includes("Pattern setup. Five short steps"));
  check("registers the folder", /Registered 2 components from src\/components/.test(result.stdout));
  const store = JSON.parse(readFileSync(join(home, ".pattern", "design_systems.json"), "utf8"));
  const ids = Object.keys(store);
  check("registration saved under one project id", ids.length === 1 && store[ids[0]].candidates.length === 2);
  check("summary marks client and design system done", result.stdout.includes("[x] 3. Client connected") && result.stdout.includes("[x] 4. Design system registered") && result.stdout.includes("Setup: 3 of 5 steps done"));
  check("enforcement offered and skipped by default", result.stdout.includes("Skipped. Turn it on any time"));
  check("did not write a gate hook", !/pattern-check-gate-hook/.test(result.stdout) && !(() => { try { readFileSync(join(root, ".claude", "settings.json")); return true; } catch { return false; } })());

  console.log("   rerun with a different source asks before replacing");
  mkdirSync(join(root, "other"), { recursive: true });
  writeFileSync(join(root, "other", "Card.tsx"), "export function Card() { return <div />; }\n");
  // skip key, no figma, (client already configured), choose 2, path other, then decline replace, no enforcement
  const rerun = run("\n\n2\nother\nn\n\n");
  check("rerun exits 0", rerun.status === 0);
  check("asks before replacing", rerun.stdout.includes("Replace it with this one?"));
  const after = JSON.parse(readFileSync(join(home, ".pattern", "design_systems.json"), "utf8"));
  check("declining leaves the old registration", after[ids[0]].candidates.length === 2);

  console.log("   path outside the project is refused");
  const outside = run("\n\n2\n/etc\n\n");
  check("refuses a path outside the project", outside.stdout.includes("outside the project"));
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

console.log("5. real init with a (fake) Anthropic: key checked, summaries written after consent");
{
  const { createServer } = await import("node:http");
  const { spawn } = await import("node:child_process");
  const seen = { models: 0, messages: 0, bodies: [] };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/v1/models")) {
        seen.models++;
        res.end(JSON.stringify({ data: [] }));
      } else {
        seen.messages++;
        seen.bodies.push(body);
        res.end(JSON.stringify({ content: [{ type: "text", text: "A stub summary of this component." }], usage: { input_tokens: 100, output_tokens: 20 } }));
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const root = mkdtempSync(join(tmpdir(), "pattern-wiz-root-"));
  const home = mkdtempSync(join(tmpdir(), "pattern-wiz-home-"));
  mkdirSync(join(root, ".cursor"), { recursive: true });
  mkdirSync(join(root, "src", "components"), { recursive: true });
  writeFileSync(join(root, "src", "components", "Button.tsx"), "export function Button(props: { label: string }) { return <button>{props.label}</button>; }\n");
  writeFileSync(join(root, "src", "components", "Modal.tsx"), "export function Modal(props: { open: boolean }) { return props.open ? <div role=\"dialog\" /> : null; }\n");
  // key, no figma, write cursor config, default ds choice, default path, summaries: yes, enforcement: no
  const runWith = (stdin, extra = {}) =>
    new Promise((resolve) => {
      const p = spawn("node", [indexPath, "init"], {
        env: { ...process.env, PATTERN_PROJECT_ROOT: root, HOME: home, PATTERN_TELEMETRY: "0", PATH: "/usr/bin:/bin", ANTHROPIC_API_KEY: "", PATTERN_ANTHROPIC_URL: base, PATTERN_SUMMARY_API_URL: `${base}/v1/messages`, ...extra },
      });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (out += d));
      p.on("close", (code) => resolve({ code, out }));
      p.stdin.end(stdin);
    });
  const r = await runWith("sk-ant-fake-key\n\ny\n\n\n\n\n");
  check("exits 0", r.code === 0);
  check("key was checked against the API", seen.models === 1 && r.out.includes("accepted by the Anthropic API"));
  check("disclosure shown before summaries", r.out.includes("sends up to 8000 characters"));
  check("one summary call per component", seen.messages === 2);
  check("reports summaries written", /Wrote 2 summaries/.test(r.out));
  const store = JSON.parse(readFileSync(join(home, ".pattern", "design_systems.json"), "utf8"));
  const cands = Object.values(store)[0].candidates;
  check("summaries saved on the registration", cands.length === 2 && cands.every((c) => typeof c.summary === "string" && c.summary.includes("stub summary")));
  check("summary line in the checklist", r.out.includes("2 summarised"));
  const cfg = JSON.parse(readFileSync(join(root, ".cursor", "mcp.json"), "utf8"));
  check("key written to the client config", cfg.mcpServers.pattern.env.ANTHROPIC_API_KEY === "sk-ant-fake-key");

  console.log("   declining summaries sends nothing");
  rmSync(join(home, ".pattern"), { recursive: true, force: true });
  const before = seen.messages;
  const d = await runWith("sk-ant-fake-key\n\n\n\nn\n\n");
  check("no summary calls when declined", seen.messages === before);
  check("registered without summaries", /Registered 2 components/.test(d.out) && !d.out.includes("Wrote "));
  server.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
