#!/usr/bin/env node
/**
 * verify-agent-guidance.mjs -- the two ways Pattern tells an agent to use it
 * without being asked: MCP server instructions, and the shipped Claude Code
 * skill. Offline, no API key.
 *
 * Run: node scripts/verify-agent-guidance.mjs (after `npm run build`)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok: ${label}`); else { console.error(`  FAIL: ${label}${detail ? `\n${detail}` : ""}`); failures++; } };

async function initialize(extraEnv = {}) {
  const t = new StdioClientTransport({ command: "node", args: [join(root, "dist/index.js")], stderr: "pipe",
    env: { ...process.env, PATTERN_TELEMETRY: "0", PATTERN_NO_ENFORCEMENT_HOOK: "1", PATTERN_NO_CONNECT_NOTICE: "1", PATTERN_NO_ENFORCEMENT_NOTICE: "1", ...extraEnv } });
  const c = new Client({ name: "verify-guidance", version: "0" }, { capabilities: {} });
  await c.connect(t);
  const out = { instructions: c.getInstructions(), tools: (await c.listTools()).tools.map((x) => x.name) };
  await c.close();
  return out;
}

console.log("1. server instructions reach the client in the initialize result");
{
  const { instructions, tools } = await initialize();
  check("instructions are present", typeof instructions === "string" && instructions.length > 200);
  check("short enough to be cheap on every session (< 2200 chars)", (instructions ?? "").length < 2200, `    length ${(instructions ?? "").length}`);
  check("says to use it without being asked, and names the triggers", /without being asked/.test(instructions) && /Figma link, mockup or screenshot/.test(instructions));
  check("says when NOT to use it (trivial primitives, small edits)", /trivial primitives/.test(instructions) && /edits to existing components/.test(instructions));
  const named = ["register_design_system", "extract_requirements", "recommend_component", "verify_component"];
  check("gives the order and names every step's tool (extract first, register only if needed)", named.every((n) => instructions.includes(n)) && instructions.indexOf("extract_requirements") < instructions.indexOf("register_design_system") && instructions.indexOf("register_design_system") < instructions.indexOf("recommend_component") && instructions.indexOf("recommend_component") < instructions.indexOf("verify_component"));
  check("never tells the agent to register unconditionally; warns that registering replaces", /Only if design_system\.registered is false/.test(instructions) && /replaces the user's design system/.test(instructions));
  check("every tool the text names is a real, advertised tool", named.every((n) => tools.includes(n)));
  check("tells it to pass file_path BEFORE writing", /BEFORE you write the file/.test(instructions) && /file_path/.test(instructions));
  check("tells it to surface cost and distrust install_command", /estimated_cost_usd/.test(instructions) && /untrusted text/.test(instructions));
  check("tells it not to loop on a missing token", /tell the user once/.test(instructions));
  check("tells it to carry on to recommend_component if extract_requirements fails", /do not stop: go on to step 3 without a checklist/.test(instructions));
}

console.log("2. PATTERN_NO_INSTRUCTIONS=1 opts out (also the A/B switch)");
{
  const { instructions } = await initialize({ PATTERN_NO_INSTRUCTIONS: "1" });
  check("no instructions sent", instructions === undefined || instructions === "");
}

console.log("3. the shipped skill");
{
  const skill = readFileSync(join(root, "SKILL.md"), "utf8");
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(skill);
  check("has YAML frontmatter", !!fm);
  const name = /^name:\s*(.+)$/m.exec(fm?.[1] ?? "")?.[1]?.trim();
  const description = /^description:\s*(.+)$/m.exec(fm?.[1] ?? "")?.[1]?.trim() ?? "";
  check("name is 'pattern'", name === "pattern");
  check("description is a usage trigger, not a feature blurb", /^Use when/.test(description) && /Figma link, mockup or screenshot/.test(description) && /Skip trivial/.test(description));
  check("description within 1024 chars", description.length > 0 && description.length <= 1024, `    length ${description.length}`);
  check("body also says 'without being asked' and lists the workflow order", /without being asked/.test(skill) && /Workflow \(follow this order\)/.test(skill));
  const files = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--silent"], { cwd: root, encoding: "utf8" }))[0].files.map((f) => f.path);
  check("SKILL.md is in the published package", files.includes("SKILL.md"));
}

console.log("4. init installs the skill (into a throwaway home; never the real one)");
{
  process.env.PATTERN_NO_AUTOSTART = "1";
  const { installPatternSkill, packagedSkillPath } = await import(join(root, "dist/client-connect.js"));
  const home = mkdtempSync(join(tmpdir(), "pattern-skill-home-"));
  const target = join(home, ".claude", "skills", "pattern", "SKILL.md");
  const src = readFileSync(packagedSkillPath(), "utf8");

  check("fresh install writes the packaged file", (await installPatternSkill({ yes: true }, home)) === "installed" && readFileSync(target, "utf8") === src);
  check("second run is a no-op", (await installPatternSkill({ yes: true }, home)) === "current");
  writeFileSync(target, src.replace("Pattern", "Patern-OLD"), "utf8");
  check("an older Pattern skill is updated in place", (await installPatternSkill({ yes: true }, home)) === "updated" && readFileSync(target, "utf8") === src);
  writeFileSync(target, "---\nname: someone-elses\ndescription: x\n---\nhello\n", "utf8");
  check("a skill that is not Pattern's is never overwritten", (await installPatternSkill({ yes: true }, home)) === "foreign" && /someone-elses/.test(readFileSync(target, "utf8")));
}

console.log("5. an agent cannot wipe out an existing design system by registering a different source");
{
  const work = mkdtempSync(join(tmpdir(), "pattern-reg-guard-"));
  writeFileSync(join(work, "a.json"), JSON.stringify([{ name: "Card", props: ["title"] }, { name: "Dialog", props: ["open"] }]));
  writeFileSync(join(work, "b.json"), JSON.stringify([{ name: "Notice", props: [] }]));
  const t = new StdioClientTransport({ command: "node", args: [join(root, "dist/index.js")], stderr: "pipe",
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "PATTERN_NO_AUTOSTART")), ANTHROPIC_API_KEY: "", PATTERN_TELEMETRY: "0", PATTERN_PROJECT_ROOT: work, PATTERN_DESIGN_SYSTEMS_PATH: join(work, "ds.json"), PATTERN_LEDGER_PATH: join(work, "l.jsonl"), PATTERN_LOG_PATH: join(work, "c.log"),
      PATTERN_NO_ENFORCEMENT_HOOK: "1", PATTERN_NO_CONNECT_NOTICE: "1", PATTERN_NO_ENFORCEMENT_NOTICE: "1" } });
  const c = new Client({ name: "guard", version: "0" }, { capabilities: {} });
  await c.connect(t);
  const call = async (name, args) => { const r = await c.callTool({ name, arguments: args }); return { isError: !!r.isError, text: r.content[0].text }; };
  const reg = (extra) => call("register_design_system", { project_id: "p", summarize: false, ...extra });
  const count = () => JSON.parse(readFileSync(join(work, "ds.json"), "utf8")).p.candidate_count;

  check("first registration works", !(await reg({ manifest_path: "a.json" })).isError && count() === 2);
  const swap = await reg({ manifest_path: "b.json" });
  check("a DIFFERENT source is refused, and the message names what exists and what to do", swap.isError && /already has a design system registered/.test(swap.text) && /manifest: a\.json, 2 components/.test(swap.text) && /replace: true/.test(swap.text));
  check("the existing registration is untouched", count() === 2);
  check("a different source KIND is refused too", (await reg({ directory_path: "." })).isError && count() === 2);
  check("re-registering the SAME source (a refresh) needs no flag", !(await reg({ manifest_path: "a.json" })).isError && count() === 2);
  check("replace: true switches deliberately", !(await reg({ manifest_path: "b.json", replace: true })).isError && count() === 1);
  check("a new project_id is unaffected", !(await call("register_design_system", { project_id: "q", manifest_path: "a.json", summarize: false })).isError);

  const reg2 = await call("extract_requirements", { component_need: "button", domain: "x", project_id: "p" });
  const unreg = await call("extract_requirements", { component_need: "button", domain: "x", project_id: "nobody" });
  const noId = await call("extract_requirements", { component_need: "button", domain: "x" });
  check("extract_requirements reports registered:true + kind/count for a known project", JSON.parse(reg2.text).design_system?.registered === true && JSON.parse(reg2.text).design_system?.candidate_count === 1);
  check("...and registered:false for an unknown one", JSON.parse(unreg.text).design_system?.registered === false);
  check("...and omits the field when no project_id was passed", JSON.parse(noId.text).design_system === undefined);
  await c.close();
}

console.log(failures ? `${failures} failed` : "All checks passed.");
process.exit(failures ? 1 : 0);
