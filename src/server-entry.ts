// Recognising a Pattern MCP server entry in a client config, whatever it is
// named. The connect wizard names its entry "pattern", but people also have
// hand-made ones (a dev checkout, "ui-component-judgment", a pinned
// `npx pattern-mcp@x`). Matching only the name made `init` add a second,
// keyless server next to a hand-made one, and made `doctor` blind to an entry
// that could not even start.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export interface McpEntryLike {
  command?: unknown;
  args?: unknown;
  env?: unknown;
}

const RUNS_PATTERN = /pattern-mcp|ui-component-judgment-mcp/;

/** The package directory a `node <script>` entry runs from (nearest package.json up to 4 levels), or null. */
function packageDirOfScript(script: string): string | null {
  let dir = dirname(script);
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    dir = dirname(dir);
  }
  return null;
}

function localScript(e: McpEntryLike): string | null {
  const command = typeof e.command === "string" ? e.command : "";
  if (!/(^|\/)node(\.exe)?$/.test(command)) return null;
  const args = Array.isArray(e.args) ? e.args.filter((a): a is string => typeof a === "string") : [];
  // Absolute only: a relative path would resolve against whatever directory THIS
  // process happens to run in, not the client's, and could match the wrong package.
  return args.find((a) => /\.[cm]?js$/.test(a) && isAbsolute(a)) ?? null;
}

/**
 * True if this config entry launches Pattern: by name, by what it runs
 * (`npx pattern-mcp`, a path containing the repo's name), or because it runs a
 * local checkout whose package.json is named "pattern-mcp" -- a clone can live
 * in a folder with any name.
 */
export function isPatternServerEntry(name: string, entry: unknown): boolean {
  if (name === "pattern") return true;
  if (!entry || typeof entry !== "object") return false;
  const e = entry as McpEntryLike;
  if (RUNS_PATTERN.test(JSON.stringify([e.command, e.args]))) return true;
  const script = localScript(e);
  const dir = script ? packageDirOfScript(script) : null;
  if (!dir) return false;
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name === "pattern-mcp";
  } catch {
    return false;
  }
}

/** The first Pattern entry of an `mcpServers` map, with the name it is filed under. */
export function findPatternEntry(servers: unknown): { name: string; entry: McpEntryLike } | null {
  if (!servers || typeof servers !== "object") return null;
  for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
    if (isPatternServerEntry(name, entry)) return { name, entry: (entry ?? {}) as McpEntryLike };
  }
  return null;
}

export interface ClaudeListServer {
  name: string;
  /** false when `claude mcp list` reports it failed to connect. */
  ok: boolean;
}

/**
 * Parses `claude mcp list` output ("name: command args - ✔ Connected") and
 * returns the Pattern servers in it. Names can contain spaces and the command
 * can contain ": " (URLs), so split on the FIRST ": " and the LAST " - ".
 */
export function patternServersInClaudeList(output: string): ClaudeListServer[] {
  const found: ClaudeListServer[] = [];
  for (const line of output.split("\n")) {
    const m = /^(.+?): (.+) - ([✔✘!].*)$/.exec(line.trim());
    if (!m) continue;
    const [, name, command, status] = m;
    if (name === "pattern" || RUNS_PATTERN.test(command)) found.push({ name, ok: status.startsWith("✔") });
  }
  return found;
}

/**
 * For an entry that runs a local checkout (`node /path/dist/index.js`), says
 * why it cannot start, or null if nothing is wrong that can be seen from disk.
 * This is the "CONNECTION_CLOSED" case: no node_modules next to the package.
 */
export function diagnoseLocalEntry(entry: McpEntryLike): { problem: string; fix: string } | null {
  const script = localScript(entry); // null for npx etc.: nothing local to check
  if (!script) return null;
  if (!existsSync(script)) return { problem: `${script} does not exist`, fix: "point the entry at a built checkout, or at the published package: npx --yes pattern-mcp@latest" };
  const dir = packageDirOfScript(script);
  if (!dir) return null;
  try {
    if (!statSync(join(dir, "node_modules")).isDirectory()) throw new Error();
  } catch {
    return { problem: `${dir} has no node_modules, so the server crashes on start (the client shows CONNECTION_CLOSED)`, fix: `run \`npm ci && npm run build\` in ${dir}, or point the entry at the published package: npx --yes pattern-mcp@latest` };
  }
  return null;
}
