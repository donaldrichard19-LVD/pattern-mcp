#!/usr/bin/env node
// Claude-Code-specific PreToolUse adapter for pattern-check-gate. Copy this
// file into your repo (or reference it from node_modules/pattern-mcp) and
// wire it up via .claude/settings.json -- see
// ../claude-settings/settings.json for the exact hook config. Not
// installed automatically by pattern-mcp; this is opt-in (see
// BACKLOG.md's "Enforcement boundary: hook + CI gate" entry for why).
//
// Reads the PreToolUse stdin JSON, shells out to `pattern-check-gate
// write`, and translates the result into the hook's blocking contract:
// a JSON object on stdout with permissionDecision "deny" blocks the tool
// call and feeds the reason back to Claude as retryable guidance (not a
// hard turn failure); exiting 0 with no output allows it.
//
// Requires a PATTERN_PROJECT_ID env var (or --project-id below) -- set it
// in the hook's own "command" (e.g. via `env PATTERN_PROJECT_ID=my-app
// node ...`) or export it in your shell profile for local dev.

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

async function main() {
  if (process.env.PATTERN_NO_ENFORCEMENT_HOOK) {
    process.exit(0);
  }

  const input = JSON.parse(readFileSync(0, "utf8"));
  const toolName = input.tool_name;
  if (toolName !== "Write" && toolName !== "Edit") {
    process.exit(0);
  }

  const filePath = input.tool_input?.file_path;
  if (!filePath) process.exit(0);

  // isNewFile is determined here, at hook time, before the write happens
  // -- this is the one piece of Claude-Code-specific state check-gate.ts
  // itself doesn't have access to. Edit calls always target an existing
  // file, so isNewFile is always false for them, which is why they're
  // effectively never gated by this hook (see component-gate.ts's
  // comment on isNewFile) -- the initial Write that creates the file is
  // the highest-signal moment.
  const isNewFile = !existsSync(filePath);
  const content = toolName === "Write" ? input.tool_input?.content ?? "" : "";

  const projectId = process.env.PATTERN_PROJECT_ID;
  if (!projectId) {
    // Fail open with a clear stderr note rather than blocking every write
    // in a repo that hasn't configured this yet -- misconfiguration
    // shouldn't look identical to "no ledger entry found."
    process.stderr.write("check-gate-hook: PATTERN_PROJECT_ID not set, skipping gate\n");
    process.exit(0);
  }

  const args = ["write", "--file", filePath, "--project-id", projectId, "--project-root", input.cwd ?? process.cwd()];
  if (isNewFile) args.push("--is-new");

  const result = spawnSync("npx", ["pattern-check-gate", ...args], {
    input: content,
    encoding: "utf8",
    timeout: 30000,
  });

  let parsed;
  try {
    parsed = JSON.parse((result.stdout || "").trim());
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
