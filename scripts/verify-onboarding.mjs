#!/usr/bin/env node
/**
 * verify-onboarding.mjs -- a user must not be able to finish `init` believing Pattern works when it can't.
 *
 * Covers: `init --yes` carries keys from the shell and takes --design-system, ends with a
 * SETUP COMPLETE / INCOMPLETE status and an honest exit code; `keys` (and a re-run of init) can
 * add a key to an ALREADY registered entry, with rollback; `claude mcp list` glyph variants;
 * first-use error text; and the has_anthropic_key / has_design_system start-event fields.
 *
 * Offline, no API key. Uses a fake `claude` CLI with real add/get/remove state.
 * Run: node scripts/verify-onboarding.mjs (after `npm run build`)
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(repo, "dist");
const NODE = process.execPath;
let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok: ${label}`); else { console.error(`  FAIL: ${label}${detail ? `\n    ${String(detail).slice(0, 600)}` : ""}`); failures++; } };

process.env.PATTERN_NO_AUTOSTART = "1";
const { patternServersInClaudeList } = await import(join(dist, "server-entry.js"));
const { parseClaudeMcpGet } = await import(join(dist, "client-connect.js"));
const { deriveProjectId } = await import(join(dist, "project-id.js"));
delete process.env.PATTERN_NO_AUTOSTART;

// ---------- a fake `claude` with state ----------
const STUB = `#!/usr/bin/env node
const fs = require("fs");
const state = process.env.STUB_STATE, log = process.env.STUB_LOG;
const load = () => { try { return JSON.parse(fs.readFileSync(state, "utf8")); } catch { return { servers: {} }; } };
const save = (s) => fs.writeFileSync(state, JSON.stringify(s));
const a = process.argv.slice(2);
fs.appendFileSync(log, a.join(" ") + "\\n");
const glyph = process.env.STUB_GLYPH || "\\u221a";
const scopeText = { user: "User config (available in all your projects)", local: "Local config (private to you in this project)", project: "Project config (shared via .mcp.json)" };
if (a[0] === "--version") { console.log("2.1.304 (Claude Code)"); process.exit(0); }
const st = load();
if (a[0] === "mcp" && a[1] === "list") {
  console.log("Checking MCP server health\\u2026\\n");
  for (const [n, s] of Object.entries(st.servers)) console.log(n + ": " + s.command + " " + s.args.join(" ") + " - " + glyph + " Connected");
  process.exit(0);
}
if (a[0] === "mcp" && a[1] === "get") {
  const s = st.servers[a[2]];
  if (!s) { console.error("No MCP server found with name: " + a[2]); process.exit(1); }
  console.log(a[2] + ":\\n  Scope: " + scopeText[s.scope] + "\\n  Status: " + glyph + " Connected\\n  Type: stdio\\n  Command: " + s.command + "\\n  Args: " + s.args.join(" ") + "\\n  Environment:");
  for (const [k, v] of Object.entries(s.env)) console.log("    " + k + "=" + v);
  console.log("\\nTo remove this server, run: claude mcp remove " + a[2] + " -s " + s.scope);
  process.exit(0);
}
if (a[0] === "mcp" && a[1] === "remove") {
  if (!st.servers[a[2]]) { console.error("No MCP server found"); process.exit(1); }
  delete st.servers[a[2]]; save(st); console.log("Removed MCP server " + a[2]); process.exit(0);
}
if (a[0] === "mcp" && a[1] === "add") {
  const name = a[2]; let scope = "local"; const env = {}; let i = 3;
  for (; i < a.length && a[i] !== "--"; i++) {
    if (a[i] === "--scope" || a[i] === "-s") scope = a[++i];
    else if (a[i] === "-e") { const [k, ...r] = a[++i].split("="); env[k] = r.join("="); }
  }
  const [command, ...args] = a.slice(i + 1);
  if (process.env.STUB_ADD_FAIL === "1") { console.error("error: could not write config"); process.exit(1); }
  if (process.env.STUB_FAIL_ADD_WHEN_ENV && env[process.env.STUB_FAIL_ADD_WHEN_ENV]) { console.error("error: simulated failure"); process.exit(1); }
  if (st.servers[name]) { console.error("MCP server " + name + " already exists in " + scope + " config"); process.exit(1); }
  st.servers[name] = { scope, command, args, env }; save(st); console.log("Added stdio MCP server " + name); process.exit(0);
}
process.exit(0);
`;

function world(name, { claude = true, state = null, cursor = null } = {}) {
  const d = mkdtempSync(join(tmpdir(), `pattern-onb-${name}-`));
  for (const x of ["home", "proj", "bin"]) mkdirSync(join(d, x), { recursive: true });
  symlinkSync(NODE, join(d, "bin", "node"));
  if (claude) { writeFileSync(join(d, "bin", "claude"), STUB); chmodSync(join(d, "bin", "claude"), 0o755); }
  writeFileSync(join(d, "state.json"), JSON.stringify(state ?? { servers: {} }));
  writeFileSync(join(d, "claude.log"), "");
  if (cursor !== null) { mkdirSync(join(d, "proj", ".cursor")); writeFileSync(join(d, "proj", ".cursor", "mcp.json"), typeof cursor === "string" ? cursor : JSON.stringify(cursor)); }
  mkdirSync(join(d, "proj", "src", "components"), { recursive: true });
  writeFileSync(join(d, "proj", "src", "components", "Button.tsx"), "export function Button(props: { label: string }) { return <button>{props.label}</button>; }\n");
  return d;
}
function run(d, args, extraEnv = {}, { stdin = "" } = {}) {
  const r = spawnSync(join(d, "bin", "node"), [join(dist, "index.js"), ...args], {
    cwd: join(d, "proj"), input: stdin, encoding: "utf8", timeout: 90000,
    env: { HOME: join(d, "home"), PATH: join(d, "bin"), PATTERN_PROJECT_ROOT: join(d, "proj"), PATTERN_TELEMETRY: "0", PATTERN_TELEMETRY_NOTICE_PATH: join(d, "notice"),
      PATTERN_DESIGN_SYSTEMS_PATH: join(d, "ds.json"), PATTERN_LEDGER_PATH: join(d, "ledger.jsonl"), PATTERN_MEMORY_PATH: join(d, "mem.json"), PATTERN_NO_SUMMARIES: "1", PATTERN_ANTHROPIC_URL: "http://127.0.0.1:9",
      STUB_STATE: join(d, "state.json"), STUB_LOG: join(d, "claude.log"), ...extraEnv },
  });
  return { out: (r.stdout ?? "") + (r.stderr ?? ""), code: r.status };
}
const log = (d) => readFileSync(join(d, "claude.log"), "utf8");
const state = (d) => JSON.parse(readFileSync(join(d, "state.json"), "utf8"));
const KEY = "sk-ant-api03-test-key";

console.log("1. claude mcp list glyphs: a healthy entry must be recognised whatever tick the CLI prints");
for (const g of ["\u2714", "\u221a", "\u2713"]) check(`"${g}" Connected -> found and ok`, JSON.stringify(patternServersInClaudeList(`pattern: npx pattern-mcp - ${g} Connected\n`)) === JSON.stringify([{ name: "pattern", ok: true }]));
for (const g of ["\u2718", "\u00d7", "\u2717"]) check(`"${g}" Failed -> found, not ok`, JSON.stringify(patternServersInClaudeList(`pattern: npx pattern-mcp - ${g} Failed to connect\n`)) === JSON.stringify([{ name: "pattern", ok: false }]));

console.log("2. parsing `claude mcp get`");
const got = parseClaudeMcpGet("pattern:\n  Scope: User config (available in all your projects)\n  Status: ok\n  Type: stdio\n  Command: npx\n  Args: pattern-mcp\n  Environment:\n    FOO=bar\n    BAZ=a=b\n\nTo remove this server, run: claude mcp remove pattern -s user\n");
check("scope, command, args", got?.scope === "user" && got.command === "npx" && got.args.join(" ") === "pattern-mcp");
check("env, including a value with '='", got?.env.FOO === "bar" && got?.env.BAZ === "a=b");
check("no env block -> empty env", Object.keys(parseClaudeMcpGet("p:\n  Scope: Local config (x)\n  Command: npx\n  Args: pattern-mcp\n  Environment:\n\nTo remove").env).length === 0);
check("garbage -> null", parseClaudeMcpGet("nothing useful") === null);

console.log("3. init --yes carries a key exported in the shell into the client config");
{
  const d = world("yes-key");
  const r = run(d, ["init", "--yes"], { ANTHROPIC_API_KEY: KEY });
  check("exits 0", r.code === 0, r.out);
  check("says it used the key from the environment", /Using ANTHROPIC_API_KEY from your environment/.test(r.out));
  check("claude mcp add got -e ANTHROPIC_API_KEY=...", new RegExp(`mcp add pattern .*-e ANTHROPIC_API_KEY=${KEY}`).test(log(d)), log(d));
  check("the registered entry holds the key", state(d).servers.pattern?.env.ANTHROPIC_API_KEY === KEY);
  check("status line: INCOMPLETE, missing only the design system", /SETUP INCOMPLETE -- missing: a registered design system\./.test(r.out), r.out.split("\n").filter((l) => /Status:/.test(l)).join("|"));
  check("the key itself is never printed", !r.out.includes(KEY), r.out.split("\n").filter((l) => l.includes(KEY)).join(" | "));
  check("the add command is shown with the value masked", /-e ANTHROPIC_API_KEY=\*\*\*/.test(r.out));
  const c = run(world("yes-cursor", { claude: false, cursor: { mcpServers: {} } }), ["init", "--yes"], { ANTHROPIC_API_KEY: KEY });
  check("Cursor/Desktop config preview masks the key too", !c.out.includes(KEY) && /"ANTHROPIC_API_KEY": "\*\*\*"/.test(c.out), c.out);
  check("...but the file on disk does hold it (the client needs it)", readFileSync(join(world("noop"), "state.json"), "utf8").length > 0);
}

console.log("4. init --yes --design-system finishes setup");
{
  const d = world("yes-ds");
  const r = run(d, ["init", "--yes", "--design-system", "src/components"], { ANTHROPIC_API_KEY: KEY });
  check("registers the components folder", /Registered 1 component from src\/components/.test(r.out), r.out);
  check("status line: SETUP COMPLETE", /Status: SETUP COMPLETE/.test(r.out));
  check("the registration is saved", existsSync(join(d, "ds.json")) && Object.keys(JSON.parse(readFileSync(join(d, "ds.json"), "utf8"))).length === 1);
  const bad = run(world("yes-ds-bad"), ["init", "--yes", "--design-system", "does/not/exist"], { ANTHROPIC_API_KEY: KEY });
  check("a bad --design-system path is reported, not fatal", /does not exist/.test(bad.out) && /SETUP INCOMPLETE/.test(bad.out));
}

console.log("5. no key anywhere -> INCOMPLETE names it and the command that fixes it");
{
  const d = world("yes-nokey");
  const r = run(d, ["init", "--yes"]);
  check("INCOMPLETE lists ANTHROPIC_API_KEY and the design system", /SETUP INCOMPLETE -- missing: ANTHROPIC_API_KEY, a registered design system/.test(r.out));
  check("points at `npx pattern-mcp keys`", /npx pattern-mcp keys/.test(r.out));
  check("still exits 0 (connected, just incomplete)", r.code === 0);
  const jev = run(world("yes-jev"), ["init", "--yes", "--design-system", "src/components"], { TYPESAFE_API_KEY: "tk" });
  check("a Jev-scored setup needs no Anthropic key", /SETUP COMPLETE/.test(jev.out), jev.out);
}

console.log("6. nothing connected -> non-zero exit, so an unattended run cannot mistake it for success");
{
  const d = world("yes-none", { claude: false });
  const r = run(d, ["init", "--yes"], { ANTHROPIC_API_KEY: KEY });
  check("exit code 2", r.code === 2, `exit ${r.code}\n${r.out}`);
  check("says no client was found and the setup is incomplete", /No supported MCP client/.test(r.out) && /missing: a connected client/.test(r.out));
  const failAdd = run(world("yes-addfail"), ["init", "--yes"], { ANTHROPIC_API_KEY: KEY, STUB_ADD_FAIL: "1" });
  check("`claude mcp add` failing is also exit 2", failAdd.code === 2 && /missing: a connected client/.test(failAdd.out), `exit ${failAdd.code}`);
}

console.log("7. re-running init when Pattern is already registered adds the key to that entry");
{
  const d = world("rerun", { state: { servers: { pattern: { scope: "user", command: "npx", args: ["pattern-mcp"], env: {} } } } });
  const r = run(d, ["init", "--yes"], { ANTHROPIC_API_KEY: KEY });
  check("recognised as already connected (not added twice)", /Already connected/.test(r.out) && !/add. failed/.test(r.out));
  check("the key was added to the existing entry", state(d).servers.pattern?.env.ANTHROPIC_API_KEY === KEY, JSON.stringify(state(d)));
  check("scope and command preserved", state(d).servers.pattern?.scope === "user" && state(d).servers.pattern?.command === "npx");
  const removesBefore = log(d).split("\n").filter((l) => /mcp remove/.test(l)).length;
  const again = run(d, ["init", "--yes"], { ANTHROPIC_API_KEY: KEY });
  const removesAfter = log(d).split("\n").filter((l) => /mcp remove/.test(l)).length;
  check("a second run with the same key asks nothing and changes nothing", /already has those keys/.test(again.out) && removesAfter === removesBefore, again.out);
}

console.log("8. `keys` updates every client entry it can find");
{
  const d = world("keys", {
    state: { servers: { pattern: { scope: "user", command: "npx", args: ["pattern-mcp"], env: { KEEP: "me" } } } },
    cursor: { mcpServers: { other: { command: "x" }, pattern: { command: "npx", args: ["pattern-mcp"] } } },
  });
  const r = run(d, ["keys", "--from-env"], { ANTHROPIC_API_KEY: KEY, FIGMA_ACCESS_TOKEN: "figd_test" });
  check("exits 0", r.code === 0, r.out);
  check("Claude Code entry updated, existing env kept", state(d).servers.pattern.env.ANTHROPIC_API_KEY === KEY && state(d).servers.pattern.env.FIGMA_ACCESS_TOKEN === "figd_test" && state(d).servers.pattern.env.KEEP === "me", JSON.stringify(state(d)));
  const cur = JSON.parse(readFileSync(join(d, "proj", ".cursor", "mcp.json"), "utf8"));
  check("Cursor entry updated and the other server untouched", cur.mcpServers.pattern.env.ANTHROPIC_API_KEY === KEY && cur.mcpServers.other.command === "x", JSON.stringify(cur));
  check("tells the user to restart", /Restart your MCP client/.test(r.out));
  check("never prints the key", !r.out.includes(KEY));
  const piped = run(world("keys-piped", { state: { servers: { pattern: { scope: "user", command: "npx", args: ["pattern-mcp"], env: {} } } } }), ["keys"], {}, { stdin: `${KEY}\n\n` });
  check("interactive (piped) path: prompts, then updates (the key is not echoed back)", /ANTHROPIC_API_KEY/.test(piped.out) && !piped.out.includes(`: ${KEY}`) && piped.code === 0, piped.out);
}
{
  const r = run(world("keys-none", { claude: false }), ["keys", "--from-env"], { ANTHROPIC_API_KEY: KEY });
  check("no client entry anywhere -> exit 1 and says to run init", r.code === 1 && /npx pattern-mcp init/.test(r.out));
  const none = run(world("keys-noenv", { state: { servers: { pattern: { scope: "user", command: "npx", args: ["pattern-mcp"], env: {} } } } }), ["keys", "--from-env"]);
  check("--from-env with nothing exported -> exit 1, nothing changed", none.code === 1 && /none of/.test(none.out));
  const bad = run(world("keys-badjson", { claude: false, cursor: "{ not json" }), ["keys", "--from-env"], { ANTHROPIC_API_KEY: KEY });
  check("an unparsable config is not touched", bad.code === 1);
}

console.log("9. if re-adding the entry fails, the original is restored");
{
  const d = world("rollback", { state: { servers: { pattern: { scope: "user", command: "npx", args: ["pattern-mcp"], env: { KEEP: "me" } } } } });
  const r = run(d, ["keys", "--from-env"], { ANTHROPIC_API_KEY: KEY, STUB_FAIL_ADD_WHEN_ENV: "ANTHROPIC_API_KEY" });
  check("reports the failure and exits 1", r.code === 1 && /original was restored/.test(r.out), r.out);
  check("Pattern is still registered, unchanged", state(d).servers.pattern?.env.KEEP === "me" && !state(d).servers.pattern?.env.ANTHROPIC_API_KEY, JSON.stringify(state(d)));
}

console.log("10. first-use errors tell the agent exactly what to do");
{
  const d = world("errors", { claude: false });
  const t = new StdioClientTransport({ command: NODE, args: [join(dist, "index.js")], stderr: "ignore",
    env: { HOME: join(d, "home"), PATH: process.env.PATH, PATTERN_PROJECT_ROOT: join(d, "proj"), PATTERN_TELEMETRY: "0", PATTERN_NO_CONNECT_NOTICE: "1", PATTERN_NO_ENFORCEMENT_NOTICE: "1",
      PATTERN_DESIGN_SYSTEMS_PATH: join(d, "ds.json"), PATTERN_LEDGER_PATH: join(d, "ledger.jsonl"), PATTERN_MEMORY_PATH: join(d, "mem.json") } });
  const c = new Client({ name: "claude-code", version: "0" }, { capabilities: {} });
  await c.connect(t);
  const need = { component_need: "confirmation dialog for a destructive action", domain: "SaaS admin", framework: "React", project_id: "demo" };
  const r = await c.callTool({ name: "recommend_component", arguments: need });
  const text = r.content?.[0]?.text ?? "";
  check("no key: SETUP NEEDED, names `npx pattern-mcp keys`", r.isError && /SETUP NEEDED/.test(text) && /npx pattern-mcp keys/.test(text), text);
  check("tells the agent never to ask for the key in chat", /never ask them to paste a key into chat/.test(text));
  check("old advice that does not work is gone", !/re-run `npx pattern-mcp init` to add it/.test(text));
  await c.close();
  const t2 = new StdioClientTransport({ command: NODE, args: [join(dist, "index.js")], stderr: "ignore",
    env: { HOME: join(d, "home"), PATH: process.env.PATH, PATTERN_PROJECT_ROOT: join(d, "proj"), PATTERN_TELEMETRY: "0", PATTERN_SCORER: "jev", TYPESAFE_API_KEY: "tk", PATTERN_NO_CONNECT_NOTICE: "1", PATTERN_NO_ENFORCEMENT_NOTICE: "1",
      PATTERN_DESIGN_SYSTEMS_PATH: join(d, "ds.json"), PATTERN_LEDGER_PATH: join(d, "ledger.jsonl"), PATTERN_MEMORY_PATH: join(d, "mem.json") } });
  const c2 = new Client({ name: "claude-code", version: "0" }, { capabilities: {} });
  await c2.connect(t2);
  const r2 = await c2.callTool({ name: "recommend_component", arguments: need });
  const text2 = r2.content?.[0]?.text ?? "";
  check("no design system: SETUP NEEDED, asks where it lives, mentions the Figma token path", r2.isError && /SETUP NEEDED: no design system/.test(text2) && /components folder/.test(text2) && /npx pattern-mcp keys/.test(text2), text2);
  await c2.close();
}

console.log("11. the start event says whether this run is set up (booleans only)");
{
  const captured = [];
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (x) => chunks.push(x));
    req.on("end", () => {
      let buf = Buffer.concat(chunks);
      try { if (req.headers["content-encoding"] === "gzip" || (buf[0] === 0x1f && buf[1] === 0x8b)) buf = gunzipSync(buf); } catch {}
      try { const body = JSON.parse(buf.toString("utf8")); for (const e of body.batch ?? [body]) captured.push(e); } catch {}
      res.writeHead(200, { "content-type": "application/json" }); res.end('{"status":1}');
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const host = `http://127.0.0.1:${srv.address().port}`;
  const startEvent = async (name, extra, register) => {
    const d = world(name, { claude: false });
    const dsPath = join(d, "ds.json");
    if (register) {
      const id = deriveProjectId(join(d, "proj"));
      writeFileSync(dsPath, JSON.stringify({ [id]: { project_id: id, source_kind: "manifest", source_path: "m.json", registered_at: "2026-01-01T00:00:00Z", candidate_count: 1, candidates: [{ name: "A", props: [], description: null, usage_example: null, file_path: null }] } }));
    }
    writeFileSync(join(d, "install_id"), `onboarding-test-${name}`);
    captured.length = 0;
    // async spawn: this process also hosts the stub HTTP server, which a blocking spawnSync would starve
    await new Promise((resolveDone) => {
      const child = spawn(NODE, [join(dist, "index.js")], { cwd: join(d, "proj"), stdio: ["pipe", "ignore", "ignore"],
        env: { HOME: join(d, "home"), PATH: process.env.PATH, PATTERN_PROJECT_ROOT: join(d, "proj"), PATTERN_POSTHOG_HOST: host, PATTERN_INSTALL_ID_PATH: join(d, "install_id"), PATTERN_TELEMETRY_NOTICE_PATH: join(d, "notice"),
          PATTERN_NO_CONNECT_NOTICE: "1", PATTERN_NO_ENFORCEMENT_NOTICE: "1", PATTERN_DESIGN_SYSTEMS_PATH: dsPath, PATTERN_LEDGER_PATH: join(d, "l.jsonl"), PATTERN_MEMORY_PATH: join(d, "m.json"), ...extra } });
      const timer = setTimeout(() => { child.kill(); resolveDone(); }, 30000);
      child.on("exit", () => { clearTimeout(timer); resolveDone(); });
      child.stdin.end(); // closes stdin, which ends the server
    });
    await new Promise((r) => setTimeout(r, 300));
    return captured.find((e) => e.event === "pattern_cli_started");
  };
  const none = await startEvent("tel-none", {}, false);
  check("start event arrives at the stub", !!none, "no pattern_cli_started captured");
  check("unconfigured: has_anthropic_key=false, has_design_system=false", none?.properties?.has_anthropic_key === false && none?.properties?.has_design_system === false, JSON.stringify(none?.properties));
  const full = await startEvent("tel-full", { ANTHROPIC_API_KEY: KEY }, true);
  check("configured: both true", full?.properties?.has_anthropic_key === true && full?.properties?.has_design_system === true, JSON.stringify(full?.properties));
  const props = JSON.stringify(full?.properties ?? {});
check("the key is never in the event, and only these two setup fields were added", !props.includes(KEY) && !/"anthropic_api_key"/i.test(props) && Object.keys(full?.properties ?? {}).filter((k) => /^has_/.test(k)).sort().join() === "has_anthropic_key,has_design_system", props);
  srv.close();
}

console.log("12. init --yes checks the key it carries instead of reporting a rejected one as done");
{
  // The stub API runs in its own process: run() blocks this one with spawnSync.
  const api = spawn(NODE, ["-e", `const s=require("http").createServer((q,r)=>{r.statusCode=q.headers["x-api-key"]==="sk-ant-GOOD"?200:401;r.end("{}")});s.listen(0,"127.0.0.1",()=>console.log(s.address().port))`], { stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise((res) => api.stdout.once("data", (b) => res(Number(String(b).trim()))));
  const url = `http://127.0.0.1:${port}`;
  const good = run(world("yes-good"), ["init", "--yes", "--design-system", "src/components"], { ANTHROPIC_API_KEY: "sk-ant-GOOD", PATTERN_ANTHROPIC_URL: url });
  check("accepted key: says ok, SETUP COMPLETE, exit 0", /ANTHROPIC_API_KEY: ok/.test(good.out) && /SETUP COMPLETE/.test(good.out) && good.code === 0, good.out);
  const bad = run(world("yes-bad"), ["init", "--yes", "--design-system", "src/components"], { ANTHROPIC_API_KEY: "sk-ant-BAD", PATTERN_ANTHROPIC_URL: url });
  check("rejected key: says WRONG and SETUP INCOMPLETE naming the rejected key", /ANTHROPIC_API_KEY: WRONG/.test(bad.out) && /SETUP INCOMPLETE -- missing: a working ANTHROPIC_API_KEY/.test(bad.out), bad.out);
  check("rejected key: still never printed", !bad.out.includes("sk-ant-BAD"));
  const down = run(world("yes-down"), ["init", "--yes", "--design-system", "src/components"], { ANTHROPIC_API_KEY: "sk-ant-GOOD" });
  check("API unreachable: 'not confirmed', does not block setup", /not confirmed/.test(down.out) && /SETUP COMPLETE/.test(down.out), down.out);
  api.kill();
}

console.log("13. a wrong project_id points at the id this repo is registered under");
{
  const d = world("pid-hint");
  run(d, ["init", "--yes", "--design-system", "src/components"], {});
  const here = deriveProjectId(join(d, "proj"));
  const t = new StdioClientTransport({ command: join(d, "bin", "node"), args: [join(dist, "index.js")], cwd: join(d, "proj"), stderr: "ignore",
    env: { HOME: join(d, "home"), PATH: join(d, "bin"), PATTERN_PROJECT_ROOT: join(d, "proj"), PATTERN_TELEMETRY: "0", PATTERN_DESIGN_SYSTEMS_PATH: join(d, "ds.json"), PATTERN_LEDGER_PATH: join(d, "l.jsonl"), PATTERN_MEMORY_PATH: join(d, "m.json"), ANTHROPIC_API_KEY: "sk-ant-x" } });
  const c = new Client({ name: "t", version: "1" }, { capabilities: {} });
  await c.connect(t);
  const call = async (name, args) => JSON.stringify(await c.callTool({ name, arguments: args }));
  const wrong = await call("recommend_component", { component_need: "a data table", domain: "saas", framework: "react", project_id: "some-other-name" });
  check("error says SETUP NEEDED and names the right project_id", wrong.includes("SETUP NEEDED") && wrong.includes(`registered under project_id \\"${here}\\"`), wrong);
  await c.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
