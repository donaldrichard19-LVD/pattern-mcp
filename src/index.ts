#!/usr/bin/env node
/**
 * ui-component-judgment-mcp
 *
 * MCP server exposing a single tool, `recommend_component`, that judges
 * whether a UI component need should be met with an existing shadcn/ui or
 * 21st.dev component, or requires a custom build guided by a real-app
 * reference from Mobbin.
 *
 * The judgment logic (extract requirements -> search -> score real code ->
 * threshold into a verdict) is delegated to a single Anthropic API call
 * with the server-side web_search tool enabled, so the same reasoning
 * this project validated by hand in conversation is what runs here.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// Configurable so Sonnet vs. Haiku can be A/B tested without a code change.
// Defaults to Sonnet 5. Try MODEL=claude-haiku-4-5-20251001 to test the
// cheaper tier -- re-run the 5 validated test cases from the product brief
// (price breakdown, cancellation policy, earnings dashboard, gallery,
// messaging) and diff verdicts before trusting it in production.
const MODEL = process.env.UI_JUDGMENT_MODEL ?? "claude-sonnet-5";

// Search budget for candidate discovery. Defaults to 2, matching the
// process the system prompt was originally validated against. Set to
// "unlimited" to remove the cap entirely (enforced server-side via the
// web_search tool's max_uses -- not just prompt instruction, since models
// don't reliably self-limit against a purely textual budget).
const SEARCH_BUDGET_RAW = process.env.UI_JUDGMENT_SEARCH_BUDGET ?? "2";
const SEARCH_BUDGET: number | null =
  SEARCH_BUDGET_RAW.trim().toLowerCase() === "unlimited"
    ? null
    : (() => {
        const parsed = Number.parseInt(SEARCH_BUDGET_RAW, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(
            `UI_JUDGMENT_SEARCH_BUDGET must be a positive integer or "unlimited", got: ${SEARCH_BUDGET_RAW}`
          );
        }
        return parsed;
      })();

// Static skip-list: single-purpose primitives with no meaningful internal
// structure to score coverage against. Decided in the product brief as a
// starting point -- revisit once real usage data exists (see README).
const SKIP_LIST = [
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

const TOOL_NAME = "recommend_component";

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
  },
  required: ["component_need", "domain", "framework"],
} as const;

function buildSystemPrompt(searchBudget: number | null): string {
  const budgetLine =
    searchBudget === null
      ? "Budget: no fixed limit on search calls for candidate discovery -- search as much as genuinely helps you find and verify real candidates, but don't search redundantly once you have enough to score confidently."
      : `Budget: at most ${searchBudget} search call${searchBudget === 1 ? "" : "s"} for candidate discovery. This is separate from, and does not include, the Mobbin lookup in step 6 -- one extra search call is reserved for that and will not work if you spend it here.`;
  return `You are a UI component judgment layer. Given a component need, you decide whether it should be met with an existing shadcn/ui or 21st.dev component, or requires a custom build guided by a real-app reference. You have access to a web_search tool -- use it.

Follow this process exactly:

1. SKIP-LIST CHECK
If the component need is a trivial, single-purpose primitive with no meaningful internal structure (button, input, checkbox, label, badge, spinner, loader, tooltip, avatar, icon), skip the rest of this process and return verdict "use_existing" with reason "skip_list", confidence "high", and a note that this is a commodity primitive not worth scoring.

2. EXTRACT REQUIREMENTS
Turn the component need + domain into a concrete checklist of elements the component must contain -- specific enough to check against real code, not a vibe. Ground it in the stated domain, not the component name alone. Extract exactly 8 checklist items, ranked by importance to the component's core function (most important first) -- a fixed count, not a range, so coverage = met/total isn't itself a moving target across runs.

3. SEARCH FOR CANDIDATES
Search shadcn/ui and 21st.dev for components matching the need, filtered to the stated framework. Fire the shadcn and 21st.dev searches together in the same turn (they're independent lookups) rather than one at a time -- this avoids re-sending the growing conversation on extra round-trips. ${budgetLine} If those don't surface enough to score, proceed with what you have rather than continuing to search -- a "low confidence, here's why" verdict is more useful than an unbounded search loop.

If search returns zero real candidates -- not just weak matches, but nothing relevant at all (e.g. only vendor policy pages, unrelated components) -- stop here and return verdict "custom_build" with reason "no_candidates_found". Do not fabricate a coverage score in this case; omit requirements_checked and coverage entirely.

4. SCORE COVERAGE AGAINST THE CHECKLIST
For each real candidate, evaluate against the checklist using actual evidence you can find about the component's real props/structure/code -- not just its marketing description, since descriptions can claim functionality the component doesn't actually have. Mark each requirement met or not-met with a one-line reason. Compute coverage = (requirements met) / (total requirements) for the best-fitting candidate.

5. APPLY VERDICT THRESHOLDS
coverage >= 80% -> verdict "use_existing", confidence "high"
coverage 40-79% -> verdict "use_existing", confidence "low" (list the missing fields)
coverage < 40% -> verdict "custom_build"

6. IF custom_build
Search Mobbin (site:mobbin.com) for the closest real-app reference matching the stated domain (e.g. real Airbnb screens for an Airbnb-style app), using the one search call reserved for this step. One search call is enough -- return that reference plus the requirement checklist from step 2 as the build spec. Only include a "reference" if you actually ran this search and it returned a real result -- if you're out of search budget or the search found nothing, set "reference" to null rather than naming a plausible-sounding URL from memory. An unverified reference is worse than none: it will be silently discarded server-side if it isn't backed by an actual successful Mobbin search, so there is no benefit to guessing.

If you do include a reference, also include "reference_description": 1-2 sentences of plain-language description of what the reference screen actually shows -- specific enough that an agent that can't open the URL still has something to act on. E.g. "Airbnb's checkout screen shows the cancellation policy as an expandable section below the price breakdown, with the exact refund percentage next to each date threshold." Base this on what you actually saw in the search result, not a generic guess at what the screen probably looks like.

7. EXISTING STACK TIEBREAKER
If existing_stack is provided and two candidates score similarly, prefer the one matching the existing stack. Never use it as a hard filter that excludes a genuinely better-scoring candidate from a different source.

Respond with ONLY a single JSON object, no prose before or after, no markdown code fences, matching this exact shape:

{
  "verdict": "use_existing" | "custom_build",
  "confidence": "high" | "medium" | "low",
  "reason": "scored" | "no_candidates_found" | "skip_list",
  "computed_at": "<today's date, ISO format>",
  "requirements_checked": [ { "requirement": "string", "met": true|false, "evidence": "string" } ] | null,
  "coverage": "string like '5/7 (71%)'" | null,
  "recommendation": {
    "source": "string or null",
    "install_command": "string or null",
    "reference": { "source": "Mobbin", "url": "string", "flow_name": "string", "reference_description": "string" } | null
  }
}`;
}

type SinglePassResult = { ok: true; result: JudgmentResult } | { ok: false; raw: string };

async function runSinglePass(input: {
  component_need: string;
  domain: string;
  framework: string;
  existing_stack?: string;
}): Promise<SinglePassResult> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Export it in the environment running this MCP server."
    );
  }

  // Fast path: skip-list check happens locally too, so trivial primitives
  // never spend a real API call. The system prompt also enforces this, but
  // checking here avoids the round-trip entirely for the common case.
  const needLower = input.component_need.toLowerCase().trim();
  const isSkippable = SKIP_LIST.some(
    (item) => needLower === item || needLower === `a ${item}` || needLower === `an ${item}`
  );
  if (isSkippable) {
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
          source: "shadcn/ui or 21st.dev (commodity primitive)",
          install_command: null,
          reference: null,
        },
      },
    };
  }

  const userMessage = `component_need: ${input.component_need}
domain: ${input.domain}
framework: ${input.framework}
existing_stack: ${input.existing_stack ?? "(not specified)"}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      // Raised from 4096: higher search budgets produce more candidates
      // and more per-requirement evidence text, and 4096 was observed
      // truncating mid-response (stop_reason "max_tokens"), which corrupts
      // the JSON extractJson() pulls out below.
      max_tokens: 8192,
      // System prompt is identical on every call, so mark it cacheable --
      // cache reads cost roughly a tenth of fresh input tokens. This is
      // the single biggest cost lever here: the same ~800-token prompt is
      // otherwise re-sent in full on every turn of the search loop, and on
      // every separate tool call besides.
      system: [
        {
          type: "text",
          text: buildSystemPrompt(SEARCH_BUDGET),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userMessage }],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          // Server-enforced cap, not just prompt instruction -- omitted
          // entirely when SEARCH_BUDGET is null (unlimited). +1 reserves a
          // slot for the step-6 Mobbin lookup so it doesn't have to compete
          // with discovery for the same budget: without this, discovery
          // searches (fired first) consumed the whole cap and the Mobbin
          // search was silently blocked (max_uses_exceeded) every time a
          // custom_build verdict was reached, and the model backfilled a
          // plausible-looking but ungrounded reference URL instead of
          // reporting that it never actually searched -- confirmed via a
          // direct rerun where 0 Mobbin queries were attempted but a
          // specific Mobbin URL was still returned.
          ...(SEARCH_BUDGET !== null ? { max_uses: SEARCH_BUDGET + 1 } : {}),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as {
    content: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: unknown;
      id?: string;
      tool_use_id?: string;
      content?: unknown;
    }>;
    stop_reason?: string;
  };

  // Diagnostic only -- logged to stderr (stdout is the MCP JSON-RPC
  // channel) so callers can measure actual vs. attempted search-call
  // counts against the configured budget without it leaking into the
  // tool's JSON contract. "Attempted" (server_tool_use) can exceed the
  // configured max_uses -- the API still emits a block for the blocked
  // attempt, paired with a web_search_tool_result carrying error_code
  // "max_uses_exceeded" rather than real results. Match calls to results
  // by tool_use_id to tell genuine searches apart from blocked ones.
  const searchCalls = data.content.filter(
    (block) => block.type === "server_tool_use" && block.name === "web_search"
  );
  const searchResultsById = new Map(
    data.content
      .filter((block) => block.type === "web_search_tool_result")
      .map((block) => [block.tool_use_id, block.content])
  );
  const searchCallDetails = searchCalls.map((call) => {
    const result = searchResultsById.get(call.id);
    const isError =
      typeof result === "object" && result !== null && !Array.isArray(result) && "error_code" in (result as object);
    return {
      query: call.input,
      succeeded: !isError,
      error_code: isError ? (result as { error_code?: string }).error_code : undefined,
    };
  });
  console.error(
    JSON.stringify({
      diagnostic: "search_calls",
      attempted: searchCallDetails.length,
      succeeded: searchCallDetails.filter((d) => d.succeeded).length,
      budget: SEARCH_BUDGET,
      stop_reason: data.stop_reason,
      calls: searchCallDetails,
    })
  );

  // A higher search budget means more candidates and evidence text to
  // generate -- if the model still hits max_tokens, the response is cut
  // mid-JSON and must not be silently returned as if it were valid.
  if (data.stop_reason === "max_tokens") {
    throw new Error(
      "Anthropic response was truncated (stop_reason: max_tokens) before finishing its JSON output. Raise max_tokens or reduce the search budget."
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

  enforceReferenceGrounding(parsed, searchCallDetails);
  enforceCoverageRecount(parsed);
  enforceVerdictThreshold(parsed);

  return { ok: true, result: parsed };
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
const BOUNDARY_RISK_MET_COUNTS_FOR_8_ITEMS = new Set([3, 4, 6, 7]);

function isBoundaryRisk(result: JudgmentResult): boolean {
  if (result.reason !== "scored") return false;

  const items = result.requirements_checked;
  if (!Array.isArray(items) || items.length === 0) return true; // malformed -- be conservative

  const total = items.length;
  if (total !== 8) return true; // extraction didn't follow the fixed-8 instruction -- the precomputed boundary table doesn't apply, so don't trust a single run

  const met = items.filter((item) => item.met === true).length;
  return BOUNDARY_RISK_MET_COUNTS_FOR_8_ITEMS.has(met);
}

// Orchestrates the ensemble: run once, and only pay for 2 more full
// pipeline passes when the single-run result landed close enough to a
// verdict threshold that a single item's judgment swinging could flip
// the answer. Cases far from any boundary return the fast single-run
// path unchanged, at no extra cost.
async function judgeComponent(input: {
  component_need: string;
  domain: string;
  framework: string;
  existing_stack?: string;
}): Promise<string> {
  const first = await runSinglePass(input);
  if (!first.ok) return first.raw;

  if (!isBoundaryRisk(first.result)) {
    first.result.ensemble = { triggered: false };
    return JSON.stringify(first.result);
  }

  console.error(
    JSON.stringify({
      diagnostic: "ensemble_triggered",
      reason: first.result.reason,
      coverage: first.result.coverage,
    })
  );

  const [second, third] = await Promise.all([runSinglePass(input), runSinglePass(input)]);
  const passes = [first, second, third].filter((p): p is { ok: true; result: JudgmentResult } => p.ok);

  const verdicts = passes.map((p) => p.result.verdict);
  const counts = new Map<string, number>();
  for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1);
  const [majorityVerdict, majorityCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const agreement = `${majorityCount}/${passes.length}`;

  const base = first.result;
  base.verdict = majorityVerdict;
  // Unanimous agreement keeps whatever confidence the base run computed
  // for itself (already threshold-correct); any split forces "low" --
  // a genuine disagreement across identical inputs is real uncertainty
  // the tool should surface, not paper over with a confident-sounding verdict.
  if (majorityCount < passes.length) base.confidence = "low";
  base.ensemble = { triggered: true, runs: verdicts, agreement };

  console.error(
    JSON.stringify({
      diagnostic: "ensemble_decision",
      runs: verdicts,
      agreement,
      finalVerdict: base.verdict,
      finalConfidence: base.confidence,
    })
  );

  return JSON.stringify(base);
}

interface JudgmentResult {
  verdict: string;
  confidence: string;
  reason: string;
  coverage?: string | null;
  requirements_checked?: Array<{ requirement?: string; met?: boolean; evidence?: string }> | null;
  recommendation?: {
    source?: string | null;
    install_command?: string | null;
    reference?: { url?: string; flow_name?: string; source?: string; reference_description?: string } | null;
  } | null;
  ensemble?: { triggered: boolean; runs?: string[]; agreement?: string };
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
function enforceCoverageRecount(parsed: JudgmentResult): void {
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
function parseCoveragePercent(coverage: string | null | undefined): number | null {
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

function enforceVerdictThreshold(parsed: JudgmentResult): void {
  if (parsed.reason !== "scored") return;
  const pct = parseCoveragePercent(parsed.coverage);
  if (pct === null) return;

  let correctVerdict: string;
  let correctConfidence: string | null;
  if (pct >= 80) {
    correctVerdict = "use_existing";
    correctConfidence = "high";
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

// Confirmed by direct testing: the model returns a specific-looking Mobbin
// URL/flow_name even when it made zero Mobbin search calls that turn --
// fabricated from prior knowledge, not grounded in a real search result.
// Strip any reference not backed by an actual successful mobbin.com call.
function enforceReferenceGrounding(
  parsed: JudgmentResult,
  searchCallDetails: Array<{ query: unknown; succeeded: boolean }>
): void {
  const reference = parsed.recommendation?.reference;
  if (!reference) return;

  const groundedInRealSearch = searchCallDetails.some((d) => {
    if (!d.succeeded) return false;
    const q = typeof d.query === "object" && d.query !== null ? JSON.stringify(d.query) : String(d.query ?? "");
    return q.toLowerCase().includes("mobbin");
  });

  if (!groundedInRealSearch) {
    console.error(
      JSON.stringify({
        diagnostic: "reference_stripped",
        reason: "no successful mobbin.com search call found to ground this reference",
        strippedReference: reference,
      })
    );
    if (parsed.recommendation) parsed.recommendation.reference = null;
  }
}

// The system prompt asks for a bare JSON object, but models don't always
// comply -- observed wrapping the object in ```json fences and, once,
// prefacing it with a sentence of prose. Downstream agents parse this
// output directly (the README's whole contract is structured JSON, not
// prose), so pull out the {...} substring rather than trust verbatim
// compliance.
function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

const server = new Server(
  { name: "ui-component-judgment-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: TOOL_NAME,
      description:
        "Judges whether a UI component need should be met with an existing " +
        "shadcn/ui or 21st.dev component, or requires a custom build guided " +
        "by a real-app reference from Mobbin. Returns a structured verdict " +
        "(use_existing | custom_build), not a list of search results. Call " +
        "this whenever you are about to scaffold a new, non-trivial UI " +
        "component from scratch, when you're unsure your own default output " +
        "will look production-quality, or when the user references a " +
        "specific app's pattern to match. On a custom_build verdict, open " +
        "or fetch the returned Mobbin reference URL if you have that " +
        "capability, and describe what the reference screen shows before " +
        "starting the build. Do not just print the URL and move on.",
      inputSchema: INPUT_SCHEMA,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== TOOL_NAME) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = request.params.arguments as {
    component_need: string;
    domain: string;
    framework: string;
    existing_stack?: string;
  };

  try {
    const resultText = await judgeComponent(args);
    return {
      content: [{ type: "text", text: resultText }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error starting ui-component-judgment-mcp:", err);
  process.exit(1);
});
