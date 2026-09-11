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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface, type Interface } from "node:readline";
import { deriveProjectId } from "./project-id.js";

const HOOK_MARKER = "pattern-check-gate-hook";

export interface InitOptions {
  yes: boolean;
}

// A queue-based prompt helper, not readline/promises' question() --
// question() only starts listening for a line *after* it's called, but
// with piped/non-TTY stdin (as in an automated test, or `init | cat`)
// every line arrives in one synchronous burst, ahead of any await
// cycle. Confirmed directly: two sequential `rl.question()` calls on a
// piped `printf 'a\nb\n'` answer only the first and hang forever on the
// second -- Node even logs "Detected unsettled top-level await" in that
// repro. The fix is a small always-listening queue: a persistent 'line'
// listener buffers answers that arrive before they're asked for, so
// `askLine` either drains an already-buffered answer immediately or
// waits for the next 'line' event, whichever comes first -- correct for
// both a real interactive TTY (waiter path) and piped/scripted input
// (queue path).
let rl: Interface | null = null;
const lineQueue: string[] = [];
const waiters: Array<(line: string) => void> = [];

function ensureRl(): Interface {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.on("line", (line) => {
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else lineQueue.push(line);
    });
  }
  return rl;
}

function askLine(promptStr: string): Promise<string> {
  ensureRl();
  process.stdout.write(promptStr);
  const queued = lineQueue.shift();
  if (queued !== undefined) return Promise.resolve(queued);
  return new Promise((resolve) => waiters.push(resolve));
}

function closeRl(): void {
  rl?.close();
  rl = null;
}

async function confirm(question: string, options: InitOptions, defaultYes: boolean): Promise<boolean> {
  if (options.yes) return defaultYes;
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = (await askLine(`${question} ${suffix} `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

async function promptText(question: string, defaultValue: string, options: InitOptions): Promise<string> {
  if (options.yes) return defaultValue;
  const answer = (await askLine(`${question} [${defaultValue}]: `)).trim();
  return answer || defaultValue;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

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

async function setupClaudeSettings(root: string, projectIdOverride: string | null, options: InitOptions): Promise<void> {
  const settingsPath = join(root, ".claude", "settings.json");
  let settings: ClaudeSettings = {};
  let existed = false;
  if (existsSync(settingsPath)) {
    existed = true;
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8")) as ClaudeSettings;
    } catch {
      console.log("  .claude/settings.json exists but isn't valid JSON -- skipping, fix it manually first.");
      return;
    }
  }

  const preToolUse: PreToolUseEntry[] = settings.hooks?.PreToolUse ?? [];
  const alreadyInstalled = preToolUse.some((entry) =>
    (entry.hooks ?? []).some((h) => typeof h.command === "string" && h.command.includes(HOOK_MARKER)),
  );
  if (alreadyInstalled) {
    console.log("  .claude/settings.json: hook already configured, skipping.");
    return;
  }

  const command = projectIdOverride
    ? `env PATTERN_PROJECT_ID=${shellQuote(projectIdOverride)} npx --yes pattern-check-gate-hook`
    : "npx --yes pattern-check-gate-hook";

  const newEntry: PreToolUseEntry = {
    matcher: "Edit|Write",
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
    return;
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

  try {
    await setupClaudeSettings(root, projectIdOverride, options);
    await setupWorkflowFile(root, options);
    await maybeSetupBranchProtection(root, options);
  } finally {
    // Always close, even on error -- an open readline interface keeps
    // the process alive waiting on stdin otherwise.
    closeRl();
  }

  console.log("\nDone. Review the changes with `git status` / `git diff`, then commit when ready.");
}
