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

Setup (see [README](./README.md#setup--quickstart)) has you paste a real
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

## What actually leaves your machine — no local log file exists

At the time of writing, this server does **not** write a persistent local
log file anywhere (no `~/.ui-component-judgment-mcp/calls.log` or
equivalent). Two things are worth knowing anyway:

- **Every call sends `component_need`, `domain`, `framework`, and
  `existing_stack` to the Anthropic API** as part of the request (see
  [How it works](./README.md#how-it-works)). That's the real data flow to
  be mindful of — avoid putting sensitive project names, unreleased
  feature details, or anything confidential into those fields, the same
  way you would with any other LLM API call.
- The server emits diagnostic JSON lines to **stderr** on every call
  (search queries, coverage recounts, verdict corrections, ensemble
  decisions). These are not written to disk by this server, but depending
  on your MCP client, stderr from a child process may be captured or
  persisted somewhere client-side that this project doesn't control.
  Search-query diagnostics can include terms derived from your
  `component_need`/`domain`, so the same caution applies if your client
  logs stderr.

## No cost ceiling

The server has no built-in spend cap, rate limit, or circuit breaker. A
single non-trivial call already costs multiple Anthropic API requests
(search + score, up to 3x on a boundary-risk ensemble trigger — see
[Ensemble cost](./README.md#ensemble-cost-boundary-risk-cases-only)). If
a calling agent retries aggressively — on a timeout, a transient error,
or its own retry loop — nothing here stops it from repeating expensive
calls indefinitely against your key. Watch your
[Anthropic Console usage dashboard](https://console.anthropic.com) if
you're testing with an agent that has its own retry behavior you don't
fully control.

## Not sandboxed

This server needs outbound network access to `api.anthropic.com` and
whatever the model's `web_search` tool reaches — there's no domain
allowlist or sandboxing layer in front of it. Run it with the same trust
level you'd give any local process that makes outbound API calls with
your credentials attached.
