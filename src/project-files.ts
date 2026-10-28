// Resolving a caller's file_path to a real file, tolerantly.
//
// The server's root (PATTERN_PROJECT_ROOT, else its cwd) is often a parent of
// the repo the caller is working in (an MCP server launched from ~, a monorepo
// opened one level up). A caller then passes either "pkg/x.tsx" (relative to
// the repo) or "repo/pkg/x.tsx" (relative to the server root), and the gate's
// receipts are keyed by the repo-relative form. Rather than make the caller
// guess which form this server wants, resolve both, and say which repo owns
// the file so receipts are read and written there.

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface ResolvedProjectFile {
  /** Absolute path of the file. */
  abs: string;
  /** Path relative to the server root (what the ledger usually stores). */
  rootRel: string;
  /** Nearest ancestor containing .git, or the server root when there is none. */
  repoRoot: string;
  /** Path relative to repoRoot (what the gate's receipts are keyed by). */
  repoRel: string;
  /** Every spelling of this file a ledger entry might have been stored under. */
  spellings: string[];
  /** How the file was found, for transparency. */
  via: "root" | "absolute" | "nested_repo";
}

const norm = (p: string) => p.trim().replace(/\\/g, "/").replace(/^\.\//, "");

function isFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

function within(root: string, abs: string): boolean {
  const rel = relative(root, abs);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Nearest ancestor of `start` (inclusive) with a .git entry, never above `ceiling`'s parent. */
export function findGitRoot(start: string, ceiling?: string): string | null {
  let dir = isFile(start) ? dirname(start) : start;
  for (let i = 0; i < 40; i++) {
    if (existsSync(join(dir, ".git"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    if (ceiling && !within(ceiling, up) && up !== ceiling) return null;
    dir = up;
  }
  return null;
}

// Immediate (depth 1) and one-level-nested (depth 2) directories of root that
// are git repos. Bounded so a huge home directory costs a few readdirs.
function nestedRepos(root: string): string[] {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".git", ".cache", ".npm", ".local", ".config"]);
  let level1: string[] = [];
  try {
    level1 = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !skip.has(d.name)).map((d) => join(root, d.name));
  } catch {
    return out;
  }
  for (const dir of level1) {
    if (existsSync(join(dir, ".git"))) out.push(dir);
  }
  return out;
}

/**
 * Finds the file a caller means. Accepts a root-relative path, a repo-relative
 * path of a repo nested under the root, or an absolute path inside the root.
 * Returns null when nothing matches, or when the repo-relative form is
 * ambiguous (two nested repos hold the same relative path).
 */
export function resolveProjectFile(root: string, input: string): ResolvedProjectFile | null {
  const given = norm(input);
  if (!given) return null;

  let abs: string | null = null;
  let via: ResolvedProjectFile["via"] = "root";

  if (isAbsolute(given)) {
    const a = resolve(given);
    if (!within(root, a) || !isFile(a)) return null;
    abs = a;
    via = "absolute";
  } else {
    // A relative path may never climb: "../x" stays refused even if some
    // nested repo could make it land back inside the root.
    if (given.split("/").includes("..")) return null;
    const direct = resolve(root, given);
    if (within(root, direct) && isFile(direct)) {
      abs = direct;
    } else {
      const hits = nestedRepos(root)
        .map((repo) => resolve(repo, given))
        .filter((p) => within(root, p) && isFile(p));
      if (hits.length === 1) {
        abs = hits[0];
        via = "nested_repo";
      }
    }
  }
  if (!abs) return null;

  const repoRoot = findGitRoot(abs, root) ?? root;
  const rootRel = norm(relative(root, abs));
  const repoRel = norm(relative(repoRoot, abs));
  const spellings = [...new Set([given, rootRel, repoRel].filter((s) => s && !isAbsolute(s)))];
  return { abs, rootRel, repoRoot, repoRel, spellings, via };
}

/** Absolute paths inside root become root-relative; everything else is returned trimmed and slash-normalized. */
export function toRootRelative(root: string, input: string): string {
  const given = norm(input);
  if (isAbsolute(given)) {
    const a = resolve(given);
    if (within(root, a)) return norm(relative(root, a));
  }
  return given;
}
