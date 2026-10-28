#!/usr/bin/env node
/**
 * verify-story.mjs
 *
 * Standalone check for the story layer (src/story.ts): claim lifecycle,
 * decision links, every challenge kind, dismissal, ingest, and the path guard.
 * Uses a temp story dir, never ~/.pattern.
 *
 * Run: node scripts/verify-story.mjs (after `npm run build`)
 * Exits non-zero on any failed assertion.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pattern-story-"));
process.env.PATTERN_STORY_DIR = join(dir, "story");
const root = join(dir, "repo");
mkdirSync(root);

const { handleStoryTool } = await import("../dist/story.js");

let failures = 0;
function check(label, condition) {
  if (condition) console.log(`  ok: ${label}`);
  else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}
const call = async (name, args, deps) => {
  const r = await handleStoryTool(name, { project_id: "demo", ...args }, root, deps);
  const body = r.content[0].text;
  return { error: !!r.isError, body, json: r.isError ? null : JSON.parse(body) };
};
const kinds = (res) => res.json.findings.map((f) => f.kind);

console.log("empty story");
check("challenge on empty story reports nothing recorded", (await call("challenge", {})).json.open_count === 0);

console.log("decisions with no message");
await call("link_decision", { summary: "Hero shows three feature cards", serves: [], surface: "home" });
let ch = await call("challenge", {});
check("flags no_message", kinds(ch).includes("no_message"));
check("flags orphan_decision", kinds(ch).includes("orphan_decision"));

console.log("claims and unsupported");
const c1 = (await call("record_claim", { text: "Teams lose the reason behind design decisions", kind: "message", source: "founder", confidence: "high" })).json.claim_id;
const c2 = (await call("record_claim", { text: "Users want faster onboarding", kind: "belief", source: "gut", confidence: "high", topic: "onboarding" })).json.claim_id;
check("ids are sequential", c1 === "c1" && c2 === "c2");
await call("link_decision", { summary: "Cut onboarding to two steps", serves: [c2], surface: "onboarding" });
ch = await call("challenge", {});
const unsupported = ch.json.findings.filter((f) => f.kind === "unsupported_claim");
check("unsupported high-confidence belief is high severity", unsupported.some((f) => f.cites[0].id === c2 && f.severity === "high"));
check("finding cites the decision resting on it", unsupported.find((f) => f.cites[0].id === c2).cites.some((c) => c.type === "decision"));
check("no_message gone once a message exists", !kinds(ch).includes("no_message"));

console.log("evidence clears it");
await call("record_claim", { action: "add_evidence", claim_id: c2, evidence: ["7/10 interviewees dropped at step 4"] });
check("unsupported finding on c2 resolved", !(await call("challenge", {})).json.findings.some((f) => f.kind === "unsupported_claim" && f.cites[0].id === c2));

console.log("contradiction");
const c3 = (await call("record_claim", { text: "Onboarding should be slow and deliberate", kind: "belief", source: "design lead", topic: "onboarding", evidence: ["x"] })).json.claim_id;
ch = await call("challenge", {});
check("same-topic contradiction flagged", ch.json.findings.some((f) => f.kind === "contradiction" && f.cites.map((c) => c.id).sort().join() === [c2, c3].sort().join()));
const polA = (await call("record_claim", { text: "Show pricing on the landing page", kind: "constraint", source: "cfo" })).json.claim_id;
const polB = (await call("record_claim", { text: "Never show pricing on the landing page", kind: "constraint", source: "ceo" })).json.claim_id;
ch = await call("challenge", {});
check("opposite-polarity wording flagged as heuristic", ch.json.findings.some((f) => f.kind === "contradiction" && f.heuristic && f.cites.some((c) => c.id === polB)));

console.log("supersede -> stale rationale");
await call("record_claim", { action: "supersede", supersedes: c3, text: "Onboarding should be fast", kind: "belief", source: "design lead", reason: "interviews", evidence: ["y"], topic: "onboarding" });
await call("record_claim", { action: "supersede", supersedes: c2, text: "Users want fewer steps", kind: "belief", source: "research", reason: "reworded", evidence: ["z"] });
ch = await call("challenge", {});
check("contradiction on c2/c3 cleared by supersede", !ch.json.findings.some((f) => f.kind === "contradiction" && f.cites.some((c) => c.id === c3)));
check("retract of unknown claim is an error", (await call("record_claim", { action: "retract", claim_id: "c99", reason: "n/a" })).error);

const old = (await call("record_claim", { text: "Enterprise buyers decide on security first", kind: "belief", source: "sales", evidence: ["deal notes"] })).json.claim_id;
await call("link_decision", { summary: "Lead homepage with SOC2 badge", serves: [old], surface: "home" });
await call("record_claim", { action: "retract", claim_id: old, reason: "sales data showed price drives it" });
ch = await call("challenge", {});
check("decision resting on retracted claim is stale_rationale", ch.json.findings.some((f) => f.kind === "stale_rationale" && f.cites.some((c) => c.id === old)));

console.log("dilution");
const m2 = (await call("record_claim", { text: "Pattern is the cheapest way to audit UI", kind: "message", source: "marketing", evidence: ["w"] })).json.claim_id;
await call("link_decision", { summary: "Hero headline about cost", serves: [m2], surface: "home" });
await call("link_decision", { summary: "Hero headline about memory", serves: [c1], surface: "home" });
ch = await call("challenge", {});
check("surface serving two messages flagged", ch.json.findings.some((f) => f.kind === "dilution" && f.cites.length === 2));

console.log("broken link");
await call("link_decision", { summary: "Footer tagline", serves: ["c404"] });
check("unknown claim link flagged", kinds(await call("challenge", {})).includes("broken_link"));

console.log("dismissal");
const target = (await call("challenge", {})).json.findings.find((f) => f.kind === "broken_link");
check("dismiss needs a reason", (await call("challenge", { dismiss_finding_id: target.id })).error);
check("dismiss with reason ok", !(await call("challenge", { dismiss_finding_id: target.id, dismiss_reason: "placeholder, removing next sprint" })).error);
check("dismissed finding hidden", !(await call("challenge", {})).json.findings.some((f) => f.id === target.id));
const withDismissed = (await call("challenge", { include_dismissed: true })).json.dismissed;
check("dismissed finding listed with reason", withDismissed.some((f) => f.id === target.id && /placeholder/.test(f.dismissed_reason)));
check("dismissing a non-finding errors", (await call("challenge", { dismiss_finding_id: "nope", dismiss_reason: "x" })).error);

console.log("read_story");
const story = (await call("read_story", {})).json;
check("history keeps superseded/retracted claims with reasons", story.history.some((c) => c.id === old && c.status === "retracted" && c.end_reason) && story.history.some((c) => c.id === c2 && c.superseded_by));
check("active claims grouped by kind", Array.isArray(story.active.message));

console.log("ingest");
writeFileSync(join(root, "notes.md"), "# Notes\n- The message is: decisions should remember why they were made\n- We assume designers will adopt a new tool\n- Lunch is at noon\n- Users want to see what changed\n");
let ing = await call("ingest_notes", { file_path: "notes.md" });
check("preview finds 3 candidates, commits none", ing.json.candidates.length === 3 && ing.json.committed === 0);
check("kinds guessed", ing.json.candidates.map((c) => c.kind).join() === "message,assumption,belief");
check("sources carry file:line", ing.json.candidates[0].source === "notes.md:2");
ing = await call("ingest_notes", { file_path: "notes.md", commit: true });
check("commit records claims", ing.json.committed === 3);
check("re-ingest dedupes", (await call("ingest_notes", { file_path: "notes.md" })).json.candidates.length === 0);
check("rejects ..", (await call("ingest_notes", { file_path: "../x.md" })).error);
check("rejects absolute", (await call("ingest_notes", { file_path: "/etc/passwd" })).error);

console.log("model ingest");
writeFileSync(join(root, "long.md"), "# Brief\nThe problem is that founders cannot describe the design they want.\nOur audience is early-stage founders.\nLunch is at noon.\n");
const stub = async () =>
  JSON.stringify([
    { text: "Founders cannot describe the design they want", kind: "belief", quote: "founders cannot describe the design they want" },
    { text: "Audience is early-stage founders", kind: "belief", quote: "Our audience is early-stage founders" },
    { text: "Everyone loves it", kind: "belief", quote: "this sentence is not in the file" },
    { text: "Bad kind", kind: "vibes", quote: "Lunch is at noon" },
  ]);
let mi = await call("ingest_notes", { file_path: "long.md", use_model: true }, { complete: stub });
check("verified claims kept, fabricated quote and bad kind dropped", mi.json.candidates.length === 2 && mi.json.dropped_unverifiable === 2);
check("source line comes from where the quote was found", mi.json.candidates[0].source === "long.md:2" && mi.json.candidates[1].source === "long.md:3");
check("model preview commits nothing", mi.json.committed === 0);
mi = await call("ingest_notes", { file_path: "long.md", use_model: true, commit: true }, { complete: stub });
check("model commit records claims", mi.json.committed === 2);
check("non-JSON model reply is an error", (await call("ingest_notes", { file_path: "long.md", use_model: true }, { complete: async () => "sorry" })).error);
const savedKey = process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
check("use_model without a key errors clearly", /ANTHROPIC_API_KEY/.test((await call("ingest_notes", { file_path: "long.md", use_model: true })).body));
const { createServer } = await import("node:http");
let seenKey;
const srv = createServer((req, res) => {
  seenKey = req.headers["x-api-key"];
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ content: [{ type: "text", text: 'Here: [{"text":"Lunch matters","kind":"belief","quote":"Lunch is at noon"}]' }] }));
}).listen(0);
process.env.PATTERN_STORY_API_URL = `http://127.0.0.1:${srv.address().port}/v1/messages`;
process.env.ANTHROPIC_API_KEY = "sk-ant-test";
const net = await call("ingest_notes", { file_path: "long.md", use_model: true });
check("real fetch path sends key and parses a wrapped JSON reply", seenKey === "sk-ant-test" && net.json.candidates.length === 1 && net.json.candidates[0].source === "long.md:4");
srv.close();
if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey; else delete process.env.ANTHROPIC_API_KEY;

check("non-story tool returns undefined", await handleStoryTool("recommend_component", {}, root) === undefined);

rmSync(dir, { recursive: true, force: true });
if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall story checks passed");
