// Option A from BACKLOG.md's "Enforcement boundary setup" entry:
// auto-derives a project id instead of requiring PATTERN_PROJECT_ID to be
// hand-set. Shared by check-gate.ts's write mode (runtime fallback when
// --project-id is omitted) and init-enforcement.ts (to pre-fill its
// prompt) -- one derivation, not two, so the hook's actual behavior and
// init's preview can never disagree.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

export function deriveProjectId(root: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (typeof pkg.name === "string" && pkg.name.trim()) return pkg.name.trim();
  } catch {
    // no package.json, or unparseable -- fall through to the git remote
  }
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
    // Matches the repo name out of either an https or ssh remote URL,
    // with or without a trailing .git.
    const match = url.match(/([^/:]+?)(\.git)?$/);
    if (match && match[1]) return match[1];
  } catch {
    // no git remote, or git not available -- fall through to the dir name
  }
  return basename(root);
}
