# Product Brief: AI-Powered Design Component Recommendations

## Bottom line

Pattern helps coding agents make better UI decisions.

When an agent needs a component, Pattern checks real components from shadcn/ui and 21st.dev against the actual requirements. If an existing component is a good match, Pattern tells the agent to use it. If not, Pattern finds a real product example from Mobbin or Figma Community so the agent can build from something concrete instead of guessing.

I first validated the judgment logic by hand across five test cases. I then built and tested a working MCP server against live search data in Claude Code.

That testing found two real bugs:

* A reference could be fabricated even when no real Mobbin search had happened.
* The model could return a verdict that did not match its own coverage score.

Both are fixed and enforced in code.

I also found one limitation that cannot be fully eliminated: the model can interpret the same evidence differently across runs. Pattern now detects cases where that variance could change the verdict, runs the judgment three times, and surfaces disagreement instead of hiding it.

The tool is packaged for local installation and works with Claude Code, Cursor, and Codex CLI. It is ready for early testers.

## The problem

I have a specific idea for an interaction or UI, but getting an AI coding agent to build it well is difficult.

The agent can usually write a functional implementation. The problem is the design. The result often looks generic or low-quality.

I also have trouble describing exactly what I want changed in a prompt. I may know that something should feel more like Airbnb, for example, without knowing the right design language to give the agent.

The result is a gap between **what I want the product to look like** and **what the coding agent knows how to build**.

## Who I'm building for

### Primary segment: early-stage founders

The initial target is **early-stage founders who are building software with AI coding agents but are not designers**.

I considered four segments:

| Segment                         | Priority  |
| ------------------------------- | --------- |
| Early-stage founders            | Primary   |
| Independent freelancers         | Secondary |
| Personal / hobbyist builders    | Lower     |
| Employed engineers / developers | Lower     |

I ruled out designers because they are already good at finding and evaluating design patterns themselves.

I deprioritized PMs because this problem happens less frequently in their day-to-day work.

## The five pain points

Once a founder starts building with an AI coding agent, five related problems show up:

**A. Agent design capabilities**
The agent can create a functional spec, but the resulting UI is often generic.

**B. Prompting the agent**
The founder struggles to describe the design changes they actually want.

**C. Finding components**
The founder manually searches 21st.dev, shadcn/ui, and Mobbin for examples. This takes time and still requires judgment.

**D. Managing components**
The founder saves useful components and references somewhere, often in a markdown file, so they can reuse them later.

**E. Prompting for reuse**
The founder has to point the agent back to those saved references when they want to reuse or modify something.

A, B, and C are the biggest problems because they are both frequent and painful. D is less painful but happens often.

## The solution

Pattern focuses on **component search and discovery**.

It directly solves the search problem and also helps with the prompting and design-quality problems.

The core workflow is simple:

1. The agent encounters a UI need while building.
2. It calls Pattern with the need and the product context.
3. Pattern searches real component libraries and evaluates what it finds against the requirements.
4. Pattern returns a decision:

   * **Use an existing component**
   * **Build it custom**
   * **No suitable candidate found**
5. The agent acts on the decision.

The founder does not need to leave the coding workflow and manually search shadcn/ui, 21st.dev, or Mobbin.

## Why an agent-invoked tool

I considered three other approaches:

* **A full component library organized by use case** — useful, but much more work to build.
* **An explore library** — interesting, but less directly connected to the moment when the agent needs to make a decision.
* **Designer skills or expertise on demand** — potentially valuable, but less direct impact on the core problem.

Pattern puts the recommendation directly inside the agent's workflow.

That matters because the target user is already delegating implementation to an AI coding agent. The best place to intervene is where the agent is making the design decision, not in a separate application the founder has to manage.

## When the agent should use Pattern

Pattern should be called when:

* The current codebase does not already satisfy a UI need and the agent is about to build something new.
* The agent is likely to produce generic or boilerplate UI and could benefit from a real component or product reference.
* The request points to a specific pattern or comparison, such as "make this feel like Airbnb's calendar."

### When the agent should skip Pattern

Pattern should generally be skipped for simple primitives such as:

`button`, `input`, `checkbox`, `label`, `badge`, `spinner`, `loader`, `tooltip`, `avatar`, `icon`

These do not have enough internal structure for meaningful requirement scoring.

Pattern handles them with a static skip-list instead of asking the model to decide whether something is trivial. That avoids spending a judgment step to decide whether another judgment step is necessary.

The skip-list is intentionally a starting point. It will be validated and updated once there is real usage data.

The agent should also avoid repeating the same recommendation within a build session. If it already has a verdict, it can keep that result in its own session memory.

## Caching

Pattern itself **never caches recommendations**.

Every call searches and scores from scratch and returns a `computed_at` timestamp.

This is intentional. Component libraries change.

During testing, shadcn/ui shipped new chat primitives. A messaging component that had previously looked like a custom-build case became a near-perfect existing-component match.

Persisting the old verdict would eventually give the agent the wrong answer.

If the calling agent wants to avoid asking the same question twice during one build, it can keep the result in session memory.

That cache should not persist across sessions or builds.

## Input

Pattern takes a specific component need plus the product context:

```json
{
  "component_need": "price breakdown with fees and taxes",
  "context": {
    "domain": "Airbnb-style rental marketplace",
    "framework": "React + Tailwind",
    "existing_stack": "already using shadcn/ui"
  }
}
```

### Why the input is specific

`component_need` is free text, but it should describe the actual UI need.

Good:

```text
price breakdown with fees and taxes
```

Not:

```text
pricing
```

Testing showed that vague categories can create false-positive matches. For example, a generic SaaS pricing table can look relevant to "pricing" even though it is not appropriate for a booking checkout.

Requiring specificity at the input level improves the quality of the judgment.

`domain` and `framework` are required because they directly affect both requirement extraction and component search.

`existing_stack` is optional and is used as a tiebreaker between similarly scored candidates.

I intentionally left out budget and implementation effort. None of the five validated test cases needed those inputs, and coverage plus confidence already give the agent the decision it needs.

## How the agent uses the result

### `use_existing`

The agent uses the recommended component and can install it using the returned command.

No additional design judgment is needed.

### `custom_build`

The agent uses:

* The returned requirement checklist as the build specification.
* The Mobbin or Figma Community reference as the visual guide.

Instead of inventing the requirements itself, the agent has both a concrete checklist and a real product example.

### `no_candidates_found`

The agent should not quietly pretend it found a good match.

It can either:

* Build something custom using its own judgment, with the understanding that it has no strong reference.
* Tell the founder that no suitable existing candidate was found.

The important distinction is that **"nothing found" is not treated as "bad match."**

## Validation

I first tested the judgment logic by hand across five cases designed to cover different outcomes:

| Case                    |          Coverage | Result                          | What it tested                             |
| ----------------------- | -----------------:| -------------------------------- | ------------------------------------------- |
| Image gallery           |               100% | `use_existing`, high confidence | Clear commodity match                      |
| Host-guest messaging    |               100% | `use_existing`, high confidence | New ecosystem component changed the answer |
| Host earnings dashboard |                71% | `use_existing`, low confidence  | Partial match with real gaps               |
| Price breakdown         |                37% | `custom_build`                  | False-positive-prone case                  |
| Cancellation policy     | 0%, no candidates  | `custom_build`                  | No real candidate existed                  |

I then built the MCP server and tested it against live search data in Claude Code.

That testing uncovered two real bugs.

### Bug 1: Fabricated references

The tool returned a specific Mobbin URL and flow name even though it had not actually searched Mobbin.

**Fix:** Mobbin references now require a dedicated search. Pattern only returns a reference when it has real search evidence behind it.

### Bug 2: The threshold was not enforced

The model could return a verdict that did not match its own coverage percentage because the code trusted the model's stated verdict.

**Fix:** Pattern now recalculates coverage from the individual requirements and applies the verdict threshold in code.

The model cannot override the threshold by simply returning a different verdict.

## The deeper reliability problem

After fixing those bugs, I found a harder problem.

The same input could produce a different verdict across runs, even when nothing in the code changed.

I traced this to the model's interpretation of evidence, not the search.

Two runs could:

* Find the same component.
* Use the same search queries.
* See the same evidence.

But the model could interpret one feature differently between runs.

For example, one run might read an `Export` action as present while another reads it as absent.

This is a limitation of model-based judgment. It cannot be completely removed through deterministic code.

## How Pattern handles uncertainty

Pattern uses a **boundary-risk ensemble**.

If coverage is close enough to a decision threshold that one changed requirement could flip the verdict, Pattern runs the judgment two additional times.

It then takes the majority result.

For example:

```json
{
  "ensemble": {
    "triggered": true,
    "runs": [
      "use_existing",
      "custom_build",
      "use_existing"
    ],
    "agreement": "2/3"
  }
}
```

If the three runs disagree, Pattern returns `confidence: low`.

The goal is not to pretend the model is perfectly consistent. The goal is to make uncertainty visible to the agent.

Results that are clearly inside a threshold stay single-pass.

Testing showed that the ensemble adds about **1.9x average cost**, rather than 3x, because only a subset of calls trigger it.

## Evaluating a staged pipeline (not shipped)

The verdict-flip problem above raises an obvious question: would splitting the single bundled judgment call into separate stages — extract requirements, search evidence, score coverage — produce more consistent, more diagnosable results?

I ran a structured validation to answer that, rather than assuming staging would help. I built a 25-case hand-graded eval set, tested requirement extraction in isolation, then built the staged pipeline as a full parallel implementation. Before committing to a large comparison run, I ran a 5-case pilot first: 3 repeated runs per case, per architecture, spanning clean, boundary-risk, and genuinely ambiguous cases.

| Case | Bundled | Staged |
| ---- | ---: | ---: |
| Search map toggle (clean) | 3/3 correct, 3/3 consistent, 3 calls | 3/3 correct, 3/3 consistent, 12 calls |
| Image gallery (boundary) | 1/3 correct, split verdict | 3/3 correct, 3/3 consistent, 22 calls |
| Availability calendar (boundary) | 3/3 correct, 3/3 consistent, 7 calls | 3/3 correct, 3/3 consistent, 23 calls |
| Date range picker (boundary) | 3/3 correct, 3/3 consistent, 9 calls | 1/3 correct, split verdict, 1 run hard-failed |
| Host earnings dashboard (boundary) | 1/3 correct, split verdict | 1/3 correct, split verdict (same pattern) |

Totals: bundled scored 11/15 correct (73%) across 37 calls. Staged scored 11/14 correct (79%, one run errored out) across 75 calls — roughly **2x bundled's cost**.

**Result: a wash, not a win.** Staging clearly improved consistency on one case and clearly hurt it on another, including an unhandled fetch failure mid-run. Where both architectures failed on the same case, that points to a hard or ambiguous case rather than an architecture problem. Net accuracy was statistically indistinguishable between the two, and staged cost roughly double throughout — not just on the boundary-risk cases it was expected to help most.

I did not run the full 25-case comparison. The pilot answered the question it was built to answer: on exactly the profiles staging was hypothesized to help — boundary-risk and ambiguous cases — it didn't show a benefit consistent enough to justify double the cost.

**Pattern ships the bundled pipeline.** The staged implementation remains in the repo (`src/staged/`) as an evaluated, unshipped experiment, not a replacement.

## Distribution

The first version is a **local npm package**.

Each developer installs Pattern and provides their own Anthropic API key.

This is the simplest way to get the tool into real developers' hands without first building:

* Authentication
* User accounts
* Rate limits
* Hosted infrastructure
* Billing
* API cost management

It also matches the architecture already built.

Pattern is a standard MCP server, so it works with:

* Claude Code
* Cursor
* Codex CLI

The underlying server and costs are the same across clients. Only the configuration differs.

## Why this matters

Pattern started as an idea for an "OpenRouter for design components": route a UI need across sources such as shadcn/ui, 21st.dev, and Mobbin.

The testing changed the emphasis.

The valuable part is not simply finding components.

It is **making the design decision**:

> Does something already exist that actually fits this product need, or should the agent build something new?

That judgment happens inside the agent's workflow, using real component evidence and real product references.

The validation work has shown that this approach can work in practice, while also making the important limitations visible.

## Current status

| Phase | Item                                                       | Status                                |
| ----- | ----------------------------------------------------------- | -------------------------------------- |
| P0    | Judgment logic validated by hand across 5 cases             | Done                                   |
| P0    | MCP server built and compiling                              | Done                                   |
| P0    | Live testing against real search data                       | Done                                   |
| P0    | Mobbin fabrication bug                                       | Fixed and verified                     |
| P0    | Threshold enforcement bug                                    | Fixed and verified                     |
| P0    | Verdict-flip reliability issue                               | Addressed with boundary-risk ensemble  |
| P1    | Staged pipeline evaluated as an alternative architecture     | Evaluated, not adopted (~2x cost, no consistent accuracy or consistency gain) |
| P1    | Package metadata, README, GitHub repo                        | Done                                   |
| P1    | Claude Code, Cursor, Codex support                            | Confirmed                              |
| P1    | Local usage logging                                           | In progress                            |
| P2    | Clean-install test                                            | Not yet run                            |
| P2    | Recruit early testers                                         | Ready                                  |
| P3    | Validate skip-list with real usage                            | Not yet validated                      |
| P3    | Validate demand from early-stage founders vs. freelancers     | Not yet validated                      |

## Next steps

### 1. Test the skip-list with real usage

Track which calls hit the skip-list.

Look for two signals:

* Agents are calling Pattern for things that should have been skipped.
* Agents are building generic UI for things that should have been on the skip-list.

The list should evolve based on real usage rather than assumptions.

### 2. Test demand with early-stage founders

Independent freelancers were close to early-stage founders in the initial segment analysis, so real usage is needed to validate the target.

The first test is simple: put Pattern in the hands of a small group of early-stage founders building real products and see what they actually do.

The strongest signal is **repeat, voluntary use across multiple projects**.

A weaker signal would be usage concentrated around trivial components or high-confidence existing matches, with very few cases where the agent needs a custom build.

### 3. Run a clean-install test

Validate that someone who has never seen the project can install Pattern from scratch, configure their MCP client, and get a successful recommendation without help.

### 4. Recruit early testers

The core product is working. The next important question is no longer whether the judgment layer can be built.

It is whether developers actually want an agent to make this design decision for them while they build.
