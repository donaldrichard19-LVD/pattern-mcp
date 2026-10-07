#!/usr/bin/env node
/**
 * verify-cli-doctor.mjs -- offline check of `pattern doctor` and `pattern fetch-figma`.
 * Fixture HOME + a local mock Figma API; no network, no spend, no real secrets.
 * Run: node scripts/verify-cli-doctor.mjs (after `npm run build`)
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { spawnSync, spawn } from "node:child_process";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
process.env.PATTERN_NO_AUTOSTART = "1";
const { findServerEntries, figmaTokenProblem, runDoctor } = await import(join(dist, "cli.js"));
let failures = 0;
const check = (label, cond) => (cond ? console.log(`  ok: ${label}`) : (console.error(`  FAIL: ${label}`), failures++));

const tmp = mkdtempSync(join(tmpdir(), "pattern-doctor-"));
const home = join(tmp, "home"), root = join(tmp, "repo");
mkdirSync(home, { recursive: true }); mkdirSync(root, { recursive: true });
writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture-app" }));
writeFileSync(join(root, ".env"), "TYPESAFE_API_KEY=abc\nFIGMA_ACCESS_TOKEN=figd_zzz\n");
const GOOD = "figd_" + "a".repeat(30);
writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { "my-dev-pattern": { command: "npx", args: ["--yes", "pattern-mcp@latest"], env: { ANTHROPIC_API_KEY: "sk-test", FIGMA_ACCESS_TOKEN: GOOD } } } }));
process.env.PATTERN_DESIGN_SYSTEMS_PATH = join(tmp, "ds.json");

console.log("figmaTokenProblem");
check("good token passes", figmaTokenProblem(GOOD) === null);
check("whitespace flagged", /whitespace/.test(figmaTokenProblem(GOOD + "\n") ?? ""));
check("non-ASCII flagged", /non-ASCII/.test(figmaTokenProblem("figd_é") ?? ""));
check("wrong prefix flagged", /figd_/.test(figmaTokenProblem("abc123") ?? ""));

console.log("findServerEntries");
const e = findServerEntries(root, home);
check("finds a differently-named entry by what it launches", e.length === 1 && e[0].env.ANTHROPIC_API_KEY === "sk-test");

console.log("runDoctor");
const lines = await runDoctor(root, { online: false, home });
const text = lines.map((l) => `${l.level}:${l.text}`).join("\n");
check("derived project id shown", /fixture-app/.test(text));
check("missing TYPESAFE key in server env is a warning", /warn:TYPESAFE_API_KEY NOT/.test(text));
check("key stranded in .env is called out", /warn:TYPESAFE_API_KEY.*\.env but not in the server env/.test(text));
check("no design system registered is a warning", /warn:No design system registered for project id "fixture-app"/.test(text));
check("no secret value is ever printed", !text.includes(GOOD) && !text.includes("sk-test"));
check("no failures with a valid setup", !lines.some((l) => l.level === "fail"));
writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { pattern: { command: "npx", env: { FIGMA_ACCESS_TOKEN: GOOD + " " } } } }));
const bad = await runDoctor(root, { online: false, home });
check("bad token + missing Anthropic key fail", bad.filter((l) => l.level === "fail").length === 2);
rmSync(join(home, ".claude.json"));
check("no server entry fails", (await runDoctor(root, { online: false, home })).some((l) => l.level === "fail" && /No Pattern MCP server/.test(l.text)));

console.log("fetch-figma (mock API)");
let mode = "ok";
const srv = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (mode === "403") { res.statusCode = 403; return res.end(JSON.stringify({ status: 403, err: "Invalid token" })); }
  if (mode === "nodoc") return res.end(JSON.stringify({ hello: "world" }));
  res.end(JSON.stringify({ document: { id: "0:0", children: [] }, name: "Mock" }));
});
await new Promise((r) => srv.listen(0, r));
const env = { ...process.env, FIGMA_API_URL: `http://127.0.0.1:${srv.address().port}`, FIGMA_ACCESS_TOKEN: GOOD, HOME: home };
delete env.PATTERN_NO_AUTOSTART;
const run = (...a) => new Promise((res) => { const p = spawn("node", [join(dist, "cli.js"), ...a, "--project-root", root], { env }); let o = "", er = ""; p.stdout.on("data", (d) => (o += d)); p.stderr.on("data", (d) => (er += d)); p.on("close", (code) => res({ code, o, er })); });
let r = await run("fetch-figma", "KEY1");
check("saves a real file and prints the figma_json_path call", r.code === 0 && existsSync(join(root, ".pattern/figma/KEY1.json")) && /figma_json_path: "\.pattern\/figma\/KEY1\.json"/.test(r.o));
rmSync(join(root, ".pattern"), { recursive: true });
mode = "403"; r = await run("fetch-figma", "KEY2");
check("403 saves nothing and exits 1", r.code === 1 && /403/.test(r.er) && !existsSync(join(root, ".pattern/figma/KEY2.json")));
mode = "nodoc"; r = await run("fetch-figma", "KEY3");
check("non-file JSON saves nothing", r.code === 1 && /not a file/.test(r.er) && !existsSync(join(root, ".pattern/figma/KEY3.json")));
env.FIGMA_ACCESS_TOKEN = GOOD + "\n"; mode = "ok"; r = await run("fetch-figma", "KEY4");
check("malformed token is refused before any request", r.code === 1 && /not sending it/.test(r.er));
r = spawnSync("node", [join(dist, "cli.js")], { env });
check("no subcommand prints usage, exit 2", r.status === 2);
srv.close(); rmSync(tmp, { recursive: true, force: true });
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("all checks passed");
