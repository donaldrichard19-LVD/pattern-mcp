# Product Brief: AI-Powered Design Component Recommendations

## Bottom Line

I built an MCP tool that lets a coding agent check shadcn/ui and 21st.dev against a real requirements checklist before it writes a UI component from scratch. If a real component covers the need, the tool tells the agent to install it. If nothing covers it, the tool pulls a real screen from Mobbin so the agent builds from a concrete reference instead of guessing.

I validated the judgment logic by hand across five test cases, then built and tested a working MCP server against live search data through several rounds in Claude Code. I found and fixed two real bugs (a fabricated reference and an unenforced scoring rule) and one real limitation I can't fully eliminate (the model reads the same evidence differently across runs). I addressed that limitation with a boundary-risk ensemble that re-runs a close call three times and flags disagreement instead of hiding it.

The tool is packaged for local install, works with Claude Code, Cursor, and Codex CLI, and I'm ready to recruit early testers.

## Problem

I have an idea for a specific, unique interaction or UI, but bringing it to life through an AI coding agent is hard. My agent can write a functional spec, but the design output tends to be generic and low-quality. I also struggle to describe the design changes I actually want in a prompt.

## Target Segment

**Primary: Early-Stage Founders (EF)** — non-designers building software products who code with AI agents.

Other segments I considered, ranked by impact and reach:
- Early-Stage Founders (EF) — highest impact, I picked this one
- Independent Freelancers (IF) — close second on impact and reach
- Personal/Hobbyist Builders (PB) — lower priority
- Employed Engineers/Developers building for employers (EE) — lower priority

I ruled out designers (they already do this well, so the pain is lower) and PMs (lower frequency of need).

## Pain Points Within the EF Segment

Once an EF starts agent-assisted coding, five recurring pain points show up:

| # | Pain Point | Description |
|---|---|---|
| A | Agent Design Capabilities | The agent builds a spec, but the design output is generic and low-quality |
| B | Agent Prompting Skills | The EF struggles to describe the desired design changes to the agent |
| C | Design Component Search | The EF manually searches 21st.dev, shadcn, and Mobbin for matching components, which takes real time |
| D | Design Component Management | The EF saves found components to a markdown file for later reuse |
| E | Agent Prompting for Reuse | The EF points the agent back to that file to apply or change the current design |

I prioritized by severity and frequency. A, B, and C are high severity and high frequency, so I put them at the top of the cluster. D is lower severity but still high frequency.

## Proposed Solution

I focused on Design Component Search & Discovery, which addresses pain point C directly and B and A indirectly.

**Core flow:** the agent hits a component need mid-build and calls an MCP tool with that need and the project context. The tool returns a verdict: install this existing component, or build this one custom from a reference. The agent acts on the verdict directly. The EF never manually searches shadcn, 21st.dev, or Mobbin themselves.

I evaluated three solution options on effort and impact:
1. A full component library organized by use case — higher effort
2. An "explore" library — I deprioritized this one
3. Access to designer skills or expertise — lower impact

I picked the agent-invoked recommendation approach. It's the lowest-effort, highest-impact option of the three.

## Delivery Model: MCP Tool

I built the judgment layer as an MCP tool the agent calls, not a human-facing search or comparison UI. This follows directly from the EF segment profile. EFs already delegate implementation to a coding agent, so the natural point of intervention is the agent's own workflow, not a separate app that pulls the EF out of their flow.

### When the Agent Should Call the Tool

The agent should call the tool when:
1. A UI component need comes up that nothing in the current codebase already satisfies — the agent is about to scaffold something new rather than reuse or extend an existing component.
2. The agent's own confidence in producing a well-designed result is low — generic, boilerplate-looking UI is a signal to check for a better real option before shipping a first draft.
3. The request references a specific pattern or comparison point, like "make this look like Airbnb's calendar."

The agent should generally skip the tool for:
- Trivial, single-purpose primitives with no meaningful internal structure: button, input, checkbox, label, badge, spinner, loader, tooltip, avatar, icon. These don't have a multi-field checklist to score, so the tool adds nothing. I built this as a static skip-list rather than a runtime judgment call, because deciding "is this trivial" at runtime would require its own judgment step and defeat the purpose of skipping it. I plan to revisit the list once I have real usage data.
- Repeat calls for the same component need within one session. The agent should hold its own verdict in memory for the build (see Caching below).

### Caching

The tool itself never caches. It computes fresh every time and returns a `computed_at` timestamp, because a `custom_build` verdict can go stale as component libraries ship new work. I confirmed this directly: shadcn shipped real chat primitives partway through my testing and turned a likely custom-build messaging component into a near-perfect match. Persisting a stale verdict would eventually hand someone a wrong answer.

Session-level caching, if any, belongs to the calling agent. The agent can hold its own verdict in memory for one build session to avoid asking twice, but that cache should never persist across sessions or builds.

### Input Contract

```json
{
  "component_need": "string, required — a specific description, not a category. e.g. 'price breakdown with fees and taxes' not 'pricing'",
  "context": {
    "domain": "string, required — the product type, e.g. 'Airbnb-style rental marketplace'",
    "framework": "string, required — e.g. 'React + Tailwind', 'Vue 3'",
    "existing_stack": "string, optional — e.g. 'already using shadcn/ui', used only as a tiebreaker between similarly-scored candidates"
  }
}
```

I made `component_need` free text instead of a category enum. My test cases showed that vague category names like "pricing" produce false-positive matches during requirement extraction, so forcing specificity at the input level carries real weight, not just style. `domain` and `framework` are required because they directly shape requirement extraction and candidate search. `existing_stack` only breaks ties. I left out a budget or effort field on purpose. None of my five validated test cases needed one, and coverage plus confidence already carry the decision the agent needs.

### How the Agent Uses the Verdict

- `use_existing`: the agent installs the recommended component with the returned install command. No further judgment needed.
- `custom_build`: the agent treats the returned requirement checklist as its build spec and the Mobbin reference as its visual guide, instead of inventing requirements on its own.
- `no_candidates_found`: the agent should not silently guess. It should either build custom using its own judgment, which is clearly worse-informed than a `custom_build` verdict with a checklist, or flag the gap back to the EF.

## Validation and Build History

I validated the judgment logic by hand first, across five test cases spanning the full range of outcomes:

| Case | Coverage | Verdict | What it showed |
|---|---|---|---|
| Image gallery | 100% | use_existing, high confidence | True commodity match |
| Host-guest messaging | 100% | use_existing, high confidence | Ecosystem shift flipped a likely custom build into a match |
| Host earnings dashboard | 71% | use_existing, low confidence | Partial match with real gaps |
| Price breakdown | 37% | custom_build | Caught a false-positive-prone case correctly |
| Cancellation policy | 0%, no candidates | custom_build | Zero real candidates existed |

Once I built the actual MCP server and ran it against live search data in Claude Code, I found two real bugs:

1. **Fabricated Mobbin references.** The tool returned a specific Mobbin URL and flow name even when it never ran a search against mobbin.com. I fixed this by reserving a dedicated search allowance for the Mobbin lookup and refusing to populate a reference unless a real, grounded search succeeded.
2. **Unenforced scoring threshold.** The model sometimes stated a verdict that didn't match its own coverage percentage, and the code trusted that self-report. I fixed this by recomputing the coverage fraction from the model's own evidence array and applying the threshold in code, not by trusting what the model says about itself.

After fixing both, I found a deeper issue: the same component need can produce a different verdict across separate runs with no code change between them. I traced this to the model reading identical evidence differently from one run to the next, not to search inconsistency. I confirmed this directly: two runs found the exact same named component through the exact same search queries, but one run read a specific feature as present and the other read it as absent.

I addressed this with a boundary-risk ensemble. When a call's coverage lands close enough to a threshold to plausibly flip the verdict, the tool automatically re-runs the judgment two more times and takes the majority verdict. A 2-of-3 split ships with low confidence and an `agreement` field so the calling agent knows it was a close call. Calls that land clearly inside a threshold band stay single-run. Measured across a real test batch, this adds about 1.9x average cost, not the 3x worst case, since only about half of calls actually trigger it.

## Distribution

I decided to ship the first version as a local npm package. Each developer installs it and supplies their own Anthropic API key, rather than me running a hosted service. This is the cheapest path to real testers and matches the architecture I already built. A hosted version would need auth, per-tester rate limits, and me covering everyone's API cost, none of which I need for early testing.

I confirmed the tool works with Claude Code, Cursor, and Codex CLI, since it's a standard MCP server and not tied to one client. The setup and cost stay the same across all three. Only the config file path and format differ.

## Why This Matters

This extends my original UI component aggregator idea, an "OpenRouter for design components" that routes a stated need across shadcn, 21st.dev, and Mobbin. I validated the judgment logic across five hand-tested cases and then again through multiple rounds of live testing, catching and fixing two real bugs along the way and building a working answer to the one limitation I couldn't code away.

## Status and Next Steps

| Phase | Item | Status |
|---|---|---|
| P0 | Judgment logic validated by hand (5 cases) | Done |
| P0 | MCP server built and compiling | Done |
| P0 | Live testing against real search data | Done |
| P0 | Mobbin fabrication bug | Fixed and verified |
| P0 | Threshold enforcement bug | Fixed and verified |
| P0 | Verdict-flip reliability issue | Addressed with boundary-risk ensemble |
| P1 | Package metadata, README, GitHub repo | Done |
| P1 | Multi-client support (Claude Code, Cursor, Codex) | Confirmed |
| P1 | Local usage logging | In progress with Claude Code |
| P2 | Cold-start test from a clean install | Not yet run |
| P2 | Recruit early testers | Twitter thread drafted, not yet posted |
| P3 | Validate skip-list against real usage | Needs real call volume |
| P3 | Validate EF demand specifically vs. IF | Needs real call volume |

**Validate the skip-list** once real calls exist. Log every call and whether it hit the skip-list. Watch for two failure signals: the agent calling the tool anyway on a skip-listed item, or the agent shipping generic UI for something that should have been skipped. Review after real call volume builds up, not on a calendar date.

**Validate EF demand specifically**, since IF scored similarly on impact and reach. The cheapest test is shipping to a small number of EFs on real projects and watching whether they actually hit `custom_build` moments the tool catches. Real demand looks like repeat, voluntary use across multiple projects. A signal against it looks like usage mostly landing on the skip-list or high-confidence `use_existing` cases, rarely reaching `custom_build`.
