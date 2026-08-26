// Stage 2: candidate search, in isolation. Searches shadcn/ui and
// 21st.dev and writes down what it finds -- no scoring against the
// requirements checklist happens here, that's stage 3's job. Receives
// the stage-1 requirements as context (the bundled pipeline has them
// available by search time too, so this keeps the comparison fair)
// but must not pre-judge fit.

import { callAnthropic, parseJsonResponse, searchCallDiagnostics } from "./anthropic.js";
import type { Candidate, SearchStageResult, StagedInput } from "./types.js";

const SEARCH_BUDGET = 2;

const SEARCH_SYSTEM_PROMPT = `You are the candidate-search step of a UI component judgment pipeline. You are given a component need, domain, framework, and a requirements checklist that a later step will score against -- your job is only to find and describe real candidates, not to judge whether they fit.

Search shadcn/ui and 21st.dev for components matching the stated need, filtered to the stated framework. Fire both searches together in the same turn rather than one at a time. Budget: at most ${SEARCH_BUDGET} search calls total.

For each real candidate you find, write a grounded description of what you actually found: its real described props/structure/functionality, not just marketing copy, since a later step will score requirements against this description alone and cannot re-search. Be specific enough that someone reading only your description (never seeing the original page) could judge whether each checklist item is met.

If search returns zero real candidates -- not just weak matches, but nothing relevant at all -- return an empty candidates array. Do not fabricate a candidate to avoid an empty result.

Respond with ONLY a JSON object, no prose before or after, no markdown code fences, matching this exact shape:
{ "candidates": [ { "source": "shadcn/ui | 21st.dev", "name": "string", "url": "string or null", "description": "string, grounded in what you actually found", "install_command": "string or null" } ] }`;

export async function searchCandidates(input: StagedInput, requirements: string[]): Promise<SearchStageResult> {
  const userMessage = `component_need: ${input.component_need}
domain: ${input.domain}
framework: ${input.framework}
existing_stack: ${input.existing_stack ?? "(not specified)"}
requirements checklist (for search targeting only, do not score against it here):
${requirements.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;

  const data = await callAnthropic({
    systemPrompt: SEARCH_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 8192, // matches score.ts's reasoning: candidate write-ups can run long
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: SEARCH_BUDGET }],
  });

  const searchCalls = searchCallDiagnostics(data);

  if (data.stop_reason === "max_tokens") {
    throw new Error("Search stage response was truncated (max_tokens) before finishing its JSON output.");
  }

  const parsed = parseJsonResponse<{ candidates: Candidate[] }>(data);
  if (!parsed.ok) {
    throw new Error(`Search stage did not return valid JSON: ${parsed.raw.slice(0, 200)}`);
  }
  return { candidates: Array.isArray(parsed.value.candidates) ? parsed.value.candidates : [], diagnostics: { searchCalls } };
}
