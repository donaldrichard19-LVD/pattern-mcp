// Stage 1: requirement extraction, in isolation. No tools, no search --
// same wording as step 2 of the bundled system prompt in src/index.ts,
// and the same prompt used in scripts/phase1-extraction-only.mjs, so
// Phase 3's comparison is testing an architecture difference, not a
// reworded prompt.

import { callAnthropic, parseJsonResponse } from "./anthropic.js";
import type { ExtractStageResult, StagedInput } from "./types.js";

const EXTRACTION_SYSTEM_PROMPT = `You are the requirement-extraction step of a UI component judgment pipeline. Given a component need and domain, turn it into a concrete checklist of elements the component must contain -- specific enough to check against real code, not a vibe. Ground it in the stated domain, not the component name alone. Extract exactly 8 checklist items, ranked by importance to the component's core function (most important first) -- a fixed count, not a range, so coverage = met/total isn't itself a moving target across runs.

Respond with ONLY a JSON object, no prose before or after, no markdown code fences, matching this exact shape:
{ "requirements": ["string", "string", "string", "string", "string", "string", "string", "string"] }`;

export async function extractRequirements(input: StagedInput): Promise<ExtractStageResult> {
  const userMessage = `component_need: ${input.component_need}\ndomain: ${input.domain}\nframework: ${input.framework}`;
  const data = await callAnthropic({ systemPrompt: EXTRACTION_SYSTEM_PROMPT, userMessage, maxTokens: 1024 });
  const parsed = parseJsonResponse<{ requirements: string[] }>(data);
  if (!parsed.ok) {
    throw new Error(`Extraction stage did not return valid JSON: ${parsed.raw.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed.value.requirements) || parsed.value.requirements.length === 0) {
    throw new Error("Extraction stage returned no requirements array");
  }
  return { requirements: parsed.value.requirements, diagnostics: { searchCalls: 0, note: "extraction makes no tool calls" } };
}
