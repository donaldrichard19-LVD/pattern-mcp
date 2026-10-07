#!/usr/bin/env node
/**
 * verify-npx-commands.mjs -- static guard, no network, no build needed.
 *
 * `pattern`, `pattern-check-gate` and `pattern-check-gate-hook` are bin names
 * inside the pattern-mcp package, NOT npm packages. `npx pattern-check-gate x`
 * asks the registry for a package of that name (404 for the first two bins; and
 * `pattern` is an UNRELATED real package), so it must be written
 * `npx [--yes] -p pattern-mcp <bin> ...`. `npx pattern-mcp ...` is correct.
 * Shipped in 0.19.0 and earlier: the CI template, the hook `init` wrote, the
 * first-run notice and the docs all had the bare form.
 *
 * Fails if any tracked text file contains a bare form (including
 * spawnSync("npx", ["--yes", "<bin>"...)), or if a bin we name does not exist
 * in package.json. Files that deliberately quote the broken form are listed.
 *
 * Run: node scripts/verify-npx-commands.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BAD = new Set(["pattern", "pattern-check-gate", "pattern-check-gate-hook"]);
// Files that quote the broken form on purpose (the detector itself and its fixtures).
const ALLOW = new Set(["src/gate-commands.ts", "scripts/verify-npx-commands.mjs", "scripts/verify-check-gate.mjs"]);
const TEXT = /\.(ts|tsx|mjs|js|json|md|yml|yaml|sh|txt)$/;

let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok: ${label}`); else { console.error(`  FAIL: ${label}${detail ? `\n${detail}` : ""}`); failures++; } };

const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter((f) => f && TEXT.test(f) && !f.endsWith("package-lock.json") && !ALLOW.has(f));
const hits = [];
for (const f of files) {
  let text;
  try { text = readFileSync(resolve(root, f), "utf8"); } catch { continue; }
  text.split("\n").forEach((line, i) => {
    // `npx` [--yes|-y] <token>  where the first non-flag token is one of our bin names
    for (const m of line.matchAll(/\bnpx\s+(?:(?:--yes|-y)\s+)?([\w@./-]+)/g)) if (BAD.has(m[1])) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
    // spawnSync("npx", ["--yes", "<bin>", ...])
    for (const m of line.matchAll(/["']npx["']\s*,\s*\[\s*(?:["'](?:--yes|-y)["']\s*,\s*)?["']([\w@./-]+)["']/g)) if (BAD.has(m[1])) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
  });
}
console.log(`scanned ${files.length} tracked files`);
check("no bare `npx <pattern bin>` (use `npx --yes -p pattern-mcp <bin>`)", hits.length === 0, hits.map((h) => `    ${h}`).join("\n"));

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
check("the bins we tell people to run exist in package.json", [...BAD].every((b) => b in pkg.bin) && pkg.name === "pattern-mcp");
check("`npx pattern-mcp` stays valid (bin name equals package name)", pkg.bin["pattern-mcp"] !== undefined);

const gc = readFileSync(resolve(root, "src/gate-commands.ts"), "utf8");
check("gate-commands.ts is the single source for the hook / init commands", /HOOK_COMMAND = `\$\{GATE_NPX\} pattern-check-gate-hook`/.test(gc) && /GATE_NPX = "npx --yes -p pattern-mcp"/.test(gc));
const tpl = readFileSync(resolve(root, "templates/github-workflows/pattern-gate.yml"), "utf8");
const hookTpl = readFileSync(resolve(root, "templates/claude-settings/settings.json"), "utf8");
check("CI template and settings template use the -p pattern-mcp form", /npx --yes -p pattern-mcp pattern-check-gate verify/.test(tpl) && /npx --yes -p pattern-mcp pattern-check-gate-hook/.test(hookTpl));

console.log(failures ? `${failures} failed` : "All checks passed.");
process.exit(failures ? 1 : 0);
