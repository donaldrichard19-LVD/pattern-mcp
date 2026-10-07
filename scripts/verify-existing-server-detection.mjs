#!/usr/bin/env node
/**
 * verify-existing-server-detection.mjs -- `init` and `doctor` must recognise a
 * Pattern server under ANY name, and say why one cannot start. Offline.
 *
 * Found on a real machine: Claude Code had Pattern as "ui-component-judgment"
 * (a dev checkout with no node_modules, so CONNECTION_CLOSED). `init` looked
 * only for the name "pattern", so it would have added a second, keyless server.
 *
 * Run: node scripts/verify-existing-server-detection.mjs (after `npm run build`)
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok: ${label}`); else { console.error(`  FAIL: ${label}${detail ? `\n${detail}` : ""}`); failures++; } };
const { isPatternServerEntry, findPatternEntry, patternServersInClaudeList, diagnoseLocalEntry } = await import(join(root, "dist/server-entry.js"));

console.log("1. recognising an entry by what it runs, not only its name");
check('named "pattern"', isPatternServerEntry("pattern", {}));
check("npx pattern-mcp under another name", isPatternServerEntry("my-ui", { command: "npx", args: ["pattern-mcp"] }));
check("pinned: npx --yes pattern-mcp@latest", isPatternServerEntry("x", { command: "npx", args: ["--yes", "pattern-mcp@latest"] }));
check("a dev checkout path", isPatternServerEntry("ui-component-judgment", { command: "node", args: ["/home/u/ui-component-judgment-mcp/dist/index.js"] }));
{
  const clone = mkdtempSync(join(tmpdir(), "somefolder-"));
  mkdirSync(join(clone, "dist"), { recursive: true });
  writeFileSync(join(clone, "dist", "index.js"), "//\n");
  writeFileSync(join(clone, "package.json"), JSON.stringify({ name: "pattern-mcp" }));
  check("a clone in a folder with ANY name is recognised by its package.json name", isPatternServerEntry("whatever", { command: "node", args: [join(clone, "dist", "index.js")] }));
  const other = mkdtempSync(join(tmpdir(), "somefolder-"));
  mkdirSync(join(other, "dist"), { recursive: true });
  writeFileSync(join(other, "dist", "index.js"), "//\n");
  writeFileSync(join(other, "package.json"), JSON.stringify({ name: "someone-elses-server" }));
  check("...but another package's local server is not", !isPatternServerEntry("whatever", { command: "node", args: [join(other, "dist", "index.js")] }));
}
check("a RELATIVE script path is never resolved against our own cwd", !isPatternServerEntry("a", { command: "node", args: ["x.js"] }) && !isPatternServerEntry("a", { command: "node", args: ["dist/index.js"] }));
check("an unrelated server is not Pattern", !isPatternServerEntry("posthog", { command: "npx", args: ["-y", "mcp-remote", "https://mcp.posthog.com/mcp"] }) && !isPatternServerEntry("x", null) && !isPatternServerEntry("x", "str"));
check("findPatternEntry picks it out of a map and reports its name", findPatternEntry({ a: { command: "node", args: ["x.js"] }, mine: { command: "npx", args: ["pattern-mcp"] } })?.name === "mine");
check("findPatternEntry: none -> null", findPatternEntry({ a: { command: "node" } }) === null && findPatternEntry(undefined) === null);

console.log("2. parsing `claude mcp list` (real output from the machine that exposed this)");
const LIST = `Checking MCP server health…

claude.ai Claude Docs: https://api.anthropic.com/v1/pages/mcp - ✔ Connected
claude.ai PostHog: https://mcp.posthog.com/mcp - ✔ Connected
claude.ai Calvin AI: https://calvin-app.onrender.com/mcp/7ffe - ! Needs authentication
plugin:vercel:vercel: https://mcp.vercel.com (HTTP) - ✔ Connected
ui-component-judgment: node /home/u/ui-component-judgment-mcp/dist/index.js - ✘ Failed to connect — CONNECTION_CLOSED: Connection closed
`;
const parsed = patternServersInClaudeList(LIST);
check("finds the hand-named server and flags it as failing", parsed.length === 1 && parsed[0].name === "ui-component-judgment" && parsed[0].ok === false);
check("a healthy one is ok:true, and names with spaces/colons/URLs elsewhere do not confuse it", patternServersInClaudeList(LIST.replace("✘ Failed to connect — CONNECTION_CLOSED: Connection closed", "✔ Connected"))[0].ok === true);
check('a server literally named "pattern" is found', patternServersInClaudeList("pattern: npx pattern-mcp - ✔ Connected\n")[0]?.name === "pattern");
check("no Pattern in the list -> empty", patternServersInClaudeList("claude.ai PostHog: https://mcp.posthog.com/mcp - ✔ Connected\n").length === 0 && patternServersInClaudeList("").length === 0);

console.log("3. a local entry that cannot start is diagnosed");
{
  const pkg = mkdtempSync(join(tmpdir(), "pattern-local-"));
  mkdirSync(join(pkg, "dist"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "pattern-mcp" }));
  writeFileSync(join(pkg, "dist", "index.js"), "// built\n");
  const entry = { command: "node", args: [join(pkg, "dist", "index.js")] };
  const d = diagnoseLocalEntry(entry);
  check("no node_modules -> says so, and how to fix", !!d && /no node_modules/.test(d.problem) && /npm ci && npm run build/.test(d.fix) && /pattern-mcp@latest/.test(d.fix));
  mkdirSync(join(pkg, "node_modules"));
  check("with node_modules -> nothing to report", diagnoseLocalEntry(entry) === null);
  check("script missing -> says so", /does not exist/.test(diagnoseLocalEntry({ command: "node", args: [join(pkg, "nope.js")] })?.problem ?? ""));
  check("npx entries are not 'local'", diagnoseLocalEntry({ command: "npx", args: ["--yes", "pattern-mcp@latest"] }) === null);
}

console.log("4. `pattern doctor` shows the name and flags the broken entry");
{
  const home = mkdtempSync(join(tmpdir(), "pattern-home-"));
  const pkg = mkdtempSync(join(tmpdir(), "pattern-local-"));
  mkdirSync(join(pkg, "dist"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "pattern-mcp" }));
  writeFileSync(join(pkg, "dist", "index.js"), "//\n");
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { "ui-component-judgment": { type: "stdio", command: "node", args: [join(pkg, "dist", "index.js")], env: { ANTHROPIC_API_KEY: "sk-ant-x" } } } }));
  const doctor = () => {
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    delete env.PATTERN_NO_AUTOSTART;
    const r = spawnSync(process.execPath, [join(root, "dist/cli.js"), "doctor", "--project-root", mkdtempSync(join(tmpdir(), "pattern-proj-"))], { env, encoding: "utf8", timeout: 60000 });
    return r.stdout;
  };
  const text = doctor();
  check('reports the entry and its name ("ui-component-judgment")', /Server entry: ~\/\.claude\.json \(user\) \(named "ui-component-judgment"\)/.test(text), text);
  check("FAILS with the reason (no node_modules) instead of a clean bill of health", /FAIL\s+This server entry cannot start: .*no node_modules/.test(text));
  mkdirSync(join(pkg, "node_modules"));
  check("once node_modules exists the failure is gone", !/cannot start/.test(doctor()));
}

console.log("5. init adds no duplicate next to a hand-named entry (Cursor scenario, throwaway home/project)");
{
  const home = mkdtempSync(join(tmpdir(), "pattern-home-"));
  const proj = mkdtempSync(join(tmpdir(), "pattern-proj-"));
  mkdirSync(join(proj, ".cursor"), { recursive: true });
  const original = JSON.stringify({ mcpServers: { "ui-component-judgment": { command: "npx", args: ["--yes", "pattern-mcp@latest"], env: { ANTHROPIC_API_KEY: "sk-ant-x" } } } }, null, 2) + "\n";
  writeFileSync(join(proj, ".cursor", "mcp.json"), original);
  // a fake `claude` that fails any call, so init can never touch the real Claude Code
  const bin = mkdtempSync(join(tmpdir(), "pattern-bin-"));
  writeFileSync(join(bin, "claude"), "#!/bin/sh\nexit 1\n"); chmodSync(join(bin, "claude"), 0o755);
  const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: `${bin}:/usr/bin:/bin`, PATTERN_NO_CONNECT_NOTICE: "1", PATTERN_NO_ENFORCEMENT_NOTICE: "1", PATTERN_TELEMETRY: "0" };
  delete env.PATTERN_NO_AUTOSTART;
  const r = spawnSync(process.execPath, [join(root, "dist/index.js"), "init", "--yes"], { cwd: proj, env, encoding: "utf8", timeout: 60000 });
  const after = readFileSync(join(proj, ".cursor", "mcp.json"), "utf8");
  check("init exits 0", r.status === 0, r.stderr);
  check("mcp.json is byte-for-byte unchanged (no second 'pattern' server)", after === original);
  check('says it is already configured, naming the entry', /already configured .* \(as "ui-component-judgment"\)/.test(r.stdout));
}

console.log(failures ? `${failures} failed` : "All checks passed.");
process.exit(failures ? 1 : 0);
