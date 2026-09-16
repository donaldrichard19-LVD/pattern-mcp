// `pattern-mcp init` -- closes the gap between "downloaded Pattern" and
// "actually connected it to an MCP client," which is the step where
// someone can first see real value (a real recommend_component call in
// their own agent). See project_pattern_reddit_launch_spike memory: a
// 2026-09-11 download spike showed almost no matching growth in real MCP
// handshakes, and the most likely reason is that `npx pattern-mcp` run
// bare in a terminal (the natural first thing a curious downloader does)
// never gets any further than a process sitting on stdin waiting for a
// client that was never configured to connect to it.
//
// Same shape as init-enforcement.ts's `pattern-check-gate init`
// (detect state, show what would change, confirm each step
// independently, never silently overwrite) and shares its prompt
// plumbing (prompt.ts) rather than reimplementing it.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { askLine, closeRl, confirm, type PromptOptions } from "./prompt.js";

export type ConnectOptions = PromptOptions;

const SERVER_COMMAND = "npx" as const;
const SERVER_ARGS = ["pattern-mcp"] as const;

// The same plain-language pointer shown in three places: the TTY-only
// one-time notice, the idle nudge if no client ever connects, and the
// init wizard's fallback when no supported client was detected at all.
export function connectInstructionsText(): string {
  return [
    "Pattern only does something once it's connected to an MCP client --",
    "on its own it's just a process waiting on stdin. Two ways to fix that:",
    "",
    "  1. Run the setup wizard:  npx pattern-mcp init",
    "  2. Or connect it by hand -- see",
    "     https://github.com/donaldrichard19-LVD/pattern-mcp#connect-pattern-to-your-mcp-client",
  ].join("\n");
}

function hasCommand(cmd: string, versionFlag = "--version"): boolean {
  try {
    execFileSync(cmd, [versionFlag], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function claudeCodeAlreadyConnected(): boolean {
  try {
    const out = execFileSync("claude", ["mcp", "list"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    });
    return /^pattern\b/m.test(out);
  } catch {
    return false;
  }
}

async function setupClaudeCode(apiKey: string | null, options: ConnectOptions): Promise<void> {
  if (!hasCommand("claude")) return;
  console.log("\nClaude Code detected (`claude` on PATH).");

  if (claudeCodeAlreadyConnected()) {
    console.log("  Already connected (`claude mcp list` shows pattern) -- skipping.");
    return;
  }

  const everywhere = await confirm(
    "  Make Pattern available in every Claude Code project, not just this one?",
    options,
    true,
  );

  const args = ["mcp", "add", "pattern"];
  if (apiKey) args.push("-e", `ANTHROPIC_API_KEY=${apiKey}`);
  if (everywhere) args.push("--scope", "user");
  args.push("--", SERVER_COMMAND, ...SERVER_ARGS);

  console.log(`  Running: claude ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`);
  const proceed = await confirm("  Proceed?", options, true);
  if (!proceed) {
    console.log("  Skipped.");
    return;
  }

  try {
    execFileSync("claude", args, { stdio: "inherit", timeout: 15000 });
    console.log("  Connected. Verify with `claude mcp list`.");
  } catch {
    console.log("  `claude mcp add` failed -- see output above, or add it manually (README's Claude Code section).");
  }
}

interface McpServersConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

function readJsonConfig(path: string): { config: McpServersConfig; existed: boolean; valid: boolean } {
  if (!existsSync(path)) return { config: {}, existed: false, valid: true };
  try {
    return { config: JSON.parse(readFileSync(path, "utf8")) as McpServersConfig, existed: true, valid: true };
  } catch {
    return { config: {}, existed: true, valid: false };
  }
}

// Shared by Claude Desktop and Cursor -- both use the same
// `{"mcpServers": {"<name>": {command, args, env?}}}` shape. Never
// touches any other key in the file, and never overwrites an existing
// "pattern" entry without an explicit confirm, same discipline as
// init-enforcement.ts's setupClaudeSettings.
async function mergeServerConfig(
  label: string,
  path: string,
  apiKey: string | null,
  options: ConnectOptions,
): Promise<void> {
  const { config, existed, valid } = readJsonConfig(path);
  if (existed && !valid) {
    console.log(`\n${label}: ${path} exists but isn't valid JSON -- skipping, fix it manually first.`);
    return;
  }

  const servers = { ...(config.mcpServers ?? {}) } as Record<string, unknown>;
  if (servers.pattern) {
    console.log(`\n${label}: pattern already configured in ${path} -- skipping.`);
    return;
  }

  const entry: Record<string, unknown> = { command: SERVER_COMMAND, args: [...SERVER_ARGS] };
  if (apiKey) entry.env = { ANTHROPIC_API_KEY: apiKey };

  console.log(`\n${existed ? "Merging into" : "Creating"} ${label} config at ${path}:`);
  console.log(
    JSON.stringify({ pattern: entry }, null, 2)
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n"),
  );
  const proceed = await confirm("Write this?", options, true);
  if (!proceed) {
    console.log("Skipped.");
    return;
  }

  const merged: McpServersConfig = { ...config, mcpServers: { ...servers, pattern: entry } };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(merged, null, 2) + "\n", "utf8");
  console.log(`Written. Restart ${label} to pick it up.`);
}

function clientConfigHasPattern(path: string | null): boolean {
  if (!path) return false;
  const { config } = readJsonConfig(path);
  return Boolean((config.mcpServers as Record<string, unknown> | undefined)?.pattern);
}

// Best-effort, read-only check across every client Pattern knows how to
// detect a prior successful setup for -- used to decide whether to keep
// offering the connect wizard on a later bare run (see
// offerClientConnectSetupOnce below), instead of asking only once ever
// regardless of outcome. Codex is deliberately excluded: its config is
// TOML, which this project never parses or writes (see
// offerCodexInstructions), so there's no way to confirm a Codex-only
// setup from here. That means a Codex-only user keeps getting offered
// the wizard -- a false negative, which is the safe failure mode (asks
// again when already connected) rather than a false positive (goes quiet
// when it isn't).
export function isAnyClientConnected(root: string): boolean {
  return (
    claudeCodeAlreadyConnected() ||
    clientConfigHasPattern(claudeDesktopConfigPath()) ||
    clientConfigHasPattern(join(root, ".cursor", "mcp.json"))
  );
}

// Claude Desktop isn't shipped on Linux -- there's no config path to
// even guess at there, so this target is simply not offered on that
// platform rather than writing a file no client will ever read.
function claudeDesktopConfigPath(): string | null {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    case "win32":
      return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
    default:
      return null;
  }
}

async function setupClaudeDesktop(apiKey: string | null, options: ConnectOptions): Promise<void> {
  const path = claudeDesktopConfigPath();
  if (!path) return;
  // Only offer this if Claude Desktop's own config directory already
  // exists -- the strongest available signal it's actually installed,
  // without a CLI to query directly (unlike Claude Code's `claude
  // --version`).
  if (!existsSync(dirname(path))) return;
  await mergeServerConfig("Claude Desktop", path, apiKey, options);
}

// Cursor has no CLI to query and no reliable global config location
// across platforms, so this uses the same detection init-enforcement.ts
// uses for "has this repo used X before": a project-level `.cursor/`
// directory already present is real evidence Cursor has opened this
// project, without guessing at a global install marker that doesn't
// exist. Project-scoped `.cursor/mcp.json`, matching the README.
async function setupCursor(root: string, apiKey: string | null, options: ConnectOptions): Promise<void> {
  if (!existsSync(join(root, ".cursor"))) return;
  await mergeServerConfig("Cursor", join(root, ".cursor", "mcp.json"), apiKey, options);
}

// Codex CLI's global config is TOML (~/.codex/config.toml), which this
// deliberately does not hand-edit -- no TOML writer is already a
// dependency here, and getting a partial/lossy rewrite wrong on someone's
// existing config is worse than just telling them what to add. Detected
// the same way as the other targets (evidence it's actually used), but
// only ever prints instructions.
function offerCodexInstructions(): void {
  if (!existsSync(join(homedir(), ".codex"))) return;
  console.log(
    [
      "\nCodex CLI detected (~/.codex exists). Pattern doesn't auto-write Codex's",
      "TOML config -- add this to ~/.codex/config.toml (or .codex/config.json for",
      "this project only):",
      "",
      '  [mcp_servers.pattern]',
      '  command = "npx"',
      '  args = ["pattern-mcp"]',
    ].join("\n"),
  );
}

async function promptApiKey(options: ConnectOptions): Promise<string | null> {
  if (options.yes) return null;
  console.log(
    "\nYour ANTHROPIC_API_KEY can be written into whichever client configs you set up\n" +
      "below (visible in plain text there and as you type it now), or you can skip\n" +
      "and add it yourself later -- see README's \"Add your Anthropic API key\".",
  );
  const answer = (await askLine("Paste your ANTHROPIC_API_KEY now, or press Enter to skip: ")).trim();
  return answer || null;
}

export async function runConnect(root: string, options: ConnectOptions): Promise<void> {
  console.log("Connecting Pattern to your MCP client(s)...");

  try {
    const apiKey = await promptApiKey(options);

    let anyDetected = false;
    if (hasCommand("claude")) {
      anyDetected = true;
      await setupClaudeCode(apiKey, options);
    }
    if (claudeDesktopConfigPath() && existsSync(dirname(claudeDesktopConfigPath()!))) {
      anyDetected = true;
      await setupClaudeDesktop(apiKey, options);
    }
    if (existsSync(join(root, ".cursor"))) {
      anyDetected = true;
      await setupCursor(root, apiKey, options);
    }
    if (existsSync(join(homedir(), ".codex"))) {
      anyDetected = true;
      offerCodexInstructions();
    }

    if (!anyDetected) {
      console.log(
        "\nNo supported MCP client was detected on this machine automatically.\n" + connectInstructionsText(),
      );
    }
  } finally {
    closeRl();
  }

  console.log("\nDone. Ask your agent to list its MCP tools and look for recommend_component.");
}

// Option 1/#1 from the activation-funnel discussion: piggybacks on the
// same first-run moment as the telemetry and enforcement-boundary
// notices (see telemetry.ts's printTelemetryNoticeOnce, which states the
// stdin constraint first). Always prints the full notice once, ever --
// including when a real MCP client has spawned this as a subprocess,
// where it's genuinely irrelevant but harmless, since the notice is
// gated on a marker file the same as the others.
//
// The interactive "set it up now?" prompt is different: it used to be
// gated on that same one-time marker, so a human who ignored or missed
// it on the very first bare run never saw it again -- a permanent
// drop-off with no second chance, found while mapping the new-install
// journey (see project_pattern_activation_funnel memory). It now keeps
// reappearing on every bare TTY run -- a human running `npx pattern-mcp`
// in their own shell, never a real client's spawned subprocess -- for as
// long as isAnyClientConnected() can't confirm a real connection exists
// yet. This is the concrete fix for "don't rely on the user to figure
// out how to connect": Pattern keeps offering, not just once, until it
// can verify success, or until PATTERN_NO_CONNECT_NOTICE opts out.
const CONNECT_NOTICE_PATH =
  process.env.PATTERN_CONNECT_NOTICE_PATH ?? join(homedir(), ".pattern", "connect_notice_shown");

export async function offerClientConnectSetupOnce(root: string): Promise<void> {
  if (process.env.PATTERN_NO_CONNECT_NOTICE) return;

  let noticeAlreadyShown = true;
  try {
    readFileSync(CONNECT_NOTICE_PATH, "utf8");
  } catch {
    noticeAlreadyShown = false;
  }

  if (!noticeAlreadyShown) {
    console.error(["", "Pattern -- one-time setup notice (this will not print again)", connectInstructionsText(), ""].join("\n"));
    try {
      mkdirSync(dirname(CONNECT_NOTICE_PATH), { recursive: true });
      writeFileSync(CONNECT_NOTICE_PATH, new Date().toISOString(), "utf8");
    } catch {
      // Couldn't persist the marker -- worst case this prints again next
      // run. Never blocks startup over it, same as the other notices.
    }
  }

  if (!process.stdin.isTTY) return;
  if (isAnyClientConnected(root)) return;

  try {
    const question = noticeAlreadyShown
      ? "No MCP client is connected to Pattern yet -- run the connect wizard now?"
      : "Run the connect wizard now?";
    const setUpNow = await confirm(question, { yes: false }, true);
    if (setUpNow) {
      await runConnect(root, { yes: false }); // closes the shared readline itself
    }
  } finally {
    closeRl();
  }
}
