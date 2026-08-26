// Stage 3b: reference search, run only when scoring resolves to
// custom_build. Kept as its own isolated call rather than a 4th named
// pipeline stage, since the plan calls for extract/search/score and this
// is causally downstream of score's verdict, not an independent stage --
// but it's still logged separately, same as the other three.
//
// Reuses enforceReferenceGrounding and applyDeepLinkGrounding from
// src/index.ts verbatim rather than reimplementing them, so the
// no-fabrication and deep-link-verification guarantees are identical to
// the bundled pipeline's -- this stage's whole job is finding candidate
// URLs; the trust decision about them stays centralized in one place.

import { DOMAIN_FOR_SOURCE_KEYWORD, enforceReferenceGrounding, type JudgmentResult } from "../index.js";
import { buildSearchResultUrlsByKeyword, callAnthropic, fetchCallDiagnostics, parseJsonResponse, searchCallDiagnostics } from "./anthropic.js";
import type { ReferenceStageResult, StagedInput } from "./types.js";

const REFERENCE_SYSTEM_PROMPT = `You are the reference-search step of a UI component judgment pipeline, run only when an earlier step decided no existing component covers a UI need well enough. Search TWO reference sources, one search call each:
- Mobbin (site:mobbin.com) for the closest real-app screen matching the stated domain (e.g. real Airbnb screens for an Airbnb-style app).
- Figma Community (site:figma.com/community) for a relevant real component or template file matching the stated domain and component need. Plain web search only -- there is no Figma API token available, don't attempt to use one.

A search result URL is very often a category/browse page (e.g. mobbin.com/explore/mobile/screens/notifications), not a direct link to the specific screen or flow you actually identified. Figma Community results are different: a URL containing "/community/file/" is already file-specific by Figma's own URL structure -- leave it as-is and do not spend a fetch on it. Only a non-"/community/file/" Figma result has the same category-vs-specific gap Mobbin has.

For each Mobbin result, and for any Figma Community result that isn't already a "/community/file/" URL: fetch that result's URL with the web_fetch tool and look in the fetched page content for a more specific permalink pointing at that same specific screen or flow you identified. Use that permalink as the reference "url" ONLY if you can actually see it written in the fetched content -- never construct, guess, or pattern-match a deep-link URL that isn't literally present on the page. Figma's robots.txt blocks automated fetching site-wide, so a Figma category-page fetch will very likely fail outright -- that's expected. Each source gets at most ONE fetch attempt; do not retry by guessing a different URL variant. If a fetch fails or doesn't expose a more specific link, keep the category/search URL as "url" and say so plainly in "reference_description".

Include a reference for each source that actually returned a real, relevant result from a search you actually ran -- never name a plausible-sounding URL from memory for either source. If out of budget, or a search found nothing relevant, that source is simply not included.

Shape the "reference" field based on how many sources actually grounded:
- Both grounded: an array of both reference objects.
- Only one grounded: a single reference object (not a one-element array).
- Neither grounded: reference is null.

Each reference object has: "source" ("Mobbin" or "Figma Community"), "url", and either "flow_name" (Mobbin) or "file_name" (Figma Community). Each also gets its own "reference_description": 1-2 sentences of plain-language description of what that specific screen or file actually shows, grounded only in what you saw in that source's own search result.

Respond with ONLY a JSON object, no prose before or after, no markdown code fences, matching this exact shape:
{ "recommendation": { "reference": { "source": "Mobbin" | "Figma Community", "url": "string", "flow_name": "string (Mobbin only)", "file_name": "string (Figma Community only)", "reference_description": "string" } | [ /* same shape, up to 2 entries */ ] | null } }`;

export async function searchReference(input: StagedInput): Promise<ReferenceStageResult> {
  const userMessage = `component_need: ${input.component_need}\ndomain: ${input.domain}`;

  const data = await callAnthropic({
    systemPrompt: REFERENCE_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 8192, // matches score.ts's reasoning
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: 2 },
      { type: "web_fetch_20250910", name: "web_fetch", max_uses: 2, max_content_tokens: 15000 },
    ],
  });

  const searchCallDetails = searchCallDiagnostics(data);
  const fetchCallDetails = fetchCallDiagnostics(data);
  const searchResultUrlsByKeyword = buildSearchResultUrlsByKeyword(data, DOMAIN_FOR_SOURCE_KEYWORD);

  if (data.stop_reason === "max_tokens") {
    throw new Error("Reference stage response was truncated (max_tokens) before finishing its JSON output.");
  }

  const parsed = parseJsonResponse<{ recommendation: { reference: JudgmentResult["recommendation"] extends infer R ? (R extends { reference: infer Ref } ? Ref : never) : never } }>(data);
  if (!parsed.ok) {
    throw new Error(`Reference stage did not return valid JSON: ${parsed.raw.slice(0, 200)}`);
  }

  // enforceReferenceGrounding mutates a JudgmentResult-shaped object in
  // place; build the minimal shape it needs.
  const shell: JudgmentResult = {
    verdict: "custom_build",
    confidence: "high",
    reason: "scored",
    recommendation: { reference: parsed.value.recommendation?.reference ?? null },
  };
  enforceReferenceGrounding(shell, searchCallDetails, searchResultUrlsByKeyword, fetchCallDetails);

  return {
    reference: shell.recommendation?.reference ?? null,
    diagnostics: { searchCalls: searchCallDetails, fetchCalls: fetchCallDetails.map(({ url, succeeded, error_code }) => ({ url, succeeded, error_code })) },
  };
}
