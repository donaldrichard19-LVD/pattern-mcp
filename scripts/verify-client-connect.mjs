#!/usr/bin/env node
/**
 * verify-client-connect.mjs
 *
 * Standalone check for the activation-funnel work: `pattern_cli_started`
 * telemetry (telemetry.ts), the one-time connect notice
 * (offerClientConnectSetupOnce), and the `pattern-mcp init` wizard
 * (client-connect.ts) -- spawned as real subprocesses against a temp
 * scratch HOME/project root, never the real ~/.pattern or a real client
 * config.
 *
 * Run: node scripts/verify-client-connect.mjs (after `npm run build`)
 * Exits non-zero on any failed assertion.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ok: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

const indexPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const clientConnectPath = fileURLToPath(new URL("../dist/client-connect.js", import.meta.url));
const telemetryPath = fileURLToPath(new URL("../dist/telemetry.js", import.meta.url));

// Deliberately excludes the real `claude` CLI's directory (~/.local/bin
// on this machine) -- these tests must never shell out to the real
// `claude` on the machine running them, which would read (`mcp list`) or
// worse, write (`mcp add`) this machine's actual Claude Code config.
// Confirmed node itself lives in a separate system dir, so this doesn't
// also break spawning node.
const ISOLATED_PATH = "/usr/bin:/bin";

function runInit(root, home, extraArgs = [], stdin = "") {
  return spawnSync("node", [indexPath, "init", ...extraArgs], {
    input: stdin,
    encoding: "utf8",
    timeout: 5000,
    env: {
      ...process.env,
      PATTERN_PROJECT_ROOT: root,
      HOME: home,
      PATTERN_TELEMETRY: "0",
      PATH: ISOLATED_PATH,
      // Never a TTY under spawnSync's piped stdio anyway, but explicit
      // for anyone reading this later.
    },
  });
}

function scratch() {
  const root = mkdtempSync(join(tmpdir(), "pattern-connect-test-root-"));
  const home = mkdtempSync(join(tmpdir(), "pattern-connect-test-home-"));
  return { root, home };
}

function cleanup(root, home) {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

console.log("1. captureCliStarted never throws, telemetry on or off");
{
  const scriptPath = join(tmpdir(), "pattern-cli-started-test.mjs");
  writeFileSync(
    scriptPath,
    [
      `const { captureCliStarted } = await import(${JSON.stringify(telemetryPath)});`,
      'captureCliStarted("server");',
      'captureCliStarted("init");',
      'console.log("DONE");',
    ].join("\n"),
    "utf8",
  );
  const off = spawnSync("node", [scriptPath], {
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, PATTERN_TELEMETRY: "0" },
  });
  check("with telemetry off: exits cleanly", off.stdout.includes("DONE"));
  check("with telemetry off: no crash", off.status === 0);

  const on = spawnSync("node", [scriptPath], {
    encoding: "utf8",
    timeout: 5000,
    // Deliberately still off for the "on" case too -- this only checks
    // that going through getClient()'s real construction path (posthog-node
    // actually instantiated) doesn't throw before the first flush; it does
    // not assert a real network call succeeds, which would make this test
    // flaky and dependent on outbound network access. This script never
    // calls shutdownTelemetry() or process.exit() itself (unlike every
    // real call site), so posthog-node's client legitimately keeps the
    // process alive afterward -- same as pattern-mcp's own server mode,
    // which is meant to stay running -- hence the timeout kill below is
    // expected, not a bug.
    env: { ...process.env, PATTERN_TELEMETRY: "1", PATTERN_POSTHOG_HOST: "http://127.0.0.1:1" },
  });
  check("with telemetry on (unreachable host): capture() itself didn't throw before DONE printed", on.stdout.includes("DONE"));
  rmSync(scriptPath, { force: true });
}

console.log("1b. shutdownTelemetry: always resolves promptly even against an unreachable host");
{
  const scriptPath = join(tmpdir(), "pattern-shutdown-timeout-test.mjs");
  writeFileSync(
    scriptPath,
    [
      `const { captureCliStarted, shutdownTelemetry } = await import(${JSON.stringify(telemetryPath)});`,
      'captureCliStarted("init");',
      "const t0 = Date.now();",
      "await shutdownTelemetry();",
      'console.log("SHUTDOWN_MS", Date.now() - t0);',
    ].join("\n"),
    "utf8",
  );
  const result = spawnSync("node", [scriptPath], {
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, PATTERN_TELEMETRY: "1", PATTERN_POSTHOG_HOST: "http://127.0.0.1:1" },
  });
  const match = result.stdout.match(/SHUTDOWN_MS (\d+)/);
  check("shutdown() call itself resolved (didn't hang forever)", !!match);
  check("resolved within ~2.5s bound, not stalled on the unreachable host", !!match && Number(match[1]) < 2500);
  rmSync(scriptPath, { force: true });
}

console.log("2. offerClientConnectSetupOnce: prints once, not twice");
{
  const { root, home } = scratch();
  const markerPath = join(root, "connect_notice_marker");
  const scriptPath = join(tmpdir(), "pattern-connect-notice-test.mjs");
  writeFileSync(
    scriptPath,
    [
      'process.stdin.isTTY = false;',
      `const { offerClientConnectSetupOnce } = await import(${JSON.stringify(clientConnectPath)});`,
      `await offerClientConnectSetupOnce(${JSON.stringify(root)});`,
      'console.log("CALL_ONE_DONE");',
      `await offerClientConnectSetupOnce(${JSON.stringify(root)});`,
      'console.log("CALL_TWO_DONE");',
    ].join("\n"),
    "utf8",
  );
  const result = spawnSync("node", [scriptPath], {
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, PATTERN_CONNECT_NOTICE_PATH: markerPath },
  });
  check("both calls complete without hanging", result.stdout.includes("CALL_TWO_DONE"));
  const noticeCount = (result.stderr.match(/one-time setup notice/g) || []).length;
  check("notice printed on the first call", noticeCount >= 1);
  check("notice not printed again on the second call", noticeCount === 1);
  check("marker file was written", existsSync(markerPath));
  rmSync(scriptPath, { force: true });
  cleanup(root, home);
}

console.log("3. offerClientConnectSetupOnce: PATTERN_NO_CONNECT_NOTICE skips entirely");
{
  const { root, home } = scratch();
  const markerPath = join(root, "connect_notice_marker");
  const scriptPath = join(tmpdir(), "pattern-connect-notice-skip-test.mjs");
  writeFileSync(
    scriptPath,
    [
      'process.stdin.isTTY = false;',
      `const { offerClientConnectSetupOnce } = await import(${JSON.stringify(clientConnectPath)});`,
      `await offerClientConnectSetupOnce(${JSON.stringify(root)});`,
      'console.log("DONE");',
    ].join("\n"),
    "utf8",
  );
  const result = spawnSync("node", [scriptPath], {
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, PATTERN_CONNECT_NOTICE_PATH: markerPath, PATTERN_NO_CONNECT_NOTICE: "1" },
  });
  check("completes without hanging", result.stdout.includes("DONE"));
  check("no notice printed", !result.stderr.includes("one-time setup notice"));
  check("no marker file written", !existsSync(markerPath));
  rmSync(scriptPath, { force: true });
  cleanup(root, home);
}

console.log("3b. offerClientConnectSetupOnce: keeps offering the wizard on later bare TTY runs, not just once");
{
  const { root, home } = scratch();
  const markerPath = join(root, "connect_notice_marker");
  const scriptPath = join(tmpdir(), "pattern-connect-repeat-offer-test.mjs");
  writeFileSync(
    scriptPath,
    [
      'process.stdin.isTTY = true;',
      `const { offerClientConnectSetupOnce } = await import(${JSON.stringify(clientConnectPath)});`,
      `await offerClientConnectSetupOnce(${JSON.stringify(root)});`,
      'console.log("CALL_ONE_DONE");',
      `await offerClientConnectSetupOnce(${JSON.stringify(root)});`,
      'console.log("CALL_TWO_DONE");',
    ].join("\n"),
    "utf8",
  );
  // Two piped answers, one per call: decline the wizard both times ("n").
  const result = spawnSync("node", [scriptPath], {
    input: "n\nn\n",
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, PATTERN_CONNECT_NOTICE_PATH: markerPath, PATTERN_PROJECT_ROOT: root, PATH: ISOLATED_PATH },
  });
  check("both calls complete without hanging", result.stdout.includes("CALL_TWO_DONE"));
  const promptCount = (result.stdout.match(/[Rr]un the connect wizard now\?/g) || []).length;
  check("prompted on the first call", promptCount >= 1);
  check("prompted again on the second call (this is the fix -- it used to go silent after one)", promptCount === 2);
  check("second prompt uses the 'no client connected yet' wording", result.stdout.includes("No MCP client is connected to Pattern yet"));
  rmSync(scriptPath, { force: true });
  cleanup(root, home);
}

console.log("3c. offerClientConnectSetupOnce: stops offering once a client is actually connected");
{
  const { root, home } = scratch();
  const markerPath = join(root, "connect_notice_marker");
  // Simulate a prior successful Cursor setup -- isAnyClientConnected()
  // should detect this and skip the prompt entirely, with no answer
  // needed on stdin at all (if it prompted anyway, this would hang and
  // the timeout below would fail the test).
  mkdirSync(join(root, ".cursor"), { recursive: true });
  writeFileSync(
    join(root, ".cursor", "mcp.json"),
    JSON.stringify({ mcpServers: { pattern: { command: "npx", args: ["pattern-mcp"] } } }, null, 2),
    "utf8",
  );
  const scriptPath = join(tmpdir(), "pattern-connect-already-done-test.mjs");
  writeFileSync(
    scriptPath,
    [
      'process.stdin.isTTY = true;',
      `const { offerClientConnectSetupOnce } = await import(${JSON.stringify(clientConnectPath)});`,
      `await offerClientConnectSetupOnce(${JSON.stringify(root)});`,
      'console.log("DONE");',
    ].join("\n"),
    "utf8",
  );
  const result = spawnSync("node", [scriptPath], {
    input: "",
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, PATTERN_CONNECT_NOTICE_PATH: markerPath, PATTERN_PROJECT_ROOT: root, PATH: ISOLATED_PATH },
  });
  check("completes without hanging (no prompt was waiting on stdin)", result.stdout.includes("DONE"));
  check("did not prompt -- a real connection was already detected", !/[Rr]un the connect wizard now\?/.test(result.stdout));
  rmSync(scriptPath, { force: true });
  cleanup(root, home);
}

console.log("4. pattern-mcp init: no client detected -> fallback instructions, exits cleanly");
{
  const { root, home } = scratch();
  const result = runInit(root, home, ["--yes"]);
  check("exits 0", result.status === 0);
  check("prints fallback instructions", result.stdout.includes("No supported MCP client was detected"));
  check("does not hang waiting on stdio (would have timed out above otherwise)", true);
  cleanup(root, home);
}

console.log("5. pattern-mcp init: writes Cursor config, preserves unrelated entries, skips API key when declined");
{
  const { root, home } = scratch();
  mkdirSync(join(root, ".cursor"), { recursive: true });
  writeFileSync(
    join(root, ".cursor", "mcp.json"),
    JSON.stringify({ mcpServers: { other: { command: "foo" } } }, null, 2),
    "utf8",
  );
  // Two piped lines: blank (skip API key), "y" (confirm the write).
  const result = runInit(root, home, [], "\ny\n");
  check("exits 0", result.status === 0);
  check("detected Cursor", result.stdout.includes("Cursor"));

  const written = JSON.parse(readFileSync(join(root, ".cursor", "mcp.json"), "utf8"));
  check("unrelated server entry preserved", written.mcpServers?.other?.command === "foo");
  check("pattern entry added", written.mcpServers?.pattern?.command === "npx");
  check("pattern args correct", JSON.stringify(written.mcpServers?.pattern?.args) === JSON.stringify(["pattern-mcp"]));
  check("no env block when API key was skipped", written.mcpServers?.pattern?.env === undefined);

  console.log("   rerun: idempotent, doesn't duplicate");
  const rerun = runInit(root, home, [], "\ny\n");
  check("rerun exits 0", rerun.status === 0);
  check("rerun reports already configured", rerun.stdout.includes("already configured"));
  const stillOne = JSON.parse(readFileSync(join(root, ".cursor", "mcp.json"), "utf8"));
  check("still exactly one pattern entry (no duplication)", stillOne.mcpServers?.pattern?.command === "npx");
  check("unrelated entry still intact after rerun", stillOne.mcpServers?.other?.command === "foo");

  cleanup(root, home);
}

console.log("6. pattern-mcp init: Codex detected -> prints instructions, writes nothing (TOML left alone)");
{
  const { root, home } = scratch();
  mkdirSync(join(home, ".codex"), { recursive: true });
  const result = runInit(root, home, ["--yes"]);
  check("exits 0", result.status === 0);
  check("detected Codex", result.stdout.includes("Codex CLI detected"));
  check("printed manual TOML snippet", result.stdout.includes("mcp_servers.pattern"));
  check("did not write a config.toml", !existsSync(join(home, ".codex", "config.toml")));
  check("no fallback 'not detected' message alongside a real detection", !result.stdout.includes("No supported MCP client was detected"));
  cleanup(root, home);
}

console.log("7. pattern-mcp init: with API key provided, writes it into the config");
{
  const { root, home } = scratch();
  mkdirSync(join(root, ".cursor"), { recursive: true });
  // Piped lines: the API key itself, then "y" to confirm the write.
  const result = runInit(root, home, [], "sk-ant-test-key\ny\n");
  check("exits 0", result.status === 0);
  const written = JSON.parse(readFileSync(join(root, ".cursor", "mcp.json"), "utf8"));
  check("API key written into env block", written.mcpServers?.pattern?.env?.ANTHROPIC_API_KEY === "sk-ant-test-key");
  cleanup(root, home);
}

console.log("8. pattern-mcp init: Codex + no key -> generic export reminder, no key leaked");
{
  const { root, home } = scratch();
  mkdirSync(join(home, ".codex"), { recursive: true });
  const result = runInit(root, home, ["--yes"]);
  check("exits 0", result.status === 0);
  check("prints the generic export reminder", result.stdout.includes("export ANTHROPIC_API_KEY=sk-ant-..."));
  check("does not claim a key was entered", !result.stdout.includes("You entered an API key above"));
  cleanup(root, home);
}

console.log("9. pattern-mcp init: Codex + a provided key -> echoes a ready-to-run export line");
{
  const { root, home } = scratch();
  mkdirSync(join(home, ".codex"), { recursive: true });
  // Piped: the API key itself. No client that writes a config file is
  // present, so there's no second "confirm write?" prompt to answer.
  const result = runInit(root, home, [], "sk-ant-codex-test-key\n");
  check("exits 0", result.status === 0);
  check("acknowledges a key was entered", result.stdout.includes("You entered an API key above"));
  check("echoes the real key in a copy-pasteable export line", result.stdout.includes('export ANTHROPIC_API_KEY="sk-ant-codex-test-key"'));
  cleanup(root, home);
}

console.log("10. recommend_component: a skip-list primitive succeeds with no ANTHROPIC_API_KEY set at all");
{
  const { root, home } = scratch();
  const transport = new StdioClientTransport({
    command: "node",
    args: [indexPath],
    env: {
      PATH: ISOLATED_PATH,
      HOME: home,
      PATTERN_PROJECT_ROOT: root,
      PATTERN_TELEMETRY: "0",
      // ANTHROPIC_API_KEY deliberately omitted -- this is the whole point.
    },
  });
  const client = new Client({ name: "verify-client-connect", version: "0.0.0" }, { capabilities: {} });
  await client.connect(transport);
  try {
    const skipListResult = await client.callTool({
      name: "recommend_component",
      arguments: { component_need: "button", domain: "test", framework: "React" },
    });
    check("skip-list call did not error", !skipListResult.isError);
    let parsed = null;
    try {
      parsed = JSON.parse(skipListResult.content?.[0]?.text ?? "");
    } catch {
      // handled by the check below
    }
    check("verdict is use_existing", parsed?.verdict === "use_existing");
    check("reason is skip_list -- confirms the free local path, not a lucky API success", parsed?.reason === "skip_list");

    const realCallResult = await client.callTool({
      name: "recommend_component",
      arguments: { component_need: "host earnings dashboard with payout history", domain: "test", framework: "React" },
    });
    check(
      "a real (non-skip-list) call still fails without a key, with the actionable message",
      realCallResult.isError && (realCallResult.content?.[0]?.text ?? "").includes("re-run `npx pattern-mcp init`"),
    );
  } finally {
    await client.close();
  }
  cleanup(root, home);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
}
