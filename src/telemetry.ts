/**
 * Anonymous product telemetry.
 *
 * On by default. Disabling it (PATTERN_TELEMETRY=0) turns off both halves
 * described below. It answers two questions the product can't answer any
 * other way without asking users directly:
 *
 *  - Do people come back and use Pattern on a second or third project on
 *    their own, unprompted? (tracked via distinct project hashes seen per
 *    anonymous install, on every recommend_component call)
 *  - How often does a BYO Anthropic key actually run dry or get rate
 *    limited in real sessions, not just the one time it happened during
 *    manual testing? (tracked via captureApiError)
 *
 * There are two halves to what ships, both gated by the same flag:
 *
 *  1. This file's own capture() calls: an anonymous, randomly generated
 *     install ID (see installId() below); a one-way SHA-256 hash of
 *     project_id, truncated to 16 hex chars -- never the raw project_id
 *     string; the verdict shape already written to the local call log
 *     (verdict, confidence, ensemble_triggered, estimated cost); on a
 *     failed Anthropic API call, only the HTTP status and a coarse error
 *     classification (rate_limit / insufficient_credit / other) -- never
 *     the request or response body; and, on every invocation of the
 *     binary, a single `pattern_cli_started` event carrying only which
 *     mode it ran in (`server` or `init`) -- see captureCliStarted below.
 *  2. `@posthog/mcp`'s standard MCP instrumentation, wired up in index.ts:
 *     tool name, call duration, error/success, and the same anonymous
 *     install ID as the distinct_id (via its `identify` option), so both
 *     halves count the same "user." Its `beforeSend` hook strips
 *     `$mcp_parameters`, `$mcp_response`, and `$mcp_intent`/
 *     `$mcp_intent_source` before anything leaves the process -- those
 *     would otherwise carry tool call arguments and output text.
 *
 * component_need text, requirements_checked evidence, and the API key
 * itself are never sent, by either half. See SECURITY.md and README.md for
 * the full disclosure and how to opt out.
 *
 * Manual/ad-hoc test sessions (a one-off MCP client run by hand while
 * debugging, not a checked-in script) should set PATTERN_TELEMETRY=0 before
 * connecting -- there's no way for this file to distinguish that from real
 * usage on its own, and self-testing was previously showing up as if it
 * were adoption (see project_pattern_activation_funnel memory: roughly half
 * of all recorded handshakes turned out to be internal test/smoke-test
 * clients). Checked-in test scripts (e.g. scripts/test-client.mjs) default
 * this off already.
 *
 * Reuses Pattern's existing PostHog project (the same one the marketing
 * site sends browser events to) with its public, write-only project key --
 * safe to embed in a distributed package the same way that key is already
 * embedded in the site's client bundle. CLI events are namespaced with a
 * "pattern_cli_" event prefix and source: "cli" so they're never confused
 * with website traffic in queries or dashboards.
 */

import { PostHog } from "posthog-node";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Opt-out, not opt-in. Previously opt-in; changed because opt-in meant
// near-zero real signal in practice (installs happened, but almost no one
// ever set the env var) -- see the one-time notice below, which is the
// disclosure mechanism that replaces an interactive consent prompt for a
// stdio MCP server. Any of "0", "false", "no" (case-insensitive) turns it
// off; anything else, including unset, leaves it on.
export const TELEMETRY_ENABLED = !/^(0|false|no)$/i.test(process.env.PATTERN_TELEMETRY ?? "");

// One-time startup notice, printed to stderr -- the closest thing to an
// opt-in prompt an MCP stdio server can safely show. stdin is the JSON-RPC
// channel the client uses to talk to this process; blocking on it to read
// a y/n keypress would fight the protocol handshake instead of showing a
// dialog, so there's no safe way to do an interactive prompt here. This
// prints once ever (gated by TELEMETRY_NOTICE_PATH, not by whether this is
// a fresh install), so someone who installed Pattern before telemetry
// existed sees it exactly once on their first run after upgrading, the
// same as a brand-new install does on its first run ever. Call from
// main() at startup -- never from inside a tool call, so it can't be
// mistaken for a response to the calling agent.
export function printTelemetryNoticeOnce(): void {
  try {
    readFileSync(TELEMETRY_NOTICE_PATH, "utf8");
    return; // Already shown -- never repeat.
  } catch {
    // No marker yet -- fall through and show it.
  }

  const status = TELEMETRY_ENABLED
    ? "ON (the default)"
    : "OFF, because PATTERN_TELEMETRY is set to 0/false/no";

  console.error(
    [
      "",
      "Pattern -- one-time telemetry notice (this will not print again)",
      `Anonymous usage telemetry is currently ${status}.`,
      "",
      "When on, Pattern sends an anonymous per-install ID, a one-way hash",
      "of project_id (never the raw string), the same verdict summary",
      "already written to ~/.pattern/calls.log (verdict, confidence,",
      "reason, estimated cost), a single startup event noting whether this",
      "run is the server or the `init` wizard, and standard MCP tool-call",
      "analytics (tool name, duration, success/failure) via PostHog's MCP",
      "SDK. Tool call arguments and responses are stripped before sending",
      "-- component_need, domain, framework, existing_stack, and your API",
      "key are never sent.",
      "Full field list: https://github.com/donaldrichard19-LVD/pattern-mcp#telemetry",
      "",
      "To opt out: PATTERN_TELEMETRY=0",
      "Already off and want it back on? Unset PATTERN_TELEMETRY (or set it to 1).",
      "",
    ].join("\n")
  );

  try {
    mkdirSync(dirname(TELEMETRY_NOTICE_PATH), { recursive: true });
    writeFileSync(TELEMETRY_NOTICE_PATH, new Date().toISOString(), "utf8");
  } catch {
    // Couldn't persist the marker -- worst case this prints again next
    // run. Never blocks startup or a tool call over it.
  }
}

// Public PostHog project API key (phc_...). Write-only: it can send events,
// it cannot read or query data back, so it's safe to ship in source the
// same way it's already shipped in the marketing site's client bundle.
// Override for self-hosting or testing against a different project.
const POSTHOG_KEY =
  process.env.PATTERN_POSTHOG_KEY ?? "phc_yUq5SpVfS9JxMm6QgFAYAfwzszAvbHQQsdN4xAqqJt3U";
const POSTHOG_HOST = process.env.PATTERN_POSTHOG_HOST ?? "https://us.i.posthog.com";

const INSTALL_ID_PATH =
  process.env.PATTERN_INSTALL_ID_PATH ?? join(homedir(), ".pattern", "install_id");

// Marker for the one-time startup notice below -- deliberately a separate
// file from install_id, not reused as an existence check. install_id gets
// created the moment ANY telemetry function runs (including a disabled
// no-op path in some future refactor); this marker exists purely to answer
// "has this specific human seen the notice yet," so it's written only from
// printTelemetryNoticeOnce itself.
const TELEMETRY_NOTICE_PATH =
  process.env.PATTERN_TELEMETRY_NOTICE_PATH ?? join(homedir(), ".pattern", "telemetry_notice_shown");

let cachedInstallId: string | undefined;

// Stable per-install anonymous ID, generated once and persisted locally --
// the distinct_id every telemetry event is keyed by. This is what makes
// "same install, second project" observable at all; without it every event
// would look like a brand-new anonymous user. Never derived from anything
// that identifies a person or machine (no hostname, no MAC, no username) --
// purely a random UUID with no way to reverse it to an identity.
export function installId(): string {
  if (cachedInstallId) return cachedInstallId;
  try {
    cachedInstallId = readFileSync(INSTALL_ID_PATH, "utf8").trim();
    if (cachedInstallId) return cachedInstallId;
  } catch {
    // No file yet -- fall through and create one.
  }
  cachedInstallId = randomUUID();
  try {
    mkdirSync(dirname(INSTALL_ID_PATH), { recursive: true });
    writeFileSync(INSTALL_ID_PATH, cachedInstallId, "utf8");
  } catch {
    // Couldn't persist (e.g. read-only home dir) -- still usable for this
    // process's lifetime, just won't be stable across restarts. Telemetry
    // is best-effort by design; this never blocks a tool call.
  }
  return cachedInstallId;
}

// One-way hash so a project_id string (which may be a real repo/project
// name someone doesn't want sent anywhere) never leaves the machine in
// readable form, while still letting the same project produce the same
// hash every time -- which is exactly what's needed to count distinct
// projects per install without ever seeing what those projects are named.
export function hashProjectId(projectId: string): string {
  return createHash("sha256").update(projectId).digest("hex").slice(0, 16);
}

export type ApiErrorType = "rate_limit" | "insufficient_credit" | "other";

// Classifies a thrown Anthropic API error by status code and the coarse
// shape of the error body, without ever inspecting or forwarding the body
// itself. Matches the two failure modes called out in the product brief's
// Risks section (§06): a key that's out of money, and rate limiting.
export function classifyApiError(message: string): { type: ApiErrorType; status: number | null } {
  const statusMatch = message.match(/Anthropic API error (\d+)/);
  const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : null;

  if (status === 429) return { type: "rate_limit", status };
  if (status === 400 && /credit balance|insufficient/i.test(message)) {
    return { type: "insufficient_credit", status };
  }
  return { type: "other", status };
}

let client: PostHog | undefined;

// Exported so index.ts's @posthog/mcp instrument() call shares this same
// client/project instead of standing up a second PostHog connection --
// same reason both halves share installId() as their distinct_id.
export function getClient(): PostHog | undefined {
  if (!TELEMETRY_ENABLED || !POSTHOG_KEY) return undefined;
  if (!client) {
    client = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      // Low volume, long-lived process (an MCP server, not a batch job) --
      // flush promptly rather than buffering, so an event isn't silently
      // lost if the server process is killed shortly after a call.
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}

// Fire-and-forget by design: telemetry must never be able to slow down or
// break a tool call. Every failure path here is swallowed, not surfaced --
// including "telemetry is disabled," which is the common case.
function capture(event: string, properties: Record<string, unknown>): void {
  const posthog = getClient();
  if (!posthog) return;
  try {
    posthog.capture({
      distinctId: installId(),
      event,
      properties: { ...properties, source: "cli" },
    });
  } catch {
    // Never let a telemetry failure affect the tool call it's attached to.
  }
}

export function captureRecommendation(args: {
  projectId?: string;
  verdict?: string;
  confidence?: string;
  reason?: string;
  ensembleTriggered?: boolean;
  estimatedCostUsd?: number | null;
  servedFromLedger?: boolean;
}): void {
  capture("pattern_cli_recommend_component", {
    project_hash: args.projectId ? hashProjectId(args.projectId) : null,
    verdict: args.verdict ?? null,
    confidence: args.confidence ?? null,
    reason: args.reason ?? null,
    ensemble_triggered: args.ensembleTriggered ?? false,
    estimated_cost_usd: args.estimatedCostUsd ?? null,
    served_from_ledger: args.servedFromLedger ?? false,
  });
}

// Fires once per process invocation, immediately at startup, before the
// stdio transport connects and before either first-run notice prints.
// Distinct from @posthog/mcp's $mcp_initialize (which only fires once a
// real MCP client completes the JSON-RPC handshake): this fires for
// every real execution of the binary, including a bare `npx pattern-mcp`
// run in a terminal that never gets wired into a client, and the `init`
// subcommand. Exists to measure the gap between "npm registered a
// download" (includes scanner/mirror traffic that never runs the code at
// all) and "someone actually ran this" -- see
// project_pattern_reddit_launch_spike memory for why that gap mattered:
// a 2026-09-11 download spike showed almost no matching $mcp_initialize
// growth, and there was no signal at all for the step in between.
export function captureCliStarted(mode: "server" | "init"): void {
  capture("pattern_cli_started", { mode });
}

export type CliExitReason =
  | "clean"
  | "sigint"
  | "sigterm"
  | "uncaught_exception"
  | "unhandled_rejection"
  | "fatal_startup_error";

// Paired with captureCliStarted so a start with no matching handshake is
// diagnosable instead of silent -- added after a 2026-09-13 incident where
// 33 starts in one hour produced exactly 1 successful handshake, and
// telemetry had no way to say why the other 32 processes ended (see
// project_pattern_activation_funnel memory). Only a coarse reason and the
// thrown value's constructor name travel -- never the error message or
// stack, which could contain a file path, a stray argument value, or other
// local detail never sent by design (see this file's header).
export function captureCliExited(reason: CliExitReason, err?: unknown): void {
  capture("pattern_cli_exited", {
    exit_reason: reason,
    error_name: err instanceof Error ? err.name : null,
  });
}

export function captureApiError(args: { tool: string; message: string; projectId?: string }): void {
  const { type, status } = classifyApiError(args.message);
  capture("pattern_cli_api_error", {
    tool: args.tool,
    error_type: type,
    status_code: status,
    project_hash: args.projectId ? hashProjectId(args.projectId) : null,
  });
}

// How long shutdown will wait for a final flush before giving up.
// Verified directly (not assumed): with an unreachable PostHog host,
// posthog-node's client.shutdown() does not reject or time out on its
// own -- it hung well past 8s in a real test (an unroutable/blocked port
// looks like a stalled TCP connect, not an instant refusal). Without this
// race, every caller of shutdownTelemetry -- the SIGINT/SIGTERM handlers
// below AND the `init` wizard's normal exit path -- would hang
// indefinitely on a restricted network instead of exiting, directly
// contradicting this function's own "best-effort, never blocks" purpose.
const SHUTDOWN_TIMEOUT_MS = 2000;

// Best-effort drain on clean shutdown so the last event(s) of a session
// aren't dropped. Safe to call even when telemetry was never enabled.
// Always resolves within SHUTDOWN_TIMEOUT_MS regardless of network state.
export async function shutdownTelemetry(): Promise<void> {
  if (!client) return;
  try {
    await Promise.race([
      client.shutdown(),
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS).unref()),
    ]);
  } catch {
    // Ignore -- process is exiting either way.
  }
}
