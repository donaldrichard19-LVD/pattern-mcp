# Testing the Pattern story layer prototype in Claude Code

This walks you from a fresh clone to a working test of the story layer
(branch `claude/story-layer`, PR #62). It takes about 15 minutes. You do not
need a design system, Figma, or an Anthropic API key for Parts 1 to 5. Part 6
(model-assisted ingest) is the only part that needs a key.

## What you are testing

A layer above Pattern's component ledger that records what a project
**believes and says**, then pushes back on it. Five tools:

| Tool | What it does |
| --- | --- |
| `record_claim` | Stores a message, belief, assumption, goal or constraint, with a source, confidence and evidence. Claims are never edited: you supersede or retract them with a reason. |
| `link_decision` | Stores a decision and the claim ids it serves, optionally the screen/section it lives on. |
| `challenge` | Pushes back: unsupported claims, contradictions, decisions resting on claims that no longer hold, one surface saying several things, decisions serving nothing, a missing message. No model call. |
| `read_story` | Shows active claims, the history of superseded/retracted ones, and decisions. |
| `ingest_notes` | Pulls candidate claims out of a notes file. Pattern matching by default, a verified model pass with `use_model: true`. |

The question you are really answering while you test: **does `challenge`
say things you would actually want said, and is it right often enough to
trust?**

## Part 0: Prerequisites

- Node 20 or newer (`node --version`)
- Git
- Claude Code installed and working (`claude --version`)

## Part 1: Get the code and build it

The prototype is not published to npm, so you run it from a local clone.

```bash
git clone https://github.com/donaldrichard19-LVD/pattern-mcp.git
cd pattern-mcp
git checkout claude/story-layer
npm ci
npm run build
```

Confirm the build and the automated checks pass:

```bash
node scripts/verify-story.mjs
```

You should end on `all story checks passed`. If not, stop here and tell
whoever gave you this file; nothing below will be meaningful.

Note the absolute path of the clone. You will need it:

```bash
pwd
# e.g. /Users/you/code/pattern-mcp
```

## Part 2: Create a scratch project to test against

Use a throwaway folder so your story data and notes do not mix with real work.

```bash
mkdir -p ~/story-test && cd ~/story-test
git init -q
```

Create a notes file to ingest later (Part 5). Copy this in exactly:

```bash
cat > notes.md <<'EOF'
# Acme Onboarding: working notes

- The message is: setting up Acme takes two minutes, not two days.
- Users want faster onboarding.
- We assume small teams do not have an admin who can configure SSO.
- Our goal is to get a new team to their first shared report in one sitting.
- We will never ask for a credit card before the first report.
- Lunch is at noon on Thursday.
EOF
```

## Part 3: Connect the prototype to Claude Code

Register it as a **separate** MCP server named `pattern-story`, so it does not
collide with a regular `pattern` install if you have one. Replace
`/ABSOLUTE/PATH/TO/pattern-mcp` with the path from Part 1.

```bash
cd ~/story-test
claude mcp add pattern-story \
  -e PATTERN_STORY=1 \
  -e PATTERN_PROJECT_ROOT="$HOME/story-test" \
  -e PATTERN_STORY_DIR="$HOME/story-test/.story-data" \
  -- node /ABSOLUTE/PATH/TO/pattern-mcp/dist/index.js
```

What the settings do:

- `PATTERN_STORY=1` turns the story tools on (they are off by default).
- `PATTERN_PROJECT_ROOT` is the folder `ingest_notes` is allowed to read from.
- `PATTERN_STORY_DIR` keeps the story data inside the scratch folder, so
  deleting that folder resets everything. Without it, data goes to
  `~/.pattern/story/`.

Start Claude Code **in the scratch folder** and check the server is connected:

```bash
cd ~/story-test
claude
```

Inside Claude Code, run `/mcp`. You should see `pattern-story` listed as
connected, with these tools: `record_claim`, `link_decision`, `challenge`,
`read_story`, `ingest_notes` (plus Pattern's usual four or five).

If it is not connected:

- Run `claude mcp list` in a normal terminal to see its status.
- Run the server by hand to see errors:
  `node /ABSOLUTE/PATH/TO/pattern-mcp/dist/index.js`. It should start and
  wait silently (it speaks MCP over stdin). Press Ctrl+C to exit.
- The most common cause is a wrong absolute path or not running `npm run build`.

Tell Claude which project id to use, so every call lines up. Paste this as your
first message:

> Use project_id "acme-onboarding" for every pattern-story tool call in this session.

## Part 4: The test script

Paste each prompt into Claude Code in order. The **Expect** lines say what a
working prototype should do. Anything different is a finding worth noting.

### Test 1: Decisions with no story

> Using link_decision, record these three decisions with no claims linked: "Welcome screen has a 6-step checklist" (surface: welcome), "Pricing table on the signup page" (surface: signup), "Confetti animation after first report" (surface: report). Then run challenge and show me the findings.

**Expect:** one **high** finding `no_message` ("decisions recorded, but no
active message claim") and three **medium** `orphan_decision` findings. Each
finding has a `question` for you and cites the decisions.

### Test 2: Record the message and a belief with nothing behind it

> Record a message claim: "Setting up Acme takes two minutes, not two days" with source "founder", confidence high. Then record a belief claim: "Users want faster onboarding" with source "gut feel", confidence high, topic "onboarding". Then link a new decision "Cut signup to two fields" (surface: signup) that serves the belief claim. Run challenge.

**Expect:** the `no_message` finding is gone. An `unsupported_claim`
finding on the belief, severity **high** (high confidence, no evidence, and a
decision rests on it), citing both the claim and the decision.

### Test 3: Add evidence and watch it clear

> Add evidence to the "Users want faster onboarding" claim: "7 of 10 interviewees abandoned at step 4 of the old flow". Run challenge again.

**Expect:** the `unsupported_claim` finding for that belief disappears.

### Test 4: Contradiction

> Record a belief claim: "Onboarding should be slow and deliberate so people trust it" with source "design lead", topic "onboarding", confidence medium, evidence ["competitor teardown"]. Run challenge.

**Expect:** a **high** `contradiction` finding: two active claims on topic
"onboarding" and neither replaces the other. It cites both.

Now resolve it the way a real team would:

> Supersede the "slow and deliberate" claim with "Onboarding should be fast, with trust built after the first report", source "design lead", reason "interviews showed drop-off, not distrust", evidence ["interview notes"], topic "onboarding". Run challenge.

**Expect:** the contradiction is gone. `read_story` (Test 7) will show the old
claim in history with that reason.

### Test 5: A decision whose reason has since changed

> Record a belief "Enterprise buyers decide on security first" with source "sales", evidence ["Q2 deal notes"]. Link a decision "Lead the homepage with the SOC2 badge" (surface: home) that serves it. Then retract that claim with reason "pricing data showed price drives the decision". Run challenge.

**Expect:** a **high** `stale_rationale` finding: the SOC2 decision rests only
on a claim that no longer holds, quoting your retraction reason, with the
question "Keep it for a new reason, or revisit it?"

### Test 6: One screen saying two things

> Record a second message claim: "Acme is the cheapest option for small teams", source "marketing", evidence ["pricing page review"]. Link a decision "Hero headline about price" serving it, and another "Hero headline about speed" serving the original two-minutes message, both on surface "home". Run challenge.

**Expect:** a **high** `dilution` finding: surface "home" is trying to say two
different things, citing both messages.

### Test 7: Read the whole story

> Run read_story and summarize it back to me: what we currently believe, what changed and why, and which decisions rest on what.

**Expect:** active claims grouped by kind; a history section with the
superseded and retracted claims and their reasons; the decision list.

### Test 8: Dismissing a finding

> Take the dilution finding and dismiss it with the reason "intentional: hero shows speed, the subhead shows price". Run challenge, then run it again with include_dismissed.

**Expect:** the finding disappears from the normal list, reappears under
`dismissed` with your reason. Trying to dismiss without a reason should be
refused. This is the check on the tool: it can be overruled, but never
silently.

## Part 5: Ingest from notes (no API key needed)

Start a **fresh** story so Part 4's data does not interfere:

```bash
# in a normal terminal, not Claude Code
rm -rf ~/story-test/.story-data
```

Then restart Claude Code (exit and run `claude` again in `~/story-test`) and
paste the project id instruction again.

> Run ingest_notes on notes.md without committing, and show me the candidates.

**Expect:** about 5 candidates with kinds guessed (message, belief,
assumption, goal, constraint) and sources like `notes.md:3`. "Lunch is at
noon" must **not** appear. Nothing is recorded yet.

> Now run ingest_notes on notes.md with commit true, then run challenge.

**Expect:** the claims are recorded at low confidence with no evidence.
Running ingest again should return no candidates (it de-duplicates).

Also try the safety checks:

> Run ingest_notes on "../../etc/hosts".

**Expect:** a refusal. Paths must be relative to the project root and may not
contain `..`.

## Part 6 (optional): Model-assisted ingest

This is the only part that calls Anthropic and costs a few cents at most. It
**sends the file's text to Anthropic**, so only use a file you are comfortable
sending.

Add your key to the server and restart Claude Code:

```bash
claude mcp remove pattern-story
claude mcp add pattern-story \
  -e PATTERN_STORY=1 \
  -e PATTERN_PROJECT_ROOT="$HOME/story-test" \
  -e PATTERN_STORY_DIR="$HOME/story-test/.story-data" \
  -e ANTHROPIC_API_KEY="sk-ant-..." \
  -- node /ABSOLUTE/PATH/TO/pattern-mcp/dist/index.js
```

Then, ideally with a real doc of yours (a product brief, strategy notes), copy
it into `~/story-test/` and:

> Run ingest_notes on brief.md with use_model true, without committing.

**Expect:** more candidates than pattern matching finds, each with a
`file:line` source, and a `dropped_unverifiable` count. Open the file and check
that the line each source points at really contains the idea. This is the check
on the model: every proposed claim must quote an actual line from the file, and
anything it cannot quote is dropped, so a made-up claim cannot enter the record
with a believable source.

This path has only been tested against a stub so far. **If it errors with a
real key, that is the most valuable bug report you can send.**

## Part 7: Try it on real work

The prototype proves nothing until it meets a real project. Take something you
are actually designing or building:

1. Start a fresh story (`rm -rf ~/story-test/.story-data`) or point
   `PATTERN_STORY_DIR` somewhere new.
2. Write the one-sentence message of the product. If you cannot, that is
   itself the first finding.
3. Ingest your real notes (Part 6 for best results).
4. Record the 5 to 10 most important decisions with `link_decision`, each
   serving a claim.
5. Run `challenge` and read every finding.

## What to write down

For each finding `challenge` produced, mark it:

- **Right and useful**: you did not know, or had been avoiding it.
- **Right but obvious**: true, but you would have caught it.
- **Wrong**: a false alarm. Note which kind and why.
- **Noise**: technically true, not worth your attention.

Also note anything it **should** have caught and did not. The two things I am
least sure about:

1. **Contradiction detection.** It only catches claims that share a `topic`, or
   wording that overlaps heavily with reversed polarity (like "show pricing"
   versus "never show pricing"). Two contradicting claims worded differently
   will be missed. How often does that happen to you?
2. **Whether you would actually keep using it.** Recording claims and links
   takes effort. After a week, would you do it unprompted?

## Known limits (do not report these as bugs)

- `ledger_entry_id` on a decision is stored but nothing uses it yet.
- No story-level critique of whole flows or screens, only the checks listed
  above. Audience-versus-copy mismatches, sunk-cost defence and message drift
  across a long history are not detected.
- Pattern-matching ingest has low recall by design; that is why the model
  option exists.
- IDs are `c1, c2, ...` and `d1, d2, ...` per project, in the order created.
  Findings reference them, so keep them in view when asking Claude to link
  decisions.

## Resetting and removing

Reset the story only:

```bash
rm -rf ~/story-test/.story-data
```

Remove the server from Claude Code entirely:

```bash
claude mcp remove pattern-story
```

Remove everything: delete `~/story-test` and the cloned `pattern-mcp` folder.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `pattern-story` not in `/mcp` | Run `claude mcp list`; confirm the path to `dist/index.js` is absolute and that `npm run build` succeeded. |
| Server connected but no story tools | `PATTERN_STORY=1` was not set. Remove and re-add the server with the `-e` flags. |
| `Error: Unknown claim c7` | A claim id that does not exist. Run `read_story` to see real ids. |
| `ingest_notes` says file not found | The path is relative to `PATTERN_PROJECT_ROOT` (`~/story-test`), not to your current directory. |
| `use_model needs ANTHROPIC_API_KEY` | Part 6 key step was skipped, or Claude Code was not restarted after re-adding the server. |
| Claude invents a project id | Repeat the instruction: use project_id "acme-onboarding" for every call. |
