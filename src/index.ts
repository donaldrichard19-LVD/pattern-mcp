#!/usr/bin/env node
/**
 * Pattern
 *
 * MCP server exposing tools built around one judgment: whether a UI
 * component need should be met with a component from the project's own
 * registered design system, or requires a custom build.
 *
 * Two separate local stores back this, with two different rules:
 *  - `record_component_decision` appends a confirmed decision to local
 *    per-project memory (see MEMORY_PATH below), which recommend_component
 *    can optionally read back (via project_id) as consistency context for
 *    a future call -- never as a cached verdict; coverage is still scored
 *    fresh every time. Unchanged, still true.
 *  - Every recommend_component call that reaches the API instead appends
 *    to a per-project ledger (see LEDGER_PATH below). Unlike memory.json,
 *    a high-confidence ledger entry CAN be served directly on a later,
 *    matching call instead of a fresh search+score -- the one deliberate
 *    exception to "always fresh," bounded by exact component_need/domain/
 *    framework/conventions match and a staleness TTL, and always flagged
 *    via `served_from_ledger: true` in the response so nothing is silently
 *    passed off as freshly verified. See findLedgerCacheHit.
 *
 * The judgment logic itself (extract requirements -> search -> score real
 * code -> threshold into a verdict) is delegated to a single Anthropic API
 * call with the server-side web_search tool enabled, so the same reasoning
 * this project validated by hand in conversation is what runs here.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { instrument } from "@posthog/mcp";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureApiError,
  captureCliExited,
  captureCliStarted,
  captureRecommendation,
  getClient as getPostHogClient,
  installId,
  printTelemetryNoticeOnce,
  shutdownTelemetry,
  TELEMETRY_ENABLED,
} from "./telemetry.js";
import { offerEnforcementSetupOnce } from "./init-enforcement.js";
import { connectInstructionsText, offerClientConnectSetupOnce, runConnect } from "./client-connect.js";
import { collapseForJev, rankWithJev } from "./design-system-jev.js";
import { describeFigma, fetchFigmaFile, parseFigmaFile, type FigmaCandidateInfo } from "./design-system-figma.js";
import { captionFigmaDesigns, carryOverCaptions } from "./design-system-figma-captions.js";
import {
  SUMMARY_MODEL,
  carryOverSummaries,
  makeAnthropicSummaryCall,
  summarizeCandidates,
  type SummarizeStats,
} from "./design-system-summaries.js";

// Read as early as possible in this file's own module-level code, wrapped
// so a missing/corrupt package.json can't itself become a new, unguarded
// crash source -- this is read before the crash handlers below exist to
// catch anything. Moved up from where it used to live (just above the
// `server` construction, far later in this file) after a 2026-09-14
// incident where a caller crashed on every single launch, ~29 times in 4
// minutes, immediately after a version bump published -- telemetry had no
// way to say whether the crashing process was the old or new version (see
// project_pattern_activation_funnel memory). Every pattern_cli_started/
// pattern_cli_exited event now carries this, closing that gap for next
// time.
const PACKAGE_VERSION: string = (() => {
  try {
    return JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")
    ).version;
  } catch {
    return "unknown";
  }
})();

// Registered before anything else in this file runs (all the way up here,
// not down by main() where it used to be) so a throw anywhere in this
// file's own module-level code -- not just inside main() -- is captured
// instead of dying silently before these handlers would otherwise have
// existed. Can't cover a throw during the import statements above this
// line (nothing can run before those resolve), but this closes the much
// larger window between "imports finished" and "main() starts," which is
// most of this file's ~4700 lines of function/constant definitions and
// tool registrations.
let exitTelemetryCaptured = false;
function captureExitOnce(reason: Parameters<typeof captureCliExited>[0], err?: unknown): void {
  if (exitTelemetryCaptured) return;
  exitTelemetryCaptured = true;
  captureCliExited(reason, err, PACKAGE_VERSION);
}
process.on("uncaughtException", async (err) => {
  console.error("Pattern: uncaught exception, exiting.", err);
  captureExitOnce("uncaught_exception", err);
  await shutdownTelemetry();
  process.exit(1);
});
process.on("unhandledRejection", async (reason) => {
  console.error("Pattern: unhandled rejection, exiting.", reason);
  captureExitOnce("unhandled_rejection", reason);
  await shutdownTelemetry();
  process.exit(1);
});

export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// Only required for org-scoped keys (not tied to one workspace); unset for
// legacy workspace-scoped keys, which don't need it.
export const ANTHROPIC_WORKSPACE_ID = process.env.ANTHROPIC_WORKSPACE_ID;

// Cheap, no-network sanity check on the key's shape, run once at startup.
// Deliberately NOT a real auth ping against the Anthropic API -- that would
// spend a real request on every single server boot (every MCP client
// launch), which is exactly the kind of always-pay-the-API cost this
// project avoids elsewhere (see the skip-list and ledger-cache-hit designs).
// This only catches the cheap, common misconfigurations -- unset, empty, or
// a value that's obviously not an Anthropic key (wrong var pasted, stray
// quotes) -- surfaced at startup instead of only on the first real tool
// call's 401. Never blocks startup; recommend_component/extract_requirements
// still fail with their own clear message if this warning goes unheeded.
function warnIfAnthropicKeyLooksWrong(): void {
  if (!ANTHROPIC_API_KEY) {
    console.error(
      "Pattern: ANTHROPIC_API_KEY is not set. recommend_component and extract_requirements will fail until it is."
    );
    return;
  }
  if (!/^sk-ant-/.test(ANTHROPIC_API_KEY)) {
    console.error(
      "Pattern: ANTHROPIC_API_KEY is set but doesn't look like a real Anthropic key (expected it to start with " +
        "\"sk-ant-\"). If a tool call fails with a 401, check this value first."
    );
  }
}

// Thrown by recommend_component/extract_requirements when they actually
// need the API and no key is present -- this is what the calling agent
// sees as the tool's error result, so unlike warnIfAnthropicKeyLooksWrong's
// stderr line (invisible in most real clients -- see
// project_pattern_activation_funnel memory), this is the message a real
// user is actually likely to see. Gives two concrete fixes rather than
// just naming the problem: re-running `init` (which already offers to
// write the key into every client it detects), or exporting it directly --
// the one method that works the same way across every client, since it
// doesn't depend on any client-specific config format.
const NO_DESIGN_SYSTEM_MESSAGE =
  "No design system registered for this project_id. Pattern judges components against your own design system: call register_design_system first (figma_file_key, figma_json_path, directory_path, or manifest_path), then re-run with the same project_id.";

const MISSING_API_KEY_MESSAGE =
  "Pattern: ANTHROPIC_API_KEY is not set, so this call can't reach the Anthropic API. Fix it one of two ways: " +
  "re-run `npx pattern-mcp init` to add it to your MCP client's config, or export it directly -- " +
  "`export ANTHROPIC_API_KEY=sk-ant-...` in the shell your client launches Pattern from, then restart the client.";
// Configurable so Sonnet vs. Haiku can be A/B tested without a code change.
// Defaults to Sonnet 5. Try MODEL=claude-haiku-4-5-20251001 to test the
// cheaper tier -- re-run the 5 validated test cases from the product brief
// (price breakdown, cancellation policy, earnings dashboard, gallery,
// messaging) and diff verdicts before trusting it in production.
export const MODEL = process.env.PATTERN_MODEL ?? "claude-sonnet-5";

// Design-system mode only: PATTERN_SCORER=jev scores a project's registered
// design system with Jev (TypeSafe AI) instead of Anthropic -- no web search,
// no Anthropic call, and a plain "nothing fits" result when nothing does.
// Off by default; see src/design-system-jev.ts for what the eval showed.
// Candidate names, file names, doc comments and summaries (never prop lists)
// plus the component_need are sent to api.typesafe.ai when it is on.
const DESIGN_SYSTEM_JEV_ENABLED = process.env.PATTERN_SCORER === "jev";
// First guess from the eval: lowest correct top pick was 0.44 without
// summaries (0.55 with) and highest "nothing fits" score was 0.27, so 0.4
// separates them on that data. Jev's scores are not calibrated -- tune this
// against your own evals rather than trusting it as a probability.
const JEV_FOUND_THRESHOLD = Number(process.env.PATTERN_JEV_FOUND_THRESHOLD ?? 0.4);
const JEV_BATCH_TOKENS = Number(process.env.PATTERN_JEV_BATCH_TOKENS ?? 18000);
// Optional, for cost reporting only -- Jev pricing is not baked in.
const JEV_USD_PER_MTOK_IN = process.env.PATTERN_JEV_USD_PER_MTOK_IN;
const JEV_USD_PER_MTOK_OUT = process.env.PATTERN_JEV_USD_PER_MTOK_OUT;

// register_design_system writes a short Haiku capability summary per scanned
// file BY DEFAULT when ANTHROPIC_API_KEY is set (see design-system-summaries.ts).
// That sends up to 8000 chars of each such source file to api.anthropic.com, so
// there are two ways out: pass `summarize: false` per call, or set
// PATTERN_NO_SUMMARIES=1 to turn it off everywhere. No key -> nothing is sent.
// Registration guard for Figma sources: more candidates than this is refused
// (see registerDesignSystem) instead of silently truncated.
const FIGMA_MAX_CANDIDATES = Number(process.env.PATTERN_FIGMA_MAX_CANDIDATES ?? 3000);
const SUMMARIZE_BY_DEFAULT = process.env.PATTERN_NO_SUMMARIES !== "1";
const SUMMARY_EGRESS_NOTICE =
  "Source text (up to 8000 characters of each file that needed a summary) was sent to api.anthropic.com to write these summaries. " +
  "Pass summarize: false on register_design_system, or set PATTERN_NO_SUMMARIES=1, to turn this off.";

// Static skip-list: single-purpose primitives with no meaningful internal
// structure to score coverage against. Decided in the product brief as a
// starting point -- revisit once real usage data exists (see README).
export const SKIP_LIST = [
  "button",
  "input",
  "checkbox",
  "label",
  "badge",
  "spinner",
  "loader",
  "tooltip",
  "avatar",
  "icon",
];

export function isSkipListMatch(componentNeed: string): boolean {
  const needLower = componentNeed.toLowerCase().trim();
  return SKIP_LIST.some(
    (item) => needLower === item || needLower === `a ${item}` || needLower === `an ${item}`
  );
}

// Session-level call cap, protecting a tester's API key against a
// calling agent stuck in a retry/loop. Counts once per recommend_component
// invocation that actually reaches the Anthropic API -- skip-list hits
// never call the API, so they don't count. Default of 40 is grounded in
// real usage: a full pass through a realistic ~25-component project
// (validated against this project's own 5-case Airbnb-style test list,
// scaled up) costs 25 calls, so 40 leaves headroom for iteration while
// still catching a runaway loop well before it gets expensive. This is
// an in-memory counter -- it resets when the server process restarts,
// by design (see README).
const SESSION_CALL_CAP_RAW = process.env.PATTERN_SESSION_CAP ?? "40";
const SESSION_CALL_CAP = (() => {
  const parsed = Number.parseInt(SESSION_CALL_CAP_RAW, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `PATTERN_SESSION_CAP must be a positive integer, got: ${SESSION_CALL_CAP_RAW}`
    );
  }
  return parsed;
})();
let sessionCallCount = 0;

// Local structured logging -- one JSON line per recommend_component call
// that actually reaches the Anthropic API (skip-list hits are excluded,
// same exclusion as the session cap, since they never call it). Local
// only: nothing here is sent anywhere by this server. Deliberately
// excludes requirements_checked evidence text and the API key -- see
// SECURITY.md for what this means for component_need/domain, which are
// written here in plaintext.
const LOG_PATH = process.env.PATTERN_LOG_PATH ?? join(homedir(), ".pattern", "calls.log");

// Persistent per-project decision memory -- distinct from LOG_PATH above.
// The log is an append-only record of every call that reached the API;
// this file only ever gains an entry when record_component_decision is
// called, i.e. when the calling agent explicitly confirms it acted on a
// verdict. recommend_component never writes here, only reads (see
// getPastDecisions) -- coverage scoring stays fresh every call regardless
// of what's in this file (see README's "no verdict caching" rule).
const MEMORY_PATH = process.env.PATTERN_MEMORY_PATH ?? join(homedir(), ".pattern", "memory.json");
const MAX_DECISIONS_PER_PROJECT = 50;

// Registered design systems (Solo Dev architecture,
// pattern-solo-design-system-architecture.md) -- one registration per
// project_id, config-shaped like MEMORY_PATH (overwritten wholesale by a
// fresh register_design_system call, not appended to). Same homedir
// convention as LOG_PATH/MEMORY_PATH/LEDGER_PATH: a local file keyed by
// the caller-supplied project_id string, no server-side component. When a
// project has a registration, recommend_component scores ONLY against it
// (one-or-the-other per project, not additive with shadcn/21st.dev/reui --
// see runSinglePass's designSystem branch).
const DESIGN_SYSTEMS_PATH = process.env.PATTERN_DESIGN_SYSTEMS_PATH ?? join(homedir(), ".pattern", "design_systems.json");

// Per-project judgment ledger -- distinct from both LOG_PATH and
// MEMORY_PATH above. Every recommend_component call that reaches the API
// with a project_id and lands on reason "scored" or "no_candidates_found"
// appends one line here (see appendLedgerEntry), unlike MEMORY_PATH which
// only gains an entry when record_component_decision is explicitly called.
// Unlike MEMORY_PATH, this file's entries CAN produce a cached verdict on a
// later call (see findLedgerCacheHit) -- the one deliberate exception to
// this project's "coverage is scored fresh every time" rule, bounded by
// exact component_need/domain/framework/conventions match, confidence
// "high", and LEDGER_TTL_DAYS staleness, and always flagged in the
// response via served_from_ledger so nothing is silently passed off as
// fresh. Same homedir/project_id-keyed convention as LOG_PATH/MEMORY_PATH,
// not a repo-root file -- this server has no concept of "which repo" a
// call is about, only the caller-supplied project_id string.
const LEDGER_PATH = process.env.PATTERN_LEDGER_PATH ?? join(homedir(), ".pattern", "ledger.jsonl");
const LEDGER_TTL_DAYS = Number(process.env.PATTERN_LEDGER_TTL_DAYS ?? 30);

// Ledger integrity + decision provenance
// (pattern-ledger-integrity-and-provenance-spec.md). This deliberately
// reverses the principle stated above report_outcome_proxy elsewhere in
// this file ("Pattern has no process.cwd()/repo-path concept and no
// filesystem access to a caller's repo at all") -- but narrowly: the only
// two things this grants are (1) checking whether one caller-supplied
// file_path still exists / still mentions a chosen_candidate
// (checkFileLiveStatus) and (2) reading the current commit SHA via
// `git rev-parse HEAD` (computeSnapshotRef). Both are read-only, both are
// scoped to PROJECT_ROOT (see resolveWithinRoot's traversal guard), and
// neither ever runs an arbitrary shell command. report_build_cost/
// report_outcome_proxy remain self-reported by design -- rework rate and
// time-to-merge need real git *history*, a materially bigger and more
// failure-prone surface than "does this one file exist right now" or
// "what commit is HEAD."
//
// resolveWithinRoot/computeSnapshotRef/readLedgerEntries are exported so
// check-gate.ts (the enforcement-boundary CLI, see that file) can reuse
// this exact scoping rather than growing a second, parallel fs/git-access
// surface -- it imports these dynamically, after setting
// PATTERN_NO_AUTOSTART, the same convention scripts/*.mjs already use.
//
// Defaults to process.cwd() -- for a locally-run stdio MCP server, that's
// normally the consuming repo's root, since MCP hosts typically launch
// the server with the project directory as its working directory. When
// that assumption doesn't hold (or for tests), override with
// PATTERN_PROJECT_ROOT.
const PROJECT_ROOT = process.env.PATTERN_PROJECT_ROOT ?? process.cwd();

// Belt-and-suspenders guard against a file_path (ultimately caller-
// supplied, see recommend_component's input schema) that's absolute or
// escapes PROJECT_ROOT via "../" -- the calling agent already has real fs
// access to its own machine regardless, but a stray path should degrade
// to "unknown" rather than silently stat-ing something outside the
// project. Returns null (never throws) on anything that doesn't resolve
// cleanly inside root.
export function resolveWithinRoot(root: string, relPath: string): string | null {
  if (!relPath || isAbsolute(relPath)) return null;
  const resolved = resolve(root, relPath);
  const rel = relative(root, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return resolved;
}

// Feature 2 / Decision Provenance, P0: best-effort commit SHA at
// ledger-write time. Never throws -- not being in a git repo, git not
// being installed, or the call simply timing out all degrade to null
// rather than failing the judgment call that triggered this write (see
// buildLedgerEntry). Read-only: `git rev-parse HEAD` never touches repo
// state.
export function computeSnapshotRef(root: string): string | null {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
    return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

// Feature 2 / Decision Provenance, P3: best-effort reconstruction of
// snapshot_ref for an entry written before that field existed (or written
// outside a git repo -- though a project that's never used git has
// nothing to reconstruct from either way). Finds the commit that was HEAD
// at or just before the entry's own timestamp. Necessarily an
// approximation, not a guarantee: a rebase, force-push, or history
// rewrite since that time can make "the commit HEAD pointed to then" no
// longer resolve to what the codebase actually looked like at judgment
// time -- exactly the risk the spec's own mitigation table already names.
// Read-only, same timeout/error-swallowing discipline as
// computeSnapshotRef above.
function reconstructSnapshotRef(root: string, atISOTimestamp: string): string | null {
  try {
    const sha = execFileSync("git", ["log", `--before=${atISOTimestamp}`, "-1", "--format=%H"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
    return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

// Kill switch for the cache-hit short-circuit specifically -- does NOT
// disable the ledger itself. Entries still get written and read_ledger
// still works either way; this only controls whether judgeComponent is
// allowed to skip a fresh search+score on a matching entry. Set
// PATTERN_NO_LEDGER_CACHE_HIT (any truthy value) to revert to "every
// recommend_component call always scores fresh" without removing any
// ledger code -- flip it back off (unset the var) to re-enable.
const LEDGER_CACHE_HIT_ENABLED = !process.env.PATTERN_NO_LEDGER_CACHE_HIT;

// Tool surface tier. Default "core" advertises only the tools a first-time
// caller needs for the install -> recommend -> enforce -> build path:
// recommend_component, extract_requirements, record_component_decision.
// Everything else (design-system registration, ledger provenance/liveness,
// cost/outcome tracking) is real but stays out of the default tool list so
// it can reveal itself once a caller actually needs it, rather than
// front-loading all eleven -- er, twelve -- tools on day one. Set
// PATTERN_TOOLS=full to advertise every tool immediately.
const TOOL_TIER = process.env.PATTERN_TOOLS === "full" ? "full" : "core";

// $/1M tokens, checked against the Anthropic pricing page rather than
// recalled from training data (rates drift). Both current and legacy
// Haiku 4.5 model-id spellings are listed since PATTERN_MODEL is
// user-configurable and either form may be in use. Falls back to Sonnet 5
// rates (with a diagnostic) for any model not listed here -- an estimate
// clearly logged as such beats silently returning $0.
const PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  "claude-sonnet-5": { inputPerMTok: 2.0, outputPerMTok: 10.0 },
  "claude-opus-5": { inputPerMTok: 5.0, outputPerMTok: 25.0 },
  "claude-haiku-4-5": { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  "claude-haiku-4-5-20251001": { inputPerMTok: 1.0, outputPerMTok: 5.0 },
};

// Anthropic's standard prompt-caching multipliers, applied on top of a
// model's base input rate -- cache writes cost ~1.25x, cache reads ~0.1x.
// These ratios are documented as consistent across models, unlike the
// base per-model rates above.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// Estimate only -- see PRICING's comment above. Rounded to 4 decimal
// places since a single call is well under a cent in many cases.
export function estimateCostUsd(usage: AnthropicUsage, model: string): number {
  const pricing = PRICING[model];
  if (!pricing) {
    console.error(
      JSON.stringify({
        diagnostic: "pricing_fallback",
        reason: `no pricing entry for model "${model}" -- estimated_cost_usd uses Sonnet 5 rates as a stand-in`,
        model,
      })
    );
  }
  const { inputPerMTok, outputPerMTok } = pricing ?? PRICING["claude-sonnet-5"];
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cost =
    (input * inputPerMTok +
      output * outputPerMTok +
      cacheWrite * inputPerMTok * CACHE_WRITE_MULTIPLIER +
      cacheRead * inputPerMTok * CACHE_READ_MULTIPLIER) /
    1_000_000;
  return Math.round(cost * 10000) / 10000;
}

// This bundled call runs extraction, search, and scoring inside ONE model
// turn via server-executed tools (web_search/web_fetch run on Anthropic's
// servers, not as separate round-trips this code makes) -- so there's no
// natural place to put three separate stopwatches. Streaming the response
// and timing content-block boundaries is the only way to get a real
// per-phase split without adding a second API call (which would change
// cost/behavior -- out of scope here).
//
// Validated against 8 real streamed traces before shipping (4 custom_build,
// 4 use_existing, covering both branches of step 6) rather than assumed:
// every trace showed the same shape --
//   [thinking] -> [search tool_use x2 -> search tool_result x2] -> [thinking/text...]
// with the first tool_use block starting at the exact millisecond the
// opening `thinking` block stopped (0-16ms of jitter across all 8 runs),
// and the discovery-search wave (always exactly the 2 calls step 3 asks
// the model to fire together) always followed immediately by a `thinking`
// or `text` block -- never by a third tool call with no reasoning in
// between. That gives two clean, consistently-observed cut points:
// first-tool-block-start (end of extract) and end-of-the-first-contiguous
// tool-block-run (end of search).
//
// For custom_build cases specifically, step 6's reference search
// (Mobbin/Figma) and its web_fetch deep-link check happen in a SECOND
// tool-block run, separated from the first by a `thinking` block that
// contains the actual coverage-scoring/verdict reasoning -- i.e. search
// and score are not simply sequential there, scoring happens in the
// middle. Using "last tool result in the whole response" as the search/
// score boundary (an earlier draft of this) would have wrongly folded that
// interstitial scoring reasoning, plus all of step 6, into "search". The
// boundary below avoids that: "search" is only ever the first contiguous
// tool-block run. Concretely this means breakdown_ms.score, for a
// custom_build verdict, also covers step 6's reference-finding and
// write-up -- not just coverage scoring -- which is disclosed in the
// README rather than presented as a narrower number than it is.
function classifyBlockKind(type: string | undefined): "tool" | "other" {
  return type === "tool_use" ||
    type === "server_tool_use" ||
    type === "web_search_tool_result" ||
    type === "web_fetch_tool_result"
    ? "tool"
    : "other";
}

export interface PhaseTimings {
  requestStartMs: number;
  extractEndMs: number;
  searchEndMs: number;
  scoreEndMs: number;
}

export function computeBreakdownMs(t: PhaseTimings): { extract: number; search: number; score: number } {
  return {
    extract: t.extractEndMs - t.requestStartMs,
    search: t.searchEndMs - t.extractEndMs,
    score: t.scoreEndMs - t.searchEndMs,
  };
}

function buildMeta(timings: PhaseTimings, usage: AnthropicUsage): NonNullable<JudgmentResult["_meta"]> {
  const fresh = usage.input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return {
    total_ms: timings.scoreEndMs - timings.requestStartMs,
    breakdown_ms: computeBreakdownMs(timings),
    tokens_used: {
      input: fresh + cacheWrite + cacheRead,
      output: usage.output_tokens ?? 0,
      input_breakdown: { fresh, cache_write: cacheWrite, cache_read: cacheRead },
    },
    estimated_cost_usd: estimateCostUsd(usage, MODEL),
  };
}

type StreamedContentBlock = {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  id?: string;
  tool_use_id?: string;
  content?: unknown;
};

interface StreamedMessage {
  content: StreamedContentBlock[];
  stop_reason?: string;
  usage: AnthropicUsage;
  timings: PhaseTimings;
}

// Streams a Messages API request over SSE and reconstructs the same
// {content, stop_reason, usage} shape the non-streaming endpoint returns,
// so every downstream consumer (search/fetch-call parsing, JSON
// extraction, the enforce* functions) is unaffected by this transport
// change. Also captures the phase timestamps described above. This is
// hand-rolled SSE parsing rather than the Anthropic SDK to avoid pulling
// in a new dependency for what's a small, stable, well-documented event
// shape (message_start/content_block_start/_delta/_stop/message_delta/
// message_stop).

// One retry, not a real backoff loop -- deliberately cost-conscious (see
// this project's skip-list/ledger-cache-hit reasoning): a 429 that's still
// rate-limited after respecting the API's own Retry-After is treated as a
// real failure to surface, not something worth spending a second wait on.
const RATE_LIMIT_MAX_RETRIES = 1;
// Fallback only for the rare case the API doesn't send Retry-After at all.
const RATE_LIMIT_DEFAULT_BACKOFF_MS = 3000;

function postAnthropicMessages(body: Record<string, unknown>): Promise<Response> {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      ...(ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": ANTHROPIC_WORKSPACE_ID } : {}),
    },
    body: JSON.stringify({ ...body, stream: true }),
  });
}

async function streamAnthropicMessage(body: Record<string, unknown>): Promise<StreamedMessage> {
  const requestStartMs = Date.now();
  let response = await postAnthropicMessages(body);

  for (let attempt = 0; response.status === 429 && attempt < RATE_LIMIT_MAX_RETRIES; attempt++) {
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader ? Number.parseFloat(retryAfterHeader) : NaN;
    const waitMs = Number.isFinite(retryAfterSeconds)
      ? Math.max(0, retryAfterSeconds * 1000)
      : RATE_LIMIT_DEFAULT_BACKOFF_MS;
    console.error(
      `Pattern: rate limited by the Anthropic API, retrying in ${(waitMs / 1000).toFixed(1)}s ` +
        `(${retryAfterHeader ? "per Retry-After" : "default backoff, no Retry-After header"})...`
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    response = await postAnthropicMessages(body);
  }

  if (!response.ok) {
    const errText = await response.text();
    const hint =
      response.status === 401
        ? " -- check that ANTHROPIC_API_KEY is set to a valid, active key in the environment running this MCP server."
        : response.status === 429
          ? " -- still rate limited after retrying once; the caller should wait longer before trying this request again."
          : "";
    throw new Error(`Anthropic API error ${response.status}: ${errText}${hint}`);
  }
  if (!response.body) {
    throw new Error("Anthropic API streaming response had no body to read.");
  }

  const blocks: StreamedContentBlock[] = [];
  const partialJson: Record<number, string> = {};
  let usage: AnthropicUsage = {};
  let stop_reason: string | undefined;

  let firstToolBlockStartMs: number | undefined;
  let lastToolResultStopMs: number | undefined;
  let searchEndMs: number | undefined; // frozen the first time a non-tool block interrupts the run
  let sawAnyToolBlock = false;

  const handleEvent = (payload: any) => {
    const now = Date.now();
    switch (payload.type) {
      case "message_start":
        usage = { ...usage, ...payload.message?.usage };
        break;
      case "content_block_start": {
        const idx: number = payload.index;
        blocks[idx] = structuredClone(payload.content_block) as StreamedContentBlock;
        const kind = classifyBlockKind(blocks[idx].type);
        if (kind === "tool") {
          sawAnyToolBlock = true;
          if (firstToolBlockStartMs === undefined) firstToolBlockStartMs = now;
        } else if (sawAnyToolBlock && searchEndMs === undefined && lastToolResultStopMs !== undefined) {
          // A thinking/text block has interrupted the first tool-block run --
          // freeze the search/score boundary at the last tool result seen so far.
          searchEndMs = lastToolResultStopMs;
        }
        break;
      }
      case "content_block_delta": {
        const idx: number = payload.index;
        const delta = payload.delta;
        if (delta?.type === "text_delta") {
          blocks[idx].text = (blocks[idx].text ?? "") + delta.text;
        } else if (delta?.type === "input_json_delta") {
          partialJson[idx] = (partialJson[idx] ?? "") + delta.partial_json;
        }
        break;
      }
      case "content_block_stop": {
        const idx: number = payload.index;
        if (partialJson[idx] !== undefined) {
          try {
            (blocks[idx] as any).input = JSON.parse(partialJson[idx] || "{}");
          } catch {
            (blocks[idx] as any).input = {};
          }
        }
        if (blocks[idx]?.type === "web_search_tool_result" || blocks[idx]?.type === "web_fetch_tool_result") {
          lastToolResultStopMs = now;
        }
        break;
      }
      case "message_delta":
        if (payload.usage) usage = { ...usage, ...payload.usage };
        if (payload.delta?.stop_reason) stop_reason = payload.delta.stop_reason;
        break;
      default:
        break;
    }
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let dataLines: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (line === "") {
        if (dataLines.length > 0) {
          try {
            handleEvent(JSON.parse(dataLines.join("\n")));
          } catch {
            // Malformed/partial SSE frame -- skip it rather than crash the call.
          }
        }
        dataLines = [];
        continue;
      }
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      // "event:" lines are ignored -- payload.type inside `data:` is
      // sufficient to dispatch on, and is what the code above already uses.
    }
  }

  const scoreEndMs = Date.now();
  const extractEndMs = firstToolBlockStartMs ?? scoreEndMs;
  const resolvedSearchEndMs = searchEndMs ?? lastToolResultStopMs ?? extractEndMs;

  return {
    content: blocks,
    stop_reason,
    usage,
    timings: { requestStartMs, extractEndMs, searchEndMs: resolvedSearchEndMs, scoreEndMs },
  };
}

const TOOL_NAME = "recommend_component";
const RECORD_DECISION_TOOL_NAME = "record_component_decision";
const EXTRACT_REQUIREMENTS_TOOL_NAME = "extract_requirements";
const READ_LEDGER_TOOL_NAME = "read_ledger";
const REPORT_BUILD_COST_TOOL_NAME = "report_build_cost";
const REPORT_OUTCOME_PROXY_TOOL_NAME = "report_outcome_proxy";
const CHECK_LEDGER_LIVENESS_TOOL_NAME = "check_ledger_liveness";
const EXPORT_LEDGER_PROVENANCE_TOOL_NAME = "export_ledger_provenance";
const POST_LEDGER_PROVENANCE_TOOL_NAME = "post_ledger_provenance_to_github";
const SWEEP_LEDGER_LIVENESS_TOOL_NAME = "sweep_ledger_liveness";
const BACKFILL_LEDGER_SNAPSHOT_REF_TOOL_NAME = "backfill_ledger_snapshot_ref";
const REGISTER_DESIGN_SYSTEM_TOOL_NAME = "register_design_system";

// See TOOL_TIER above. These four cover the install -> register a design
// system -> recommend -> enforce -> build happy path (recommend_component
// needs a registered design system to score against); everything else is
// "advanced" and only listed when PATTERN_TOOLS=full.
const CORE_TOOL_NAMES = new Set([
  REGISTER_DESIGN_SYSTEM_TOOL_NAME,
  TOOL_NAME,
  EXTRACT_REQUIREMENTS_TOOL_NAME,
  RECORD_DECISION_TOOL_NAME,
]);

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    component_need: {
      type: "string",
      description:
        "Specific description of the UI component needed -- not a category. " +
        "e.g. 'price breakdown with fees and taxes', not 'pricing'. Vague " +
        "category names produce false-positive matches.",
    },
    domain: {
      type: "string",
      description:
        "The product type/domain, e.g. 'Airbnb-style rental marketplace'. " +
        "Shapes what requirements get extracted for the component need.",
    },
    framework: {
      type: "string",
      description: "e.g. 'React + Tailwind', 'Vue 3'.",
    },
    existing_stack: {
      type: "string",
      description:
        "Optional. e.g. 'already using shadcn/ui'. Used only as a tiebreaker " +
        "between similarly-scored candidates, never as a hard filter.",
    },
    project_id: {
      type: "string",
      description:
        "Optional. A project name or path identifying which project this call " +
        "belongs to. When provided, past decisions confirmed via " +
        "record_component_decision for this same project_id are surfaced to " +
        "the model as a consistency signal (never a rule -- a genuinely " +
        "better match found in this search still wins). Separately, this call " +
        "may also be served directly from a recent, high-confidence prior " +
        "recommend_component judgment for this same project_id/component_need/" +
        "domain/framework/existing_stack, skipping search+score entirely -- " +
        "check the response for served_from_ledger: true, which is always set " +
        "when this happens; see read_ledger to inspect what's stored. Omit " +
        "project_id to skip both lookups entirely; neither ever falls back to " +
        "a shared/global bucket.",
    },
    checklist: {
      type: "array",
      items: { type: "string" },
      description:
        "Optional. A hand-provided (or extract_requirements-provided) requirement " +
        "checklist to score against directly, skipping this call's own internal " +
        "requirement extraction. Use this to inspect or correct the checklist " +
        "before spending the search+score budget -- call extract_requirements " +
        "first, review or edit its checklist, then pass it here. Omit to keep " +
        "today's default behavior: recommend_component extracts its own " +
        "checklist internally, unchanged.",
    },
    feature_id: {
      type: "string",
      description:
        "Optional. A stable identifier for the feature this component need " +
        "belongs to (e.g. a ticket id or branch name), used to roll up this " +
        "call's cost with a later report_build_cost call for the same " +
        "feature. Omit to have one derived deterministically from " +
        "project_id+component_need -- repeat calls for the same feature " +
        "then land under the same id automatically, with no coordination " +
        "needed between calls. Only meaningful together with project_id.",
    },
    file_path: {
      type: "string",
      description:
        "Optional. Path (relative to the project root) where this component " +
        "decision is expected to be implemented, if already known -- usually " +
        "not known yet at this call, since the decision typically precedes " +
        "the file existing. When provided, it's stored on the resulting " +
        "ledger entry and check_ledger_liveness can later confirm the file " +
        "still exists and still references chosen_candidate. Omit if unknown; " +
        "it cannot currently be attached to an entry after the fact.",
    },
  },
  required: ["component_need", "domain", "framework"],
} as const;

const EXTRACT_REQUIREMENTS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    component_need: {
      type: "string",
      description: "Same field as recommend_component's input -- a specific description of the UI component needed, not a category.",
    },
    domain: {
      type: "string",
      description: "Same field as recommend_component's input -- the product type/domain. Extraction is grounded in this, not the component name alone.",
    },
  },
  required: ["component_need", "domain"],
} as const;

const RECORD_DECISION_INPUT_SCHEMA = {
  type: "object",
  properties: {
    project_id: {
      type: "string",
      description:
        "A project name or path identifying which project this decision belongs " +
        "to -- must match the project_id used in recommend_component calls for " +
        "this decision to be surfaced there later.",
    },
    component_need: {
      type: "string",
      description: "The component need this decision was made for -- same field as recommend_component's input.",
    },
    domain: {
      type: "string",
      description: "Optional. The product domain, same field as recommend_component's input.",
    },
    action: {
      type: "string",
      enum: ["installed", "custom_built"],
      description: "Whether the calling agent installed an existing component or custom-built one.",
    },
    source: {
      type: "string",
      description: "Where it came from, e.g. 'shadcn', '21st.dev', 'reui', or 'custom' for a custom build.",
    },
    timestamp: {
      type: "string",
      description: "Optional. ISO 8601 timestamp of the decision. Defaults to the current time if omitted.",
    },
    time_saved_minutes: {
      type: "number",
      description:
        "Optional. Your own estimate, in minutes, of the time this decision saved you by having " +
        "Pattern's verdict instead of researching candidates and judging fit yourself from scratch. " +
        "This is self-reported by the calling agent -- Pattern has no way to measure a counterfactual, " +
        "so it never computes this itself (unlike _meta, which is Pattern's own real cost/latency). " +
        "Omit if you don't have a meaningful estimate; never guess a number just to fill the field.",
    },
  },
  required: ["project_id", "component_need", "action", "source"],
} as const;

const READ_LEDGER_INPUT_SCHEMA = {
  type: "object",
  properties: {
    project_id: {
      type: "string",
      description: "The project_id used in prior recommend_component calls whose ledger entries you want to inspect.",
    },
    component_need: {
      type: "string",
      description: "Optional. Filters entries by simple keyword match against their component_need. Omit to list all entries for the project.",
    },
    limit: {
      type: "number",
      description: "Optional. Maximum number of entries to return, most recent first. Defaults to 20.",
    },
    feature_id: {
      type: "string",
      description:
        "Optional. Instead of the usual keyword listing, returns the full " +
        "cost rollup for this one feature_id -- every verdict-time ledger " +
        "entry (fresh judgments and $0 ledger cache hits) plus every " +
        "report_build_cost record for it, with a summed total_cost_usd. " +
        "When provided, component_need and limit are ignored.",
    },
  },
  required: ["project_id"],
} as const;

const REPORT_BUILD_COST_INPUT_SCHEMA = {
  type: "object",
  properties: {
    feature_id: {
      type: "string",
      description:
        "The feature_id this build belongs to -- either one you explicitly " +
        "passed to an earlier recommend_component call for this feature, " +
        "or (if you didn't) the same value recommend_component would " +
        "derive on its own: sha256(project_id + '::' + component_need, " +
        "lowercased/trimmed) truncated to 8 hex chars. When in doubt, call " +
        "read_ledger with just project_id and copy the feature_id off the " +
        "relevant entry rather than re-deriving it by hand.",
    },
    project_id: {
      type: "string",
      description: "Optional but recommended. The same project_id used in the recommend_component call(s) for this feature, so read_ledger's feature_id rollup can find this record.",
    },
    tokens_used: {
      type: "number",
      description: "Optional. Total tokens spent building this feature, if you have a real number (e.g. from your own session accounting).",
    },
    cost_usd: {
      type: "number",
      description: "Total real spend, in USD, for building this feature end to end -- your own best number, not Pattern's (Pattern has no visibility past the verdict it returned).",
    },
    outcome: {
      type: "string",
      enum: ["shipped", "abandoned", "replaced_with_existing"],
      description:
        "What actually happened to this build: 'shipped' it went out, " +
        "'abandoned' the build was dropped before shipping, " +
        "'replaced_with_existing' you started a custom build but swapped " +
        "in an existing component instead (or vice versa).",
    },
  },
  required: ["feature_id", "cost_usd", "outcome"],
} as const;

const REPORT_OUTCOME_PROXY_INPUT_SCHEMA = {
  type: "object",
  properties: {
    feature_id: {
      type: "string",
      description: "The feature_id this outcome data belongs to -- same value used in the feature's recommend_component/report_build_cost calls.",
    },
    project_id: {
      type: "string",
      description: "Optional but recommended. The same project_id used in this feature's other calls, so read_ledger's feature_id rollup can find this record.",
    },
    reworked: {
      type: "boolean",
      description:
        "Whether any of the files this feature's build touched have been modified again since the original merge -- computed by you from your own repo's git history (e.g. `git log --follow` against the file list), never guessed. Re-report this on a later check if the answer changes.",
    },
    days_to_rework: {
      type: "number",
      description: "Optional. Days between the original merge and the first rework commit, if reworked is true and you have a real date to compute from.",
    },
    time_to_merge_hours: {
      type: "number",
      description: "Hours between the first commit touching this feature's files and the commit/PR that merged it, computed from your own repo's git metadata.",
    },
    status_at_30d: {
      type: "string",
      enum: ["kept", "replaced", "removed"],
      description: "At a ~30-day horizon post-merge: whether the component Pattern recommended still exists in the codebase, unchanged in kind ('kept'), was swapped for a different approach ('replaced'), or was deleted entirely ('removed'). Only report this once the horizon has actually passed.",
    },
  },
  required: ["feature_id"],
} as const;

const CHECK_LEDGER_LIVENESS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    project_id: {
      type: "string",
      description: "The project_id used in the recommend_component call(s) whose ledger entries you want live-checked.",
    },
    ledger_entry_id: {
      type: "string",
      description:
        "Optional. Check just this one entry (its id, from read_ledger) " +
        "instead of every entry for project_id that has a file_path set.",
    },
  },
  required: ["project_id"],
} as const;

const EXPORT_LEDGER_PROVENANCE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    project_id: {
      type: "string",
      description: "The project_id used in the recommend_component call that produced this ledger entry.",
    },
    ledger_entry_id: {
      type: "string",
      description: "The specific entry to export, from read_ledger or check_ledger_liveness.",
    },
  },
  required: ["project_id", "ledger_entry_id"],
} as const;

const POST_LEDGER_PROVENANCE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    project_id: {
      type: "string",
      description: "The project_id used in the recommend_component call that produced this ledger entry.",
    },
    ledger_entry_id: {
      type: "string",
      description: "The specific entry to post, from read_ledger or check_ledger_liveness.",
    },
    repo: {
      type: "string",
      description: 'GitHub repo in "owner/repo" form, e.g. "my-org/my-booking-app".',
    },
    issue_number: {
      type: "number",
      description:
        "The PR or issue number to comment on -- GitHub treats both identically for comments, so no separate type flag is needed.",
    },
  },
  required: ["project_id", "ledger_entry_id", "repo", "issue_number"],
} as const;

const SWEEP_LEDGER_LIVENESS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    project_id: {
      type: "string",
      description:
        "Optional. Scope the sweep to one project_id. Omit to sweep every " +
        "project_id present in the ledger -- the whole-ledger, scheduler-driven " +
        "mode this tool exists for.",
    },
  },
  required: [],
} as const;

const BACKFILL_LEDGER_SNAPSHOT_REF_INPUT_SCHEMA = {
  type: "object",
  properties: {
    project_id: {
      type: "string",
      description: "The project_id whose ledger entries to backfill.",
    },
    ledger_entry_id: {
      type: "string",
      description: "Optional. Backfill just this one entry instead of every entry for project_id missing snapshot_ref.",
    },
  },
  required: ["project_id"],
} as const;

const REGISTER_DESIGN_SYSTEM_INPUT_SCHEMA = {
  type: "object",
  properties: {
    project_id: {
      type: "string",
      description:
        "The project this registration belongs to -- must match the project_id used in recommend_component calls for it to be scored against. Registering a design system replaces (does not merge with) any prior registration for this same project_id, and switches recommend_component to score ONLY against it for this project -- shadcn/ui, 21st.dev, and ReUI are no longer searched once a project has a registration.",
    },
    manifest_path: {
      type: "string",
      description:
        "Path to a components manifest, relative to the project root (PATTERN_PROJECT_ROOT, defaults to this server's working directory) -- never an absolute path. Two recognized shapes: a hand-authored JSON array of {name, props, description, usage_example} objects (optionally wrapped in {\"components\": [...]}); or a Storybook-exported stories/index JSON file (an object with a top-level \"entries\" or \"stories\" map) -- component names only in that case, since Storybook's basic export doesn't carry prop data. Exactly one of manifest_path, directory_path, figma_json_path or figma_file_key is required.",
    },
    directory_path: {
      type: "string",
      description:
        "Path to a directory of component source files, relative to the project root -- never an absolute path. Scanned recursively for .jsx/.tsx/.js/.ts files (excluding node_modules/dist/build/.git and test/story files); each exported, uppercase-named function or const component found is a candidate, with props read from a `<Name>Props` interface/type, a `.propTypes` block, or (as a last resort) the component's own destructured parameters. This is a heuristic scan, not a full parser -- an empty or partial props list for some components is expected, not a bug, especially on plain JS with no prop typing at all. Exactly one of manifest_path, directory_path, figma_json_path or figma_file_key is required.",
    },
    figma_json_path: {
      type: "string",
      description:
        "Path (relative to the project root) to a saved Figma file response -- the JSON from GET https://api.figma.com/v1/files/<file_key>. Fully local: no token, no network call. One candidate per component set (component-with-variants) and per standalone component, carrying its page/section, description and variant options; hidden components (names starting with . or _) and instances are skipped. Experimental: built to Figma's documented schema, not yet run against a real file. Exactly one of manifest_path, directory_path, figma_json_path or figma_file_key is required.",
    },
    figma_file_key: {
      type: "string",
      description:
        "Figma file key (the part of a figma.com/design/<key>/... URL). Fetches the file from api.figma.com with FIGMA_ACCESS_TOKEN (environment only, never a tool argument) and registers it like figma_json_path -- so your token and this request go to Figma. Experimental. Exactly one of manifest_path, directory_path, figma_json_path or figma_file_key is required.",
    },
    figma_mode: {
      type: "string",
      enum: ["components", "frames"],
      description:
        "Only with figma_json_path / figma_file_key. \"components\" (default): one candidate per defined component / component set. \"frames\": one candidate per named design (frame or group) on the pages -- for files, community templates especially, that draw their designs as plain frames instead of components. In frames mode a frame with 3+ substantial sub-designs is treated as a sheet (\"Bar Charts > Chart 5\"), and each candidate's evidence is its layer names and text contents. Experimental.",
    },
    figma_pages: {
      type: "array",
      items: { type: "string" },
      description:
        "Both Figma modes: restrict to pages whose name contains any of these strings (case-insensitive), e.g. [\"Design\"], to skip cover / style-guide / license pages.",
    },
    figma_exclude_pages: {
      type: "array",
      items: { type: "string" },
      description:
        "Both Figma modes: skip pages whose name contains any of these strings (case-insensitive), e.g. [\"Icons\"]. Real design systems often carry thousands of icon components that would swamp scoring; a registration over PATTERN_FIGMA_MAX_CANDIDATES (3000) candidates is refused with the biggest pages named.",
    },
    summarize: {
      type: "boolean",
      description:
        "Two different things. (1) directory_path: ON BY DEFAULT when ANTHROPIC_API_KEY is set: writes a short (2-3 sentence) capability summary for each scanned file with Claude Haiku and stores it on the registration -- a big accuracy/confidence gain for the Jev design-system scorer (PATTERN_SCORER=jev) and harmless for the default one. This SENDS up to 8000 characters of each source file that needs a summary to api.anthropic.com; pass false (or set PATTERN_NO_SUMMARIES=1) to keep registration fully local. true refuses (leaving the previous registration untouched) when there is no key or no directory_path; unset never refuses, it just skips. Costs about 0.2 cents per file (capped at PATTERN_SUMMARY_MAX_FILES, default 200 files). Summaries are cached by file content: re-registering only pays for files that changed, and unchanged files keep their summary even with summarize: false. (2) figma_file_key: OPT-IN ONLY (summarize: true; never default) -- renders each registered design with Figma's images API and has Claude Haiku write a 2-sentence VISION caption of it (chart type, what is drawn, tooltips/legends/toggles), stored as the candidate's summary. Text and layer names can't say what is drawn, and on a real file this raised needs matched from ~17/27 to 23/27 with a clean score gap. It SENDS IMAGES OF YOUR DESIGNS to api.anthropic.com and asks Figma to render them with your token; needs ANTHROPIC_API_KEY and FIGMA_ACCESS_TOKEN; costs under a tenth of a cent per design; refused with figma_json_path (fully local).",
    },
  },
  required: ["project_id"],
} as const;

// Shared between buildSystemPrompt's own step 2 and
// buildExtractionSystemPrompt (the extract_requirements tool's standalone
// prompt) -- the extraction *instructions* are one piece of text reused
// by both, even though the two tools issue physically separate API calls
// (recommend_component's step 2 runs inside the same server-tool-use
// turn as search+score; extract_requirements is a standalone call with no
// tools at all). This is what "factor it out into a shared function" means
// here: the wording, not a shared HTTP call.
const EXTRACTION_INSTRUCTIONS =
  "Turn the component need + domain into a concrete checklist of elements the component must contain -- specific enough to check against real code, not a vibe. Ground it in the stated domain, not the component name alone. Extract exactly 8 checklist items, ranked by importance to the component's core function (most important first) -- a fixed count, not a range, so coverage = met/total isn't itself a moving target across runs.";

// Step 8 doesn't depend on where candidates came from, only on whether
// past-decision context was included in the user message.
const PAST_DECISION_SIGNAL_INSTRUCTIONS = `Include a top-level "past_decision_signal" field in your response: { "considered": true|false, "note": "string" }. Set "considered": true only if at least one listed past decision was genuinely similar enough to this need that it actually factored into your scoring or recommendation -- not just present in the list. "note" is one sentence: if considered is true, name which past decision and how it factored in (e.g. "Consistent with this project's prior custom build of a similar price breakdown component"); if false, one sentence on why none applied (e.g. "No past decision matches this need closely enough to be a relevant signal"). This field is mandatory whenever the section is present in the user message -- do not omit it, and do not include it at all if the section was absent.`;

// Shared for the same reason -- the response contract itself doesn't
// depend on candidate source either.
const JUDGMENT_RESPONSE_SHAPE = `Respond with ONLY a single JSON object, no prose before or after, no markdown code fences, matching this exact shape:

{
  "verdict": "use_existing" | "custom_build",
  "confidence": "high" | "medium" | "low",
  "reason": "scored" | "no_candidates_found" | "skip_list",
  "computed_at": "<today's date, ISO format>",
  "requirements_checked": [ { "requirement": "string", "met": true|false, "evidence": "string" } ] | null,
  "coverage": "string like '5/7 (71%)'" | null,
  "oversized_match": true|false | omit if verdict is not use_existing,
  "oversized_match_note": "string, required when oversized_match is true" | omit otherwise,
  "recommendation": {
    "source": "string or null",
    "install_command": "string or null",
    "component_description": "string (use_existing only) or null",
    "reference": null
  },
  "past_decision_signal": { "considered": true|false, "note": "string" } | omit this field entirely if step 8 doesn't apply
}`;

// Design-system-scored variant of buildSystemPrompt -- used by
// runSinglePass instead of buildSystemPrompt whenever the caller's
// project_id has a registration from register_design_system (see
// getRegisteredDesignSystem). Steps 1, 2, 5 (skip-list, checklist,
// thresholds/oversized-match), 6, 7, 8, and the response shape are
// unchanged in substance from buildSystemPrompt -- only step 3 (discovery)
// and step 4 (scoring evidence) differ, because there's no live search to
// run: the candidate pool is already fully known from the registration,
// passed inline in the user message (see runSinglePass's designSystemBlock).
function buildDesignSystemSystemPrompt(opts?: { checklistProvided?: boolean }): string {
  const step2 = opts?.checklistProvided
    ? `2. USE THE PROVIDED CHECKLIST
The user message includes a "Provided checklist" section -- a requirement checklist already prepared for you (either hand-written by the calling agent, or produced by a prior extract_requirements call). Do not extract your own checklist, and do not add, remove, reorder, or reword any item. Treat it as fixed input and score coverage against exactly these items in step 4 below.`
    : `2. EXTRACT REQUIREMENTS
${EXTRACTION_INSTRUCTIONS}`;
  return `You are a UI component judgment layer. Given a component need, you decide whether it should be met with a component already in this project's own registered design system, or requires a custom build. This project has registered its own design system as the candidate pool for this call (see the "Registered design system candidates" section in the user message below) -- score ONLY against those candidates, never against shadcn/ui, 21st.dev, ReUI, or any other external library. You have no tools: there is nothing to search for or fetch, the candidate pool is already given to you in full.

If the user message includes a "Past confirmed decisions in this project" section, treat it only as a signal, not a rule: if a highly similar past decision exists, consider consistency with it while scoring and recommending, but don't let it override a genuinely better match among the registered candidates, and don't skip or shortcut your own scoring because a past decision exists. You decide relevance yourself. Step 8 below tells you exactly how to report what you did with it.

Follow this process exactly:

1. SKIP-LIST CHECK
If the component need is a trivial, single-purpose primitive with no meaningful internal structure (button, input, checkbox, label, badge, spinner, loader, tooltip, avatar, icon), skip the rest of this process and return verdict "use_existing" with reason "skip_list", confidence "high", and a note that this is a commodity primitive not worth scoring.

${step2}

3. MATCH AGAINST THE REGISTERED DESIGN SYSTEM
The "Registered design system candidates" section below lists every candidate available for this call: each has a name and, where known, its props and a description/usage example. This data was already extracted from this project's own manifest or component code -- do not search the web for candidates, do not invent props or capabilities beyond what's listed, and do not assume a candidate has a prop just because a similarly-named external component typically would. A candidate with an empty or sparse props list is expected on some registered design systems (a directory scan or a bare-bones manifest can only capture what was actually written) -- score it honestly against what's listed, which will often mean lower coverage or lower confidence, not a bug in this process.

If none of the registered candidates are even plausibly relevant to the component need -- not just a weak match, but nothing on-topic at all -- stop here and return verdict "custom_build" with reason "no_candidates_found". Do not fabricate a coverage score in this case; omit requirements_checked and coverage entirely.

4. SCORE COVERAGE AGAINST THE CHECKLIST
For each plausibly relevant registered candidate, evaluate against the checklist using only the props/description/usage_example data given for it in the user message. There is nothing to fetch here -- unlike an external library, this data already IS this project's own real source of truth, not a summary of it. Mark each requirement met or not-met with a one-line reason grounded in what the candidate's listed data actually shows, never a guess at what a component with this name would probably support elsewhere. Compute coverage = (requirements met) / (total requirements) for the best-fitting candidate.

5. APPLY VERDICT THRESHOLDS
coverage >= 80% -> verdict "use_existing", confidence "high"
coverage 40-79% -> verdict "use_existing", confidence "low" (list the missing fields)
coverage < 40% -> verdict "custom_build"

Before finalizing a "high" confidence use_existing verdict, check for an OVERSIZED MATCH: a
candidate can satisfy every checklist item and still be the wrong call if its real capabilities
substantially exceed what the stated project scope actually needs. This is a distinct check from
coverage -- a component can be 100% covered and still be an Oversized Match. Weigh it against what
the component_need and domain actually state about scale.

Report this via two top-level fields, "oversized_match" (boolean) and "oversized_match_note" (string,
required when true): set oversized_match true and name the specific excess capability in the note, not
a vague "this may be more than needed." Do this regardless of what you also write for "confidence"
below -- the server derives the actual confidence cap from oversized_match deterministically, so don't
rely on your own "confidence" value alone to carry this signal.

If the verdict is use_existing, include "component_description": 1-2 sentences of plain-language description of what the recommended candidate actually does, grounded only in the data given for it above -- not a generic guess at what a component with this name would typically look like.

"install_command" should be omitted (null) for a registered-design-system candidate -- there is no install step for a component that's already part of this project's own codebase or design spec; the calling agent already has it.

6. IF custom_build
Return "recommendation" with "source", "install_command", "component_description" and "reference" all null. Do not name external components, libraries, or reference screens -- the requirements_checked list already shows, item by item, what the closest registered candidates do not cover, and that gap list is the guidance for the build.

7. EXISTING STACK TIEBREAKER
If existing_stack is provided and two registered candidates score similarly, prefer the one matching the existing stack. Never use it as a hard filter that excludes a genuinely better-scoring registered candidate.

8. PAST DECISION SIGNAL (only if the user message included a "Past confirmed decisions in this project" section)
${PAST_DECISION_SIGNAL_INSTRUCTIONS}

${JUDGMENT_RESPONSE_SHAPE}`;
}

// Standalone prompt for the extract_requirements tool -- shares
// EXTRACTION_INSTRUCTIONS with buildSystemPrompt's own step 2 (see that
// constant's comment) but is otherwise a much smaller prompt: no tools, no
// search/score steps, just the extraction reasoning. This is what makes
// extract_requirements fast and cheap relative to recommend_component.
function buildExtractionSystemPrompt(): string {
  return `You are the requirement-extraction step of a UI component judgment tool. Given a component need and a product domain, produce a checklist of concrete elements the component must contain.

${EXTRACTION_INSTRUCTIONS}

Respond with ONLY a single JSON object, no prose before or after, no markdown code fences, matching this exact shape:

{
  "checklist": ["string", "string", "..."]
}`;
}

// Placeholder heuristic, not a validated confidence signal -- see the
// extract_requirements section of README.md for why (a known gap to
// revisit with real usage data, not fabricated precision). A longer,
// more specific component_need gives the extraction step more to ground
// the checklist in; a one- or two-word need is exactly the "too vague"
// case the README already warns produces misleading matches elsewhere in
// this tool, so it's flagged "low" here too.
export function estimateExtractionConfidence(componentNeed: string): "high" | "medium" | "low" {
  const wordCount = componentNeed.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount <= 2) return "low";
  if (wordCount <= 5) return "medium";
  return "high";
}

type SinglePassResult = { ok: true; result: JudgmentResult } | { ok: false; raw: string };

const DESIGN_SYSTEM_RECALL_NOTE =
  "These registered design-system candidates share keywords with this component_need but were not selected as a match -- the verdict may have missed a real one. This is a weak, keyword-only signal, not proof of an actual match: double-check these candidates yourself (or re-run this call) before trusting custom_build here.";

// Design-system mode scored by Jev (PATTERN_SCORER=jev): one Jev call (or a
// few, for a big library) ranks the registered design system's files against
// the need. No Anthropic call, no web search. A top score under
// JEV_FOUND_THRESHOLD is reported as plain "nothing fits" -- there is
// deliberately no external-library fallback in this mode.
async function runDesignSystemJevPass(
  input: { component_need: string; domain: string; project_id?: string },
  designSystem: DesignSystemRegistration,
  passStartMs: number
): Promise<SinglePassResult> {
  const pool = collapseForJev(designSystem.candidates);
  const { ranked, usage } = await rankWithJev(input.component_need, pool, JEV_BATCH_TOKENS);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const shape = (r: (typeof ranked)[number]) => ({ file: r.entry.file, components: r.entry.components, score: round2(r.score) });
  const top = ranked[0];
  const found = top !== undefined && top.score >= JEV_FOUND_THRESHOLD;
  const elapsed = Math.max(1, Date.now() - passStartMs);

  const rated = JEV_USD_PER_MTOK_IN !== undefined && JEV_USD_PER_MTOK_OUT !== undefined;
  const cost = rated
    ? (usage.input_tokens * Number(JEV_USD_PER_MTOK_IN) + usage.output_tokens * Number(JEV_USD_PER_MTOK_OUT)) / 1_000_000
    : 0;
  const meta: NonNullable<JudgmentResult["_meta"]> = {
    total_ms: elapsed,
    breakdown_ms: { extract: 0, search: 0, score: elapsed },
    tokens_used: { input: usage.input_tokens, output: usage.output_tokens },
    estimated_cost_usd: cost,
    ...(rated ? {} : { cost_note: "Jev scorer: cost unknown (set PATTERN_JEV_USD_PER_MTOK_IN/OUT to estimate); 0 here does not mean free." }),
  };

  const base = {
    scorer: "jev" as const,
    computed_at: new Date().toISOString().slice(0, 10),
    requirements_checked: null,
    coverage: null,
    checklist_source: "extracted" as const,
    ensemble: { triggered: false },
    _meta: meta,
  };

  if (found) {
    const label = `${top.entry.components.join(", ")}${top.entry.file ? ` (${top.entry.file})` : ""}`;
    return {
      ok: true,
      result: {
        ...base,
        verdict: "use_existing",
        // Never "high": Jev's scores are unproven as calibrated probabilities,
        // and "high" also unlocks the ledger cache-hit shortcut.
        confidence: top.score >= 0.7 ? "medium" : "low",
        reason: "scored",
        recommendation: { source: "design_system", install_command: null, component_description: label, reference: null },
        design_system_match: { ...shape(top), alternatives: ranked.slice(1, 4).map(shape), candidates_considered: pool.length },
      },
    };
  }

  const closest = top ? `${top.entry.components.join(", ")}${top.entry.file ? ` (${top.entry.file})` : ""}, score ${round2(top.score)}` : "none";
  const result: JudgmentResult = {
    ...base,
    verdict: "custom_build",
    confidence: top && top.score >= JEV_FOUND_THRESHOLD * 0.75 ? "low" : "medium",
    reason: "no_candidates_found",
    recommendation: null,
    design_system_match: top ? { ...shape(top), alternatives: ranked.slice(1, 4).map(shape), candidates_considered: pool.length } : null,
    not_found_message:
      `Could not find a component in the registered design system that fits this need ` +
      `(checked ${designSystem.candidate_count} components in ${pool.length} ${pool.length === 1 ? "entry" : "entries"}; closest: ${closest}). ` +
      `Web search is not used in design-system mode with the Jev scorer, so no outside library was searched. ` +
      `Build it custom, or add a suitable component to the design system and re-register it.`,
  };
  const overlap = findKeywordOverlapCandidates(input.component_need, input.domain, designSystem.candidates);
  if (overlap.length > 0) {
    result.design_system_recall_check = { possible_missed_candidates: overlap, note: DESIGN_SYSTEM_RECALL_NOTE };
  }
  return { ok: true, result };
}

async function runSinglePass(input: {
  component_need: string;
  domain: string;
  framework: string;
  existing_stack?: string;
  project_id?: string;
  checklist?: string[];
}): Promise<SinglePassResult> {
  const passStartMs = Date.now();
  const checklistSource: "extracted" | "provided" = input.checklist && input.checklist.length > 0 ? "provided" : "extracted";

  // Fast path: skip-list check happens locally too, so trivial primitives
  // never spend a real API call. The system prompt also enforces this, but
  // checking here avoids the round-trip entirely for the common case. The
  // ANTHROPIC_API_KEY check used to run before this, unconditionally --
  // meaning a keyless install couldn't get even this free, local path.
  // Moved below the skip-list return so a missing/invalid key only ever
  // blocks the cases that actually need the API.
  if (isSkipListMatch(input.component_need)) {
    const skipListElapsedMs = Math.max(1, Date.now() - passStartMs);
    return {
      ok: true,
      result: {
        verdict: "use_existing",
        confidence: "high",
        reason: "skip_list",
        computed_at: new Date().toISOString().slice(0, 10),
        requirements_checked: null,
        coverage: null,
        recommendation: {
          source: "commodity primitive",
          install_command: null,
          component_description: null,
          reference: null,
        },
        checklist_source: checklistSource,
        // No API call happens on this path -- tokens/cost are genuinely
        // zero, not omitted. total_ms is clamped to at least 1 so the
        // field is never zero even though this branch is sub-millisecond;
        // all of that trivial time is attributed to "extract" since it's
        // the local skip-list check, not a search or scoring step.
        _meta: {
          total_ms: skipListElapsedMs,
          breakdown_ms: { extract: skipListElapsedMs, search: 0, score: 0 },
          tokens_used: { input: 0, output: 0 },
          estimated_cost_usd: 0,
        },
      },
    };
  }

  // Jev design-system path: needs no Anthropic key. A caller-supplied
  // checklist opts out (Jev scores whole files, not per-requirement items),
  // falling through to the normal Anthropic path below.
  if (DESIGN_SYSTEM_JEV_ENABLED && input.project_id && !(input.checklist && input.checklist.length > 0)) {
    const jevDesignSystem = getRegisteredDesignSystem(input.project_id);
    if (jevDesignSystem) return runDesignSystemJevPass(input, jevDesignSystem, passStartMs);
  }

  // Pattern judges against a project's own registered design system only.
  // No registration -> nothing to score against; say so instead of falling
  // back to searching external libraries.
  if (!ANTHROPIC_API_KEY) {
    throw new Error(MISSING_API_KEY_MESSAGE);
  }

  if (!input.project_id || !getRegisteredDesignSystem(input.project_id)) {
    throw new Error(NO_DESIGN_SYSTEM_MESSAGE);
  }

  // Coverage still computes fresh below regardless of what this finds --
  // memory (MEMORY_PATH/record_component_decision) only ever adds context
  // to the user message, it never short-circuits search/scoring or gets
  // treated as a cached verdict. No project_id -> no lookup at all, not a
  // shared/global fallback (see getPastDecisions). This is distinct from
  // the ledger cache-hit check in judgeComponent, which CAN skip this
  // entire function on a matching high-confidence entry -- that check
  // happens one level up, before runSinglePass is ever called.
  const pastDecisions = input.project_id ? getPastDecisions(input.project_id) : [];
  const pastDecisionsBlock =
    pastDecisions.length === 0
      ? ""
      : `\n\nPast confirmed decisions in this project:\n${pastDecisions
          .map((d) => {
            const verb = d.action === "installed" ? "Installed" : "Custom-built";
            const domainPart = d.domain ? ` (domain: ${d.domain})` : "";
            return `- ${verb} for "${d.component_need}"${domainPart}, source: ${d.source}, confirmed ${d.timestamp}`;
          })
          .join("\n")}`;

  const checklistBlock =
    input.checklist && input.checklist.length > 0
      ? `\n\nProvided checklist (use exactly these items, do not re-extract):\n${input.checklist
          .map((item, i) => `${i + 1}. ${item}`)
          .join("\n")}`
      : "";

  // The registration is guaranteed by the no-design-system guard above:
  // Pattern only ever scores against a project's own registered design system.
  const designSystem = getRegisteredDesignSystem(input.project_id!)!;
  const designSystemBlock = `\n\nRegistered design system candidates (source: ${designSystem.source_kind}, ${designSystem.source_path}):\n${designSystem.candidates
        .map((c, i) => {
          const propsPart = c.props.length > 0 ? `props: ${c.props.join(", ")}` : "props: (none captured)";
          const descPart = c.description ? `; description: ${c.description}` : "";
          const usagePart = c.usage_example ? `; usage_example: ${c.usage_example}` : "";
          const summaryPart = c.summary ? `; summary: ${c.summary}` : "";
          const figmaText = describeFigma(c);
          const figmaPart = figmaText ? `; ${figmaText}` : "";
          return `${i + 1}. ${c.name} -- ${propsPart}${descPart}${usagePart}${summaryPart}${figmaPart}`;
        })
        .join("\n")}`;

  const userMessage = `component_need: ${input.component_need}
domain: ${input.domain}
framework: ${input.framework}
existing_stack: ${input.existing_stack ?? "(not specified)"}${checklistBlock}${pastDecisionsBlock}${designSystemBlock}`;

  // Diagnostic only, same pattern as the other stderr diagnostics in this
  // file -- proves the memory lookup actually reached the prompt sent to
  // the model, not just that it was read from disk successfully.
  if (input.project_id) {
    console.error(
      JSON.stringify({
        diagnostic: "past_decisions_context",
        project_id: input.project_id,
        past_decision_count: pastDecisions.length,
        included_in_prompt: pastDecisionsBlock || null,
      })
    );
  }

  const data = await streamAnthropicMessage({
    model: MODEL,
    max_tokens: 8192,
    // System prompt is identical on every call, so mark it cacheable --
    // cache reads cost roughly a tenth of fresh input tokens.
    system: [
      {
        type: "text",
        text: buildDesignSystemSystemPrompt({ checklistProvided: checklistSource === "provided" }),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userMessage }],
    // No tools: the candidate pool is given inline, so there is nothing to
    // search for or fetch.
    tools: [],
  });

  // If the model hits max_tokens, the response is cut
  // mid-JSON and must not be silently returned as if it were valid.
  if (data.stop_reason === "max_tokens") {
    throw new Error(
      "Anthropic response was truncated (stop_reason: max_tokens) before finishing its JSON output. Raise max_tokens or register a smaller design system."
    );
  }

  const finalText = data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();

  if (!finalText) {
    throw new Error(
      `Anthropic response contained no text content to extract JSON from (stop_reason: ${data.stop_reason ?? "unknown"}).`
    );
  }

  const extracted = extractJson(finalText);
  let parsed: JudgmentResult;
  try {
    parsed = JSON.parse(extracted) as JudgmentResult;
  } catch {
    // Can't post-process what doesn't parse -- return as-is rather than
    // crash. The caller still gets the raw (if malformed) model output.
    console.error(JSON.stringify({ diagnostic: "postprocess_skipped", reason: "output did not parse as JSON" }));
    return { ok: false, raw: extracted };
  }

  enforceCoverageRecount(parsed);
  enforceVerdictThreshold(parsed);
  enforceRecommendationConsistency(parsed);

  // Set server-side, never trusted from the model's own "source" text --
  // same "server derives what it already knows deterministically" policy
  // as the other enforce* calls above. A design-system-scored use_existing
  // verdict always gets the literal string "design_system" here,
  // regardless of what the model wrote, so downstream consumers (the
  // ledger, provenance markdown, read_ledger rollups) can match on it
  // reliably instead of parsing free-text.
  if (designSystem && parsed.verdict === "use_existing" && parsed.recommendation) {
    parsed.recommendation.source = "design_system";
  }

  // Design-system recall check (see findKeywordOverlapCandidates above):
  // only meaningful when the model claimed nothing registered was even
  // plausibly relevant -- a "scored" custom_build already means a real
  // candidate was found, evaluated, and fell below threshold, a
  // different, already-instrumented failure mode (requirements_checked
  // shows exactly what was missing). Logged even on a clean miss (no
  // overlap found) so the check's own execution is visible in stderr,
  // not just its hits.
  if (designSystem && parsed.reason === "no_candidates_found") {
    const overlap = findKeywordOverlapCandidates(input.component_need, input.domain, designSystem.candidates);
    console.error(
      JSON.stringify({
        diagnostic: "design_system_recall_check",
        project_id: input.project_id,
        possible_missed_candidates: overlap.map((m) => m.name),
      })
    );
    if (overlap.length > 0) {
      parsed.design_system_recall_check = {
        possible_missed_candidates: overlap,
        note: DESIGN_SYSTEM_RECALL_NOTE,
      };
    }
  }

  // Set server-side rather than trusted from the model -- deterministic
  // from whether input.checklist was actually supplied, same "never trust
  // the model where the server already knows the truth" policy as the
  // other enforce* functions above.
  parsed.checklist_source = checklistSource;
  parsed._meta = buildMeta(data.timings, data.usage);

  // Same "server-side, not just prompt instruction" policy as the rest of
  // this file: a past_decision_signal is only trusted when this call
  // actually had past-decision context to consider. Strips a fabricated
  // signal on a call with no project_id or an empty project history --
  // the model has no basis to claim it weighed something that was never
  // in its prompt.
  if (pastDecisions.length === 0 && parsed.past_decision_signal) {
    console.error(
      JSON.stringify({
        diagnostic: "past_decision_signal_cleared",
        reason: "no past-decision context was included in this call's prompt -- clearing an unbacked signal",
        clearedSignal: parsed.past_decision_signal,
      })
    );
    parsed.past_decision_signal = null;
  }

  return { ok: true, result: parsed };
}

export interface ExtractionResult {
  checklist: string[];
  extraction_confidence: "high" | "medium" | "low";
  _meta: NonNullable<JudgmentResult["_meta"]>;
}

type ExtractionOutcome = { ok: true; result: ExtractionResult } | { ok: false; raw: string };

// Backs the extract_requirements tool. Deliberately a separate, much
// smaller call than runSinglePass above: no tools declared (extraction is
// pure reasoning over component_need + domain, no search needed), so this
// is fast and cheap relative to recommend_component's full pipeline. Also
// applies the same local skip-list short-circuit as recommend_component,
// for the same reason (trivial primitives shouldn't cost an API call here
// either).
async function runExtraction(input: { component_need: string; domain: string }): Promise<ExtractionOutcome> {
  const startMs = Date.now();

  if (isSkipListMatch(input.component_need)) {
    const elapsedMs = Math.max(1, Date.now() - startMs);
    return {
      ok: true,
      result: {
        checklist: [],
        extraction_confidence: "high",
        _meta: {
          total_ms: elapsedMs,
          breakdown_ms: { extract: elapsedMs, search: 0, score: 0 },
          tokens_used: { input: 0, output: 0 },
          estimated_cost_usd: 0,
        },
      },
    };
  }

  if (!ANTHROPIC_API_KEY) {
    throw new Error(MISSING_API_KEY_MESSAGE);
  }

  const userMessage = `component_need: ${input.component_need}\ndomain: ${input.domain}`;

  const data = await streamAnthropicMessage({
    model: MODEL,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: buildExtractionSystemPrompt(),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userMessage }],
  });

  if (data.stop_reason === "max_tokens") {
    throw new Error(
      "Anthropic response was truncated (stop_reason: max_tokens) before finishing its JSON output."
    );
  }

  const finalText = data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();

  if (!finalText) {
    throw new Error(
      `Anthropic response contained no text content to extract JSON from (stop_reason: ${data.stop_reason ?? "unknown"}).`
    );
  }

  const extracted = extractJson(finalText);
  let parsed: { checklist?: unknown };
  try {
    parsed = JSON.parse(extracted);
  } catch {
    console.error(JSON.stringify({ diagnostic: "postprocess_skipped", reason: "extract_requirements output did not parse as JSON" }));
    return { ok: false, raw: extracted };
  }

  const checklist = Array.isArray(parsed.checklist) ? parsed.checklist.filter((item): item is string => typeof item === "string") : [];

  return {
    ok: true,
    result: {
      checklist,
      extraction_confidence: estimateExtractionConfidence(input.component_need),
      _meta: buildMeta(data.timings, data.usage),
    },
  };
}

// Coverage can only land on one of 9 discrete values when exactly 8
// checklist items are extracted (0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5,
// 100%). The 40% verdict threshold sits between met=3 (37.5%) and met=4
// (50%); the 80% threshold sits between met=6 (75%) and met=7 (87.5%).
// Those are the only met-counts where a single item's judgment flipping
// is enough to change the verdict -- confirmed by direct testing
// (variance-check-results.json): image gallery and host-guest messaging
// both sat in this zone and flipped verdict across identical-input runs.
//
// no_candidates_found was included here too, on the theory that its
// run-to-run inconsistency (query-phrasing variance) was itself a
// reliability risk. Removed after testing showed it never actually
// caused a verdict flip in this session -- price breakdown hit this
// reason repeatedly and stayed "custom_build" every time, ensembled or
// not, since "no real candidates" and "candidates but low coverage"
// both point the same direction for that case. It was pure extra cost
// with no observed stability benefit; revisit if a future case shows
// otherwise.
export const BOUNDARY_RISK_MET_COUNTS_FOR_8_ITEMS = new Set([3, 4, 6, 7]);

export function isBoundaryRisk(result: JudgmentResult): boolean {
  if (result.reason !== "scored") return false;
  // The Jev design-system path has no 8-item checklist to be "malformed"
  // about, and a re-run would only re-call Jev.
  if (result.scorer === "jev") return false;

  const items = result.requirements_checked;
  if (!Array.isArray(items) || items.length === 0) return true; // malformed -- be conservative

  const total = items.length;
  if (total !== 8) return true; // extraction didn't follow the fixed-8 instruction -- the precomputed boundary table doesn't apply, so don't trust a single run

  const met = items.filter((item) => item.met === true).length;
  return BOUNDARY_RISK_MET_COUNTS_FOR_8_ITEMS.has(met);
}

// One JSON line per call that reached the API. Never throws -- a logging
// failure (disk full, permissions, read-only filesystem) must not break
// the tool call it's trying to log. component_need/domain/framework are
// written in plaintext here; requirements_checked evidence text and the
// API key never are.
function logCall(
  input: { component_need: string; domain: string; framework: string },
  result: JudgmentResult | { parseError: true }
): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      component_need: input.component_need,
      domain: input.domain,
      framework: input.framework,
    };
    if ("parseError" in result) {
      entry.error = "model output did not parse as JSON";
    } else {
      entry.verdict = result.verdict;
      entry.confidence = result.confidence;
      entry.reason = result.reason;
      entry.coverage = result.coverage ?? null;
      entry.ensemble_triggered = result.ensemble?.triggered ?? false;
      if (result.ensemble?.triggered) entry.ensemble_agreement = result.ensemble.agreement ?? null;
      entry.checklist_source = result.checklist_source ?? null;
      entry.total_ms = result._meta?.total_ms ?? null;
      entry.estimated_cost_usd = result._meta?.estimated_cost_usd ?? null;
    }
    appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    console.error(
      JSON.stringify({
        diagnostic: "local_log_write_failed",
        path: LOG_PATH,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
}

export interface DecisionEntry {
  component_need: string;
  domain?: string;
  action: "installed" | "custom_built";
  source: string;
  timestamp: string;
  // Self-reported by the calling agent, never computed by Pattern -- see
  // RECORD_DECISION_INPUT_SCHEMA's time_saved_minutes description.
  time_saved_minutes?: number;
}

type MemoryFile = Record<string, DecisionEntry[]>;

// Missing file, unreadable, or malformed content all collapse to "no
// memory yet" rather than throwing -- a fresh install or a hand-edited
// file that doesn't parse shouldn't break every recommend_component call
// that happens to pass a project_id.
function readMemory(): MemoryFile {
  try {
    const raw = readFileSync(MEMORY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as MemoryFile;
    }
    return {};
  } catch {
    return {};
  }
}

function writeMemory(memory: MemoryFile): void {
  mkdirSync(dirname(MEMORY_PATH), { recursive: true });
  writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2), "utf8");
}

// Only entry point that mutates memory.json -- called exclusively from
// record_component_decision, never from recommend_component. Appends and
// caps at MAX_DECISIONS_PER_PROJECT, dropping the oldest entries first, so
// the file stays bounded for a long-lived project without needing manual
// cleanup.
function recordDecision(input: {
  project_id: string;
  component_need: string;
  domain?: string;
  action: "installed" | "custom_built";
  source: string;
  timestamp?: string;
  time_saved_minutes?: number;
}): DecisionEntry {
  const entry: DecisionEntry = {
    component_need: input.component_need,
    domain: input.domain,
    action: input.action,
    source: input.source,
    timestamp: input.timestamp ?? new Date().toISOString(),
    // Finite-number guard only -- no range/sanity clamp, since a caller's
    // own estimate isn't Pattern's to second-guess. NaN/Infinity would
    // corrupt memory.json's JSON on write, so those alone are rejected.
    time_saved_minutes:
      typeof input.time_saved_minutes === "number" && Number.isFinite(input.time_saved_minutes)
        ? input.time_saved_minutes
        : undefined,
  };
  const memory = readMemory();
  const existing = memory[input.project_id] ?? [];
  memory[input.project_id] = [...existing, entry].slice(-MAX_DECISIONS_PER_PROJECT);
  writeMemory(memory);
  return entry;
}

// Read-only lookup used by recommend_component when project_id is
// provided. Never called with no project_id -- callers skip memory
// entirely in that case (see runSinglePass) rather than falling back to
// some shared bucket that would mix unrelated projects' decisions.
export function getPastDecisions(projectId: string): DecisionEntry[] {
  const memory = readMemory();
  return memory[projectId] ?? [];
}

// ---------------------------------------------------------------------
// Registered design systems (Solo Dev architecture)
//
// Lets a project point recommend_component at its own components instead
// of only shadcn/ui, 21st.dev, and ReUI -- register_design_system reads a
// local manifest or scans a local directory once, distills it into a flat
// candidate list, and stores it here. recommend_component then scores
// directly against that list (see runSinglePass's designSystem branch)
// instead of running a live web_search discovery step. Registration is
// local, per-project, and one-or-the-other: registering a design system
// replaces external-source scoring for that project_id entirely, it does
// not add to it (see the architecture doc's own scoping decision).
// ---------------------------------------------------------------------

export interface DesignSystemCandidate {
  name: string;
  props: string[];
  description: string | null;
  usage_example: string | null;
  // Relative to the scanned directory -- only ever set for source_kind
  // "directory_scan"; a manifest-sourced candidate has no single file of
  // its own to point at.
  file_path: string | null;
  // PascalCase names the file re-exports from another module
  // (`export { X } from "./x"`). Not candidates themselves -- X is scanned in
  // its own file -- but they advertise what this file's component
  // bundles/exposes (e.g. markdown.tsx re-exporting SyntaxHighlightedCode).
  // Omitted when there are none.
  reexports?: string[];
  // Optional natural-language capability summary (see the Jev design-system
  // path). Absent unless a registration was enriched with one.
  summary?: string | null;
  // Hash of the source file's content when `summary` was written, so a
  // re-registration reuses the summary only while the file is unchanged.
  summary_hash?: string;
  // Only for source_kind "figma": where the component lives in the file and
  // its variant structure. Untested on real Figma files -- see
  // design-system-figma.ts.
  figma?: FigmaCandidateInfo;
}

export interface DesignSystemRegistration {
  project_id: string;
  source_kind: "manifest" | "directory_scan" | "figma";
  // The path as passed to register_design_system, relative to
  // PROJECT_ROOT -- never the resolved absolute path (see
  // resolveWithinRoot), so this stays portable across machines.
  source_path: string;
  registered_at: string;
  candidate_count: number;
  candidates: DesignSystemCandidate[];
}

type DesignSystemsFile = Record<string, DesignSystemRegistration>;

// Same "malformed/missing collapses to empty, never throws" policy as
// readMemory -- a fresh install or a hand-edited file that doesn't parse
// shouldn't break recommend_component for every project, it should just
// behave as if nothing is registered.
function readDesignSystems(): DesignSystemsFile {
  try {
    const raw = readFileSync(DESIGN_SYSTEMS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as DesignSystemsFile;
    }
    return {};
  } catch {
    return {};
  }
}

function writeDesignSystems(file: DesignSystemsFile): void {
  mkdirSync(dirname(DESIGN_SYSTEMS_PATH), { recursive: true });
  writeFileSync(DESIGN_SYSTEMS_PATH, JSON.stringify(file, null, 2), "utf8");
}

// Read-only lookup used by runSinglePass. No project_id -> no lookup,
// same "never fall back to a shared/global bucket" rule as
// getPastDecisions above.
export function getRegisteredDesignSystem(projectId: string): DesignSystemRegistration | null {
  return readDesignSystems()[projectId] ?? null;
}

// Extracts the substring between the first "{" at or after fromIndex and
// its matching "}", tracking brace depth so a nested object type inside a
// props interface doesn't truncate the capture early -- a plain non-greedy
// regex on "{...}" breaks on exactly that shape (e.g. `style?: { color:
// string }`).
function extractBalancedBraceBody(text: string, fromIndex: number): string | null {
  const openIdx = text.indexOf("{", fromIndex);
  if (openIdx === -1) return null;
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return null;
}

// Heuristic, not a parser -- matches "name:" / "name?:" field declarations
// at the start of a line or after a separator. Good enough for the flat,
// single-level prop interfaces real components typically declare; a
// deliberately best-effort choice over pulling in a full TypeScript AST
// parser for this (see BACKLOG.md's manifest-quality risk -- sparse or
// imperfect extraction here is expected, not a bug).
function extractPropNamesFromBody(body: string): string[] {
  const names = new Set<string>();
  const re = /(?:^|[;,{(\n])\s*([A-Za-z_$][A-Za-z0-9_$]*)\??\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    names.add(m[1]);
  }
  return [...names];
}

// Best-effort extraction of a destructured function-parameter's field
// names, e.g. `({ title, onClose, variant = "default" })` -> ["title",
// "onClose", "variant"]. Only used as a last-resort fallback when neither
// a `<Name>Props` interface/type nor a `.propTypes` block was found.
function extractDestructuredParamNames(defWindow: string): string[] {
  const match = defWindow.match(/\(\s*\{([^}]*)\}/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((p) => p.trim().split(/[:=]/)[0].trim())
    .filter((p) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p));
}

const DESIGN_SYSTEM_SCAN_EXCLUDED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  ".turbo",
  "coverage",
]);
const DESIGN_SYSTEM_SCAN_EXTENSIONS = new Set([".jsx", ".tsx", ".js", ".ts"]);
// .d.ts (type declarations, not components) and test/story files (not the
// component's own definition, and .stories.* would otherwise double-count
// alongside the real component file) are excluded by filename fragment.
const DESIGN_SYSTEM_SCAN_EXCLUDED_NAME_FRAGMENTS = [".test.", ".spec.", ".stories.", ".d.ts"];

function walkComponentFiles(root: string): string[] {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!DESIGN_SYSTEM_SCAN_EXCLUDED_DIRS.has(entry.name)) stack.push(join(dir, entry.name));
        continue;
      }
      if (!DESIGN_SYSTEM_SCAN_EXTENSIONS.has(extname(entry.name))) continue;
      if (DESIGN_SYSTEM_SCAN_EXCLUDED_NAME_FRAGMENTS.some((frag) => entry.name.includes(frag))) continue;
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

// Names from `export { A, B as C }` lists -- the shape shadcn-style
// libraries use (`export { Button, buttonVariants }`), which the
// `export function/const` regexes below never see. Re-exports from another
// module (`export { X } from "./x"`) are skipped: the definition lives
// elsewhere and gets scanned there. PascalCase only, so `buttonVariants`
// and SCREAMING_CASE constants are not mistaken for components.
function extractExportListNames(content: string): string[] {
  const names: string[] = [];
  const re = /export\s*\{([^}]*)\}(?!\s*from)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    for (const part of m[1].split(",")) {
      const spec = part.trim();
      if (!spec || /^type\s/.test(spec)) continue;
      const exported = spec.split(/\s+as\s+/).pop()!.trim();
      if (/^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(exported)) names.push(exported);
    }
  }
  return names;
}

// Names from `export { A, B as C } from "./mod"` -- the complement of
// extractExportListNames, which skips these.
function extractReexportNames(content: string): string[] {
  const names = new Set<string>();
  const re = /export\s*\{([^}]*)\}\s*from\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    for (const part of m[1].split(",")) {
      const spec = part.trim();
      if (!spec || /^type\s/.test(spec)) continue;
      const exported = spec.split(/\s+as\s+/).pop()!.trim();
      if (/^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(exported)) names.add(exported);
    }
  }
  return [...names];
}

// Every `<X>Props` interface/type body in the file, flattened and capped.
// Fallback for names with no `<Name>Props` of their own (e.g. a
// forwardRef sub-component sharing its file's props type).
function extractFileWidePropNames(content: string): string[] {
  const props = new Set<string>();
  const re = /(?:interface|type)\s+[A-Za-z0-9_]*Props\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const body = extractBalancedBraceBody(content, m.index);
    if (body) extractPropNamesFromBody(body).forEach((p) => props.add(p));
  }
  return [...props].slice(0, 25);
}

// The /** ... */ block sitting directly above a component's own definition
// (only whitespace between them), whitespace-normalised and capped -- free
// descriptive text for the scorer. Deliberately NOT "the file's first doc
// comment": that can describe an unrelated inner helper (a real
// markdown.tsx opens with a comment about an image-zoom embed) and mislead
// the scorer worse than no description at all. Null when the component has
// no comment of its own.
function extractDocCommentBefore(content: string, index: number): string | null {
  const before = content.slice(0, index).trimEnd();
  if (!before.endsWith("*/")) return null;
  const open = before.lastIndexOf("/**");
  if (open === -1 || before.slice(open, -2).includes("*/")) return null;
  const text = before.slice(open + 3, -2).replace(/^\s*\*\s?/gm, "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 300) : null;
}

// Component detection: an uppercase-leading exported function or const,
// React's own naming convention for components -- deliberately excludes
// lowercase exported helpers/hooks, which aren't components. Props are
// resolved in priority order: a `<Name>Props` interface/type (most
// reliable, TypeScript projects), then a `.propTypes` block (plain JS
// with PropTypes), then a best-effort destructure of the function's own
// parameter list. An empty result from all three is a real, expected
// outcome for an untyped, undestructured component -- not an error.
function scanComponentFile(absPath: string, relPath: string): DesignSystemCandidate[] {
  let content: string;
  try {
    content = readFileSync(absPath, "utf8");
  } catch {
    return [];
  }

  const names = new Map<string, number | null>();
  const fnRe = /export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*(?:<[^>(]*>\s*)?\(/g;
  const constRe = /export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*(?::[^=\n]+)?=/g;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(content)) !== null) names.set(m[1], m.index);
  while ((m = constRe.exec(content)) !== null) if (!names.has(m[1])) names.set(m[1], m.index);
  for (const n of extractExportListNames(content)) if (!names.has(n)) names.set(n, null);

  const fileWideProps = extractFileWidePropNames(content);
  const reexports = extractReexportNames(content);
  const candidates: DesignSystemCandidate[] = [];
  for (const [name, idx] of names) {
    let props: string[] = [];

    const interfaceMatch = content.match(new RegExp(`(?:interface|type)\\s+${name}Props\\b`));
    if (interfaceMatch?.index !== undefined) {
      const body = extractBalancedBraceBody(content, interfaceMatch.index);
      if (body) props = extractPropNamesFromBody(body);
    }

    if (props.length === 0) {
      const propTypesMatch = content.match(new RegExp(`${name}\\.propTypes\\s*=`));
      if (propTypesMatch?.index !== undefined) {
        const body = extractBalancedBraceBody(content, propTypesMatch.index);
        if (body) props = extractPropNamesFromBody(body);
      }
    }

    if (props.length === 0 && idx !== null) {
      props = extractDestructuredParamNames(content.slice(idx, Math.min(content.length, idx + 500)));
    }

    if (props.length === 0) props = fileWideProps;

    // Export-list names have no definition index yet -- find where the
    // component is actually declared so its own comment can be read.
    let declIdx = idx;
    if (declIdx === null) {
      const decl = new RegExp(`(?:^|\\n)[ \\t]*(?:const|let|function|class)\\s+${name}\\b`).exec(content);
      declIdx = decl ? decl.index : null;
    }
    const description = declIdx === null ? null : extractDocCommentBefore(content, declIdx);

    candidates.push({
      name,
      props,
      description,
      usage_example: null,
      file_path: relPath,
      ...(reexports.length > 0 ? { reexports } : {}),
    });
  }
  return candidates;
}

function scanDirectoryForDesignSystem(absRoot: string): DesignSystemCandidate[] {
  const candidates: DesignSystemCandidate[] = [];
  for (const abs of walkComponentFiles(absRoot)) {
    candidates.push(...scanComponentFile(abs, relative(absRoot, abs)));
  }
  return candidates;
}

// Parses a manifest file's raw text into a flat candidate list. Two
// recognized shapes, matching the architecture doc's launch scope:
//  - Hand-authored: a top-level array of {name, props?, description?,
//    usage_example?} objects, optionally wrapped in {"components": [...]}.
//  - Storybook-exported index (stories.json v3, or index.json v4+): both
//    key stories/entries by id, each carrying a "title" like
//    "Components/Button" that groups stories under a component name.
//    Props aren't part of this export (only Storybook's heavier docgen
//    addon captures those), so candidates from this path start with an
//    empty props list -- expected, not a bug, per the same manifest-
//    quality risk noted on the directory-scan path above.
// Throws with a clear, specific message on anything else, per the
// architecture doc's own risk mitigation: "fail loud on malformed input
// rather than scoring against garbage."
function parseManifestCandidates(raw: string, sourcePath: string): DesignSystemCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Manifest at "${sourcePath}" is not valid JSON.`);
  }

  const handAuthoredArray = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).components)
      ? ((parsed as Record<string, unknown>).components as unknown[])
      : null;

  if (handAuthoredArray) {
    return handAuthoredArray.map((item, i) => {
      if (!item || typeof item !== "object" || typeof (item as Record<string, unknown>).name !== "string" || !(item as Record<string, unknown>).name) {
        throw new Error(
          `Manifest entry at index ${i} in "${sourcePath}" is missing a required "name" string.`
        );
      }
      const record = item as Record<string, unknown>;
      return {
        name: record.name as string,
        props: Array.isArray(record.props) ? record.props.filter((p): p is string => typeof p === "string") : [],
        description: typeof record.description === "string" ? record.description : null,
        usage_example: typeof record.usage_example === "string" ? record.usage_example : null,
        file_path: null,
      };
    });
  }

  const storybookEntries =
    parsed && typeof parsed === "object"
      ? ((parsed as Record<string, unknown>).entries ?? (parsed as Record<string, unknown>).stories ?? null)
      : null;
  if (storybookEntries && typeof storybookEntries === "object") {
    const names = new Set<string>();
    for (const entry of Object.values(storybookEntries as Record<string, unknown>)) {
      const title = entry && typeof entry === "object" ? (entry as Record<string, unknown>).title : null;
      if (typeof title !== "string") continue;
      const name = title.split("/").pop()?.trim();
      if (name) names.add(name);
    }
    if (names.size === 0) {
      throw new Error(
        `Manifest at "${sourcePath}" looked like a Storybook export (found "entries"/"stories") but no component titles could be extracted from it.`
      );
    }
    return [...names].map((name) => ({ name, props: [], description: null, usage_example: null, file_path: null }));
  }

  throw new Error(
    `Manifest at "${sourcePath}" doesn't match a recognized shape. Expected either a hand-authored array of ` +
      `{name, props, description, usage_example} objects (optionally wrapped in {"components": [...]}), or a ` +
      `Storybook-exported stories/index JSON file (an object with a top-level "entries" or "stories" map).`
  );
}

// Source text of a scanned candidate file, or null if unreadable. `rel` is
// always a scanner-produced path relative to the scanned directory.
function readCandidateSource(scanRoot: string, rel: string): string | null {
  try {
    return readFileSync(join(scanRoot, rel), "utf8");
  } catch {
    return null;
  }
}

// Opt-in (`summarize: true`): fill in a short Haiku-written capability
// summary for every scanned file still missing a valid one, then persist.
// Sends up to 8000 chars of each such source file to Anthropic.
async function summarizeRegistration(
  registration: DesignSystemRegistration
): Promise<SummarizeStats & { estimated_cost_usd: number; model: string }> {
  const scanRoot = resolveWithinRoot(PROJECT_ROOT, registration.source_path);
  if (!scanRoot) throw new Error(`source_path "${registration.source_path}" is outside the project root.`);
  const reused = new Set(registration.candidates.filter((c) => c.summary && c.file_path).map((c) => c.file_path)).size;
  const stats = await summarizeCandidates(
    registration.candidates,
    (rel) => readCandidateSource(scanRoot, rel),
    makeAnthropicSummaryCall(ANTHROPIC_API_KEY!, ANTHROPIC_WORKSPACE_ID || undefined),
    reused
  );
  const file = readDesignSystems();
  file[registration.project_id] = registration;
  writeDesignSystems(file);
  return {
    ...stats,
    model: SUMMARY_MODEL,
    estimated_cost_usd: estimateCostUsd(stats.tokens, SUMMARY_MODEL),
  };
}

// Core of the register_design_system tool. Exactly one of manifest_path
// or directory_path, both resolved via resolveWithinRoot -- same
// PROJECT_ROOT-scoped, relative-path-only boundary check_ledger_liveness
// already established for file_path, reused rather than inventing a
// second filesystem-access convention. Overwrites any prior registration
// for this project_id wholesale (one-or-the-other per project, not
// additive/merged across repeat calls).
export function registerDesignSystem(input: {
  project_id: string;
  manifest_path?: string;
  directory_path?: string;
  figma_json_path?: string;
  figma_mode?: "components" | "frames";
  figma_pages?: string[];
  figma_exclude_pages?: string[];
  // Internal: an already-fetched Figma file (the handler's figma_file_key
  // path), with the label to store as source_path.
  figma_file?: unknown;
  figma_source_label?: string;
}): DesignSystemRegistration {
  const provided = [input.manifest_path, input.directory_path, input.figma_json_path, input.figma_file].filter(
    (v) => v !== undefined && v !== ""
  );
  if (provided.length !== 1) {
    throw new Error(
      "register_design_system requires exactly one of manifest_path, directory_path, figma_json_path or figma_file_key (paths relative to the project root)."
    );
  }

  let sourceKind: "manifest" | "directory_scan" | "figma";
  let sourcePath: string;
  let candidates: DesignSystemCandidate[];

  if (input.figma_json_path || input.figma_file !== undefined) {
    sourceKind = "figma";
    let raw: unknown = input.figma_file;
    if (input.figma_json_path) {
      sourcePath = input.figma_json_path;
      const abs = resolveWithinRoot(PROJECT_ROOT, input.figma_json_path);
      if (!abs) {
        throw new Error(
          `figma_json_path "${input.figma_json_path}" must be a relative path within the project root (${PROJECT_ROOT}) -- it was either absolute or escaped the project root.`
        );
      }
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        throw new Error(`No file found at "${input.figma_json_path}" (resolved to ${abs}).`);
      }
      try {
        raw = JSON.parse(readFileSync(abs, "utf8"));
      } catch {
        throw new Error(`Figma file at "${input.figma_json_path}" is not valid JSON.`);
      }
    } else {
      sourcePath = input.figma_source_label ?? "figma";
    }
    const parsed = parseFigmaFile(raw, sourcePath, { mode: input.figma_mode, pages: input.figma_pages, excludePages: input.figma_exclude_pages });
    candidates = parsed.candidates;
    // A real design system can define tens of thousands of components (one
    // 135 MB file had 14,135 standalone ones -- icons -- against 95 real UI
    // components). Scoring that many is slow, costly and noisy, so refuse and
    // say where they are rather than silently truncating.
    if (candidates.length > FIGMA_MAX_CANDIDATES) {
      const byPage = new Map<string, number>();
      for (const c of candidates) byPage.set(c.figma?.page ?? "(no page)", (byPage.get(c.figma?.page ?? "(no page)") ?? 0) + 1);
      const top = [...byPage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, n]) => `"${p}" (${n})`).join(", ");
      throw new Error(
        `"${sourcePath}" produced ${candidates.length} candidates, over the ${FIGMA_MAX_CANDIDATES} limit (PATTERN_FIGMA_MAX_CANDIDATES). ` +
          `Biggest pages: ${top}. Icon libraries are the usual cause -- pass figma_exclude_pages (e.g. ["Icons"]) or figma_pages to keep only the pages you want scored.`
      );
    }
    // Reuse still-valid vision captions from the previous registration (same
    // design, same contents). Free.
    carryOverCaptions(candidates, readDesignSystems()[input.project_id]?.candidates);
    if (candidates.length === 0) {
      throw new Error(
        input.figma_mode === "frames"
          ? `No designs were found in "${sourcePath}" in frames mode (looked for named frames/groups with at least 5 layers${input.figma_pages?.length ? ` on pages matching ${JSON.stringify(input.figma_pages)}` : ""}). Check figma_pages / figma_exclude_pages.`
          : `No components were found in "${sourcePath}" (${parsed.stats.pages} pages, 0 defined components or component sets; ${parsed.stats.skipped_private} hidden ones skipped). ` +
            `Many Figma files -- community templates especially -- draw their designs as plain frames rather than components; pass figma_mode: "frames" to register those instead.`
      );
    }
  } else if (input.manifest_path) {
    sourceKind = "manifest";
    sourcePath = input.manifest_path;
    const abs = resolveWithinRoot(PROJECT_ROOT, input.manifest_path);
    if (!abs) {
      throw new Error(
        `manifest_path "${input.manifest_path}" must be a relative path within the project root (${PROJECT_ROOT}) -- it was either absolute or escaped the project root.`
      );
    }
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      throw new Error(`No file found at "${input.manifest_path}" (resolved to ${abs}).`);
    }
    candidates = parseManifestCandidates(readFileSync(abs, "utf8"), input.manifest_path);
  } else {
    sourceKind = "directory_scan";
    sourcePath = input.directory_path as string;
    const abs = resolveWithinRoot(PROJECT_ROOT, sourcePath);
    if (!abs) {
      throw new Error(
        `directory_path "${sourcePath}" must be a relative path within the project root (${PROJECT_ROOT}) -- it was either absolute or escaped the project root.`
      );
    }
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      throw new Error(`No directory found at "${sourcePath}" (resolved to ${abs}).`);
    }
    candidates = scanDirectoryForDesignSystem(abs);
  }

  // Reuse still-valid capability summaries from the previous registration
  // (same file, unchanged content). Free -- local hashing only.
  if (sourceKind === "directory_scan") {
    const scanRoot = resolveWithinRoot(PROJECT_ROOT, sourcePath);
    if (scanRoot) {
      carryOverSummaries(candidates, readDesignSystems()[input.project_id]?.candidates, (rel) => readCandidateSource(scanRoot, rel));
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      `No components could be found at "${sourcePath}" (${sourceKind}). Check the manifest shape, or that the directory actually contains component files recognized by the scan (export default function/const, uppercase-leading name).`
    );
  }

  const registration: DesignSystemRegistration = {
    project_id: input.project_id,
    source_kind: sourceKind,
    source_path: sourcePath,
    registered_at: new Date().toISOString(),
    candidate_count: candidates.length,
    candidates,
  };

  const file = readDesignSystems();
  file[input.project_id] = registration;
  writeDesignSystems(file);
  return registration;
}

// ---------------------------------------------------------------------
// Design-system recall check
//
// Catches a real, specific failure mode raised after this feature shipped:
// the model can say "no_candidates_found" against a registered design
// system even when a genuinely relevant candidate is sitting right there
// in the prompt it was just given -- a reading-comprehension miss over
// its own known-complete candidate list, not a live-search gap (compare
// external-library mode, where "nothing found" is at least grounded in a
// real search actually coming back empty). Unlike the ensemble
// (isBoundaryRisk), which only re-checks coverage-boundary "scored"
// results, nothing previously re-checked a "no_candidates_found" verdict
// at all -- it was trusted on the first pass. This doesn't fix that by
// spending another API call; it's a cheap, deterministic, zero-cost local
// keyword-overlap check between component_need/domain and every
// registered candidate's own name/props/description, run only when
// reason is "no_candidates_found" in design-system mode. A hit doesn't
// override the verdict -- a shared keyword is weak evidence, not proof of
// a real match -- it only surfaces the risk on the response so the
// calling agent knows to double-check before trusting a "nothing here"
// answer, same "show the uncertainty, don't paper over it" policy as
// ensemble/oversized_match elsewhere in this file.
// ---------------------------------------------------------------------

// Deliberately generic English filler, not UI-specific -- a UI-specific
// word like "banner" or "list" is exactly the kind of overlap this check
// exists to catch, so only true stopwords are excluded here.
const KEYWORD_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "with", "in", "on", "at",
  "by", "from", "is", "are", "was", "were", "be", "been", "being", "that",
  "this", "these", "those", "it", "its", "as", "not", "no", "if", "when",
  "which", "what", "who", "how", "into", "over", "out", "up", "down", "new",
  "real", "component", "components", "need", "needs", "show", "showing",
  "shows", "display", "displays", "displaying", "user", "users", "each",
  "other", "also", "app", "style", "product",
]);

// Splits on non-alphanumeric boundaries AND camelCase/PascalCase boundaries
// (so "bonusAmount" -> "bonus", "amount" and "ReferralBanner" -> "referral",
// "banner"), lowercases, then drops stopwords and anything under 3
// characters -- short tokens ("id", "on") are too generic to be a
// meaningful signal either way.
function extractKeywords(text: string): Set<string> {
  const words = text
    .split(/[^A-Za-z0-9]+/)
    .flatMap((w) => w.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/\s+/))
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 3 && !KEYWORD_STOPWORDS.has(w));
  return new Set(words);
}

function candidateKeywords(c: DesignSystemCandidate): Set<string> {
  return extractKeywords([c.name, ...c.props, c.description ?? "", c.usage_example ?? ""].join(" "));
}

// Returns every registered candidate sharing at least one real keyword
// with component_need/domain, ranked by how many keywords it shares --
// capped at 5 so a large design system can't produce an unreadable dump
// on a genuinely generic need.
export function findKeywordOverlapCandidates(
  componentNeed: string,
  domain: string,
  candidates: DesignSystemCandidate[]
): Array<{ name: string; shared_keywords: string[] }> {
  const needKeywords = extractKeywords(`${componentNeed} ${domain}`);
  if (needKeywords.size === 0) return [];
  const matches = candidates
    .map((c) => ({ name: c.name, shared_keywords: [...candidateKeywords(c)].filter((k) => needKeywords.has(k)) }))
    .filter((m) => m.shared_keywords.length > 0);
  matches.sort((a, b) => b.shared_keywords.length - a.shared_keywords.length);
  return matches.slice(0, 5);
}

// One line per judgment call that reached the API with a project_id and
// landed on reason "scored" or "no_candidates_found" (see appendLedgerEntry
// call sites in judgeComponent) -- plus, since the cost-attribution build
// plan (pattern-cost-attribution-build-plan.md), one line per ledger cache
// hit too, so cost/count rolls up correctly even for the $0 served-from-
// ledger calls (cache_hit: true, reason "ledger_cache_hit"; these are
// automatically excluded from findLedgerCacheHit's own eligibility check,
// so they can never themselves become the source of a future cache hit).
// candidates_evaluated/chosen_candidate hold only DistilledCandidate-shaped
// data -- never raw evidence text, per the data-minimization boundary
// above. project_conventions_snapshot is a hash of existing_stack (see
// hashConventions), null when existing_stack wasn't provided either time
// -- two null snapshots still count as a match. feature_id groups every
// entry (and, separately, report_build_cost's BuildRecord entries) that
// belong to the same feature, so end-to-end cost is queryable per feature,
// not just per project_id/call -- see deriveFeatureId.
export interface LedgerEntry {
  id: string;
  timestamp: string;
  project_id: string;
  feature_id: string;
  component_need: string;
  domain: string;
  framework: string;
  checklist: string[];
  checklist_source: "extracted" | "provided";
  candidates_evaluated: DistilledCandidate[];
  verdict: string;
  chosen_candidate: string | null;
  confidence: string;
  reason: string;
  coverage: string | null;
  cost_usd: number;
  cache_hit: boolean;
  project_conventions_snapshot: string | null;
  // Ledger integrity + decision provenance fields (see PROJECT_ROOT above).
  // file_path/snapshot_ref are set once at write time and never change;
  // last_verified_live/live_status are the write-time defaults ("not yet
  // checked") -- readLedgerEntries overlays the latest real check from
  // ledger_liveness.jsonl on top of these at read time (see
  // withLatestLiveness), so the persisted line itself is never mutated.
  file_path: string | null;
  snapshot_ref: string | null;
  last_verified_live: string | null;
  live_status: "live" | "orphaned" | "dangling" | "unknown";
  // Feature 2 P3: best-effort reconstruction for an entry whose real
  // snapshot_ref is null (written before that field existed, or written
  // outside a git repo). Never set at write time -- always null on a
  // freshly built entry -- and only ever populated at read time from
  // snapshot_backfill.jsonl (see backfillLedgerSnapshotRefs), the same
  // "separate overlay, never mutate the source line" convention as
  // live_status. Deliberately never conflated with snapshot_ref itself:
  // a reconstructed value carries a materially weaker guarantee (an
  // approximation of what HEAD probably was at that timestamp, not the
  // commit actually captured live) and must stay visibly distinguishable
  // from a real one wherever it's rendered (see formatProvenanceArtifact).
  reconstructed_snapshot_ref: string | null;
}

function hashConventions(existingStack?: string): string | null {
  if (!existingStack) return null;
  return createHash("sha256").update(existingStack).digest("hex").slice(0, 16);
}

// Stable id for rolling up cost across recommend_component (verdict) and
// report_build_cost (build) records for the "same" feature. A
// caller-supplied id always wins (their own tracking -- a ticket id,
// branch name, whatever is stable on their side); otherwise derive
// deterministically from project_id+component_need so repeat calls for the
// same feature land under the same key across sessions with no
// coordination required between recommend_component and report_build_cost.
function deriveFeatureId(componentNeed: string, projectId: string, provided?: string): string {
  if (provided && provided.trim()) return provided.trim();
  return createHash("sha256")
    .update(`${projectId}::${componentNeed.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 8);
}

// Overlay store for live-check results, same "append-only, latest-value-
// per-key wins at read time, never mutate the source-of-truth line"
// convention as outcome_proxies.jsonl/latestOutcomeProxy above -- a check
// is a new observation, not a correction of the original ledger entry, so
// ledger.jsonl itself stays untouched by it.
const LEDGER_LIVENESS_PATH =
  process.env.PATTERN_LEDGER_LIVENESS_PATH ?? join(homedir(), ".pattern", "ledger_liveness.jsonl");

export interface LedgerLivenessRecord {
  id: string;
  timestamp: string;
  ledger_entry_id: string;
  project_id: string;
  live_status: "live" | "orphaned" | "dangling" | "unknown";
  checked_file_path: string | null;
}

function appendLedgerLivenessRecord(record: LedgerLivenessRecord): void {
  mkdirSync(dirname(LEDGER_LIVENESS_PATH), { recursive: true });
  appendFileSync(LEDGER_LIVENESS_PATH, JSON.stringify(record) + "\n", "utf8");
}

function readLedgerLivenessRecords(ledgerEntryId: string): LedgerLivenessRecord[] {
  let raw: string;
  try {
    raw = readFileSync(LEDGER_LIVENESS_PATH, "utf8");
  } catch {
    return [];
  }
  const records: LedgerLivenessRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && parsed.ledger_entry_id === ledgerEntryId) {
        records.push(parsed as LedgerLivenessRecord);
      }
    } catch {
      // skip malformed line
    }
  }
  return records;
}

// Deliberately not a sort-then-take-first: readLedgerLivenessRecords
// returns records in file/append order (oldest first), and a descending
// sort by timestamp is NOT tie-safe -- JS's stable sort preserves the
// original relative order among equal timestamps, so on a tie (two
// records appended within the same millisecond, which sweepLedgerLiveness
// does routinely -- a per-entry check followed immediately by a
// dangling-cluster append for the same entry) it would silently return
// the OLDER of the two. reduce with >= walks forward through true append
// order and lets each later-appended tied record win, which is what
// "latest" actually means here.
function latestLiveness(ledgerEntryId: string): LedgerLivenessRecord | null {
  const records = readLedgerLivenessRecords(ledgerEntryId);
  if (records.length === 0) return null;
  return records.reduce((latest, r) => (new Date(r.timestamp).getTime() >= new Date(latest.timestamp).getTime() ? r : latest));
}

function withLatestLiveness(entry: LedgerEntry): LedgerEntry {
  const latest = latestLiveness(entry.id);
  if (!latest) return entry;
  return { ...entry, live_status: latest.live_status, last_verified_live: latest.timestamp };
}

// Feature 2 P3's overlay -- same append-only/latest-wins convention as
// ledger_liveness.jsonl above, kept as a fully separate file/function pair
// rather than folded into the liveness overlay: these two overlays answer
// unrelated questions (is the file still there vs. what commit was this
// judged against) and happen to share only their storage shape, not their
// meaning.
const SNAPSHOT_BACKFILL_PATH =
  process.env.PATTERN_SNAPSHOT_BACKFILL_PATH ?? join(homedir(), ".pattern", "snapshot_backfill.jsonl");

export interface SnapshotBackfillRecord {
  id: string;
  timestamp: string;
  ledger_entry_id: string;
  project_id: string;
  reconstructed_snapshot_ref: string | null;
}

function appendSnapshotBackfillRecord(record: SnapshotBackfillRecord): void {
  mkdirSync(dirname(SNAPSHOT_BACKFILL_PATH), { recursive: true });
  appendFileSync(SNAPSHOT_BACKFILL_PATH, JSON.stringify(record) + "\n", "utf8");
}

function readSnapshotBackfillRecords(ledgerEntryId: string): SnapshotBackfillRecord[] {
  let raw: string;
  try {
    raw = readFileSync(SNAPSHOT_BACKFILL_PATH, "utf8");
  } catch {
    return [];
  }
  const records: SnapshotBackfillRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && parsed.ledger_entry_id === ledgerEntryId) {
        records.push(parsed as SnapshotBackfillRecord);
      }
    } catch {
      // skip malformed line
    }
  }
  return records;
}

// Same tie-safety reasoning as latestLiveness above.
function latestSnapshotBackfill(ledgerEntryId: string): SnapshotBackfillRecord | null {
  const records = readSnapshotBackfillRecords(ledgerEntryId);
  if (records.length === 0) return null;
  return records.reduce((latest, r) => (new Date(r.timestamp).getTime() >= new Date(latest.timestamp).getTime() ? r : latest));
}

// Only overlays onto entries that actually need it -- an entry with a
// real snapshot_ref never consults the backfill overlay at all, so a
// stray/stale backfill record can never shadow a genuine captured value.
function withReconstructedSnapshotRef(entry: LedgerEntry): LedgerEntry {
  if (entry.snapshot_ref) return entry;
  const latest = latestSnapshotBackfill(entry.id);
  if (!latest) return entry;
  return { ...entry, reconstructed_snapshot_ref: latest.reconstructed_snapshot_ref };
}

// Feature 1 / Referential Integrity, P1: the single-entry live-check.
// Orphaned when file_path is set but the file no longer exists; live when
// the file exists and (best-effort) still mentions chosen_candidate;
// unknown when file_path was never supplied, escapes PROJECT_ROOT (see
// resolveWithinRoot), or exists but the candidate name can't be confirmed
// in its content -- conservative on purpose, per the spec's own risk
// mitigation (a false "orphaned" is worse than a lingering "unknown").
// "dangling" (a cluster of entries with no live anchor anywhere among
// them) is graph-level analysis across a whole project's entries, not a
// single-entry check -- see detectDanglingClusters, part of
// sweep_ledger_liveness (Feature 1 P2/P3), not this function.
function checkFileLiveStatus(entry: LedgerEntry): "live" | "orphaned" | "unknown" {
  if (!entry.file_path) return "unknown";
  const abs = resolveWithinRoot(PROJECT_ROOT, entry.file_path);
  if (!abs) return "unknown";
  if (!existsSync(abs)) return "orphaned";
  if (!entry.chosen_candidate) return "live";
  try {
    const content = readFileSync(abs, "utf8");
    return content.toLowerCase().includes(entry.chosen_candidate.toLowerCase()) ? "live" : "unknown";
  } catch {
    return "unknown";
  }
}

function checkLedgerEntryLiveness(entry: LedgerEntry): LedgerLivenessRecord {
  const record: LedgerLivenessRecord = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ledger_entry_id: entry.id,
    project_id: entry.project_id,
    live_status: checkFileLiveStatus(entry),
    checked_file_path: entry.file_path,
  };
  appendLedgerLivenessRecord(record);
  return record;
}

// check_ledger_liveness tool: on-demand invocation of the live-check above
// (the design's "on demand via an MCP call" case -- see
// sweepLedgerLiveness below for the scheduled/batch case, Feature 1 P2).
// Entries with no file_path are reported but never checked/recorded --
// their status is permanently "unknown" by construction, so re-checking
// them on every call would only grow ledger_liveness.jsonl without ever
// learning anything new.
function checkLedgerLiveness(input: { project_id: string; ledger_entry_id?: string }): {
  checked: number;
  total_entries: number;
  results: Array<{
    ledger_entry_id: string;
    component_need: string;
    file_path: string | null;
    live_status: LedgerLivenessRecord["live_status"];
    checked_at: string | null;
    note: string | null;
  }>;
} {
  const entries = readLedgerEntries(input.project_id).filter(
    (e) => !input.ledger_entry_id || e.id === input.ledger_entry_id
  );
  const results = entries.map((e) => {
    if (!e.file_path) {
      return {
        ledger_entry_id: e.id,
        component_need: e.component_need,
        file_path: null,
        live_status: "unknown" as const,
        checked_at: null,
        note: "no file_path recorded on this entry -- nothing to check",
      };
    }
    const record = checkLedgerEntryLiveness(e);
    return {
      ledger_entry_id: e.id,
      component_need: e.component_need,
      file_path: e.file_path,
      live_status: record.live_status,
      checked_at: record.timestamp,
      note: null,
    };
  });
  return {
    checked: results.filter((r) => r.checked_at !== null).length,
    total_entries: results.length,
    results,
  };
}

// backfill_ledger_snapshot_ref tool (Feature 2 P3): attempts
// reconstructSnapshotRef for every entry in a project that's missing a
// real snapshot_ref, and persists each attempt to snapshot_backfill.jsonl
// regardless of outcome -- a documented "we tried, here's what we found"
// audit trail, not just a cache, since a failed reconstruction is itself
// meaningful information (this project's git history doesn't reach back
// that far, or PROJECT_ROOT isn't a git repo at all). Entries that
// already have a real snapshot_ref are reported but never touched --
// backfill only ever fills a gap, never second-guesses a captured value.
function backfillLedgerSnapshotRefs(input: { project_id: string; ledger_entry_id?: string }): {
  attempted: number;
  reconstructed: number;
  results: Array<{
    ledger_entry_id: string;
    already_had_snapshot_ref: boolean;
    reconstructed_snapshot_ref: string | null;
  }>;
} {
  const entries = readLedgerEntries(input.project_id).filter(
    (e) => !input.ledger_entry_id || e.id === input.ledger_entry_id
  );
  const results = entries.map((e) => {
    if (e.snapshot_ref) {
      return { ledger_entry_id: e.id, already_had_snapshot_ref: true, reconstructed_snapshot_ref: null };
    }
    const reconstructed = reconstructSnapshotRef(PROJECT_ROOT, e.timestamp);
    appendSnapshotBackfillRecord({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ledger_entry_id: e.id,
      project_id: e.project_id,
      reconstructed_snapshot_ref: reconstructed,
    });
    return { ledger_entry_id: e.id, already_had_snapshot_ref: false, reconstructed_snapshot_ref: reconstructed };
  });
  return {
    attempted: results.filter((r) => !r.already_had_snapshot_ref).length,
    reconstructed: results.filter((r) => r.reconstructed_snapshot_ref !== null).length,
    results,
  };
}

// Same "missing/malformed collapses to empty" philosophy as readMemory,
// but line-oriented (JSONL) rather than whole-file JSON -- a single
// corrupted line (e.g. a hand-edited file, or a write that got cut off)
// is skipped rather than failing the whole read.
export function readLedgerEntries(projectId: string): LedgerEntry[] {
  let raw: string;
  try {
    raw = readFileSync(LEDGER_PATH, "utf8");
  } catch {
    return [];
  }
  const entries: LedgerEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && parsed.project_id === projectId) {
        // Backward-compatible defaults for entries written before the
        // ledger integrity/provenance fields existed -- a missing key
        // (not merely a null one) falls back to these rather than
        // `undefined` leaking into the returned shape.
        const rawEntry = parsed as Partial<LedgerEntry>;
        const normalized: LedgerEntry = {
          ...(rawEntry as LedgerEntry),
          file_path: rawEntry.file_path ?? null,
          snapshot_ref: rawEntry.snapshot_ref ?? null,
          last_verified_live: rawEntry.last_verified_live ?? null,
          live_status: rawEntry.live_status ?? "unknown",
          reconstructed_snapshot_ref: rawEntry.reconstructed_snapshot_ref ?? null,
        };
        entries.push(withReconstructedSnapshotRef(withLatestLiveness(normalized)));
      }
    } catch {
      // skip malformed line
    }
  }
  return entries;
}

// sweep_ledger_liveness (Feature 1 P2) needs every project_id present in
// the ledger when none is specified -- readLedgerEntries always filters
// to one project_id, so this is the one place that reads every line
// unfiltered. Same "missing/malformed collapses to empty" tolerance as
// readLedgerEntries itself.
function listAllProjectIds(): string[] {
  let raw: string;
  try {
    raw = readFileSync(LEDGER_PATH, "utf8");
  } catch {
    return [];
  }
  const ids = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && typeof parsed.project_id === "string") {
        ids.add(parsed.project_id);
      }
    } catch {
      // skip malformed line
    }
  }
  return [...ids];
}

// Feature 1 P3: the graph-level half of referential integrity that
// checkFileLiveStatus's single-entry check can't do. Pattern's ledger has
// no explicit entry-to-entry reference field (each line is an independent
// judgment record) -- feature_id is the one real grouping construct that
// already exists (deriveFeatureId), so a "cluster" here means every entry
// sharing one feature_id, and "cross-linked with no live anchor" means
// none of them resolved to live_status "live". A cluster of exactly one
// entry is just an ordinary orphaned/unknown entry, not a cluster
// phenomenon, so single-entry groups are never flagged.
//
// Must run after checkLedgerLiveness has updated live_status for the
// same project -- otherwise this would be judging stale per-entry
// statuses. sweepLedgerLiveness below enforces that ordering; this
// function does not re-check individual entries itself.
function detectDanglingClusters(projectId: string): Array<{ feature_id: string; entry_ids: string[] }> {
  const entries = readLedgerEntries(projectId);
  const byFeature = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    const group = byFeature.get(e.feature_id) ?? [];
    group.push(e);
    byFeature.set(e.feature_id, group);
  }

  const clusters: Array<{ feature_id: string; entry_ids: string[] }> = [];
  for (const [featureId, group] of byFeature) {
    if (group.length < 2) continue;
    if (group.some((e) => e.live_status === "live")) continue;
    clusters.push({ feature_id: featureId, entry_ids: group.map((e) => e.id) });
    for (const e of group) {
      appendLedgerLivenessRecord({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        ledger_entry_id: e.id,
        project_id: projectId,
        live_status: "dangling",
        checked_file_path: e.file_path,
      });
    }
  }
  return clusters;
}

// The MCP tool: batch-updates live_status across an entire ledger,
// optionally scoped to one project_id, but sweeping every project_id
// present when omitted -- the "on a schedule (project open or cron)" half
// of the design that check_ledger_liveness's on-demand, single-project
// call (P1) doesn't cover. Pattern has no daemon or background process of
// its own to schedule this from (each server invocation is transient,
// tied to its MCP host's lifecycle) -- this tool is meant to be invoked
// by whatever external scheduler you already have (a cron job, a CI
// step), not something Pattern triggers on its own.
function sweepLedgerLiveness(input: { project_id?: string }): {
  projects_swept: number;
  total_entries_checked: number;
  dangling_clusters: Array<{ project_id: string; feature_id: string; entry_ids: string[] }>;
  per_project: Array<{ project_id: string; checked: number; total_entries: number; dangling_clusters: number }>;
} {
  const projectIds = input.project_id ? [input.project_id] : listAllProjectIds();
  const perProject: Array<{ project_id: string; checked: number; total_entries: number; dangling_clusters: number }> =
    [];
  const allDangling: Array<{ project_id: string; feature_id: string; entry_ids: string[] }> = [];

  for (const projectId of projectIds) {
    const liveness = checkLedgerLiveness({ project_id: projectId });
    const clusters = detectDanglingClusters(projectId);
    for (const c of clusters) allDangling.push({ project_id: projectId, ...c });
    perProject.push({
      project_id: projectId,
      checked: liveness.checked,
      total_entries: liveness.total_entries,
      dangling_clusters: clusters.length,
    });
  }

  return {
    projects_swept: projectIds.length,
    total_entries_checked: perProject.reduce((sum, p) => sum + p.checked, 0),
    dangling_clusters: allDangling,
    per_project: perProject,
  };
}

// The only entry point that writes ledger.jsonl. Validates every
// candidate against the DistilledCandidate boundary before it ever touches
// disk -- a raw object reaching here throws rather than silently
// persisting (see assertDistilledCandidateShape).
function appendLedgerEntry(entry: LedgerEntry): void {
  for (const candidate of entry.candidates_evaluated) {
    assertDistilledCandidateShape(candidate);
  }
  mkdirSync(dirname(LEDGER_PATH), { recursive: true });
  appendFileSync(LEDGER_PATH, JSON.stringify(entry) + "\n", "utf8");
}

// Verdict-serving match: deliberately stricter than findLedgerMatches
// below (exact component_need/domain/framework, not keyword overlap)
// since this decides whether a fresh API call gets skipped entirely, not
// just what gets listed back to a caller browsing history.
function findLedgerCacheHit(
  input: { component_need: string; domain: string; framework: string; existing_stack?: string },
  entries: LedgerEntry[]
): LedgerEntry | null {
  const snapshot = hashConventions(input.existing_stack);
  const needLower = input.component_need.trim().toLowerCase();
  const ttlMs = LEDGER_TTL_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const eligible = entries.filter((e) => {
    if (e.component_need.trim().toLowerCase() !== needLower) return false;
    if (e.domain !== input.domain) return false;
    if (e.framework !== input.framework) return false;
    if (e.project_conventions_snapshot !== snapshot) return false;
    if (e.confidence !== "high") return false;
    if (e.reason !== "scored" && e.reason !== "no_candidates_found") return false;
    const age = now - new Date(e.timestamp).getTime();
    if (!Number.isFinite(age) || age > ttlMs) return false;
    return true;
  });
  if (eligible.length === 0) return null;
  return eligible.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
}

// Broader listing for the read_ledger tool itself -- simple keyword match
// on component_need (no embeddings, per the build plan's explicit v1
// scope), not the strict exact match findLedgerCacheHit needs.
function findLedgerMatches(projectId: string, componentNeed?: string, limit = 20): LedgerEntry[] {
  let entries = readLedgerEntries(projectId);
  if (componentNeed && componentNeed.trim()) {
    const needle = componentNeed.trim().toLowerCase();
    entries = entries.filter((e) => e.component_need.toLowerCase().includes(needle));
  }
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return entries.slice(0, limit);
}

// entry.reconstructed_snapshot_ref only ever gets consulted when
// snapshot_ref itself is null (see withReconstructedSnapshotRef) -- this
// still checks both explicitly, rather than assuming that invariant holds,
// so the two can never be silently conflated even if that changes later.
// A reconstructed value is always labeled as such: it's an approximation
// (the commit HEAD probably pointed to at that timestamp), not the
// original captured snapshot, and presenting it unlabeled would overstate
// its reliability.
function formatSnapshotLine(entry: LedgerEntry): string {
  if (entry.snapshot_ref) return "`" + entry.snapshot_ref + "`";
  if (entry.reconstructed_snapshot_ref) {
    return (
      "`" +
      entry.reconstructed_snapshot_ref +
      "` (reconstructed via backfill -- best-effort approximation, not the original captured snapshot)"
    );
  }
  return "not available (project root wasn't a git repository at judgment time)";
}

// Feature 2 / Decision Provenance, P1: renders one ledger entry as a
// stable markdown block -- "stable" meaning a pure function of the entry
// alone (never Date.now(), never anything read live off disk), so the
// same entry always produces byte-identical markdown. That determinism is
// what makes verify-provenance-artifact.mjs's snapshot test meaningful:
// a diff in the generated markdown for a fixed fixture means the format
// changed, not that time passed. Markdown, not JSON, per the spec --
// PRs/issues render it natively (see export_ledger_provenance and
// post_ledger_provenance_to_github, which attach this to one).
export function formatProvenanceArtifact(entry: LedgerEntry): string {
  const lines: string[] = [];
  lines.push(`## Pattern decision: ${entry.component_need}`);
  lines.push("");
  lines.push(`- **Verdict:** ${entry.verdict} (confidence: ${entry.confidence})`);
  lines.push(`- **Reason:** ${entry.reason}`);
  lines.push(`- **Coverage:** ${entry.coverage ?? "n/a"}`);
  lines.push(`- **Domain:** ${entry.domain}`);
  lines.push(`- **Framework:** ${entry.framework}`);
  lines.push(`- **Snapshot:** ${formatSnapshotLine(entry)}`);
  lines.push(`- **Judged at:** ${entry.timestamp}${entry.cache_hit ? " (served from ledger cache hit)" : ""}`);
  lines.push("");

  lines.push("### Requirements checked");
  if (entry.checklist.length === 0) {
    lines.push("_No checklist recorded for this entry._");
  } else {
    for (const item of entry.checklist) lines.push(`- ${item}`);
  }
  lines.push("");

  lines.push("### Candidates compared");
  if (entry.candidates_evaluated.length === 0) {
    lines.push(
      entry.verdict === "custom_build"
        ? "_No existing candidate met the bar -- Pattern recommended a custom build. The closest candidates' unmet requirements are in the requirements checked above._"
        : "_No candidates recorded for this entry._"
    );
  } else {
    lines.push("| Source | Name | Coverage | Chosen |");
    lines.push("| --- | --- | --- | --- |");
    for (const c of entry.candidates_evaluated) {
      const chosen = c.name !== null && c.name === entry.chosen_candidate ? "✓" : "";
      lines.push(`| ${c.source ?? "n/a"} | ${c.name ?? "n/a"} | ${c.coverage_pct ?? "n/a"} | ${chosen} |`);
    }
    // Solo Dev design-system architecture P3: distinguish a design_system
    // source from an external library at render time -- reads only
    // entry.candidates_evaluated (already-persisted, distilled data), so
    // this stays a pure function of the entry alone like the rest of this
    // formatter.
    if (entry.candidates_evaluated.some((c) => c.source === "design_system")) {
      lines.push("");
      lines.push("_Sourced from this project's own registered design system (`register_design_system`), not an external library._");
    }
  }
  lines.push("");
  lines.push(`_Generated by Pattern (\`export_ledger_provenance\`) from ledger entry \`${entry.id}\`._`);

  return lines.join("\n");
}

// Feature 2 / Decision Provenance, P2: posts an export_ledger_provenance
// artifact as a real comment on a GitHub PR or issue. GitHub's REST API
// treats a PR and an issue identically for comments (both are backed by
// the same /issues/{number}/comments endpoint), so one input shape covers
// both -- no separate "is this a PR" flag needed.
//
// This is the one tool in this server with a real, visible side effect on
// a third-party service outside the caller's own machine -- every other
// tool here only ever touches local files. The calling agent should
// confirm with the user before invoking it, the same way it's expected to
// confirm before running a suggested install_command (see SECURITY.md).
//
// Auth resolves the spec's own open question (personal token vs. GitHub
// App) in favor of a personal token: reads GITHUB_TOKEN from the
// environment, the same convention every GitHub Action and the `gh` CLI
// itself use. A GitHub App needs a hosted installation flow and a webhook
// receiver, which contradicts this project's "local npm package, no
// hosted infrastructure" distribution model (see the README's Ledger
// integrity section and the Pattern Primer's build-order principle) --
// Pattern manages no GitHub credential of its own, the same way it
// manages no git credential for computeSnapshotRef above.
//
// Idempotent by construction, not just by convention: every posted
// comment is prefixed with a hidden HTML marker keyed to the ledger
// entry's id, and a post first checks existing comments for that marker
// -- a repeat call for the same entry returns posted: false instead of
// creating a duplicate. Only checks the most recent 100 comments (one
// page) -- a thread with more prior comments than that is an edge case
// this pass doesn't handle; full pagination is a later concern, not built
// here.
const GITHUB_API_BASE = process.env.PATTERN_GITHUB_API_BASE ?? "https://api.github.com";

function provenanceMarker(ledgerEntryId: string): string {
  return `<!-- pattern-ledger-provenance:${ledgerEntryId} -->`;
}

async function postProvenanceToGitHub(input: {
  project_id: string;
  ledger_entry_id: string;
  repo: string;
  issue_number: number;
}): Promise<{ posted: boolean; reason?: string; comment_url: string; comment_id?: number }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set. This tool posts a real comment to GitHub and needs a personal access token " +
        "with repo scope (the same one `gh auth login` or a GitHub Action would use) -- set the GITHUB_TOKEN " +
        "environment variable and retry."
    );
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(input.repo)) {
    throw new Error(`repo must be in "owner/repo" form, got: "${input.repo}"`);
  }

  const entry = readLedgerEntries(input.project_id).find((e) => e.id === input.ledger_entry_id);
  if (!entry) {
    throw new Error(
      `No ledger entry with id "${input.ledger_entry_id}" found for project_id "${input.project_id}". Use read_ledger to list entries and their ids.`
    );
  }

  const marker = provenanceMarker(entry.id);
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "pattern-mcp",
  };
  const commentsUrl = `${GITHUB_API_BASE}/repos/${input.repo}/issues/${input.issue_number}/comments`;

  const listResponse = await fetch(`${commentsUrl}?per_page=100`, { headers });
  if (!listResponse.ok) {
    const errText = await listResponse.text();
    throw new Error(
      `GitHub API error ${listResponse.status} listing comments on ${input.repo}#${input.issue_number}: ${errText}`
    );
  }
  const existingComments = (await listResponse.json()) as Array<{ id: number; body: string; html_url: string }>;
  const existing = existingComments.find((c) => c.body.includes(marker));
  if (existing) {
    return { posted: false, reason: "already_posted", comment_url: existing.html_url, comment_id: existing.id };
  }

  const body = `${marker}\n\n${formatProvenanceArtifact(entry)}`;
  const postResponse = await fetch(commentsUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ body }),
  });
  if (!postResponse.ok) {
    const errText = await postResponse.text();
    throw new Error(
      `GitHub API error ${postResponse.status} posting comment to ${input.repo}#${input.issue_number}: ${errText}`
    );
  }
  const created = (await postResponse.json()) as { id: number; html_url: string };
  return { posted: true, comment_url: created.html_url, comment_id: created.id };
}

// report_build_cost (cost-attribution build plan, 1.3) -- self-reported
// build cost, cheapest option first, since Pattern has no visibility into
// what happens after judgeComponent returns a verdict (1.4's
// session-correlation fallback is a research spike only, not built here).
// Stored as a second, separate JSONL file rather than mixed into
// ledger.jsonl's LedgerEntry shape -- a BuildRecord has none of
// LedgerEntry's verdict/coverage/candidate fields, and keeping the file
// single-shape keeps read_ledger's existing output stable. Joined to
// verdict records purely by feature_id, per the build plan's data model.
const BUILD_LEDGER_PATH =
  process.env.PATTERN_BUILD_LEDGER_PATH ?? join(homedir(), ".pattern", "build_ledger.jsonl");

export interface BuildRecord {
  id: string;
  timestamp: string;
  project_id?: string;
  feature_id: string;
  tokens_used: number | null;
  cost_usd: number;
  outcome: "shipped" | "abandoned" | "replaced_with_existing";
}

function appendBuildRecord(record: BuildRecord): void {
  mkdirSync(dirname(BUILD_LEDGER_PATH), { recursive: true });
  appendFileSync(BUILD_LEDGER_PATH, JSON.stringify(record) + "\n", "utf8");
}

// Same "missing/malformed collapses to empty, one bad line skipped not
// fatal" philosophy as readLedgerEntries.
function readBuildRecords(featureId: string): BuildRecord[] {
  let raw: string;
  try {
    raw = readFileSync(BUILD_LEDGER_PATH, "utf8");
  } catch {
    return [];
  }
  const records: BuildRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && parsed.feature_id === featureId) {
        records.push(parsed as BuildRecord);
      }
    } catch {
      // skip malformed line
    }
  }
  return records;
}

function recordBuildCost(input: {
  feature_id: string;
  project_id?: string;
  tokens_used?: number;
  cost_usd: number;
  outcome: "shipped" | "abandoned" | "replaced_with_existing";
}): BuildRecord {
  const record: BuildRecord = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    project_id: input.project_id,
    feature_id: input.feature_id,
    tokens_used:
      typeof input.tokens_used === "number" && Number.isFinite(input.tokens_used) ? input.tokens_used : null,
    cost_usd: input.cost_usd,
    outcome: input.outcome,
  };
  appendBuildRecord(record);
  return record;
}

// The "total cost per feature is queryable" rollup task 1.5 validates
// against a hand total: every verdict-time ledger entry for this
// project_id+feature_id (fresh judgments and $0 cache hits alike) plus
// every self-reported build record for the same feature_id. project_id is
// required, same as every other read here, so this never falls back to a
// shared/global bucket across projects.
// report_outcome_proxy (cost-attribution build plan Phase 2, 2.1-2.3) --
// self-reported, same reasoning as report_build_cost: rework-rate and
// time-to-merge both require real git history, and Pattern has no
// process.cwd()/repo-path concept and no filesystem access to a caller's
// repo at all (see project judgment ledger's own design notes) -- rather
// than giving Pattern a new git-shelling-out capability, the calling
// agent (which already has real repo access) computes these off its own
// `git log`/`git blame` and reports the result here. This also makes
// 2.4's exclusion check true by construction: nothing on this path ever
// reads coverage_pct, confidence, or any other Pattern-produced field --
// there simply isn't a code path from a verdict into an outcome proxy.
// Append-only like every other record here: a feature can get multiple
// proxy reports over time (time_to_merge_hours right after merge,
// reworked/days_to_rework on a later re-check, status_at_30d once the
// horizon passes) -- readers take the latest report per field via
// latestOutcomeProxy below, not a running mutation of one row.
const OUTCOME_PROXY_PATH =
  process.env.PATTERN_OUTCOME_PROXY_PATH ?? join(homedir(), ".pattern", "outcome_proxies.jsonl");

export interface OutcomeProxyRecord {
  id: string;
  timestamp: string;
  project_id?: string;
  feature_id: string;
  reworked?: boolean;
  days_to_rework?: number | null;
  time_to_merge_hours?: number;
  status_at_30d?: "kept" | "replaced" | "removed";
}

function appendOutcomeProxyRecord(record: OutcomeProxyRecord): void {
  mkdirSync(dirname(OUTCOME_PROXY_PATH), { recursive: true });
  appendFileSync(OUTCOME_PROXY_PATH, JSON.stringify(record) + "\n", "utf8");
}

function readOutcomeProxyRecords(featureId: string): OutcomeProxyRecord[] {
  let raw: string;
  try {
    raw = readFileSync(OUTCOME_PROXY_PATH, "utf8");
  } catch {
    return [];
  }
  const records: OutcomeProxyRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && parsed.feature_id === featureId) {
        records.push(parsed as OutcomeProxyRecord);
      }
    } catch {
      // skip malformed line
    }
  }
  return records;
}

// Merges every report for a feature into one view, most recent value per
// field wins (not most recent record wins) -- so a status_at_30d reported
// today doesn't get lost behind an unrelated reworked update reported
// yesterday, and vice versa. history is still returned in full for anyone
// who wants the raw timeline rather than just the merged snapshot.
function latestOutcomeProxy(featureId: string): { merged: Partial<OutcomeProxyRecord> | null; history: OutcomeProxyRecord[] } {
  const records = readOutcomeProxyRecords(featureId).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  if (records.length === 0) return { merged: null, history: records };
  const merged: Partial<OutcomeProxyRecord> = {};
  for (const r of records) {
    if (r.reworked !== undefined) merged.reworked = r.reworked;
    if (r.days_to_rework !== undefined) merged.days_to_rework = r.days_to_rework;
    if (r.time_to_merge_hours !== undefined) merged.time_to_merge_hours = r.time_to_merge_hours;
    if (r.status_at_30d !== undefined) merged.status_at_30d = r.status_at_30d;
  }
  return { merged, history: records };
}

function recordOutcomeProxy(input: {
  feature_id: string;
  project_id?: string;
  reworked?: boolean;
  days_to_rework?: number;
  time_to_merge_hours?: number;
  status_at_30d?: "kept" | "replaced" | "removed";
}): OutcomeProxyRecord {
  if (
    input.reworked === undefined &&
    input.days_to_rework === undefined &&
    input.time_to_merge_hours === undefined &&
    input.status_at_30d === undefined
  ) {
    throw new Error(
      "report_outcome_proxy requires at least one of reworked, days_to_rework, time_to_merge_hours, or status_at_30d."
    );
  }
  const record: OutcomeProxyRecord = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    project_id: input.project_id,
    feature_id: input.feature_id,
    ...(input.reworked !== undefined ? { reworked: input.reworked } : {}),
    ...(input.days_to_rework !== undefined ? { days_to_rework: input.days_to_rework } : {}),
    ...(input.time_to_merge_hours !== undefined ? { time_to_merge_hours: input.time_to_merge_hours } : {}),
    ...(input.status_at_30d !== undefined ? { status_at_30d: input.status_at_30d } : {}),
  };
  appendOutcomeProxyRecord(record);
  return record;
}

function totalFeatureCost(
  projectId: string,
  featureId: string
): {
  feature_id: string;
  verdict_entries: LedgerEntry[];
  build_records: BuildRecord[];
  total_cost_usd: number;
  outcome_proxy: Partial<OutcomeProxyRecord> | null;
  outcome_proxy_history: OutcomeProxyRecord[];
} {
  const verdictEntries = readLedgerEntries(projectId).filter((e) => e.feature_id === featureId);
  const buildRecords = readBuildRecords(featureId).filter((r) => !r.project_id || r.project_id === projectId);
  const total =
    verdictEntries.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0) +
    buildRecords.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
  const { merged, history } = latestOutcomeProxy(featureId);
  return {
    feature_id: featureId,
    verdict_entries: verdictEntries,
    build_records: buildRecords,
    total_cost_usd: Math.round(total * 10000) / 10000,
    outcome_proxy: merged,
    outcome_proxy_history: history,
  };
}

// Orchestrates the ensemble: run once, and only pay for 2 more full
// pipeline passes when the single-run result landed close enough to a
// verdict threshold that a single item's judgment swinging could flip
// the answer. Cases far from any boundary return the fast single-run
// path unchanged, at no extra cost.
// Sums _meta across every pass that actually ran, for the ensemble case --
// "total" here means cumulative internal compute/cost across all reruns,
// not perceived wall-clock latency (the second and third passes run
// concurrently via Promise.all, so wall-clock is closer to ~2x one pass,
// not ~3x). Cost and token spend are genuinely additive across reruns, so
// that's what total_ms/tokens_used/estimated_cost_usd report here; this is
// called out in the README so a 3x-looking total_ms isn't mistaken for
// request latency.
function aggregateMeta(passes: Array<{ ok: true; result: JudgmentResult }>): JudgmentResult["_meta"] | undefined {
  const metas = passes.map((p) => p.result._meta).filter((m): m is NonNullable<JudgmentResult["_meta"]> => !!m);
  if (metas.length === 0) return undefined;
  return {
    total_ms: metas.reduce((sum, m) => sum + m.total_ms, 0),
    breakdown_ms: {
      extract: metas.reduce((sum, m) => sum + m.breakdown_ms.extract, 0),
      search: metas.reduce((sum, m) => sum + m.breakdown_ms.search, 0),
      score: metas.reduce((sum, m) => sum + m.breakdown_ms.score, 0),
    },
    tokens_used: {
      input: metas.reduce((sum, m) => sum + m.tokens_used.input, 0),
      output: metas.reduce((sum, m) => sum + m.tokens_used.output, 0),
      // Only present if every pass has it -- all passes go through the same
      // buildMeta call site in practice, so a mix would mean something else
      // changed; safer to omit than to silently sum a partial set.
      ...(metas.every((m) => m.tokens_used.input_breakdown)
        ? {
            input_breakdown: {
              fresh: metas.reduce((sum, m) => sum + (m.tokens_used.input_breakdown?.fresh ?? 0), 0),
              cache_write: metas.reduce((sum, m) => sum + (m.tokens_used.input_breakdown?.cache_write ?? 0), 0),
              cache_read: metas.reduce((sum, m) => sum + (m.tokens_used.input_breakdown?.cache_read ?? 0), 0),
            },
          }
        : {}),
    },
    estimated_cost_usd: Math.round(metas.reduce((sum, m) => sum + m.estimated_cost_usd, 0) * 10000) / 10000,
  };
}

// Builds the LedgerEntry appended after a judgment -- fresh (non-cache-hit)
// or a ledger cache hit, distinguished by opts.cacheHit/opts.costUsd (a
// cache hit is always real $0, a fresh call carries its own
// _meta.estimated_cost_usd; callers pass that in rather than this function
// reaching into result._meta itself, since the cache-hit path's synthetic
// _meta shouldn't be treated as equivalent to a real one).
// checklist/checklist_source come from the result itself, not input.checklist
// -- that field captures what was actually scored regardless of whether the
// caller pre-supplied it or this call extracted it internally.
function buildLedgerEntry(
  input: {
    component_need: string;
    domain: string;
    framework: string;
    existing_stack?: string;
    feature_id?: string;
    file_path?: string;
  },
  projectId: string,
  result: JudgmentResult,
  opts: { costUsd: number; cacheHit: boolean; featureId?: string }
): LedgerEntry {
  const candidate = distillCandidate(result);
  const checklist = Array.isArray(result.requirements_checked)
    ? result.requirements_checked.map((r) => r.requirement).filter((r): r is string => !!r)
    : [];
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    project_id: projectId,
    feature_id: deriveFeatureId(input.component_need, projectId, opts.featureId ?? input.feature_id),
    component_need: input.component_need,
    domain: input.domain,
    framework: input.framework,
    checklist,
    checklist_source: result.checklist_source ?? "extracted",
    candidates_evaluated: candidate ? [candidate] : [],
    verdict: result.verdict,
    chosen_candidate: candidate?.name ?? null,
    confidence: result.confidence,
    reason: result.reason,
    coverage: result.coverage ?? null,
    cost_usd: opts.costUsd,
    cache_hit: opts.cacheHit,
    project_conventions_snapshot: hashConventions(input.existing_stack),
    // Feature 2 P0: captured fresh for every entry (cache hits included),
    // not inherited from a matched ledger_cache_hit -- this reflects the
    // codebase state at the moment *this line* was written, not the
    // moment the original judgment ran (see PROJECT_ROOT above).
    snapshot_ref: computeSnapshotRef(PROJECT_ROOT),
    // Feature 1 P0: caller-supplied at write time (recommend_component's
    // optional file_path), null when not yet known -- typically the case,
    // since the decision is usually made before the file exists. Always
    // starts "unknown"/unchecked; check_ledger_liveness fills these in
    // later via the ledger_liveness.jsonl overlay (see withLatestLiveness).
    file_path: input.file_path ?? null,
    last_verified_live: null,
    live_status: "unknown",
    reconstructed_snapshot_ref: null,
  };
}

async function judgeComponent(input: {
  component_need: string;
  domain: string;
  framework: string;
  existing_stack?: string;
  project_id?: string;
  checklist?: string[];
  feature_id?: string;
  file_path?: string;
}): Promise<string> {
  // The one deliberate exception to "coverage is scored fresh every time"
  // (see file header and runSinglePass's memory-lookup comment) -- bounded
  // by exact component_need/domain/framework/conventions match, confidence
  // "high", and LEDGER_TTL_DAYS staleness. Checked before the skip-list
  // fast-path so a skip-list primitive never bothers with a ledger read.
  // Gated by LEDGER_CACHE_HIT_ENABLED (PATTERN_NO_LEDGER_CACHE_HIT) so the
  // "always fresh" behavior can be restored without removing this code.
  const ledgerCacheHit =
    LEDGER_CACHE_HIT_ENABLED && !isSkipListMatch(input.component_need) && input.project_id
      ? findLedgerCacheHit(input, readLedgerEntries(input.project_id))
      : null;

  if (ledgerCacheHit) {
    console.error(
      JSON.stringify({
        diagnostic: "ledger_cache_hit",
        project_id: input.project_id,
        ledger_entry_id: ledgerCacheHit.id,
        original_timestamp: ledgerCacheHit.timestamp,
      })
    );
    const candidate = ledgerCacheHit.candidates_evaluated[0] ?? null;
    const result: JudgmentResult = {
      verdict: ledgerCacheHit.verdict,
      confidence: ledgerCacheHit.confidence,
      reason: "ledger_cache_hit",
      coverage: ledgerCacheHit.coverage,
      requirements_checked: null,
      recommendation: candidate
        ? { source: candidate.source, install_command: null, component_description: candidate.name, reference: null }
        : null,
      ensemble: { triggered: false },
      checklist_source: ledgerCacheHit.checklist_source,
      served_from_ledger: true,
      ledger_entry_id: ledgerCacheHit.id,
      original_verdict_timestamp: ledgerCacheHit.timestamp,
      _meta: {
        total_ms: 1,
        breakdown_ms: { extract: 1, search: 0, score: 0 },
        tokens_used: { input: 0, output: 0 },
        estimated_cost_usd: 0,
      },
    };
    captureRecommendation({
      projectId: input.project_id,
      verdict: result.verdict,
      confidence: result.confidence,
      reason: result.reason,
      ensembleTriggered: false,
      estimatedCostUsd: 0,
      servedFromLedger: true,
    });
    // Cost-attribution build plan, 1.1: log feature_id on every ledger
    // write, cache hit included -- not just fresh judgments -- so a
    // feature's total cost rolls up correctly even when most of its later
    // calls cost $0 via this exact short-circuit. Inherits the matched
    // entry's feature_id unless this call explicitly supplies its own.
    if (input.project_id) {
      appendLedgerEntry(
        buildLedgerEntry(input, input.project_id, result, {
          costUsd: 0,
          cacheHit: true,
          featureId: input.feature_id ?? ledgerCacheHit.feature_id,
        })
      );
    }
    return JSON.stringify(result);
  }

  // Session cap and local logging both apply only to calls that actually
  // reach the API -- skip-list hits never do, so both are excluded here
  // on the same condition rather than counted/logged and refunded.
  const reachesApi = !isSkipListMatch(input.component_need);

  if (reachesApi) {
    if (sessionCallCount >= SESSION_CALL_CAP) {
      throw new Error(
        `Session call cap (${SESSION_CALL_CAP}) reached. This protects against runaway costs on your API key. Restart the MCP server to reset the counter, or set PATTERN_SESSION_CAP to raise the limit.`
      );
    }
    sessionCallCount++;
    console.error(
      JSON.stringify({ diagnostic: "session_call_count", count: sessionCallCount, cap: SESSION_CALL_CAP })
    );
  }

  const first = await runSinglePass(input);
  if (!first.ok) {
    if (reachesApi) logCall(input, { parseError: true });
    return first.raw;
  }

  if (!isBoundaryRisk(first.result)) {
    first.result.ensemble = { triggered: false };
    if (reachesApi) logCall(input, first.result);
    if (reachesApi && input.project_id && (first.result.reason === "scored" || first.result.reason === "no_candidates_found")) {
      appendLedgerEntry(
        buildLedgerEntry(input, input.project_id, first.result, {
          costUsd: first.result._meta?.estimated_cost_usd ?? 0,
          cacheHit: false,
        })
      );
    }
    if (reachesApi) {
      captureRecommendation({
        projectId: input.project_id,
        verdict: first.result.verdict,
        confidence: first.result.confidence,
        reason: first.result.reason,
        ensembleTriggered: false,
        estimatedCostUsd: first.result._meta?.estimated_cost_usd ?? null,
        servedFromLedger: false,
      });
    }
    return JSON.stringify(first.result);
  }

  console.error(
    JSON.stringify({
      diagnostic: "ensemble_triggered",
      reason: first.result.reason,
      coverage: first.result.coverage,
    })
  );

  // Adaptive escalation: run only a 2nd pass first. A binary verdict
  // (use_existing | custom_build) can only tie at 2 passes, never at 3 --
  // so we escalate to a 3rd pass ONLY on that 1/1 tie, which is exactly
  // the case that actually needs a tie-break. When the 2nd pass agrees
  // with the 1st, that agreement is itself the answer and a 3rd pass
  // would just spend real API cost confirming what's already settled.
  // This does not touch the correctness guarantee for genuine
  // disagreement -- it still always resolves via an odd-numbered
  // majority vote, same as the flat 3-run version this replaces.
  const second = await runSinglePass(input);
  let passes = [first, second].filter((p): p is { ok: true; result: JudgmentResult } => p.ok);
  let verdicts = passes.map((p) => p.result.verdict);
  let counts = new Map<string, number>();
  for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1);
  let sortedCounts = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const isTwoWayTie = passes.length === 2 && sortedCounts.length === 2 && sortedCounts[0][1] === sortedCounts[1][1];

  if (isTwoWayTie) {
    console.error(
      JSON.stringify({
        diagnostic: "ensemble_tie_escalated",
        runs: verdicts,
      })
    );
    const third = await runSinglePass(input);
    passes = [first, second, third].filter((p): p is { ok: true; result: JudgmentResult } => p.ok);
    verdicts = passes.map((p) => p.result.verdict);
    counts = new Map<string, number>();
    for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1);
    sortedCounts = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }

  const [majorityVerdict, majorityCount] = sortedCounts[0];
  const agreement = `${majorityCount}/${passes.length}`;

  // Use a pass whose own verdict already matches the majority as the base
  // for everything else in the response (recommendation, coverage,
  // requirements_checked) -- not unconditionally `first`. `first` can be
  // the outlier in a 2/3 split: if it said custom_build but the other two
  // passes said use_existing, blindly keeping first's recommendation would
  // return verdict "use_existing" paired with a custom_build-shaped
  // recommendation (a populated Mobbin reference, component_description
  // still null) -- internally inconsistent output. Falling back to `first`
  // below is unreachable in practice (majorityVerdict is defined as the
  // most common value among `verdicts`, so some pass must have it) but
  // kept as a defensive default.
  const winningPass = passes.find((p) => p.result.verdict === majorityVerdict) ?? first;
  const base = winningPass.result;
  base.verdict = majorityVerdict;
  // Unanimous agreement keeps whatever confidence the base run computed
  // for itself (already threshold-correct); any split forces "low" --
  // a genuine disagreement across identical inputs is real uncertainty
  // the tool should surface, not paper over with a confident-sounding verdict.
  if (majorityCount < passes.length) base.confidence = "low";
  base.ensemble = { triggered: true, runs: verdicts, agreement };
  // Captured before aggregateMeta overwrites base._meta (same object as
  // winningPass.result._meta) with a fresh summed-across-passes object --
  // scoring_fetch isn't summed like cost/tokens, it describes whichever
  // single pass's evidence actually became requirements_checked/
  // recommendation below, so it must come from the winning pass
  // specifically, not be dropped by aggregateMeta not knowing about it.
  const winningScoringFetch = winningPass.result._meta?.scoring_fetch;
  base._meta = aggregateMeta(passes) ?? base._meta;
  if (base._meta) base._meta.scoring_fetch = winningScoringFetch;

  console.error(
    JSON.stringify({
      diagnostic: "ensemble_decision",
      runs: verdicts,
      agreement,
      finalVerdict: base.verdict,
      finalConfidence: base.confidence,
    })
  );

  // Reachable only past the boundary-risk branch, which is itself only
  // reachable for calls that passed the skip-list check above -- always
  // reachesApi === true here, no guard needed.
  logCall(input, base);
  if (input.project_id && (base.reason === "scored" || base.reason === "no_candidates_found")) {
    appendLedgerEntry(
      buildLedgerEntry(input, input.project_id, base, {
        costUsd: base._meta?.estimated_cost_usd ?? 0,
        cacheHit: false,
      })
    );
  }
  captureRecommendation({
    projectId: input.project_id,
    verdict: base.verdict,
    confidence: base.confidence,
    reason: base.reason,
    ensembleTriggered: true,
    estimatedCostUsd: base._meta?.estimated_cost_usd ?? null,
    servedFromLedger: false,
  });
  return JSON.stringify(base);
}

export interface ReferenceEntry {
  source?: string;
  url?: string;
  flow_name?: string;
  file_name?: string;
  reference_description?: string;
  // Computed server-side by applyDeepLinkGrounding, never trusted from the
  // model -- "deep_link" only when the URL was independently confirmed
  // present in fetched page content, "entry_point" otherwise (including
  // when no fetch ran at all).
  url_type?: "deep_link" | "entry_point";
}

export interface JudgmentResult {
  verdict: string;
  confidence: string;
  reason: string;
  // Set to "jev" when the design-system Jev path produced this result
  // (PATTERN_SCORER=jev). No requirements checklist exists on that path, so
  // isBoundaryRisk never re-runs it.
  scorer?: "jev";
  // Jev path only: the best-ranked file and the runners-up. `score` is Jev's
  // raw per-candidate probability -- a ranking signal, NOT calibrated.
  design_system_match?: {
    file: string | null;
    components: string[];
    score: number;
    alternatives: Array<{ file: string | null; components: string[]; score: number }>;
    candidates_considered: number;
  } | null;
  // Jev path, nothing fits: a plain-language "we can't find it" for the
  // calling agent/user. No web search is attempted in this mode.
  not_found_message?: string | null;
  coverage?: string | null;
  // Self-reported by the model per step 5's Oversized Match check -- a
  // candidate can satisfy every checklist item and still be an Oversized
  // Match if its real capabilities substantially exceed the stated
  // project scope. enforceVerdictThreshold reads this to deterministically
  // cap confidence at "low" even at >=80% coverage, the same "recompute,
  // don't trust the model's own arithmetic" policy as coverage/verdict
  // above -- the model's own "confidence" field alone is not trusted to
  // carry this signal, since it doesn't reliably self-apply the cap it
  // was instructed to (confirmed live: a response reasoned through the
  // full Oversized Match case in oversized_match_note yet still wrote
  // confidence "high").
  oversized_match?: boolean;
  oversized_match_note?: string | null;
  // Design-system-mode only (see findKeywordOverlapCandidates): a cheap,
  // deterministic, zero-cost local check run whenever reason is
  // "no_candidates_found" -- the model said nothing registered was even
  // plausibly relevant, but the model can miss a real match sitting in
  // its own prompt the same way it can hallucinate one that isn't there.
  // This never overrides the verdict (a keyword overlap is a weak signal,
  // not proof of a real match) -- it only surfaces the risk so the
  // calling agent knows to double-check before trusting a "nothing here"
  // verdict, the same "show uncertainty instead of papering over it"
  // policy as ensemble/oversized_match above. null/absent when not
  // applicable (external-library mode, or reason !== "no_candidates_found").
  design_system_recall_check?: {
    possible_missed_candidates: Array<{ name: string; shared_keywords: string[] }>;
    note: string;
  } | null;
  requirements_checked?: Array<{ requirement?: string; met?: boolean; evidence?: string }> | null;
  recommendation?: {
    source?: string | null;
    install_command?: string | null;
    component_description?: string | null;
    reference?: ReferenceEntry | ReferenceEntry[] | null;
  } | null;
  ensemble?: { triggered: boolean; runs?: string[]; agreement?: string };
  past_decision_signal?: { considered: boolean; note: string } | null;
  checklist_source?: "extracted" | "provided";
  // Present and true only when this response was served from the ledger
  // cache hit path (see findLedgerCacheHit) instead of a fresh API call --
  // requirements_checked is null on this path since the ledger never
  // stores per-requirement evidence text, only distilled candidate fields.
  served_from_ledger?: boolean;
  ledger_entry_id?: string;
  original_verdict_timestamp?: string;
  _meta?: {
    total_ms: number;
    breakdown_ms: { extract: number; search: number; score: number };
    // input is the total (fresh + cache_write + cache_read), unchanged --
    // input_breakdown splits it out so a call can be checked for whether
    // prompt caching actually discounted anything, instead of that being
    // invisible inside one summed number. Undefined on paths with no real
    // API call (skip_list, ledger_cache_hit) since there's no split to report.
    tokens_used: { input: number; output: number; input_breakdown?: { fresh: number; cache_write: number; cache_read: number } };
    estimated_cost_usd: number;
    // Jev path only, when no per-token rate is configured: cost is reported
    // as 0 because it is unknown, not because the call was free.
    cost_note?: string;
    // Diagnostic only, mirrors search_calls/fetch_calls stderr diagnostics
    // -- whether step 4's single candidate-verification fetch (see
    // buildSystemPrompt step 4) actually happened and succeeded. No
    // requirement-level auto-correction is attempted when it didn't (no
    // safe fallback value exists for an unverified met/not-met judgment,
    // unlike step 6's reference URLs which fall back to the category
    // page) -- this exists so evals can measure whether fetch-grounded
    // scoring actually ran, not to fix the response itself.
    scoring_fetch?: { attempted: boolean; succeeded: boolean; url: string | null };
  };
  [key: string]: unknown;
}

// The model's stated `coverage` string doesn't always match its own
// `requirements_checked` array -- observed a run where the array listed
// 5 "met" items out of 10 but the coverage field said "4/10 (40%)". Since
// enforceVerdictThreshold (and the calling agent) trusts the `coverage`
// string, a wrong string silently produces a verdict that's internally
// consistent with itself but not with the evidence the model actually
// wrote down. Recount from the array -- the one part of the output that's
// a plain enumerable list, not arithmetic the model has to get right --
// and overwrite `coverage` with the true tally before anything else reads
// it.
export function enforceCoverageRecount(parsed: JudgmentResult): void {
  if (parsed.reason !== "scored") return;
  const items = parsed.requirements_checked;
  if (!Array.isArray(items) || items.length === 0) return;

  const total = items.length;
  const met = items.filter((item) => item.met === true).length;
  const percent = Math.round((met / total) * 1000) / 10; // one decimal, matches model's own style
  const percentDisplay = Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
  const recounted = `${met}/${total} (${percentDisplay}%)`;

  if (parsed.coverage !== recounted) {
    console.error(
      JSON.stringify({
        diagnostic: "coverage_recounted",
        statedCoverage: parsed.coverage,
        recountedCoverage: recounted,
        metCount: met,
        totalCount: total,
      })
    );
    parsed.coverage = recounted;
  }
}

// The model doesn't reliably self-apply its own coverage->verdict rule --
// observed a 50% coverage case labeled "custom_build" when the stated
// thresholds (>=80 high, 40-79 low, <40 custom_build) call for
// "use_existing" at low confidence. Recompute deterministically instead of
// trusting the model's arithmetic.
export function parseCoveragePercent(coverage: string | null | undefined): number | null {
  if (!coverage) return null;
  const parenMatch = coverage.match(/\((\d+(?:\.\d+)?)%\)/);
  if (parenMatch) return Number.parseFloat(parenMatch[1]);
  const fracMatch = coverage.match(/(\d+)\s*\/\s*(\d+)/);
  if (fracMatch) {
    const met = Number.parseInt(fracMatch[1], 10);
    const total = Number.parseInt(fracMatch[2], 10);
    if (total > 0) return (met / total) * 100;
  }
  return null;
}

// The only shape ever allowed to reach the ledger (see appendLedgerEntry) --
// deliberately excludes anything raw: no HTML, no full prop tables, no
// search snippet text, no evidence strings. Everything here already went
// through the judgment call's own scoring; this is a projection of that
// result, not a second copy of what was scraped to produce it.
export interface DistilledCandidate {
  source: string | null;
  name: string | null;
  url: string | null;
  coverage_pct: number | null;
}

const ALLOWED_DISTILLED_CANDIDATE_KEYS = new Set(["source", "name", "url", "coverage_pct"]);

// Throws rather than silently stripping unknown keys -- a raw object
// reaching this function is a bug (some caller skipped distillCandidate),
// and failing loudly is what makes "Pattern never persists scraped source"
// a checkable claim rather than a hopeful one.
export function assertDistilledCandidateShape(value: unknown): asserts value is DistilledCandidate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("DistilledCandidate must be a plain object");
  }
  const keys = Object.keys(value as Record<string, unknown>);
  const extra = keys.filter((k) => !ALLOWED_DISTILLED_CANDIDATE_KEYS.has(k));
  if (extra.length > 0) {
    throw new Error(`DistilledCandidate has disallowed key(s): ${extra.join(", ")}`);
  }
}

// Only ever called for verdict "use_existing" with a populated
// recommendation -- custom_build has no existing candidate to distill, so
// candidates_evaluated/chosen_candidate stay empty/null in the ledger for
// those. `url` reuses the already fetch-verified scoring_fetch URL
// (see JudgmentResult._meta.scoring_fetch) rather than inventing a second
// notion of "the candidate's real page" -- if that fetch didn't happen or
// failed, url is null rather than falling back to an unverified guess.
export function distillCandidate(result: JudgmentResult): DistilledCandidate | null {
  if (result.verdict !== "use_existing" || !result.recommendation) return null;
  return {
    source: result.recommendation.source ?? null,
    name: result.recommendation.component_description ?? null,
    url: result._meta?.scoring_fetch?.succeeded ? result._meta.scoring_fetch.url ?? null : null,
    coverage_pct: parseCoveragePercent(result.coverage),
  };
}

export function enforceVerdictThreshold(parsed: JudgmentResult): void {
  if (parsed.reason !== "scored") return;
  const pct = parseCoveragePercent(parsed.coverage);
  if (pct === null) return;

  let correctVerdict: string;
  let correctConfidence: string | null;
  if (pct >= 80) {
    correctVerdict = "use_existing";
    // Oversized Match overrides the coverage-only threshold -- a candidate
    // can satisfy every requirement and still be the wrong call if it's
    // disproportionate to the stated scope (see step 5's Oversized Match
    // check and the JudgmentResult.oversized_match comment). Deliberately
    // keyed off the model's own oversized_match flag, not its "confidence"
    // field -- confirmed live that the model can correctly reason through
    // an Oversized Match in oversized_match_note and still leave
    // "confidence": "high" unchanged, so that field alone can't be trusted
    // to carry this signal.
    if (parsed.oversized_match === true) {
      correctConfidence = "low";
      console.error(
        JSON.stringify({
          diagnostic: "oversized_match_confidence_capped",
          coverage: parsed.coverage,
          note: parsed.oversized_match_note ?? null,
        })
      );
    } else {
      correctConfidence = "high";
    }
  } else if (pct >= 40) {
    correctVerdict = "use_existing";
    correctConfidence = "low";
  } else {
    correctVerdict = "custom_build";
    correctConfidence = null; // no explicit rule for this band -- leave the model's own confidence
  }

  const verdictWrong = parsed.verdict !== correctVerdict;
  const confidenceWrong = correctConfidence !== null && parsed.confidence !== correctConfidence;
  if (verdictWrong || confidenceWrong) {
    console.error(
      JSON.stringify({
        diagnostic: "verdict_corrected",
        coverage: parsed.coverage,
        coveragePercent: pct,
        modelVerdict: parsed.verdict,
        modelConfidence: parsed.confidence,
        correctedVerdict: correctVerdict,
        correctedConfidence: correctConfidence ?? parsed.confidence,
      })
    );
    parsed.verdict = correctVerdict;
    if (correctConfidence !== null) parsed.confidence = correctConfidence;
  }
}

// enforceVerdictThreshold can flip the verdict without touching
// `recommendation`, which the model built to match its OWN (possibly
// wrong) verdict -- e.g. a corrected "use_existing" can still carry the
// "custom_build" shape: a populated Mobbin reference and a null
// component_description, flatly contradicting the documented output
// schema. Confirmed live during a cold-start test: the tool returned
// isError: false with exactly this mismatch, which is indistinguishable
// from a bug to anyone reading the output without the source in front of
// them. Backfilling a grounded description for the corrected verdict
// would need another model call (and the original reference_description
// describes a *different* app's screen anyway, not the now-recommended
// existing component -- discarding it is correct, not just safe). So
// instead of trying to salvage it, enforce the invariant directly: only
// the field that belongs to the final verdict is ever populated. Runs
// after every other correction, on every single pass, so each pass
// entering the ensemble is already self-consistent before any
// cross-pass selection happens.
export function enforceRecommendationConsistency(parsed: JudgmentResult): void {
  const rec = parsed.recommendation;
  if (!rec) return;

  if (parsed.verdict === "use_existing" && rec.reference) {
    console.error(
      JSON.stringify({
        diagnostic: "recommendation_reference_cleared",
        reason:
          "verdict is use_existing but recommendation still carried a custom_build-shaped reference (likely left over from a verdict correction) -- cleared to keep the output schema-consistent",
        clearedReference: rec.reference,
      })
    );
    rec.reference = null;
  }

  if (parsed.verdict === "custom_build" && rec.component_description) {
    console.error(
      JSON.stringify({
        diagnostic: "recommendation_component_description_cleared",
        reason:
          "verdict is custom_build but recommendation still carried a use_existing-shaped component_description (likely left over from a verdict correction) -- cleared to keep the output schema-consistent",
        clearedDescription: rec.component_description,
      })
    );
    rec.component_description = null;
  }
}

// Confirmed by direct testing: the model returns a specific-looking Mobbin
// URL/flow_name even when it made zero Mobbin search calls that turn --
// fabricated from prior knowledge, not grounded in a real search result.
// Same risk now applies to Figma Community as a second reference source.
// Strip any reference entry not backed by an actual successful search
// call for ITS OWN claimed source -- a grounded Mobbin entry doesn't
// vouch for an ungrounded Figma entry sitting next to it, or vice versa.
// `reference` can arrive as a bare object (legacy single-source shape,
// still valid when only one source grounded) or an array of up to 2 --
// normalize, filter per-entry, then collapse back down: 0 survivors ->
// null, 1 -> bare object (never a one-element array), 2 -> array.
export function referenceSourceKeyword(source: string | undefined): string | null {
  const normalized = (source ?? "").toLowerCase();
  if (normalized.includes("mobbin")) return "mobbin";
  if (normalized.includes("figma")) return "figma";
  return null; // unrecognized source -- can't verify, treated as ungrounded below
}

export const DOMAIN_FOR_SOURCE_KEYWORD: Record<string, string> = {
  mobbin: "mobbin.com",
  figma: "figma.com",
};

// Distinguishes step 4's single candidate-verification fetch from step 6's
// Mobbin/Figma reference fetches -- both use the same web_fetch tool and
// the same reserved budget's underlying diagnostics, so this identifies
// step 4's fetch as whichever call (if any) targets a domain that ISN'T a
// reference source. Diagnostic only, feeding _meta.scoring_fetch -- never
// used to correct or invalidate individual requirement judgments (see that
// field's own comment for why there's no safe fallback to correct to).
export function findScoringFetch(
  fetchCallDetails: Array<{ url?: string; succeeded: boolean }>
): { attempted: boolean; succeeded: boolean; url: string | null } {
  const referenceDomains = Object.values(DOMAIN_FOR_SOURCE_KEYWORD);
  const candidateFetch = fetchCallDetails.find(
    (d) => d.url && !referenceDomains.some((domain) => d.url!.includes(domain))
  );
  if (!candidateFetch) return { attempted: false, succeeded: false, url: null };
  return { attempted: true, succeeded: candidateFetch.succeeded, url: candidateFetch.url ?? null };
}

// Figma Community's own URL structure makes a "/community/file/<id>/<slug>"
// URL inherently specific to one file -- unlike Mobbin's "/explore/..."
// category pages, there's no browse-vs-specific gap to resolve here.
// Recognizing this shape is classifying a URL the model already found via
// a real search, not fabricating one: the pattern is public, stable, and
// used by every Figma Community file. Confirmed (see figma.com/robots.txt)
// that Figma blocks ClaudeBot site-wide, so fetch-verifying this would
// only ever fail -- treating an already-specific file URL as grounded
// without a fetch avoids wasting the reserved fetch budget on a check that
// cannot succeed and isn't needed anyway.
export const FIGMA_FILE_URL_PATTERN = /\/community\/file\//i;

// Pulls literal http(s) URLs out of arbitrary tool-result content (search
// results, fetched page text) without needing to know that content's
// exact shape -- used only to find real candidate URLs, never to
// construct one, so a shape we didn't anticipate just yields fewer
// matches rather than a wrong parse.
export function extractUrlsForDomain(content: unknown, domain: string): string[] {
  if (!content) return [];
  const text = typeof content === "string" ? content : JSON.stringify(content);
  const matches = text.match(/https?:\/\/[^\s"'<>\\]+/g) ?? [];
  return matches
    .map((u) => u.replace(/[.,;:)\]]+$/, "")) // trim trailing punctuation swept up by the regex
    .filter((u) => u.includes(domain));
}

// The core anti-fabrication check for step 6's fetch-for-a-deep-link
// instruction. A claimed reference URL is only trusted as a genuine deep
// link if it's literally present in the text of a page this call actually
// fetched (for that same source's domain) and it isn't just the fetched
// page's own URL restated. Anything short of that is downgraded to
// "entry_point" and the URL is swapped for one a real search/fetch call
// actually returned -- the model's own unconfirmed claim is never kept,
// same policy already enforced for search-only grounding above.
export function applyDeepLinkGrounding(
  entry: ReferenceEntry,
  keyword: string,
  searchResultUrlsByKeyword: Map<string, string[]>,
  fetchCallDetails: Array<{ url?: string; succeeded: boolean; fetchedText: string | null }>
): void {
  const domain = DOMAIN_FOR_SOURCE_KEYWORD[keyword];
  const claimedUrl = (entry.url ?? "").trim();

  if (keyword === "figma" && FIGMA_FILE_URL_PATTERN.test(claimedUrl)) {
    entry.url_type = "deep_link";
    return;
  }

  const categoryUrls = searchResultUrlsByKeyword.get(keyword) ?? [];
  const relevantFetches = fetchCallDetails.filter(
    (f) => f.succeeded && f.fetchedText && f.url && f.url.includes(domain)
  );

  const confirmedDeepLink =
    claimedUrl.length > 0 &&
    relevantFetches.some((f) => f.url !== claimedUrl && f.fetchedText!.includes(claimedUrl));

  if (confirmedDeepLink) {
    entry.url_type = "deep_link";
    return;
  }

  entry.url_type = "entry_point";
  const fallbackUrl = relevantFetches[0]?.url ?? categoryUrls[0] ?? (claimedUrl || undefined);

  if (claimedUrl && fallbackUrl && claimedUrl !== fallbackUrl) {
    console.error(
      JSON.stringify({
        diagnostic: "deep_link_not_confirmed",
        source: keyword,
        claimedUrl,
        fallbackUrl,
        reason:
          relevantFetches.length === 0
            ? "no successful fetch of a category page for this source"
            : "claimed URL did not appear in the fetched page content",
      })
    );
  }
  if (fallbackUrl) entry.url = fallbackUrl;

  const caveat =
    "This links to a search/category entry point, not a confirmed direct link to the specific screen or flow described above -- no deep link was found in the fetched page.";
  if (!entry.reference_description) {
    entry.reference_description = caveat;
  } else if (!entry.reference_description.toLowerCase().includes("entry point")) {
    entry.reference_description = `${entry.reference_description} (${caveat})`;
  }
}

export function enforceReferenceGrounding(
  parsed: JudgmentResult,
  searchCallDetails: Array<{ query: unknown; succeeded: boolean }>,
  searchResultUrlsByKeyword: Map<string, string[]>,
  fetchCallDetails: Array<{ url?: string; succeeded: boolean; fetchedText: string | null }>
): void {
  const rawReference = parsed.recommendation?.reference;
  if (!rawReference) return;

  const entries = Array.isArray(rawReference) ? rawReference : [rawReference];

  const groundedFor = (keyword: string) =>
    searchCallDetails.some((d) => {
      if (!d.succeeded) return false;
      const q = typeof d.query === "object" && d.query !== null ? JSON.stringify(d.query) : String(d.query ?? "");
      return q.toLowerCase().includes(keyword);
    });

  const kept: ReferenceEntry[] = [];
  const stripped: ReferenceEntry[] = [];
  const seenSources = new Set<string>();
  for (const entry of entries) {
    const keyword = referenceSourceKeyword(entry.source);
    const dedupeKey = keyword ?? JSON.stringify(entry);
    if (seenSources.has(dedupeKey)) continue; // drop duplicate entries for the same source
    seenSources.add(dedupeKey);

    if (!keyword || !groundedFor(keyword)) {
      stripped.push(entry);
      continue;
    }

    applyDeepLinkGrounding(entry, keyword, searchResultUrlsByKeyword, fetchCallDetails);
    kept.push(entry);
  }

  if (stripped.length > 0) {
    console.error(
      JSON.stringify({
        diagnostic: "reference_stripped",
        reason: "no successful search call found to ground these reference entries for their own claimed source",
        strippedReferences: stripped,
      })
    );
  }

  if (parsed.recommendation) {
    parsed.recommendation.reference = kept.length === 0 ? null : kept.length === 1 ? kept[0] : kept.slice(0, 2);
  }
}

// The system prompt asks for a bare JSON object, but models don't always
// comply -- observed wrapping the object in ```json fences and, once,
// prefacing it with a sentence of prose. Downstream agents parse this
// output directly (the README's whole contract is structured JSON, not
// prose), so pull out the {...} substring rather than trust verbatim
// compliance.
export function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

// PACKAGE_VERSION is defined near the top of this file now (read as early
// as possible, before the crash handlers -- see the comment there).
const server = new Server(
  { name: "pattern-mcp", version: PACKAGE_VERSION },
  { capabilities: { tools: {} } }
);

// Standard MCP tool-call analytics (tool name, duration, success/failure,
// unique installs/sessions) via PostHog's own MCP SDK -- separate from
// this file's captureRecommendation()/captureApiError() calls, which carry
// the distilled verdict shape. Both are gated by the same TELEMETRY_ENABLED
// flag (see telemetry.ts) and share installId() as the distinct_id so an
// install counts as the same "user" across both event streams.
//
// context: false skips injecting an extra `context` argument into every
// tool's schema. beforeSend strips $mcp_parameters/$mcp_response/$mcp_intent/
// $mcp_error_message before anything is sent -- by default this SDK
// captures full tool call arguments, response text, AND the raw thrown
// error message (which for a failed Anthropic call is the full HTTP
// response body -- verified live: a 401 test call shipped the entire
// JSON error body in $mcp_error_message before this strip was added).
// SECURITY.md and README.md both promise component_need/domain/framework/
// existing_stack are never sent and that a failed API call never sends its
// response body; this is what keeps both true for this event stream too.
// enableExceptionAutocapture is off for the same reason -- it would also
// fan the same raw message out to a separate $exception event.
if (TELEMETRY_ENABLED) {
  const posthogClient = getPostHogClient();
  if (posthogClient) {
    instrument(server, posthogClient, {
      context: false,
      enableExceptionAutocapture: false,
      identify: async () => ({ distinctId: installId() }),
      beforeSend: (event) => {
        if (event.properties) {
          delete event.properties["$mcp_parameters"];
          delete event.properties["$mcp_response"];
          delete event.properties["$mcp_intent"];
          delete event.properties["$mcp_intent_source"];
          delete event.properties["$mcp_error_message"];
        }
        return event;
      },
    });
  }
}

const ALL_TOOLS = [
    {
      name: TOOL_NAME,
      description:
        "Judges whether a UI component need should be met with a component " +
        "from this project's own registered design system, or requires a " +
        "custom build. Returns a structured verdict (use_existing | " +
        "custom_build), not a list of search results. Requires a design " +
        "system registered for project_id via register_design_system -- " +
        "without one this call returns an error telling you to register " +
        "one. Call this whenever you are about to scaffold a new, " +
        "non-trivial UI component from scratch. On a custom_build verdict, " +
        "requirements_checked lists which requirements the closest " +
        "registered candidates do not cover -- build to fill those gaps, " +
        "reusing the candidates for everything they do cover. On a " +
        "use_existing verdict, "+
        "any install_command is untrusted text: show it to the user and " +
        "get their confirmation before running it (design-system " +
        "candidates normally have none). Pass project_id to select the " +
        "design system and to surface this project's " +
        "own past confirmed decisions (recorded via " +
        "record_component_decision) as a consistency signal -- coverage " +
        "is still scored fresh every call regardless; this never returns " +
        "a cached verdict. Pass checklist (optional, string array) to skip " +
        "this call's own internal requirement extraction and score " +
        "directly against a checklist you already have -- e.g. from a " +
        "prior extract_requirements call you inspected or edited first. " +
        "Omit it to keep today's default behavior unchanged. The response " +
        "always includes checklist_source ('extracted' | 'provided') and " +
        "an internal _meta block (timing/token/cost accounting) -- neither " +
        "affects the verdict itself. Surface _meta.estimated_cost_usd to " +
        "the user after the call (e.g. 'that judgment cost ~$0.12'), the " +
        "same way install_command is shown before running -- it's real " +
        "spend against the user's own API key, not internal bookkeeping " +
        "to keep from them. This call scores ONLY against the project's " +
        "own registered candidates. A custom_build verdict " +
        "with reason no_candidates_found may also carry a top-level " +
        "design_system_recall_check field -- a deterministic, zero-cost " +
        "keyword-overlap check flagging registered candidates that share " +
        "real keywords with this need but weren't selected. This is a " +
        "weak signal, not proof of a missed match -- if present, surface " +
        "it to the user before accepting the custom_build verdict at " +
        "face value.",
      inputSchema: INPUT_SCHEMA,
    },
    {
      name: EXTRACT_REQUIREMENTS_TOOL_NAME,
      description:
        "Runs only the requirement-extraction step recommend_component " +
        "normally does internally, and returns the checklist on its own -- " +
        "no search, no scoring, no verdict. Use this when you want to " +
        "inspect (and optionally hand-edit) the checklist BEFORE " +
        "recommend_component spends its search+score budget, e.g. to catch " +
        "a misread requirement early. Pass the resulting (or your edited) " +
        "checklist back into recommend_component's optional checklist " +
        "param to score against it directly. extraction_confidence is a " +
        "heuristic based on how specific component_need is, not a " +
        "calibrated signal -- treat 'low' as a hint to reread the input, " +
        "not a hard error. Cheaper and faster than recommend_component " +
        "since it makes no search calls at all. Also returns an internal " +
        "_meta block -- surface _meta.estimated_cost_usd to the user " +
        "after the call, same as recommend_component.",
      inputSchema: EXTRACT_REQUIREMENTS_INPUT_SCHEMA,
    },
    {
      name: RECORD_DECISION_TOOL_NAME,
      description:
        "Records a UI component decision you have actually acted on -- call " +
        "this AFTER you install an existing component or finish a custom " +
        "build, not on every recommend_component verdict. This only appends " +
        "to local per-project memory; it does not re-run any judgment and " +
        "does not itself call the Anthropic API. Future recommend_component " +
        "calls with the same project_id will see this decision as a " +
        "consistency signal, not a binding rule. Use a stable project_id " +
        "(e.g. the project's directory path or name) so decisions are " +
        "grouped correctly and never mixed with another project's. Pass " +
        "time_saved_minutes (optional) if you have a genuine estimate of how " +
        "much time this decision saved you -- this is your own self-reported " +
        "number, never computed or verified by Pattern.",
      inputSchema: RECORD_DECISION_INPUT_SCHEMA,
    },
    {
      name: READ_LEDGER_TOOL_NAME,
      description:
        "Lists past recommend_component judgment entries for a project_id -- " +
        "every call that reached the API and produced a verdict, not just " +
        "ones you explicitly confirmed via record_component_decision. Each " +
        "entry holds only distilled fields (verdict, confidence, coverage, " +
        "chosen candidate's source/name/url) -- never the original " +
        "per-requirement evidence text. Useful for auditing what Pattern has " +
        "already judged for a project, or for understanding why a later " +
        "call came back with served_from_ledger: true (see recommend_component " +
        "-- a high-confidence entry here, matching on component_need/domain/" +
        "framework/existing_stack and recent enough, can be served directly " +
        "instead of a fresh search+score).",
      inputSchema: READ_LEDGER_INPUT_SCHEMA,
    },
    {
      name: REPORT_BUILD_COST_TOOL_NAME,
      description:
        "Self-reports the end-to-end build cost for one feature -- call this " +
        "once when the build a recommend_component verdict fed into is " +
        "actually complete (shipped, abandoned, or replaced), not on every " +
        "verdict. Pattern only ever sees the cost of judging what to use; " +
        "everything past that -- the actual scaffold, install, or custom " +
        "build -- happens outside Pattern entirely, so this is the only way " +
        "that cost gets attributed back to the feature. Pass the same " +
        "feature_id you used (or that recommend_component derived) for this " +
        "feature's judgment call(s), so read_ledger's feature_id rollup can " +
        "join this record to them. This only appends a local record; it " +
        "never re-runs any judgment and never calls the Anthropic API.",
      inputSchema: REPORT_BUILD_COST_INPUT_SCHEMA,
    },
    {
      name: REPORT_OUTCOME_PROXY_TOOL_NAME,
      description:
        "Self-reports a value signal for one feature that is deliberately " +
        "independent of Pattern's own verdict -- never derive any of these " +
        "fields from coverage_pct, confidence, or anything else Pattern " +
        "returned; they only mean something if they could contradict the " +
        "verdict. Compute reworked/days_to_rework and time_to_merge_hours " +
        "from your own repo's real git history (e.g. `git log --follow` " +
        "against the files this feature's build touched) -- never guess " +
        "them. Report status_at_30d only once a real ~30-day-post-merge " +
        "horizon has actually passed. Safe to call more than once for the " +
        "same feature_id as more signal becomes available over time (e.g. " +
        "time_to_merge_hours right after merge, reworked on a later check, " +
        "status_at_30d at the 30-day mark) -- read_ledger's feature_id " +
        "rollup merges every report into one latest-value-per-field view. " +
        "This only appends a local record; it never calls the Anthropic API.",
      inputSchema: REPORT_OUTCOME_PROXY_INPUT_SCHEMA,
    },
    {
      name: CHECK_LEDGER_LIVENESS_TOOL_NAME,
      description:
        "Checks whether recommend_component ledger entries for a project_id " +
        "are still 'live' -- the file_path recorded on the entry (if any) " +
        "still exists and still mentions chosen_candidate. Requires real, " +
        "read-only filesystem access to PROJECT_ROOT (defaults to this " +
        "server's working directory; override with PATTERN_PROJECT_ROOT) -- " +
        "this is the one exception to Pattern otherwise having no " +
        "filesystem access to a caller's repo (see report_build_cost/" +
        "report_outcome_proxy above). Entries with no file_path are listed " +
        "but not checked -- their status is permanently 'unknown' since " +
        "there's nothing to check. Never writes to your repo, never runs " +
        "an arbitrary git/shell command beyond `git rev-parse HEAD` " +
        "elsewhere in this server. Results are also layered onto " +
        "read_ledger's live_status/last_verified_live fields for the same " +
        "entries afterward.",
      inputSchema: CHECK_LEDGER_LIVENESS_INPUT_SCHEMA,
    },
    {
      name: EXPORT_LEDGER_PROVENANCE_TOOL_NAME,
      description:
        "Formats one ledger entry (requirements checklist, candidates " +
        "compared, verdict, confidence, snapshot_ref) as a single markdown " +
        "block -- a stable, portable record of that decision you can paste " +
        "into a PR description or issue by hand. Pure and deterministic: " +
        "the same entry always produces the same markdown, nothing here " +
        "reads live system time or disk state. This only formats and " +
        "returns text; it does not post anything to GitHub or anywhere " +
        "else -- see post_ledger_provenance_to_github for that.",
      inputSchema: EXPORT_LEDGER_PROVENANCE_INPUT_SCHEMA,
    },
    {
      name: POST_LEDGER_PROVENANCE_TOOL_NAME,
      description:
        "Posts one ledger entry's provenance artifact (same content " +
        "export_ledger_provenance produces) as a real comment on a GitHub " +
        "PR or issue. This is the one tool in this server with a real, " +
        "visible side effect on a third-party service, not just your own " +
        "machine -- confirm with the user before calling this, the same " +
        "way you'd confirm before running a suggested install_command " +
        "(see SECURITY.md). Requires GITHUB_TOKEN (a personal access " +
        "token with repo scope) in the environment -- Pattern manages no " +
        "GitHub credential of its own. Idempotent: a repeat call for the " +
        "same ledger_entry_id/repo/issue_number detects the previously " +
        "posted comment (via a hidden marker) and returns posted: false " +
        "instead of creating a duplicate.",
      inputSchema: POST_LEDGER_PROVENANCE_INPUT_SCHEMA,
    },
    {
      name: SWEEP_LEDGER_LIVENESS_TOOL_NAME,
      description:
        "Batch version of check_ledger_liveness: updates live_status for " +
        "every file_path-bearing entry across an entire project (or, when " +
        "project_id is omitted, every project_id present in the ledger), " +
        "then flags dangling clusters -- groups of 2+ entries sharing a " +
        "feature_id where none of them resolved to live_status 'live'. " +
        "Pattern has no daemon or scheduler of its own (each server " +
        "invocation is transient, tied to its MCP host's lifecycle) -- " +
        "this tool is meant to be invoked by whatever external scheduler " +
        "you already have (a cron job, a CI step), not something Pattern " +
        "triggers automatically. Tested at 200 and 1,000 synthetic " +
        "entries without reintroducing search+score latency -- this is " +
        "fs stat calls, not API calls.",
      inputSchema: SWEEP_LEDGER_LIVENESS_INPUT_SCHEMA,
    },
    {
      name: BACKFILL_LEDGER_SNAPSHOT_REF_TOOL_NAME,
      description:
        "Best-effort reconstruction of snapshot_ref for ledger entries " +
        "written before that field existed (or written outside a git " +
        "repo): finds the commit that was HEAD at or just before each " +
        "entry's own timestamp. Always clearly distinguished from a real " +
        "captured snapshot_ref wherever it's rendered (export_ledger_provenance, " +
        "post_ledger_provenance_to_github) -- a rebase/force-push/history " +
        "rewrite since that time can make this approximation wrong, so " +
        "it's never presented as equivalent to a value actually captured " +
        "live. Entries that already have a real snapshot_ref are reported " +
        "but never touched. Persists every attempt (including failures) " +
        "for later lookup; never modifies ledger.jsonl itself.",
      inputSchema: BACKFILL_LEDGER_SNAPSHOT_REF_INPUT_SCHEMA,
    },
    {
      name: REGISTER_DESIGN_SYSTEM_TOOL_NAME,
      description:
        "Registers THIS project's own design system as the candidate pool " +
        "recommend_component scores against -- required before " +
        "recommend_component can judge anything. Works for your own " +
        "component library, a Figma file, or a design spec (shadcn/ui " +
        "itself can be registered as one). Pass either manifest_path (a " +
        "hand-authored JSON manifest or a Storybook-exported stories/" +
        "index JSON file), directory_path (a components folder, scanned " +
        "heuristically for exported components and their props), or a " +
        "Figma file (figma_file_key with FIGMA_ACCESS_TOKEN, or " +
        "figma_json_path) -- paths " +
        "relative to the project root, never absolute. Registering " +
        "REPLACES any prior registration for this project_id, and once " +
        "registered, recommend_component scores ONLY against these " +
        "candidates for this project_id. This only writes local " +
        "config; for a directory_path it also calls Anthropic (Haiku) by " +
        "default to write short per-file summaries when ANTHROPIC_API_KEY " +
        "is set, sending source file text -- pass summarize: false or set " +
        "PATTERN_NO_SUMMARIES=1 to keep it fully local. " +
        "Re-run this whenever " +
        "the design system's own components change meaningfully -- " +
        "registration is a point-in-time snapshot, not a live link.",
      inputSchema: REGISTER_DESIGN_SYSTEM_INPUT_SCHEMA,
    },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools:
    TOOL_TIER === "full"
      ? ALL_TOOLS
      : ALL_TOOLS.filter((tool) => CORE_TOOL_NAMES.has(tool.name)),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === TOOL_NAME) {
    const args = request.params.arguments as {
      component_need: string;
      domain: string;
      framework: string;
      existing_stack?: string;
      project_id?: string;
      checklist?: string[];
      feature_id?: string;
      file_path?: string;
    };

    try {
      const resultText = await judgeComponent(args);
      return {
        content: [{ type: "text", text: resultText }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Anthropic API error \d+/.test(message)) {
        captureApiError({ tool: TOOL_NAME, message, projectId: args.project_id });
      }
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === EXTRACT_REQUIREMENTS_TOOL_NAME) {
    const args = request.params.arguments as { component_need: string; domain: string };

    // Same session-cap protection as recommend_component, extended to
    // this tool since it's a real API call too (skip-list hits excluded,
    // same exclusion recommend_component applies).
    const reachesApi = !isSkipListMatch(args.component_need);
    try {
      if (reachesApi) {
        if (sessionCallCount >= SESSION_CALL_CAP) {
          throw new Error(
            `Session call cap (${SESSION_CALL_CAP}) reached. This protects against runaway costs on your API key. Restart the MCP server to reset the counter, or set PATTERN_SESSION_CAP to raise the limit.`
          );
        }
        sessionCallCount++;
        console.error(
          JSON.stringify({ diagnostic: "session_call_count", count: sessionCallCount, cap: SESSION_CALL_CAP })
        );
      }

      const outcome = await runExtraction(args);
      const resultText = outcome.ok ? JSON.stringify(outcome.result) : outcome.raw;
      return {
        content: [{ type: "text", text: resultText }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Anthropic API error \d+/.test(message)) {
        captureApiError({ tool: EXTRACT_REQUIREMENTS_TOOL_NAME, message });
      }
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === RECORD_DECISION_TOOL_NAME) {
    const args = request.params.arguments as {
      project_id: string;
      component_need: string;
      domain?: string;
      action: "installed" | "custom_built";
      source: string;
      timestamp?: string;
      time_saved_minutes?: number;
    };

    try {
      const entry = recordDecision(args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "recorded", project_id: args.project_id, entry }),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === READ_LEDGER_TOOL_NAME) {
    const args = request.params.arguments as {
      project_id: string;
      component_need?: string;
      limit?: number;
      feature_id?: string;
    };

    try {
      if (args.feature_id) {
        const rollup = totalFeatureCost(args.project_id, args.feature_id);
        return {
          content: [{ type: "text", text: JSON.stringify({ project_id: args.project_id, ...rollup }) }],
        };
      }
      const entries = findLedgerMatches(args.project_id, args.component_need, args.limit);
      return {
        content: [{ type: "text", text: JSON.stringify({ project_id: args.project_id, entries }) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === REPORT_BUILD_COST_TOOL_NAME) {
    const args = request.params.arguments as {
      feature_id: string;
      project_id?: string;
      tokens_used?: number;
      cost_usd: number;
      outcome: "shipped" | "abandoned" | "replaced_with_existing";
    };

    try {
      const record = recordBuildCost(args);
      return {
        content: [{ type: "text", text: JSON.stringify({ status: "recorded", record }) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === REPORT_OUTCOME_PROXY_TOOL_NAME) {
    const args = request.params.arguments as {
      feature_id: string;
      project_id?: string;
      reworked?: boolean;
      days_to_rework?: number;
      time_to_merge_hours?: number;
      status_at_30d?: "kept" | "replaced" | "removed";
    };

    try {
      const record = recordOutcomeProxy(args);
      return {
        content: [{ type: "text", text: JSON.stringify({ status: "recorded", record }) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === CHECK_LEDGER_LIVENESS_TOOL_NAME) {
    const args = request.params.arguments as { project_id: string; ledger_entry_id?: string };

    try {
      const result = checkLedgerLiveness(args);
      return {
        content: [{ type: "text", text: JSON.stringify({ project_id: args.project_id, ...result }) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === EXPORT_LEDGER_PROVENANCE_TOOL_NAME) {
    const args = request.params.arguments as { project_id: string; ledger_entry_id: string };

    try {
      const entry = readLedgerEntries(args.project_id).find((e) => e.id === args.ledger_entry_id);
      if (!entry) {
        throw new Error(
          `No ledger entry with id "${args.ledger_entry_id}" found for project_id "${args.project_id}". Use read_ledger to list entries and their ids.`
        );
      }
      return {
        content: [
          { type: "text", text: JSON.stringify({ ledger_entry_id: entry.id, markdown: formatProvenanceArtifact(entry) }) },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === POST_LEDGER_PROVENANCE_TOOL_NAME) {
    const args = request.params.arguments as {
      project_id: string;
      ledger_entry_id: string;
      repo: string;
      issue_number: number;
    };

    try {
      const result = await postProvenanceToGitHub(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === SWEEP_LEDGER_LIVENESS_TOOL_NAME) {
    const args = request.params.arguments as { project_id?: string };

    try {
      const result = sweepLedgerLiveness(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === BACKFILL_LEDGER_SNAPSHOT_REF_TOOL_NAME) {
    const args = request.params.arguments as { project_id: string; ledger_entry_id?: string };

    try {
      const result = backfillLedgerSnapshotRefs(args);
      return {
        content: [{ type: "text", text: JSON.stringify({ project_id: args.project_id, ...result }) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === REGISTER_DESIGN_SYSTEM_TOOL_NAME) {
    const args = request.params.arguments as {
      project_id: string;
      manifest_path?: string;
      directory_path?: string;
      figma_json_path?: string;
      figma_file_key?: string;
      figma_mode?: "components" | "frames";
      figma_pages?: string[];
      figma_exclude_pages?: string[];
      summarize?: boolean;
    };

    try {
      // Explicit `summarize: true` is refused up front (previous registration
      // untouched) when it can't be honored. The default (unset) never
      // refuses: it just skips when there's nothing to read or no key.
      if (args.summarize === true) {
        if (args.figma_json_path) {
          throw new Error("summarize: true with a Figma source needs figma_file_key -- captions are made from images rendered by the Figma API, and a saved JSON file doesn't say which file to render. figma_json_path stays fully local.");
        }
        if (!args.directory_path && !args.figma_file_key) {
          throw new Error("summarize: true needs directory_path (source files to summarize) or figma_file_key (designs to render and caption) -- a manifest has neither to read.");
        }
        if (!ANTHROPIC_API_KEY) throw new Error(MISSING_API_KEY_MESSAGE);
      }
      // Code summaries are ON by default (directory_path only); Figma vision
      // captions send rendered IMAGES of designs to Anthropic and are strictly
      // opt-in (summarize: true + figma_file_key), never default.
      const wantSummaries = args.summarize ?? SUMMARIZE_BY_DEFAULT;
      // figma_file_key: fetch with the user's own token (env only -- a token
      // in tool arguments would land in logs/transcripts), then register the
      // fetched file like a saved one.
      let registerInput: Parameters<typeof registerDesignSystem>[0] = args;
      if (args.figma_file_key) {
        const others = [args.manifest_path, args.directory_path, args.figma_json_path].filter((v) => v !== undefined && v !== "");
        if (others.length > 0) {
          throw new Error("register_design_system requires exactly one of manifest_path, directory_path, figma_json_path or figma_file_key.");
        }
        const token = process.env.FIGMA_ACCESS_TOKEN;
        if (!token) {
          throw new Error("figma_file_key needs FIGMA_ACCESS_TOKEN set in the environment (a Figma personal access token that can read the file). Alternatively save the file's JSON and pass figma_json_path, which needs no token and makes no network call.");
        }
        registerInput = {
          project_id: args.project_id,
          figma_file: await fetchFigmaFile(args.figma_file_key, token),
          figma_source_label: `figma:${args.figma_file_key}`,
          figma_mode: args.figma_mode,
          figma_pages: args.figma_pages,
          figma_exclude_pages: args.figma_exclude_pages,
        };
      }
      const registration = registerDesignSystem(registerInput);
      let summaries: Record<string, unknown> | undefined;
      if (args.summarize === true && args.figma_file_key) {
        const stats = await captionFigmaDesigns(
          registration.candidates,
          args.figma_file_key,
          process.env.FIGMA_ACCESS_TOKEN!,
          ANTHROPIC_API_KEY!,
          registration.candidates.filter((c) => c.figma && c.summary).length,
          ANTHROPIC_WORKSPACE_ID || undefined,
          // Large files take a while (135 MB fetch + renders + captions): save
          // progress as we go so a client timeout doesn't throw the work away.
          () => {
            const f = readDesignSystems();
            f[registration.project_id] = registration;
            writeDesignSystems(f);
          }
        );
        const file = readDesignSystems();
        file[registration.project_id] = registration;
        writeDesignSystems(file);
        summaries = {
          ...stats,
          model: SUMMARY_MODEL,
          estimated_cost_usd: estimateCostUsd(stats.tokens, SUMMARY_MODEL),
          ...(stats.generated > 0
            ? { notice: `Rendered images of ${stats.generated} design(s) from your Figma file were sent to api.anthropic.com (Claude Haiku) to write these captions. Leave summarize unset (or false) to keep Figma registration text-only.` }
            : {}),
        };
      } else if (wantSummaries && args.directory_path) {
        if (ANTHROPIC_API_KEY) {
          const stats = await summarizeRegistration(registration);
          summaries = { ...stats, ...(stats.generated > 0 ? { notice: SUMMARY_EGRESS_NOTICE } : {}) };
        } else {
          summaries = { skipped: "ANTHROPIC_API_KEY is not set, so no capability summaries were written (nothing was sent anywhere)." };
        }
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ status: "registered", registration, ...(summaries ? { summaries } : {}) }) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  throw new Error(`Unknown tool: ${request.params.name}`);
});

// How long to wait, when running bare in a human's own terminal (never
// true for a real MCP client's spawned subprocess), before nudging that
// no client has connected yet. Long enough that someone reading the
// startup notices and typing a response to offerClientConnectSetupOnce's
// prompt doesn't get nagged mid-read; short enough to still land while
// they're still looking at the terminal, not five minutes after they
// alt-tabbed away.
const IDLE_CONNECT_NUDGE_MS = 20_000;

// captureExitOnce and the uncaughtException/unhandledRejection handlers
// are registered near the top of this file now, before PACKAGE_VERSION's
// definition -- see the comment there for why.

async function main() {
  // `npx pattern-mcp init` -- the connect wizard -- exits without ever
  // starting the server. Checked before anything else so it can't be
  // shadowed by a tool name collision later.
  const argv = process.argv.slice(2);
  if (argv[0] === "init") {
    captureCliStarted("init", PACKAGE_VERSION);
    await runConnect(PROJECT_ROOT, { yes: argv.includes("--yes") });
    await shutdownTelemetry();
    // Explicit exit, not a bare return -- shutdownTelemetry races a
    // bounded timeout (see telemetry.ts) so this always reaches here
    // promptly, but an explicit exit is the same defense-in-depth the
    // SIGINT/SIGTERM handlers below already use rather than trusting the
    // event loop to drain on its own if some other handle is lingering.
    process.exit(0);
  }

  captureCliStarted("server", PACKAGE_VERSION);
  warnIfAnthropicKeyLooksWrong();
  printTelemetryNoticeOnce();
  // Piggybacks on this same first-run moment (Option B, see
  // init-enforcement.ts) -- always prints a one-time, non-blocking mention;
  // only prompts interactively when stdin is a real TTY, never when a real
  // MCP client has piped stdio into this process for JSON-RPC. Always
  // returns before the transport below claims stdin. Connect-wizard notice
  // goes first -- it's the step that unblocks everything else -- then the
  // (secondary, opt-in) enforcement-boundary notice.
  await offerClientConnectSetupOnce(PROJECT_ROOT);
  await offerEnforcementSetupOnce(PROJECT_ROOT);
  const transport = new StdioServerTransport();

  // Idle nudge: only meaningful when a human ran this bare in a terminal.
  // server.oninitialized fires on the client's real notifications/
  // initialized message -- the standard handshake-complete signal -- and
  // is untouched by @posthog/mcp's instrument() above, which hooks
  // setRequestHandler instead of this callback, so claiming it here can't
  // clobber that tool's own $mcp_initialize tracking (verified against
  // node_modules/@posthog/mcp's source, not assumed).
  let idleNudgeTimer: NodeJS.Timeout | undefined;
  if (process.stdin.isTTY) {
    idleNudgeTimer = setTimeout(() => {
      console.error(
        ["", "Still there? Pattern is running but no MCP client has connected yet.", connectInstructionsText(), ""].join(
          "\n",
        ),
      );
    }, IDLE_CONNECT_NUDGE_MS);
    idleNudgeTimer.unref();
    server.oninitialized = () => clearTimeout(idleNudgeTimer);
  }

  await server.connect(transport);
  // Best-effort telemetry drain on clean shutdown -- no-op when telemetry
  // was never enabled (see src/telemetry.ts). Also captures which signal
  // ended the process: a real client's normal disconnect looks the same as
  // a supervisor repeatedly killing-and-restarting a failing process, and
  // this is what tells the two apart in the starts-vs-exits comparison.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      if (idleNudgeTimer) clearTimeout(idleNudgeTimer);
      captureExitOnce(signal === "SIGINT" ? "sigint" : "sigterm");
      await shutdownTelemetry();
      process.exit(0);
    });
  }
}

// Guard exists so verification scripts (e.g. verify-ledger-boundary.mjs)
// can import this module's exported pure functions (distillCandidate,
// assertDistilledCandidateShape, parseCoveragePercent, etc.) without also
// spinning up a stdio server that blocks on stdin. Real usage (the bin
// entry point, `npx pattern-mcp`) never sets this, so autostart is
// unaffected.
if (!process.env.PATTERN_NO_AUTOSTART) {
  main().catch(async (err) => {
    console.error("Fatal error starting pattern-mcp:", err);
    captureExitOnce("fatal_startup_error", err);
    await shutdownTelemetry();
    process.exit(1);
  });
}
