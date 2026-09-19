// Thin client for TypeSafe AI's System One API (Jev). Mirrors anthropic.ts's
// shape deliberately, so score-jev.ts reads the same way score.ts does --
// this is a drop-in alternative scorer, not a different architecture.
//
// Jev has no tool use and no search: it only judges the `state` you hand
// it. That's why this client is only ever called from score-jev.ts, never
// from extract.ts or search.ts -- those stages still need web_search and
// stay on Sonnet regardless of which scorer is selected.
//
// See validation-plan-staged-pipeline.md and the spike plan this
// implements (Pattern x Jev spike plan) for why this is scoped to the
// score stage only.

export const TYPESAFE_API_KEY = process.env.TYPESAFE_API_KEY;
export const JEV_MODEL = process.env.PATTERN_JEV_MODEL ?? "jev-latest";

export interface NoulQuestion {
  type: "noul";
  instructions: string;
}

export interface JevRequest {
  model: string;
  state: unknown;
  questions: Record<string, NoulQuestion>;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface JevResponse {
  model: string;
  answers: Record<string, NoulAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Jev's published request budget is ~32,000 tokens for state plus the
 * longest single question (64k tokens per request overall). Not enforced
 * client-side here -- a request that exceeds it fails at the API with a
 * clear error, which score-jev.ts surfaces rather than silently truncating
 * evidence text to fit.
 */
export async function callJev(request: Omit<JevRequest, "model">): Promise<JevResponse> {
  if (!TYPESAFE_API_KEY) {
    throw new Error("TYPESAFE_API_KEY is not set. Export it in the environment running the Jev scorer.");
  }
  const response = await fetch(process.env.TYPESAFE_API_URL ?? "https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TYPESAFE_API_KEY}`,
    },
    body: JSON.stringify({ model: JEV_MODEL, ...request }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`TypeSafe API error ${response.status}: ${errText}`);
  }
  return (await response.json()) as JevResponse;
}
