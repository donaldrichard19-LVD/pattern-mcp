---
name: pattern-docs-sync
description: Keep Pattern's two published artifact docs in sync with the repo — every new BACKLOG.md item gets reflected in the Pattern Briefing doc, and every new architecture change that actually ships in product gets reflected in the Pattern Primer doc. Use whenever adding/editing a BACKLOG.md section, or after confirming a src/index.ts architecture change is live and working.
---

# Pattern docs sync

Pattern keeps two published Artifacts that are supposed to track the repo,
not drift from it. This skill is the checklist for keeping them honest.
Both are owned by this user — update them in place via the Artifact tool's
`url` param. Never publish a new artifact for either; that creates a second,
disconnected URL.

- **Pattern Briefing** — PM-facing positioning/architecture/risk brief.
  `https://claude.ai/code/artifact/a87c4898-fa0f-4748-bc29-978ab9dd57be`
- **Pattern Primer** — engineering-facing doc explaining the *reasoning*
  behind Pattern's architecture: eight design principles, each tied to a
  real decision or finding, plus decision-rights and a glossary.
  `https://claude.ai/code/artifact/2d064e6d-53d5-4a8f-9965-303364fd6985`

Always `Artifact` `action: "read"` with the `url` first — republishing
without reading the live version risks clobbering a change made outside
this session, and the tool will refuse a stale publish anyway. Edit the
saved local HTML file, then `Artifact` `action: "publish"` with `file_path`
set to that same file and `url` set to the artifact's URL.

## Rule 1 — new BACKLOG.md item → Pattern Briefing

Trigger: a new `##` section is added to `BACKLOG.md` (a new feature idea,
not a routine edit to an existing section).

1. Read the Pattern Briefing artifact.
2. Find the `Opportunities` section (`<div class="ranked">` of
   `.ranked-item.opportunity` blocks, each `<span class="rank-mark">NN</span>`
   + `<h4>` + `<p>`). Append a new entry at the next rank number.
   - If the item is a genuine risk/concern rather than an upside, use the
     `.ranked-item.risk` variant instead if the section supports it —
     check how existing risk entries are marked in the `Risks` section and
     match that shape rather than forcing everything into `Opportunities`.
   - If it's better framed as an unresolved question than a proposed
     direction (e.g. something explicitly parked pending user demand),
     add it to `Open questions to close` instead — a plain `<li>`.
3. Write the entry in the doc's own voice: plain business prose, no
   function/variable names, no raw markdown from BACKLOG.md pasted in.
   Translate "why this matters" into product/cost/quality terms a
   non-engineer reader would follow — see existing entries for the register
   (e.g. "Build a dedicated connection to each source — the long-term
   moat"). Carry over the backlog item's actual effort/priority framing
   (parked vs. active vs. sequenced) rather than implying it's imminent
   work if it isn't.
4. Publish back to the same URL. Don't touch unrelated sections.

## Rule 2 — architecture that ships in product → Pattern Primer

Trigger: a change to `src/index.ts` (or other runtime source) has actually
shipped — built into `dist/` and confirmed working against a real call, not
just committed source. Matches this repo's own standard for "shipped" (see
`BACKLOG.md`'s cost-plan entries: "confirmed live and running" vs. code that
merely exists).

1. Read the Pattern Primer artifact. Re-read the `Start here` section's
   eight principle headers first — most shipped changes are a new example
   under an *existing* principle, not a new principle.
2. Decide: does this change illustrate one of the eight existing principles
   (far more common), or does it embody a genuinely new one? Don't add a
   ninth principle casually — that's a bigger claim than most individual
   ships warrant.
3. Add the real decision/finding as a concrete example under the relevant
   principle, in the doc's plain-prose explanatory style: what was assumed,
   what was actually found or decided, what it changed. Only record things
   actually verified live — per the Primer's own principle, a claim only
   counts as fact once checked against a real call, not just written.
4. Also add/update a `Change N` entry in Pattern Briefing's
   `Just shipped — what got checked` section (same two-column `callout`
   pattern, `<span class="tag accent">Not yet proven</span>` or
   `<span class="tag good">Confirmed working</span>` as applicable) — this
   keeps both docs pointing at the same shipped-and-verified changes instead
   of one lagging the other.
5. Publish both artifacts back to their same URLs.

## Don't

- Don't invent numbers, percentages, or confidence claims not actually
  measured — both docs are explicit about only stating what was verified.
- Don't reorder or rewrite existing entries in either doc as a side effect
  of adding a new one, unless asked.
- Don't skip the read-before-publish step, even for a small addition.
