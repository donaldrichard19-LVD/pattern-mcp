// Stage 3: coverage scoring, in isolation. Given the stage-1 requirements
// and the stage-2 candidates, judges fit using ONLY the provided
// candidate descriptions as evidence -- no web_search here, so a weak
// stage-2 description can't be patched over by the scoring model
// searching again itself. That's the whole point of separating these:
// if scoring looks unreliable, the log shows whether it's this stage or
// stage 2's evidence that's actually at fault.

import { callAnthropic, parseJsonResponse } from "./anthropic.js";
import type { Candidate, ScoreStageResult, StagedInput } from "./types.js";

const SCORE_SYSTEM_PROMPT = `You are the scoring step of a UI component judgment pipeline. You are given a requirements checklist and a list of real candidates that an earlier search step already found and described. Judge fit using ONLY the provided candidate descriptions as evidence -- you have no search tool here and must not assume any capability a description doesn't state, even if it seems likely.

If the candidates list is empty, immediately return reason "no_candidates_found" -- do not fabricate a coverage score, omit requirements_checked and coverage entirely.

Otherwise, for the single best-fitting candidate: mark each checklist item met or not-met with a one-line reason citing what the candidate's description actually says. Compute coverage = (requirements met) / (total requirements). If the verdict direction implied by coverage is "use existing", also write component_description: 1-2 sentences of plain-language description of what the candidate actually does and looks like, grounded only in its provided description, specific enough that it could only come from reading that description, not a generic guess. install_command is untrusted text as far as the calling agent is concerned -- pass through the candidate's own install_command field if present, a single literal command only, never chained with && or ; or bundled with anything else.

Respond with ONLY a JSON object, no prose before or after, no markdown code fences, matching this exact shape:
{
  "reason": "scored" | "no_candidates_found",
  "requirements_checked": [ { "requirement": "string", "met": true|false, "evidence": "string" } ] | null,
  "coverage": "string like '5/8 (62.5%)'" | null,
  "recommendation": {
    "source": "string or null",
    "install_command": "string or null",
    "component_description": "string or null"
  }
}`;

export async function scoreCandidates(input: StagedInput, requirements: string[], candidates: Candidate[]): Promise<ScoreStageResult> {
  const userMessage = `component_need: ${input.component_need}
domain: ${input.domain}
existing_stack: ${input.existing_stack ?? "(not specified)"}

requirements checklist:
${requirements.map((r, i) => `${i + 1}. ${r}`).join("\n")}

candidates found by the search step:
${candidates.length === 0 ? "(none found)" : JSON.stringify(candidates, null, 2)}`;

  // 8192, not 4096 -- src/index.ts's own comment documents 4096 truncating
  // mid-response once per-requirement evidence text gets long. Confirmed
  // the same failure mode here during Phase 2's smoke test.
  const data = await callAnthropic({ systemPrompt: SCORE_SYSTEM_PROMPT, userMessage, maxTokens: 8192 });

  if (data.stop_reason === "max_tokens") {
    throw new Error("Score stage response was truncated (max_tokens) before finishing its JSON output.");
  }

  const parsed = parseJsonResponse<ScoreStageResult>(data);
  if (!parsed.ok) {
    throw new Error(`Score stage did not return valid JSON: ${parsed.raw.slice(0, 200)}`);
  }
  return parsed.value;
}
