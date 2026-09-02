#!/usr/bin/env node
/**
 * verify-post-ledger-provenance-github.mjs
 *
 * Feature 2 (Decision Provenance) P2's test plan, per
 * pattern-ledger-integrity-and-provenance-spec.md: "Integration test
 * against a scratch repo/PR using the GitHub API; confirm idempotency
 * (re-running doesn't double-post)."
 *
 * Deliberately does NOT hit real github.com or use a real token -- every
 * other test in this repo avoids touching a real external service (no
 * test here has ever spent real Anthropic API money either), and this
 * tool's whole purpose is posting real, visible content to GitHub, which
 * is exactly the kind of side effect a test suite shouldn't create by
 * accident. Instead, this spins up a tiny local HTTP server that mimics
 * GitHub's issue-comments endpoints (GET list, POST create) and points
 * the real server at it via PATTERN_GITHUB_API_BASE. Every assertion here
 * exercises the real fetch calls, headers, marker-based idempotency
 * check, and error handling in postProvenanceToGitHub -- just against a
 * fake backend instead of the real one.
 *
 * Run: node scripts/verify-post-ledger-provenance-github.mjs (after `npm run build`)
 * Exits non-zero on any failed assertion.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "pattern-verify-post-provenance-"));
const ledgerPath = join(tmp, "ledger.jsonl");

const PROJECT_ID = "verify-post-provenance-project";
const FAKE_TOKEN = "fake-token-for-testing-only";

writeFileSync(
  ledgerPath,
  JSON.stringify({
    id: "seed-post-provenance-0001",
    timestamp: "2026-09-02T12:00:00.000Z",
    project_id: PROJECT_ID,
    feature_id: "seed-feature",
    component_need: "success or failure toast notification",
    domain: "test domain",
    framework: "React + Tailwind",
    checklist: ["a", "b"],
    checklist_source: "extracted",
    candidates_evaluated: [{ source: "shadcn", name: "Sonner toast", url: "https://example.com", coverage_pct: 100 }],
    verdict: "use_existing",
    chosen_candidate: "Sonner toast",
    confidence: "high",
    reason: "scored",
    coverage: "8/8 (100%)",
    cost_usd: 0.14,
    cache_hit: false,
    project_conventions_snapshot: null,
    file_path: null,
    snapshot_ref: "deadbeef00112233445566778899aabbccddeeff",
    last_verified_live: null,
    live_status: "unknown",
  }) + "\n",
  "utf8"
);

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ok: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

// ---------------------------------------------------------------------
// Fake GitHub: tracks comments per "owner/repo#number" key, in memory.
// A special repo name ("unauthorized/repo") always 401s, to test error
// surfacing for a bad/expired token.
// ---------------------------------------------------------------------
const store = new Map();
let nextCommentId = 1;
let postCount = 0;

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const match = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/);
  if (!match) {
    res.writeHead(404).end();
    return;
  }
  const [, owner, repoName, number] = match;
  const key = `${owner}/${repoName}#${number}`;
  const authHeader = req.headers["authorization"];

  if (owner === "unauthorized") {
    res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ message: "Bad credentials" }));
    return;
  }
  if (authHeader !== `Bearer ${FAKE_TOKEN}`) {
    res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ message: "Missing/invalid Authorization header in test" }));
    return;
  }

  if (req.method === "GET") {
    const comments = store.get(key) ?? [];
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(comments));
    return;
  }
  if (req.method === "POST") {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      postCount++;
      const { body } = JSON.parse(raw);
      const comment = { id: nextCommentId++, body, html_url: `http://mock-github.test/comments/${nextCommentId}` };
      const existing = store.get(key) ?? [];
      existing.push(comment);
      store.set(key, existing);
      res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify(comment));
    });
    return;
  }
  res.writeHead(405).end();
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const mockBase = `http://127.0.0.1:${server.address().port}`;

const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(projectRoot, "dist/index.js")],
  env: {
    ...process.env,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "unused-not-needed-for-this-script",
    PATTERN_LEDGER_PATH: ledgerPath,
    PATTERN_GITHUB_API_BASE: mockBase,
    GITHUB_TOKEN: FAKE_TOKEN,
  },
});
const client = new Client({ name: "verify-post-ledger-provenance-github", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);

console.log("1. First post succeeds, comment actually created against the mock backend");
const first = await client.callTool({
  name: "post_ledger_provenance_to_github",
  arguments: { project_id: PROJECT_ID, ledger_entry_id: "seed-post-provenance-0001", repo: "acme/booking-app", issue_number: 42 },
});
const firstParsed = JSON.parse(first.content[0].text);
check("did not error", !first.isError);
check("posted is true", firstParsed.posted === true);
check("comment_url is present", typeof firstParsed.comment_url === "string" && firstParsed.comment_url.length > 0);
check("exactly 1 POST reached the mock backend", postCount === 1);
const storedComments = store.get("acme/booking-app#42") ?? [];
check("mock backend actually stored the comment", storedComments.length === 1);
check("stored comment includes the hidden provenance marker", storedComments[0]?.body.includes("<!-- pattern-ledger-provenance:seed-post-provenance-0001 -->"));
check("stored comment includes the real markdown content", storedComments[0]?.body.includes("## Pattern decision: success or failure toast notification"));

console.log("\n2. A repeat call for the same entry/repo/issue is idempotent -- no duplicate");
const second = await client.callTool({
  name: "post_ledger_provenance_to_github",
  arguments: { project_id: PROJECT_ID, ledger_entry_id: "seed-post-provenance-0001", repo: "acme/booking-app", issue_number: 42 },
});
const secondParsed = JSON.parse(second.content[0].text);
check("did not error", !second.isError);
check("posted is false the second time", secondParsed.posted === false);
check("reason is already_posted", secondParsed.reason === "already_posted");
check("returns the original comment_url, not a new one", secondParsed.comment_url === firstParsed.comment_url);
check("still exactly 1 POST reached the mock backend (no duplicate created)", postCount === 1);
check("mock backend still holds exactly 1 comment for this thread", (store.get("acme/booking-app#42") ?? []).length === 1);

console.log("\n3. A different issue_number on the same repo is a separate thread -- not blocked by idempotency");
const differentIssue = await client.callTool({
  name: "post_ledger_provenance_to_github",
  arguments: { project_id: PROJECT_ID, ledger_entry_id: "seed-post-provenance-0001", repo: "acme/booking-app", issue_number: 99 },
});
const differentIssueParsed = JSON.parse(differentIssue.content[0].text);
check("posts successfully to the new thread", differentIssueParsed.posted === true);
check("total POSTs is now 2", postCount === 2);

console.log("\n4. Unknown ledger_entry_id fails cleanly, never reaches the network");
const missingEntry = await client.callTool({
  name: "post_ledger_provenance_to_github",
  arguments: { project_id: PROJECT_ID, ledger_entry_id: "does-not-exist", repo: "acme/booking-app", issue_number: 1 },
});
check("isError is true", missingEntry.isError === true);
check("error names the missing id", missingEntry.content[0].text.includes("does-not-exist"));
check("no additional POST reached the mock backend", postCount === 2);

console.log("\n5. Malformed repo (not owner/repo) fails cleanly, never reaches the network");
const badRepo = await client.callTool({
  name: "post_ledger_provenance_to_github",
  arguments: { project_id: PROJECT_ID, ledger_entry_id: "seed-post-provenance-0001", repo: "not-a-valid-repo", issue_number: 1 },
});
check("isError is true", badRepo.isError === true);
check("no additional POST reached the mock backend", postCount === 2);

console.log("\n6. A GitHub-side error (bad credentials) surfaces clearly instead of throwing raw/unhandled");
const unauthorized = await client.callTool({
  name: "post_ledger_provenance_to_github",
  arguments: { project_id: PROJECT_ID, ledger_entry_id: "seed-post-provenance-0001", repo: "unauthorized/repo", issue_number: 1 },
});
check("isError is true", unauthorized.isError === true);
check("error mentions the 401 status", unauthorized.content[0].text.includes("401"));

await client.close();
server.close();

console.log("\n7. Missing GITHUB_TOKEN entirely fails cleanly with a clear message");
// Deleting the key (rather than setting it to `undefined`) matters here:
// child_process.spawn stringifies an `undefined` env value to the literal
// string "undefined", which is truthy and would silently pass the `!token`
// check in postProvenanceToGitHub -- defeating the point of this test.
const envWithoutToken = { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "unused-not-needed-for-this-script", PATTERN_LEDGER_PATH: ledgerPath, PATTERN_GITHUB_API_BASE: mockBase };
delete envWithoutToken.GITHUB_TOKEN;
const transportNoToken = new StdioClientTransport({
  command: "node",
  args: [resolve(projectRoot, "dist/index.js")],
  env: envWithoutToken,
});
const clientNoToken = new Client({ name: "verify-post-ledger-provenance-github-no-token", version: "0.1.0" }, { capabilities: {} });
await clientNoToken.connect(transportNoToken);
const noToken = await clientNoToken.callTool({
  name: "post_ledger_provenance_to_github",
  arguments: { project_id: PROJECT_ID, ledger_entry_id: "seed-post-provenance-0001", repo: "acme/booking-app", issue_number: 1 },
});
check("isError is true", noToken.isError === true);
check("error mentions GITHUB_TOKEN", noToken.content[0].text.includes("GITHUB_TOKEN"));
await clientNoToken.close();

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
