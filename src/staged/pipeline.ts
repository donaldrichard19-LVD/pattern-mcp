// Phase 2 orchestrator: runs extract -> search -> score -> (reference, if
// custom_build) as four independent calls instead of src/index.ts's one
// bundled call, applying the same server-side threshold/recount/ensemble
// logic (reused, not reimplemented) so Phase 3 is comparing architecture,
// not comparing whose enforcement code is stricter.
//
// This is experimental and NOT wired into the shipped MCP server -- see
// scripts/phase2-staged-smoke-test.mjs for how to invoke it standalone.

import {
  enforceCoverageRecount,
  enforceRecommendationConsistency,
  enforceVerdictThreshold,
  isBoundaryRisk,
  isSkipListMatch,
  type JudgmentResult,
} from "../index.js";
import { extractRequirements } from "./extract.js";
import { searchCandidates } from "./search.js";
import { scoreCandidates } from "./score.js";
import { searchReference } from "./reference.js";
import type { StagedInput, StagedJudgmentResult, StageLogEntry } from "./types.js";

export interface StagedRunResult {
  result: StagedJudgmentResult;
  log: StageLogEntry[];
}

function nowIso(): string {
  return new Date().toISOString();
}

async function logged<T>(log: StageLogEntry[], stage: StageLogEntry["stage"], input: unknown, fn: () => Promise<T>): Promise<T> {
  const timestamp = nowIso();
  try {
    const output = await fn();
    log.push({ stage, timestamp, input, output, ok: true });
    return output;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.push({ stage, timestamp, input, output: null, ok: false, error: message });
    throw err;
  }
}

/** One full extract -> search -> score -> (reference) pass. No ensemble here -- runSingleStagedPass wraps this 3x itself when boundary risk is detected, mirroring judgeComponent in src/index.ts. */
async function runSingleStagedPass(input: StagedInput, log: StageLogEntry[]): Promise<StagedJudgmentResult> {
  const extractInput = { component_need: input.component_need, domain: input.domain, framework: input.framework };
  const extraction = await logged(log, "extract", extractInput, () => extractRequirements(input));

  const searchInput = { ...extractInput, requirements: extraction.requirements };
  const search = await logged(log, "search", searchInput, () => searchCandidates(input, extraction.requirements));

  const scoreInput = { requirements: extraction.requirements, candidates: search.candidates };
  const score = await logged(log, "score", scoreInput, () => scoreCandidates(input, extraction.requirements, search.candidates));

  const result: StagedJudgmentResult = {
    verdict: score.reason === "no_candidates_found" ? "custom_build" : "use_existing", // placeholder; enforceVerdictThreshold corrects the "scored" case from coverage
    confidence: score.reason === "no_candidates_found" ? "high" : "medium",
    reason: score.reason,
    computed_at: nowIso().slice(0, 10),
    requirements_checked: score.requirements_checked,
    coverage: score.coverage,
    recommendation: {
      source: score.recommendation.source,
      install_command: score.recommendation.install_command,
      component_description: score.recommendation.component_description,
      reference: null,
    },
  };

  enforceCoverageRecount(result);
  enforceVerdictThreshold(result);

  if (result.verdict === "custom_build") {
    const referenceInput = { component_need: input.component_need, domain: input.domain };
    const referenceResult = await logged(log, "reference", referenceInput, () => searchReference(input));
    if (result.recommendation) result.recommendation.reference = referenceResult.reference;
  }

  enforceRecommendationConsistency(result);
  return result;
}

export async function runStagedPipeline(input: StagedInput): Promise<StagedRunResult> {
  const log: StageLogEntry[] = [];

  if (isSkipListMatch(input.component_need)) {
    const result: StagedJudgmentResult = {
      verdict: "use_existing",
      confidence: "high",
      reason: "skip_list",
      computed_at: nowIso().slice(0, 10),
      requirements_checked: null,
      coverage: null,
      recommendation: {
        source: "shadcn/ui or 21st.dev (commodity primitive)",
        install_command: null,
        component_description: null,
        reference: null,
      },
      ensemble: { triggered: false },
    };
    return { result, log };
  }

  const first = await runSingleStagedPass(input, log);

  if (!isBoundaryRisk(first as unknown as JudgmentResult)) {
    first.ensemble = { triggered: false };
    return { result: first, log };
  }

  const [second, third] = await Promise.all([runSingleStagedPass(input, log), runSingleStagedPass(input, log)]);
  const passes = [first, second, third];
  const verdicts = passes.map((p) => p.verdict);
  const counts = new Map<string, number>();
  for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1);
  const [majorityVerdict, majorityCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const agreement = `${majorityCount}/${passes.length}`;

  const winningPass = passes.find((p) => p.verdict === majorityVerdict) ?? first;
  const base = winningPass;
  base.verdict = majorityVerdict;
  if (majorityCount < passes.length) base.confidence = "low";
  base.ensemble = { triggered: true, runs: verdicts, agreement };

  return { result: base, log };
}
