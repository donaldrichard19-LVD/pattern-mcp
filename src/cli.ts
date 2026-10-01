#!/usr/bin/env node
// pattern -- onboarding CLI. Two read-mostly helpers for the setup dead-ends
// that cost the most turns in practice (see the 2026-09-29 build session):
//
//   pattern doctor [--online] [--project-root <root>] [--project-id <id>]
//     Preflight: reports where the MCP server entry lives, which keys are in
//     THAT server's env block (the only place that counts), whether the Figma
//     token looks well-formed, the resolved root + project id, and whether a
//     design system is registered. Never prints a secret value.
//     --online additionally checks the Figma token against GET /v1/me.
//
//   pattern fetch-figma <file_key> [--out <path>]
//     Downloads a Figma file's JSON with FIGMA_ACCESS_TOKEN (shell env, else
//     the server's env block) and saves it only if it is a real file, never
//     an error body, so figma_json_path can register it with no further
//     token handling in chat.
//
// Exit 0 = nothing blocking, 1 = at least one failing check, 2 = usage.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { deriveProjectId } from "./project-id.js";
import { fetchFigmaFile } from "./design-system-figma.js";

type Level = "ok" | "warn" | "fail";
interface Line { level: Level; text: string }

const KEYS = ["ANTHROPIC_API_KEY", "TYPESAFE_API_KEY", "FIGMA_ACCESS_TOKEN"] as const;

interface ServerEntry { source: string; env: Record<string, string> }

function readJson(path: string): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// Every place a client config can declare a server named "pattern". Only the
// first match per file is returned; cwd-scoped Claude Code entries win over
// the user-level one, same as the client resolves them.
export function findServerEntries(root: string, home = homedir()): ServerEntry[] {
  const found: ServerEntry[] = [];
  // Named "pattern" by the connect wizard, but a hand-made entry can have any
  // name (e.g. a dev checkout), so also match on what it launches.
  const pick = (servers: any): any => {
    if (!servers || typeof servers !== "object") return undefined;
    if (servers.pattern) return servers.pattern;
    return Object.values(servers).find((e: any) => /pattern-mcp|ui-component-judgment-mcp/.test(JSON.stringify([e?.command, e?.args])));
  };
  const add = (source: string, servers: any) => {
    const entry = pick(servers);
    if (entry && typeof entry === "object") found.push({ source, env: entry.env && typeof entry.env === "object" ? entry.env : {} });
  };
  const claude = readJson(join(home, ".claude.json"));
  if (claude) {
    add(`~/.claude.json (project ${root})`, claude.projects?.[root]?.mcpServers);
    add("~/.claude.json (user)", claude.mcpServers);
  }
  const mcp = readJson(join(root, ".mcp.json"));
  if (mcp) add(".mcp.json", mcp.mcpServers);
  const cursor = readJson(join(root, ".cursor", "mcp.json"));
  if (cursor) add(".cursor/mcp.json", cursor.mcpServers);
  return found;
}

// Shape check only; never echoes the value. Catches the garbled-paste case
// (whitespace, quotes, non-ASCII) that surfaces later as an opaque 403.
export function figmaTokenProblem(token: string): string | null {
  if (token !== token.trim() || /["'\s]/.test(token)) return "contains whitespace or quote characters (bad paste?)";
  if (!/^[\x21-\x7e]+$/.test(token)) return "contains non-ASCII characters (bad paste?)";
  if (!token.startsWith("figd_")) return 'does not start with "figd_"';
  return null;
}

function parseDotEnv(path: string): Set<string> {
  const names = new Set<string>();
  try {
    for (const l of readFileSync(path, "utf8").split("\n")) {
      const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*\S/);
      if (m) names.add(m[1]);
    }
  } catch {
    // no .env
  }
  return names;
}

async function checkFigmaOnline(token: string): Promise<Line> {
  const base = process.env.FIGMA_API_URL ?? "https://api.figma.com";
  try {
    const res = await fetch(`${base}/v1/me`, { headers: { "X-Figma-Token": token }, signal: AbortSignal.timeout(15_000) });
    if (res.ok) return { level: "ok", text: "Figma token accepted by the API (GET /v1/me)." };
    if (res.status === 403) return { level: "fail", text: "Figma rejected the token (403): revoke it, make a new one with file_content:read, and set it yourself in the server env block." };
    return { level: "warn", text: `Figma /v1/me returned ${res.status}; the token may still work for file reads.` };
  } catch (err) {
    return { level: "warn", text: `Could not reach Figma to check the token: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function runDoctor(root: string, opts: { online: boolean; projectId?: string; home?: string }): Promise<Line[]> {
  const home = opts.home ?? homedir();
  const out: Line[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  out.push(major >= 18 ? { level: "ok", text: `Node ${process.versions.node}` } : { level: "fail", text: `Node ${process.versions.node}: pattern needs >= 18` });

  const projectId = opts.projectId ?? deriveProjectId(root);
  out.push({ level: "ok", text: `Project root: ${root}` });
  out.push({ level: "ok", text: `Project id (what the gate hook derives): ${projectId}. Pass this same id to register_design_system, extract_requirements and recommend_component.` });

  const entries = findServerEntries(root, home);
  if (entries.length === 0) {
    out.push({ level: "fail", text: 'No Pattern MCP server entry found in ~/.claude.json, .mcp.json or .cursor/mcp.json. Run `npx pattern-mcp` to connect a client.' });
  }
  const entry = entries[0];
  if (entry) {
    out.push({ level: "ok", text: `Server entry: ${entry.source}` });
    for (const k of KEYS) {
      const present = typeof entry.env[k] === "string" && entry.env[k].length > 0;
      const why = { ANTHROPIC_API_KEY: "recommend_component scoring", TYPESAFE_API_KEY: "Jev fast matching", FIGMA_ACCESS_TOKEN: "figma_file_key registration" }[k];
      out.push(present ? { level: "ok", text: `${k} set in server env (${why})` } : { level: k === "ANTHROPIC_API_KEY" ? "fail" : "warn", text: `${k} NOT in the server's env block (${why} unavailable)` });
    }
    const dotenv = parseDotEnv(join(root, ".env"));
    const stranded = KEYS.filter((k) => dotenv.has(k) && !entry.env[k]);
    if (stranded.length > 0) {
      out.push({ level: "warn", text: `${stranded.join(", ")} found in ${join(root, ".env")} but not in the server env block: the server never reads .env. Add them to the entry's env block yourself, then restart the client.` });
    }
    const token = entry.env.FIGMA_ACCESS_TOKEN;
    if (token) {
      const problem = figmaTokenProblem(token);
      out.push(problem ? { level: "fail", text: `FIGMA_ACCESS_TOKEN ${problem}` } : { level: "ok", text: "FIGMA_ACCESS_TOKEN looks well-formed" });
      if (opts.online && !problem) out.push(await checkFigmaOnline(token));
    }
    if (entry.env.PATTERN_PROJECT_ROOT && entry.env.PATTERN_PROJECT_ROOT !== root) {
      out.push({ level: "warn", text: `Server PATTERN_PROJECT_ROOT=${entry.env.PATTERN_PROJECT_ROOT} differs from this root; file_path values resolve against the server's, not this one.` });
    }
  }

  const dsPath = process.env.PATTERN_DESIGN_SYSTEMS_PATH ?? join(home, ".pattern", "design_systems.json");
  const ds = readJson(dsPath);
  if (!ds || !ds[projectId]) {
    const known = ds ? Object.keys(ds) : [];
    out.push({ level: "warn", text: `No design system registered for project id "${projectId}"${known.length ? ` (registered ids: ${known.join(", ")})` : ""}. recommend_component needs register_design_system first.` });
  } else {
    const n = Array.isArray(ds[projectId].candidates) ? ds[projectId].candidates.length : "?";
    out.push({ level: "ok", text: `Design system registered for "${projectId}" (${n} candidates)` });
  }

  const settings = readJson(join(root, ".claude", "settings.json"));
  const hooked = JSON.stringify(settings?.hooks ?? {}).includes("pattern-check-gate-hook");
  out.push(hooked ? { level: "ok", text: "Gate hook installed in .claude/settings.json (restart the session that installed it)" } : { level: "warn", text: "Gate hook not installed (optional): `npx pattern-check-gate init`" });
  return out;
}

async function runFetchFigma(root: string, fileKey: string | undefined, flags: Record<string, string | true>): Promise<number> {
  if (!fileKey) {
    process.stderr.write("Usage: pattern fetch-figma <file_key> [--out <path>]\n");
    return 2;
  }
  const entry = findServerEntries(root)[0];
  const token = process.env.FIGMA_ACCESS_TOKEN || entry?.env.FIGMA_ACCESS_TOKEN;
  if (!token) {
    process.stderr.write("No FIGMA_ACCESS_TOKEN in your shell or the pattern server's env block. Set it yourself (never paste it in a chat), then retry.\n");
    return 1;
  }
  const problem = figmaTokenProblem(token);
  if (problem) {
    process.stderr.write(`FIGMA_ACCESS_TOKEN ${problem}; not sending it.\n`);
    return 1;
  }
  const file = (await fetchFigmaFile(fileKey, token).catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return null;
  })) as Record<string, any> | null;
  if (!file) return 1;
  if (!file.document || typeof file.document !== "object") {
    process.stderr.write("Figma returned JSON that is not a file (no `document`); nothing saved.\n");
    return 1;
  }
  const rel = typeof flags.out === "string" ? flags.out : join(".pattern", "figma", `${fileKey}.json`);
  const abs = isAbsolute(rel) ? rel : resolvePath(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(file));
  const relForTool = isAbsolute(rel) ? abs : rel;
  process.stdout.write(`Saved ${abs}\nRegister it with: register_design_system { project_id: "${deriveProjectId(root)}", figma_json_path: "${relForTool}" }\n`);
  process.stdout.write("Tip: huge files are mostly sub-parts; scope with figma_pages (a page-name list) on registration.\n");
  return 0;
}

function parseFlags(argv: string[]): { pos: string[]; flags: Record<string, string | true> } {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { flags[a.slice(2)] = next; i++; } else flags[a.slice(2)] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

async function main(): Promise<void> {
  const { pos, flags } = parseFlags(process.argv.slice(2));
  const root = typeof flags["project-root"] === "string" ? resolvePath(flags["project-root"] as string) : process.cwd();
  if (pos[0] === "doctor") {
    const lines = await runDoctor(root, { online: flags.online === true, projectId: typeof flags["project-id"] === "string" ? (flags["project-id"] as string) : undefined });
    const mark = { ok: "ok  ", warn: "warn", fail: "FAIL" };
    for (const l of lines) process.stdout.write(`${mark[l.level]}  ${l.text}\n`);
    process.exit(lines.some((l) => l.level === "fail") ? 1 : 0);
  } else if (pos[0] === "fetch-figma") {
    process.exit(await runFetchFigma(root, pos[1], flags));
  }
  process.stderr.write("Usage: pattern doctor [--online] [--project-root <root>] [--project-id <id>]\n       pattern fetch-figma <file_key> [--out <path>] [--project-root <root>]\n");
  process.exit(2);
}

if (!process.env.PATTERN_NO_AUTOSTART) {
  main().catch((err) => {
    process.stderr.write(`pattern crashed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  });
}
