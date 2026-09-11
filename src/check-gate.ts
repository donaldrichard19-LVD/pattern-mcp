#!/usr/bin/env node
// pattern-check-gate -- the enforcement-boundary CLI (see
// BACKLOG.md's "Enforcement boundary: hook + CI gate" entry).
//
// Three modes. write/verify share one classifier (component-gate.ts) so
// the local hook and the CI check can never silently drift on what
// counts as "gated":
//
//   write  -- run locally (by check-gate-hook.ts) where
//             ~/.pattern/ledger.jsonl is reachable. Looks up a ledger
//             entry whose file_path matches the file being written; on a
//             match (or a manual override), writes a receipt into the
//             CONSUMING repo at .pattern/receipts/<feature_id>.json and
//             exits 0. No match, no override -> exits 1 and blocks.
//             --project-id is optional -- see project-id.ts (Option A).
//
//   verify -- run in CI, where ~/.pattern/ is never reachable. Trusts the
//             committed receipt as the artifact of record instead of
//             re-deriving anything from the ledger -- fails if a gated
//             file in the diff has no matching receipt.
//
//   init   -- Option C: a guided setup that writes/merges
//             .claude/settings.json and the workflow file, and can
//             optionally configure branch protection via `gh`. See
//             init-enforcement.ts; this file only dispatches to it.
//
// No CLI-parsing or git-wrapper dependency, matching this project's
// existing minimal-dependency posture (index.ts shells out to fixed git
// subcommands rather than a library) -- argv is parsed by hand below.
//
// This is the project's first standalone CLI entry point separate from
// the stdio MCP server (see package.json's new "pattern-check-gate" bin
// entry) -- entirely opt-in. A consuming repo that never installs the
// hook template or the workflow template never invokes this file, and
// Pattern's core MCP tools are unaffected either way.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve as resolvePath } from "node:path";
import { isGatedComponentFile, parseManualOverride } from "./component-gate.js";
import { deriveOverrideFeatureId, GateReceipt, readAllGateReceipts, writeGateReceipt } from "./gate-receipt.js";
import { deriveProjectId } from "./project-id.js";
import { runInit } from "./init-enforcement.js";

function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

// Converts a possibly-absolute file argument into a path relative to
// root, without ever reading/writing outside root.
function toRepoRelative(root: string, fileArg: string): string | null {
  const abs = isAbsolute(fileArg) ? fileArg : resolvePath(root, fileArg);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return normalize(rel);
}

function parseArgs(argv: string[]): { mode: string; flags: Record<string, string | true>; files: string[] } {
  const mode = argv[0];
  const flags: Record<string, string | true> = {};
  const files: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--files") {
      // --files (verify mode) consumes every following non-flag token
      i++;
      while (i < argv.length && !argv[i].startsWith("--")) {
        files.push(argv[i]);
        i++;
      }
      i--;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return { mode, flags, files };
}

function readStdin(): Promise<string> {
  return new Promise((resolveP, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolveP(data));
    process.stdin.on("error", reject);
  });
}

function emit(result: Record<string, unknown>, ok: boolean): never {
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(ok ? 0 : 1);
}

async function runWrite(root: string, flags: Record<string, string | true>): Promise<void> {
  const fileArg = flags.file;
  if (typeof fileArg !== "string") {
    emit({ ok: false, reason: "write mode requires --file <path>" }, false);
  }
  // Option A: --project-id is now optional -- derive it (package.json
  // name, then git remote, then the directory name) rather than require
  // every caller to know and pass it. An explicit --project-id always
  // wins over the derivation.
  const projectId = typeof flags["project-id"] === "string" ? (flags["project-id"] as string) : deriveProjectId(root);
  const relPath = toRepoRelative(root, fileArg as string);
  if (relPath === null) {
    emit({ ok: false, reason: `--file resolves outside project root: ${fileArg}` }, false);
  }
  const content = await readStdin();
  const isNew = flags["is-new"] === true;

  if (!isGatedComponentFile(relPath as string, content, isNew)) {
    emit({ ok: true, gated: false }, true);
  }

  const override = parseManualOverride(content);
  const checkedAt = new Date().toISOString();

  // Dynamic import, after nothing has set PATTERN_NO_AUTOSTART yet in
  // this process -- set it now, before index.js's module body runs, same
  // convention scripts/*.mjs already use to import from this file
  // without starting the stdio MCP server as a side effect.
  process.env.PATTERN_NO_AUTOSTART = "1";
  const { readLedgerEntries, computeSnapshotRef } = await import("./index.js");
  const snapshotRef = computeSnapshotRef(root);

  if (override.overridden) {
    const receipt: GateReceipt = {
      schema_version: 1,
      feature_id: deriveOverrideFeatureId(projectId, relPath as string),
      file_path: relPath as string,
      ledger_entry_id: null,
      verdict: null,
      chosen_candidate: null,
      snapshot_ref: snapshotRef,
      checked_at: checkedAt,
      manual_override: true,
      override_reason: override.reason,
    };
    writeGateReceipt(root, receipt);
    emit({ ok: true, gated: true, manual_override: true, feature_id: receipt.feature_id }, true);
  }

  const entries = readLedgerEntries(projectId);
  const match = entries.find((e) => e.file_path && normalize(e.file_path) === relPath);

  if (!match) {
    emit(
      {
        ok: false,
        gated: true,
        reason:
          `No recommend_component/record_component_decision entry found with file_path="${relPath}" ` +
          `for project_id="${projectId}". Call recommend_component with file_path set to this exact ` +
          `path before creating it, or add \`// pattern-mcp:override reason="..."\` to the file.`,
      },
      false,
    );
  }

  const receipt: GateReceipt = {
    schema_version: 1,
    feature_id: match!.feature_id,
    file_path: relPath as string,
    ledger_entry_id: match!.id,
    verdict: match!.verdict,
    chosen_candidate: match!.chosen_candidate,
    snapshot_ref: snapshotRef,
    checked_at: checkedAt,
    manual_override: false,
    override_reason: null,
  };
  writeGateReceipt(root, receipt);
  emit({ ok: true, gated: true, feature_id: receipt.feature_id }, true);
}

async function runVerify(root: string, files: string[]): Promise<void> {
  const receipts = readAllGateReceipts(root);
  const ungated: string[] = [];
  let checked = 0;

  for (const fileArg of files) {
    const relPath = toRepoRelative(root, fileArg);
    if (relPath === null) continue;
    const abs = resolvePath(root, relPath);
    if (!existsSync(abs)) continue;
    const content = readFileSync(abs, "utf8");
    // verify mode's caller (the workflow) is expected to pass only files
    // already filtered to "added in this diff" -- see
    // templates/github-workflows/pattern-gate.yml.
    if (!isGatedComponentFile(relPath, content, true)) continue;

    checked++;
    const hasReceipt = receipts.some((r) => normalize(r.file_path) === relPath);
    if (!hasReceipt) ungated.push(relPath);
  }

  if (ungated.length > 0) {
    emit(
      {
        ok: false,
        ungated_files: ungated,
        reason: "One or more new UI components have no matching .pattern/receipts/*.json entry.",
      },
      false,
    );
  }
  emit({ ok: true, checked }, true);
}

async function main(): Promise<void> {
  const { mode, flags, files } = parseArgs(process.argv.slice(2));
  const root = typeof flags["project-root"] === "string" ? (flags["project-root"] as string) : process.cwd();

  if (mode === "write") {
    await runWrite(root, flags);
  } else if (mode === "verify") {
    await runVerify(root, files);
  } else if (mode === "init") {
    await runInit(root, { yes: flags.yes === true });
  } else {
    process.stderr.write("Usage: pattern-check-gate write --file <path> [--is-new] [--project-id <id>] [--project-root <root>] (content on stdin)\n");
    process.stderr.write("       pattern-check-gate verify --files <path...> [--project-root <root>]\n");
    process.stderr.write("       pattern-check-gate init [--project-root <root>] [--yes]\n");
    process.exit(2);
  }
}

main().catch((err) => {
  process.stderr.write(`pattern-check-gate crashed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
