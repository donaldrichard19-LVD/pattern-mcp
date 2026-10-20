// `npx pattern-mcp keys` -- add or change the API keys Pattern runs with.
//
// Pattern reads its keys from the env block of the MCP client's config for it, never from
// the shell or a project .env, and re-running `init` skips an already-registered entry. So
// without this, someone who connected Pattern without a key (or pasted a bad one) has no
// command that fixes it. This finds every client entry for Pattern and writes the keys into
// it. Keys are typed with the input hidden, and are never sent through the agent or chat.

import { join } from "node:path";
import { existsSync } from "node:fs";
import { claudeCodePatternServers, claudeDesktopConfigPath, updateClaudeCodeEntryEnv, updateJsonServerEnv } from "./client-connect.js";
import { askLine, closeRl } from "./prompt.js";
import { askKey, checkAnthropicKey, checkFigmaToken, pickEnvKeys, type WizardEnv } from "./setup-wizard.js";
import { execFileSync } from "node:child_process";

interface Target {
  label: string;
  apply: (env: WizardEnv) => { ok: true; added: string[] } | { ok: false; reason: string };
}

function findTargets(root: string): Target[] {
  const targets: Target[] = [];

  let hasClaude = false;
  try {
    execFileSync("claude", ["--version"], { stdio: "ignore", timeout: 5000 });
    hasClaude = true;
  } catch {
    // no Claude Code CLI
  }
  if (hasClaude) {
    const found = claudeCodePatternServers(); // runs `claude mcp list` (a health check), so only once
    const entry = found.find((s) => s.ok) ?? found[0];
    if (entry) targets.push({ label: `Claude Code ("${entry.name}")`, apply: (env) => updateClaudeCodeEntryEnv(entry.name, env) });
  }

  const jsonConfigs: [string, string | null][] = [
    ["Claude Desktop", claudeDesktopConfigPath()],
    ["Cursor (this project)", join(root, ".cursor", "mcp.json")],
  ];
  for (const [label, path] of jsonConfigs) {
    if (!path || !existsSync(path)) continue;
    const probe = updateJsonServerEnv(path, {});
    if (!probe.ok && "notFound" in probe) continue; // a config with no Pattern entry
    targets.push({
      label: `${label} (${path})`,
      apply: (env) => {
        const r = updateJsonServerEnv(path, env);
        return r.ok ? r : { ok: false, reason: r.reason };
      },
    });
  }
  return targets;
}

/** Returns the process exit code: 0 if at least one client entry was updated, 1 otherwise. */
export async function runKeysCommand(root: string, argv: string[]): Promise<number> {
  const fromEnv = argv.includes("--from-env");
  const targets = findTargets(root);
  if (targets.length === 0) {
    console.log(
      "Pattern is not connected to any MCP client I can find (looked at Claude Code, Claude Desktop and this project's .cursor).\n" +
        "Connect it first: npx pattern-mcp init",
    );
    return 1;
  }
  console.log(`Found Pattern in: ${targets.map((t) => t.label).join("; ")}`);

  let env: WizardEnv = {};
  try {
    if (fromEnv) {
      env = pickEnvKeys();
      if (Object.keys(env).length === 0) {
        console.log("--from-env: none of ANTHROPIC_API_KEY, ANTHROPIC_WORKSPACE_ID, FIGMA_ACCESS_TOKEN is set in this shell.");
        return 1;
      }
      console.log(`Using from your environment: ${Object.keys(env).join(", ")}`);
    } else {
      console.log(
        "\nThe keys are written in plain text into the client config(s) above (the client passes them to Pattern).\n" +
          "Typing is hidden. They are not sent anywhere except by Pattern to Anthropic / Figma when you use it.",
      );
      const a = await askKey("ANTHROPIC_API_KEY", "  Create one at console.anthropic.com.", (k) => checkAnthropicKey(k), { yes: false });
      if (a.value) env.ANTHROPIC_API_KEY = a.value;
      if (a.value && a.needsWorkspace) {
        const id = (await askLine("  This key needs a workspace id (wrkspc_..., console.anthropic.com > Settings > Workspaces): ")).trim();
        if (id) env.ANTHROPIC_WORKSPACE_ID = id;
      }
      const f = await askKey("FIGMA_ACCESS_TOKEN (only if your design system is in Figma)", "  Figma > Settings > Security > Personal access tokens, scope file_content:read.", (k) => checkFigmaToken(k), { yes: false });
      if (f.value) env.FIGMA_ACCESS_TOKEN = f.value;
    }
  } finally {
    closeRl();
  }

  if (Object.keys(env).length === 0) {
    console.log("Nothing entered, so nothing changed.");
    return 1;
  }

  let updated = 0;
  for (const t of targets) {
    const r = t.apply(env);
    if (r.ok) {
      updated++;
      console.log(`  ${t.label}: ${r.added.length ? `set ${r.added.join(", ")}` : "already had those values"}`);
    } else {
      console.log(`  ${t.label}: not changed -- ${r.reason}`);
    }
  }
  if (updated === 0) return 1;
  console.log("\nRestart your MCP client(s) so Pattern starts with the new key. Check with: npx -p pattern-mcp pattern doctor");
  return 0;
}
