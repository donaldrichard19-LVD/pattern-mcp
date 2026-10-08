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
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SKILL_NAME } from "./agent-guidance.js";
import { deriveProjectId } from "./project-id.js";
import { findPatternEntry, patternServersInClaudeList, type ClaudeListServer } from "./server-entry.js";
import { askLine, closeRl, confirm, type PromptOptions } from "./prompt.js";
import { runInit } from "./init-enforcement.js";
import {
  newWizardState,
  runDesignSystemStep,
  runKeysSteps,
  WIZARD_STEPS,
  wizardIntro,
  wizardSummary,
  type WizardDeps,
  type WizardEnv,
  type WizardState,
} from "./setup-wizard.js";

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

// Pattern servers Claude Code already has, under ANY name (a hand-made entry
// for a dev checkout is "connected" too), with whether each one is healthy.
function claudeCodePatternServers(): ClaudeListServer[] {
  try {
    const out = execFileSync("claude", ["mcp", "list"], {
      // `claude mcp list` health-checks every registered server, i.e. starts
      // Pattern -- tag those starts so they don't read as real usage.
      env: { ...process.env, PATTERN_FROM_INIT: "1" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    });
    return patternServersInClaudeList(out);
  } catch {
    return [];
  }
}

async function setupClaudeCode(env: WizardEnv, options: ConnectOptions, state: WizardState): Promise<void> {
  if (!hasCommand("claude")) return;
  console.log("\nClaude Code detected (`claude` on PATH).");

  const existing = claudeCodePatternServers();
  if (existing.length > 0) {
    const names = existing.map((s) => `"${s.name}"`).join(", ");
    if (existing.some((s) => s.ok)) {
      console.log(`  Already connected (\`claude mcp list\` shows Pattern as ${names}) -- skipping.`);
      state.clientConnected = true;
    } else {
      console.log(
        `  Pattern is already registered as ${names}, but Claude Code reports it failed to connect.\n` +
          "  Not adding a second server. Run `npx -p pattern-mcp pattern doctor` to see why; the usual cause is a\n" +
          "  local checkout without node_modules. To use the published package instead, re-add it under the same name:\n" +
          `    claude mcp remove ${existing[0].name} -s user && claude mcp add -s user ${existing[0].name} -- npx --yes pattern-mcp@latest\n` +
          "  (add -e ANTHROPIC_API_KEY=... and any other keys it had).",
      );
    }
    return;
  }

  const everywhere = await confirm(
    "  Make Pattern available in every Claude Code project, not just this one?",
    options,
    true,
  );

  const args = ["mcp", "add", "pattern"];
  for (const [k, v] of Object.entries(env)) args.push("-e", `${k}=${v}`);
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
    state.clientConnected = true;
  } catch {
    console.log("  `claude mcp add` failed -- see output above, or add it manually (README's Claude Code section).");
  }
}

// The Claude Code skill that makes the agent reach for Pattern on its own when
// it is about to build UI (see agent-guidance.ts). Installed per user so it
// applies in every project; SKILL.md ships in the package root and is the
// single source (it is also the repo's tool-orientation doc).
export function packagedSkillPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "SKILL.md");
}

/**
 * Copies SKILL.md to <home>/.claude/skills/pattern/SKILL.md after confirming.
 * Never overwrites a file that is not a Pattern skill; replaces an older
 * Pattern one only when the content differs. Returns what happened.
 */
export async function installPatternSkill(
  options: ConnectOptions,
  home: string = homedir(),
): Promise<"installed" | "updated" | "current" | "skipped" | "foreign" | "missing"> {
  const source = packagedSkillPath();
  if (!existsSync(source)) return "missing";
  const body = readFileSync(source, "utf8");
  const target = join(home, ".claude", "skills", SKILL_NAME, "SKILL.md");

  let existing: string | null = null;
  try {
    existing = readFileSync(target, "utf8");
  } catch {
    // not installed yet
  }
  if (existing !== null) {
    if (!new RegExp(`^---[\\s\\S]*?\\nname:\\s*${SKILL_NAME}\\s*\\n`).test(existing)) {
      console.log(`  ${target} exists and is not a Pattern skill -- leaving it alone.`);
      return "foreign";
    }
    if (existing === body) {
      console.log("  Pattern skill already installed and current.");
      return "current";
    }
  }

  console.log(
    "\nPattern skill: lets Claude Code use Pattern on its own when it is about to build UI,\n" +
      "so you never have to say \"use Pattern\".",
  );
  const ok = await confirm(
    `  ${existing === null ? "Install" : "Update"} it at ${target}?`,
    options,
    true,
  );
  if (!ok) {
    console.log("  Skipped.");
    return "skipped";
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body, "utf8");
  console.log("  Written. Restart Claude Code so it picks up the skill.");
  return existing === null ? "installed" : "updated";
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
  env: WizardEnv,
  options: ConnectOptions,
  state: WizardState,
): Promise<void> {
  const { config, existed, valid } = readJsonConfig(path);
  if (existed && !valid) {
    console.log(`\n${label}: ${path} exists but isn't valid JSON -- skipping, fix it manually first.`);
    return;
  }

  const servers = { ...(config.mcpServers ?? {}) } as Record<string, unknown>;
  const already = findPatternEntry(servers);
  if (already) {
    console.log(`\n${label}: Pattern already configured in ${path} (as "${already.name}") -- skipping.`);
    state.clientConnected = true;
    return;
  }

  const entry: Record<string, unknown> = { command: SERVER_COMMAND, args: [...SERVER_ARGS] };
  if (Object.keys(env).length > 0) entry.env = { ...env };

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
  state.clientConnected = true;
}

function clientConfigHasPattern(path: string | null): boolean {
  if (!path) return false;
  const { config } = readJsonConfig(path);
  return findPatternEntry(config.mcpServers) !== null;
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
    claudeCodePatternServers().length > 0 ||
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

async function setupClaudeDesktop(env: WizardEnv, options: ConnectOptions, state: WizardState): Promise<void> {
  const path = claudeDesktopConfigPath();
  if (!path) return;
  // Only offer this if Claude Desktop's own config directory already
  // exists -- the strongest available signal it's actually installed,
  // without a CLI to query directly (unlike Claude Code's `claude
  // --version`).
  if (!existsSync(dirname(path))) return;
  await mergeServerConfig("Claude Desktop", path, env, options, state);
}

// Cursor has no CLI to query and no reliable global config location
// across platforms, so this uses the same detection init-enforcement.ts
// uses for "has this repo used X before": a project-level `.cursor/`
// directory already present is real evidence Cursor has opened this
// project, without guessing at a global install marker that doesn't
// exist. Project-scoped `.cursor/mcp.json`, matching the README.
async function setupCursor(root: string, env: WizardEnv, options: ConnectOptions, state: WizardState): Promise<void> {
  if (!existsSync(join(root, ".cursor"))) return;
  await mergeServerConfig("Cursor", join(root, ".cursor", "mcp.json"), env, options, state);
}

// Codex CLI's global config is TOML (~/.codex/config.toml), which this
// deliberately does not hand-edit -- no TOML writer is already a
// dependency here, and getting a partial/lossy rewrite wrong on someone's
// existing config is worse than just telling them what to add. Detected
// the same way as the other targets (evidence it's actually used), but
// only ever prints instructions.
//
// Deliberately does NOT print a per-server `env = {...}` TOML snippet for
// the API key, unlike the command/args lines above -- checked directly
// (openai/codex#7521, open as of 2026-09): Codex's own maintainers hadn't
// settled which env-var syntax their TOML config actually supports at the
// time this was written. Printing a guessed snippet risked giving
// confidently wrong instructions, worse than the honest "it depends on
// your version, here's what works regardless" below. A plain shell
// export is the one method that works the same way across every Codex
// version and every other client here, since it never depends on a
// client-specific config format at all.
function offerCodexInstructions(env: WizardEnv): void {
  const apiKey = env.ANTHROPIC_API_KEY ?? null;
  if (!existsSync(join(homedir(), ".codex"))) return;
  const lines = [
    "\nCodex CLI detected (~/.codex exists). Pattern doesn't auto-write Codex's",
    "TOML config -- add this to ~/.codex/config.toml (or .codex/config.json for",
    "this project only):",
    "",
    '  [mcp_servers.pattern]',
    '  command = "npx"',
    '  args = ["pattern-mcp"]',
    "",
  ];
  if (apiKey) {
    lines.push(
      "You entered an API key above. Codex's own per-server TOML env syntax isn't",
      "reliably documented across versions, so the safest way to get it to Codex",
      "is exporting it in the shell you launch Codex from:",
      "",
      `  export ANTHROPIC_API_KEY="${apiKey}"`,
    );
  } else {
    lines.push(
      "Codex also needs ANTHROPIC_API_KEY available in its own environment.",
      "Export it in the shell you launch Codex from:",
      "",
      "  export ANTHROPIC_API_KEY=sk-ant-...",
    );
  }
  console.log(lines.join("\n"));
}

// Proves the server this install would launch can actually start and speak
// MCP, independent of any client's config: spawn it the way a client would,
// complete initialize, list tools. A "Connected" message from `claude mcp
// add` only means a config entry was written. Telemetry is off in the child
// so the check never counts as usage, and the prompts are suppressed so it
// can't block on them.
export async function selfTestServer(timeoutMs = 20000): Promise<boolean> {
  const entry = process.argv[1];
  if (!entry) return false;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: {
      ...(process.env as Record<string, string>),
      PATTERN_TELEMETRY: "0",
      PATTERN_FROM_INIT: "1",
      PATTERN_NO_CONNECT_NOTICE: "1",
      PATTERN_NO_ENFORCEMENT_NOTICE: "1",
    },
    stderr: "ignore",
  });
  const client = new Client({ name: "pattern-init-selftest", version: "1.0.0" });
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      (async () => {
        await client.connect(transport);
        const { tools } = await client.listTools();
        if (tools.length === 0) throw new Error("no tools");
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

export interface RunConnectExtras {
  /** Design-system registration + project id for the guided steps; without it those steps are skipped. */
  wizard?: WizardDeps;
  fetchImpl?: typeof fetch;
  /** Overridable in tests; `false` skips the startup check. */
  selfTest?: (() => Promise<boolean>) | false;
}

export async function runConnect(root: string, options: ConnectOptions, extras: RunConnectExtras = {}): Promise<WizardState> {
  const state = newWizardState();
  const wizard = extras.wizard;
  console.log(options.yes ? "Connecting Pattern to your MCP client(s)..." : wizardIntro());

  try {
    const env = await runKeysSteps(options, state, extras.fetchImpl);

    if (!options.yes) console.log(`\n[3/${WIZARD_STEPS}] Connect your client`);
    let anyDetected = false;
    if (hasCommand("claude")) {
      anyDetected = true;
      await setupClaudeCode(env, options, state);
      state.skill = await installPatternSkill(options);
    }
    if (claudeDesktopConfigPath() && existsSync(dirname(claudeDesktopConfigPath()!))) {
      anyDetected = true;
      await setupClaudeDesktop(env, options, state);
    }
    if (existsSync(join(root, ".cursor"))) {
      anyDetected = true;
      await setupCursor(root, env, options, state);
    }
    if (existsSync(join(homedir(), ".codex"))) {
      anyDetected = true;
      offerCodexInstructions(env);
    }

    if (!anyDetected) {
      console.log(
        "\nNo supported MCP client was detected on this machine automatically.\n" + connectInstructionsText(),
      );
    }

    if (state.clientConnected && extras.selfTest !== false) {
      process.stdout.write("\nChecking that Pattern starts and answers on its own... ");
      state.selfTest = (await (extras.selfTest ?? selfTestServer)()) ? "passed" : "failed";
      console.log(state.selfTest === "passed" ? "ok." : "FAILED.");
    }

    if (wizard) {
      await runDesignSystemStep(root, wizard, env, state, options);
      if (!options.yes) {
        console.log(`\n[5/${WIZARD_STEPS}] Enforcement (optional)`);
        console.log("  A project hook plus a CI check that stops a new component shipping without a recorded Pattern decision.");
        if (await confirm("  Set that up now?", options, false)) {
          await runInit(root, options);
          state.gate = "set up";
        } else {
          state.gate = "skipped";
          console.log("  Skipped. Turn it on any time with: npx -p pattern-mcp pattern-check-gate init");
        }
      }
    }
  } finally {
    closeRl();
  }

  console.log(wizardSummary(state, wizard?.projectId ?? deriveProjectId(root)));
  return state;
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
