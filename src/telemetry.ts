/**
 * Opt-in, anonymous product telemetry.
 *
 * Off by default. Enabling it (PATTERN_TELEMETRY=1) answers two questions
 * the product can't answer any other way without asking users directly:
 *
 *  - Do people come back and use Pattern on a second or third project on
 *    their own, unprompted? (tracked via distinct project hashes seen per
 *    anonymous install, on every recommend_component call)
 *  - How often does a BYO Anthropic key actually run dry or get rate
 *    limited in real sessions, not just the one time it happened during
 *    manual testing? (tracked via captureApiError)
 *
 * What gets sent, when enabled: an anonymous, randomly generated install
 * ID (see installId() below); a one-way SHA-256 hash of project_id,
 * truncated to 16 hex chars -- never the raw project_id string; the verdict
 * shape already written to the local call log (verdict, confidence,
 * ensemble_triggered, estimated cost); and, on a failed Anthropic API call,
 * only the HTTP status and a coarse error classification (rate_limit /
 * insufficient_credit / other) -- never the request or response body.
 * component_need text, requirements_checked evidence, and the API key
 * itself are never sent. See SECURITY.md and README.md for the full
 * disclosure and the exact opt-in instructions.
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

// Opt-in, not opt-out -- deliberate, given who this tool is for. See
// README's telemetry section: a local-first tool aimed at developers who
// notice and care about silent tracking is exactly the audience §06 of the
// product brief already flags as sensitive to "no paper trail" trust gaps.
// Any of "1", "true", "yes" (case-insensitive) turns it on.
const TELEMETRY_ENABLED = /^(1|true|yes)$/i.test(process.env.PATTERN_TELEMETRY ?? "");

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
    ? "ON, because PATTERN_TELEMETRY is set"
    : "OFF (the default -- nothing is sent unless you opt in)";

  console.error(
    [
      "",
      "Pattern -- one-time telemetry notice (this will not print again)",
      `Anonymous usage telemetry is currently ${status}.`,
      "",
      "When enabled, Pattern sends an anonymous per-install ID, a one-way",
      "hash of project_id (never the raw string), and the same verdict",
      "summary already written to ~/.pattern/calls.log (verdict,",
      "confidence, reason, estimated cost). component_need, domain,",
      "framework, existing_stack, and your API key are never sent.",
      "Full field list: https://github.com/donaldrichard19-LVD/pattern-mcp#telemetry",
      "",
      "To help improve Pattern by sharing anonymous usage data, opt in:",
      "  PATTERN_TELEMETRY=1",
      "Already on and want it off instead? Unset PATTERN_TELEMETRY (or set it to 0).",
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
function installId(): string {
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

function getClient(): PostHog | undefined {
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

export function captureApiError(args: { tool: string; message: string; projectId?: string }): void {
  const { type, status } = classifyApiError(args.message);
  capture("pattern_cli_api_error", {
    tool: args.tool,
    error_type: type,
    status_code: status,
    project_hash: args.projectId ? hashProjectId(args.projectId) : null,
  });
}

// Best-effort drain on clean shutdown so the last event(s) of a session
// aren't dropped. Safe to call even when telemetry was never enabled.
export async function shutdownTelemetry(): Promise<void> {
  if (!client) return;
  try {
    await client.shutdown();
  } catch {
    // Ignore -- process is exiting either way.
  }
}
