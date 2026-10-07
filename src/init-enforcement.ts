// Option C from BACKLOG.md's "Enforcement boundary setup" entry: a
// guided `pattern-check-gate init` that does the mechanical parts of
// setting up the hook + CI gate (see check-gate-hook.ts,
// templates/github-workflows/pattern-gate.yml) instead of requiring a
// hand copy-edit-commit of each piece separately.
//
// Every step confirms independently and defaults to the safe choice --
// this never auto-commits, and the branch-protection step in particular
// never runs without an explicit, un-implied "yes" (see
// maybeSetupBranchProtection), matching the same "always confirm, never
// silently run" treatment Pattern already gives install_command and
// post_ledger_provenance_to_github.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveProjectId } from "./project-id.js";
import { closeRl, confirm, promptText, shellQuote, type PromptOptions } from "./prompt.js";
import { GATE_INIT_COMMAND, HOOK_COMMAND, isLegacyGateInvocation } from "./gate-commands.js";

const HOOK_MARKER = "pattern-check-gate-hook";

export type InitOptions = PromptOptions;

interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
}
interface PreToolUseEntry {
  matcher?: string;
  hooks?: HookEntry[];
}
interface ClaudeSettings {
  hooks?: {
    PreToolUse?: PreToolUseEntry[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// "written" is the only outcome after which a Claude Code session needs a restart.
async function setupClaudeSettings(root: string, projectIdOverride: string | null, options: InitOptions): Promise<"written" | "already" | "skipped"> {
  const settingsPath = join(root, ".claude", "settings.json");
  let settings: ClaudeSettings = {};
  let existed = false;
  if (existsSync(settingsPath)) {
    existed = true;
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8")) as ClaudeSettings;
    } catch {
      console.log("  .claude/settings.json exists but isn't valid JSON -- skipping, fix it manually first.");
      return "skipped";
    }
  }

  const preToolUse: PreToolUseEntry[] = settings.hooks?.PreToolUse ?? [];
  const ours = (h: { command?: unknown }) => typeof h.command === "string" && h.command.includes(HOOK_MARKER);
  const alreadyInstalled = preToolUse.some((entry) => (entry.hooks ?? []).some(ours));
  if (alreadyInstalled) {
    // Hooks written before 0.19.1 ran the hook bin through a bare npx (no
    // `-p pattern-mcp`), which asks npm for a package that does not exist: the hook errors on every tool
    // call and, since a hook error is non-blocking, the gate silently never runs.
    // Repair those in place (keeping any env prefix), never touching other hooks.
    let repaired = 0;
    for (const entry of preToolUse) {
      for (const h of entry.hooks ?? []) {
        if (ours(h) && isLegacyGateInvocation(h.command as string)) {
          h.command = (h.command as string).replace(/\bnpx\s+(?:(?:--yes|-y)\s+)?pattern-check-gate-hook\b/, HOOK_COMMAND);
          repaired++;
        }
      }
    }
    if (repaired === 0) {
      console.log("  .claude/settings.json: hook already configured, skipping.");
      return "already";
    }
    console.log(`  .claude/settings.json: this hook uses the pre-0.19.1 command, which cannot run (it names an npm package that does not exist).`);
    console.log(`  Updating it to: ${HOOK_COMMAND}`);
    if (!(await confirm("  Write this?", options, true))) {
      console.log("  Skipped.");
      return "skipped";
    }
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
    console.log("  Written. Restart the Claude Code session so it picks up the change.");
    return "written";
  }

  const command = projectIdOverride
    ? `env PATTERN_PROJECT_ID=${shellQuote(projectIdOverride)} ${HOOK_COMMAND}`
    : HOOK_COMMAND;

  const newEntry: PreToolUseEntry = {
    matcher: "Edit|Write|Bash",
    hooks: [{ type: "command", command, timeout: 60 }],
  };

  console.log(`\n  ${existed ? "Merging into" : "Creating"} .claude/settings.json:`);
  console.log(
    JSON.stringify(newEntry, null, 2)
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n"),
  );
  const proceed = await confirm("  Write this?", options, true);
  if (!proceed) {
    console.log("  Skipped.");
    return "skipped";
  }

  const merged: ClaudeSettings = {
    ...settings,
    hooks: {
      ...settings.hooks,
      PreToolUse: [...preToolUse, newEntry],
    },
  };
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
  console.log("  Written.");
  return "written";
}

function isGitHubRepo(root: string): { owner: string; repo: string } | null {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
    const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(\.git)?$/);
    if (match) return { owner: match[1], repo: match[2] };
  } catch {
    // no remote, or not git
  }
  return null;
}

async function setupWorkflowFile(root: string, options: InitOptions): Promise<boolean> {
  const gh = isGitHubRepo(root);
  if (!gh) {
    console.log("\n  No GitHub remote detected -- skipping the GitHub Action workflow file.");
    return false;
  }

  const workflowPath = join(root, ".github", "workflows", "pattern-gate.yml");
  const templatePath = fileURLToPath(new URL("../templates/github-workflows/pattern-gate.yml", import.meta.url));
  const templateContent = readFileSync(templatePath, "utf8");

  if (existsSync(workflowPath)) {
    const existing = readFileSync(workflowPath, "utf8");
    if (existing === templateContent) {
      console.log("\n  .github/workflows/pattern-gate.yml: already up to date, skipping.");
      return true;
    }
    console.log("\n  .github/workflows/pattern-gate.yml already exists with different content.");
    const overwrite = await confirm("  Overwrite it?", options, false);
    if (!overwrite) {
      console.log("  Skipped -- left your existing file untouched.");
      return false;
    }
  } else {
    console.log("\n  Creating .github/workflows/pattern-gate.yml.");
    const proceed = await confirm("  Write this?", options, true);
    if (!proceed) {
      console.log("  Skipped.");
      return false;
    }
  }
  mkdirSync(dirname(workflowPath), { recursive: true });
  writeFileSync(workflowPath, templateContent, "utf8");
  console.log("  Written.");
  return true;
}

function ghCliAvailable(): boolean {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function ghAuthenticated(): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function getDefaultBranch(gh: { owner: string; repo: string }): string | null {
  try {
    const out = execFileSync("gh", ["api", `repos/${gh.owner}/${gh.repo}`, "--jq", ".default_branch"], {
      encoding: "utf8",
      timeout: 10000,
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function stderrOf(err: unknown): string {
  if (err && typeof err === "object" && "stderr" in err) {
    const stderr = (err as { stderr?: unknown }).stderr;
    if (stderr) return String(stderr);
  }
  return "";
}

function getExistingProtection(gh: { owner: string; repo: string }, branch: string): "none" | "exists" | "unknown" {
  try {
    execFileSync("gh", ["api", `repos/${gh.owner}/${gh.repo}/branches/${branch}/protection`], {
      encoding: "utf8",
      timeout: 10000,
    });
    return "exists";
  } catch (err) {
    return stderrOf(err).includes("404") ? "none" : "unknown";
  }
}

// Only ever called when getExistingProtection returned "none". The
// Update Branch Protection endpoint REPLACES the entire protection
// object, and its GET/PUT schemas differ for several fields
// (enforce_admins is {enabled} on GET but a bare boolean on PUT, for
// example) -- verified against GitHub's own REST API docs before writing
// this. Deliberately does not attempt to merge into pre-existing
// protection; that case is handled by the caller bailing out to manual
// instructions instead of risking a wrong reconstruction that silently
// drops an unrelated setting (e.g. required PR reviews).
function createMinimalProtection(gh: { owner: string; repo: string }, branch: string): boolean {
  const body = JSON.stringify({
    required_status_checks: { strict: false, checks: [{ context: "pattern-gate", app_id: -1 }] },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
  });
  try {
    execFileSync("gh", ["api", "-X", "PUT", `repos/${gh.owner}/${gh.repo}/branches/${branch}/protection`, "--input", "-"], {
      input: body,
      encoding: "utf8",
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

async function maybeSetupBranchProtection(root: string, options: InitOptions): Promise<void> {
  const gh = isGitHubRepo(root);
  if (!gh) return;

  console.log("");
  // Never implied by --yes, and never defaults to yes -- see BACKLOG's
  // "strictest confirmation of the four steps" note. This is the one
  // step that reaches outside the local filesystem into real, shared
  // GitHub config.
  const wantsIt = await confirm("  Mark the pattern-gate check as required in branch protection?", options, false);
  if (!wantsIt) {
    console.log(
      `  Skipped. To do this later, add "pattern-gate" as a required status check in\n` +
        `  https://github.com/${gh.owner}/${gh.repo}/settings/branches`,
    );
    return;
  }

  if (!ghCliAvailable()) {
    console.log("  `gh` CLI not found -- install it (https://cli.github.com) and rerun, or configure manually.");
    return;
  }
  if (!ghAuthenticated()) {
    console.log("  `gh` CLI isn't authenticated -- run `gh auth login` and rerun, or configure manually.");
    return;
  }

  const branch = getDefaultBranch(gh);
  if (!branch) {
    console.log("  Couldn't determine the default branch -- configure manually.");
    return;
  }

  const existing = getExistingProtection(gh, branch);
  if (existing !== "none") {
    console.log(
      existing === "exists"
        ? `  Branch protection already exists on "${branch}". To avoid overwriting your other protection\n` +
            `  settings (this endpoint replaces the whole configuration, not just required checks), add\n` +
            `  "pattern-gate" to your required status checks manually instead of through this command.`
        : `  Couldn't determine "${branch}"'s current protection state -- configure manually rather than\n` +
            `  risk overwriting settings this command can't see.`,
    );
    return;
  }

  const ok = createMinimalProtection(gh, branch);
  console.log(
    ok
      ? `  Required "pattern-gate" check added to "${branch}" branch protection.`
      : "  Failed to update branch protection -- configure manually.",
  );
}

export async function runInit(root: string, options: InitOptions): Promise<void> {
  console.log("Setting up Pattern's enforcement boundary (hook + CI gate)...\n");

  const derivedId = deriveProjectId(root);
  const projectId = await promptText("Project id", derivedId, options);
  const projectIdOverride = projectId !== derivedId ? projectId : null;

  let hook: "written" | "already" | "skipped" = "skipped";
  try {
    hook = await setupClaudeSettings(root, projectIdOverride, options);
    await setupWorkflowFile(root, options);
    await maybeSetupBranchProtection(root, options);
  } finally {
    // Always close, even on error -- an open readline interface keeps
    // the process alive waiting on stdin otherwise.
    closeRl();
  }

  console.log("\nDone. Review the changes with `git status` / `git diff`, then commit when ready.");
  for (const line of initFollowUpNotes(projectId, hook)) console.log(line);
}

// What init cannot make true by itself, said explicitly: the hook is only read
// when a Claude Code session starts, and the gate matches ledger entries by
// project_id, so callers must use the same one.
export function initFollowUpNotes(projectId: string, hook: "written" | "already" | "skipped"): string[] {
  const notes: string[] = [""];
  if (hook === "written") {
    notes.push("Restart Claude Code: hooks are read when a session starts, so this hook will NOT fire in the session you ran init from.");
  } else if (hook === "already") {
    notes.push("The hook was already configured; if you changed it, restart Claude Code so the change is picked up.");
  }
  notes.push(
    `The gate matches ledger entries by project_id. Pass project_id "${projectId}" to recommend_component and record_component_decision,`,
    `and set file_path on recommend_component (or on record_component_decision afterwards) so the gate can find the entry.`,
  );
  if (hook === "already") {
    notes.push("(An existing hook keeps whatever PATTERN_PROJECT_ID, if any, is in its command; check it matches.)");
  }
  return notes;
}

// Option B from BACKLOG.md's "Enforcement boundary setup" entry: piggyback
// on the moment someone's already setting Pattern up, rather than leaving
// enforcement as something only the README mentions. Called once from
// index.ts's main(), right alongside printTelemetryNoticeOnce, before the
// stdio transport connects.
//
// The literal original phrasing of this option ("extend the first-run
// notice into a [y/N] prompt") turns out not to be safely buildable as
// written: stdin is the live JSON-RPC channel a real MCP client uses to
// talk to this process (see telemetry.ts's printTelemetryNoticeOnce for
// the same constraint, stated first). Blocking it on a keypress here would
// fight the protocol handshake, not show a dialog. So this does two
// different things depending on how stdin is actually connected:
//
//  - Always (any context, including a real client subprocess): print a
//    one-time, non-blocking mention that the enforcement boundary exists
//    and how to set it up. Same "print once, gated by a marker file"
//    pattern as the telemetry notice, deliberately a separate marker/
//    message so the two stay independently legible in a terminal.
//  - Only when process.stdin.isTTY is true -- which a real MCP client's
//    spawned subprocess never has, since it always pipes stdio to speak
//    JSON-RPC over it, but a human running `npx pattern-mcp` bare in
//    their own terminal does -- also offer a real interactive prompt,
//    reusing runInit itself rather than duplicating its logic.
const ENFORCEMENT_NOTICE_PATH =
  process.env.PATTERN_ENFORCEMENT_NOTICE_PATH ?? join(homedir(), ".pattern", "enforcement_notice_shown");

export async function offerEnforcementSetupOnce(root: string): Promise<void> {
  if (process.env.PATTERN_NO_ENFORCEMENT_NOTICE) return;

  try {
    readFileSync(ENFORCEMENT_NOTICE_PATH, "utf8");
    return; // Already shown -- never repeat, same discipline as the telemetry notice.
  } catch {
    // No marker yet -- fall through and show it.
  }

  console.error(
    [
      "",
      "Pattern -- enforcement boundary available (this will not print again)",
      "By default, Pattern is something the calling agent chooses to use.",
      "An opt-in hook + CI check can require it instead: run `${GATE_INIT_COMMAND}`",
      "in your repo to set it up.",
      "Full details: https://github.com/donaldrichard19-LVD/pattern-mcp#enforcement-boundary-hook--ci-gate",
      "",
    ].join("\n"),
  );

  try {
    mkdirSync(dirname(ENFORCEMENT_NOTICE_PATH), { recursive: true });
    writeFileSync(ENFORCEMENT_NOTICE_PATH, new Date().toISOString(), "utf8");
  } catch {
    // Couldn't persist the marker -- worst case this prints again next
    // run. Never blocks startup over it, same as the telemetry notice.
  }

  if (!process.stdin.isTTY) return;

  try {
    const setUpNow = await confirm("Set it up now?", { yes: false }, false);
    if (setUpNow) {
      await runInit(root, { yes: false }); // closes the shared readline itself, in its own finally block
    }
  } finally {
    // closeRl() is safe to call even if runInit already closed it (checks
    // rl?.close() and no-ops on null) -- this just guarantees stdin is
    // always released back before main() connects the stdio transport,
    // whether the answer was no or runInit already cleaned up after itself.
    closeRl();
  }
}
