#!/usr/bin/env node
// pattern-check-gate-hook -- the Claude-Code-specific PreToolUse adapter.
// Wired up via .claude/settings.json (see templates/claude-settings/settings.json,
// or generated automatically by `pattern-check-gate init`). Not installed
// automatically by pattern-mcp itself -- opt-in, per BACKLOG.md's
// "Enforcement boundary: hook + CI gate" entry.
//
// A real bin entry (not a template file to hand-copy) so it resolves the
// same way whether pattern-mcp is a real devDependency in the consuming
// repo's node_modules or only ever fetched ad hoc via npx -- both cases
// invoke it as `npx --yes pattern-check-gate-hook`, npx's own caching
// handles the rest. This also makes it testable the same way as
// check-gate.ts itself (spawned as a real subprocess in
// scripts/verify-check-gate.mjs), rather than living outside the build.
//
// Reads the PreToolUse stdin JSON, shells out to `pattern-check-gate
// write`, and translates the result into the hook's blocking contract: a
// JSON object on stdout with permissionDecision "deny" blocks the tool
// call and feeds the reason back to Claude as retryable guidance (not a
// hard turn failure); exiting 0 with no output allows it.
//
// --project-id is intentionally omitted unless PATTERN_PROJECT_ID is set
// -- pattern-check-gate derives one itself (package.json name, then git
// remote, then directory name) when it's not passed. See project-id.ts.

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

interface PreToolUseInput {
  tool_name?: string;
  tool_input?: { file_path?: string; content?: string };
  cwd?: string;
}

interface CheckGateResult {
  ok?: boolean;
  reason?: string;
}

async function main(): Promise<void> {
  if (process.env.PATTERN_NO_ENFORCEMENT_HOOK) {
    process.exit(0);
  }

  const input = JSON.parse(readFileSync(0, "utf8")) as PreToolUseInput;
  const toolName = input.tool_name;
  if (toolName !== "Write" && toolName !== "Edit") {
    process.exit(0);
  }

  const filePath = input.tool_input?.file_path;
  if (!filePath) process.exit(0);

  // isNewFile is determined here, at hook time, before the write happens
  // -- the one piece of Claude-Code-specific state pattern-check-gate
  // itself doesn't have access to. Edit calls always target an existing
  // file, so isNewFile is always false for them -- the initial Write
  // that creates the file is the highest-signal moment.
  const isNewFile = !existsSync(filePath);
  const content = toolName === "Write" ? (input.tool_input?.content ?? "") : "";
  const root = input.cwd ?? process.cwd();

  const args = ["write", "--file", filePath, "--project-root", root];
  if (process.env.PATTERN_PROJECT_ID) {
    args.push("--project-id", process.env.PATTERN_PROJECT_ID);
  }
  if (isNewFile) args.push("--is-new");

  const result = spawnSync("npx", ["--yes", "pattern-check-gate", ...args], {
    input: content,
    encoding: "utf8",
    timeout: 30000,
  });

  let parsed: CheckGateResult;
  try {
    parsed = JSON.parse((result.stdout || "").trim()) as CheckGateResult;
  } catch {
    // If pattern-check-gate itself crashed or produced no parseable
    // output, fail open (allow) rather than blocking on a plumbing bug --
    // stderr still carries the detail for debugging.
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(0);
  }

  if (parsed.ok === false) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: parsed.reason ?? "pattern-check-gate blocked this file.",
        },
      }),
    );
  }
  process.exit(0);
}

main();
