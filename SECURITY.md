# Security notes

Read this before handing this server to testers. None of the gaps below
are fixed yet — they're documented so testers go in informed, not
discovered the hard way.

## `install_command` is untrusted text

The server never executes, validates, or checks `install_command` against
any package registry. It's text the judgment model wrote after reading a
web search result — it could be wrong, outdated, or (in principle, if a
search result were adversarial) actively malicious.

This project depends on the **calling agent** treating it as untrusted:
displaying it to the user and getting explicit confirmation before
running it, never executing it automatically or silently. The tool
description and system prompt both instruct the model to produce a single
literal command (never chained with `&&`/`;`, never piped into a shell)
and instruct the calling agent on the confirm-before-run expectation —
but this is a prompting convention, not something the server enforces.
Nothing stops a calling agent that ignores its own instructions from
executing it directly. If you're integrating this tool into your own
agent, add that confirmation step yourself rather than assuming it
happens upstream.

## API keys in MCP config files

Setup (see [README](./README.md#setup)) has you paste a real
`ANTHROPIC_API_KEY` into a config file — `.mcp.json`, `.cursor/mcp.json`,
`.codex/config.json`, or a Claude Desktop settings file, depending on
your client. **These files can end up inside a project directory you
control**, separate from this repo. This repo's own `.gitignore` doesn't
protect you there: it only covers files inside *this* checkout.

If you're wiring this server into an MCP client config that lives inside
one of your own git-tracked projects, add that config file's path to
**your own project's** `.gitignore` before you save your key into it —
don't rely on this repo's `.gitignore` to catch it, since it won't. If
you already committed a key by accident, rotate it in the
[Anthropic Console](https://console.anthropic.com) — a `git revert` alone
doesn't invalidate a key that already appeared in history.

## What actually leaves your machine

- **Every call sends `component_need`, `domain`, `framework`, and
  `existing_stack` to the Anthropic API** as part of the request (see
  [How it works](./README.md#how-it-works)). That's the real data flow to
  be mindful of — avoid putting sensitive project names, unreleased
  feature details, or anything confidential into those fields, the same
  way you would with any other LLM API call.
- **`component_need` and `domain` also get written to a local log file
  in plaintext**, separate from the API call above:
  `~/.pattern/calls.log` by default, overridable via
  `PATTERN_LOG_PATH` — see
  [Local call log](./README.md#local-call-log). This is local-only
  (nothing here is sent anywhere by this server), but avoid putting
  sensitive project details in those two fields for this reason too, not
  just because of the API call — the log file persists across restarts,
  where the diagnostics below don't.
- **`record_component_decision` writes `project_id`, `component_need`,
  `domain`, `action`, `source`, and `timestamp` to a second local file in
  plaintext**: `~/.pattern/memory.json` by default,
  overridable via `PATTERN_MEMORY_PATH` — see
  [Per-project decision memory](./README.md#per-project-decision-memory).
  Same local-only caveat as `calls.log` above (nothing here is sent
  anywhere by this server on its own), but note this file's content
  *does* subsequently flow into the Anthropic API call above whenever a
  later `recommend_component` call reuses the same `project_id` — past
  `component_need`/`domain` values get folded into that call's prompt as
  context. Avoid sensitive project details in those fields for the same
  reason as `calls.log`, and additionally: unlike the append-only log,
  this file persists across restarts *and* is read back into future API
  calls, so treat its contents with the same care as the live inputs
  above, not just as a passive record.
- **If you've explicitly set `PATTERN_TELEMETRY=1`** (off by default --
  telemetry is opt-in, not opt-out), an anonymous per-install UUID
  (`~/.pattern/install_id`), a SHA-256 hash of `project_id` (never the raw
  string), and the distilled verdict shape already in `calls.log`
  (verdict, confidence, reason, ensemble_triggered, estimated_cost_usd) go
  to Pattern's PostHog project over HTTPS. A failed Anthropic API call
  additionally sends the HTTP status and a coarse error classification
  (`rate_limit` / `insufficient_credit` / `other`) -- never the response
  body. `component_need`, `domain`, `framework`, `existing_stack`, and the
  raw `project_id` are never included in telemetry, on or off. See
  [Telemetry](./README.md#telemetry) for the full field list and how to
  confirm it's off.
- The server emits diagnostic JSON lines to **stderr** on every call
  (search queries, coverage recounts, verdict corrections, ensemble
  decisions). These are not written to disk by this server, but depending
  on your MCP client, stderr from a child process may be captured or
  persisted somewhere client-side that this project doesn't control.
  Search-query diagnostics can include terms derived from your
  `component_need`/`domain`, so the same caution applies if your client
  logs stderr.

## `check_ledger_liveness` reads your filesystem and runs `git`

Every other tool in this server has no filesystem/git access to your repo
at all (see [Per-project judgment ledger](./README.md#per-project-judgment-ledger)).
`check_ledger_liveness`, and `recommend_component`'s `snapshot_ref`
capture at write time, are the one deliberate exception — see [Ledger
integrity and decision provenance](./README.md#ledger-integrity-and-decision-provenance)
for the full design. Concretely:

- `git rev-parse HEAD` runs against `PROJECT_ROOT` on every ledger write —
  read-only, never touches repo state, never any other git subcommand.
- `check_ledger_liveness` calls `fs.existsSync` and reads one file's
  content, only for a `file_path` a caller explicitly passed to
  `recommend_component`, only if it resolves inside `PROJECT_ROOT` — a
  path that's absolute or escapes `PROJECT_ROOT` via `../` is rejected
  (resolves to `live_status: "unknown"`) rather than read.
- `PROJECT_ROOT` defaults to this server process's own working directory
  (`process.cwd()`), not something derived from `project_id` or any other
  caller-supplied string — override with `PATTERN_PROJECT_ROOT` if your
  MCP host doesn't launch this server with the consuming repo as its
  working directory.
- Neither of these ever writes to your repo, and neither ever runs an
  arbitrary shell/git command beyond the fixed `git rev-parse HEAD`
  above.

If you're running this server in a context where its working directory
might not be the repo you expect (e.g. a shared or multi-tenant host),
set `PATTERN_PROJECT_ROOT` explicitly rather than relying on the default.

## Cost ceiling is a session cap, not a spend cap

The server caps itself at 40 `recommend_component` calls per process
lifetime by default (`PATTERN_SESSION_CAP` — see
[Session call cap](./README.md#session-call-cap)), which bounds the
worst case rather than eliminating cost risk entirely. Three things to
know:

- The cap is **in-memory and per-process** — it resets on restart. A
  calling agent (or a person) that just restarts the MCP server after
  hitting the cap can keep going indefinitely. The cap catches a loop
  *within one session*, not persistent abuse across many.
- The cap counts `recommend_component` invocations, not underlying
  Anthropic API requests — a single boundary-risk call can still cost up
  to 3x that internally (see
  [Ensemble cost](./README.md#ensemble-cost-boundary-risk-cases-only)),
  so 40 calls is not a hard ceiling of 40 API requests.
- There's still no rate limit or circuit breaker on *how fast* those 40
  calls can happen, and no spend-based cap in dollar terms.

Watch your [Anthropic Console usage dashboard](https://console.anthropic.com)
if you're testing with an agent that has its own retry behavior you
don't fully control.

## Not sandboxed

This server needs outbound network access to `api.anthropic.com` and
whatever the model's `web_search` tool reaches — there's no domain
allowlist or sandboxing layer in front of it. Run it with the same trust
level you'd give any local process that makes outbound API calls with
your credentials attached.
