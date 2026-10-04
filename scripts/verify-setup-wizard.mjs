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
check("figma valid", (await wiz.checkFigmaToken("figd_abc", fakeFetch(200))).status === "valid");
check("figma 403 invalid", (await wiz.checkFigmaToken("figd_abc", fakeFetch(403))).status === "invalid");
check("figma wrong prefix invalid", (await wiz.checkFigmaToken("abc", throwingFetch)).status === "invalid");
check("figma with space invalid", (await wiz.checkFigmaToken("figd_a bc", throwingFetch)).status === "invalid");
check("figma offline unverified", (await wiz.checkFigmaToken("figd_abc", throwingFetch)).status === "unverified");

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
  check("summary marks client and design system done", result.stdout.includes("[x] Client connected") && result.stdout.includes("[x] Design system registered"));
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

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
