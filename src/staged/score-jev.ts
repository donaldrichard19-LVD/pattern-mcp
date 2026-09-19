// Alternative to score.ts: same stage-3 contract (requirements + candidates
// in, ScoreStageResult out) but the coverage judgment is made by Jev
// (TypeSafe AI's System One model) instead of Sonnet.
//
// Why this is safe to isolate: score.ts already receives candidates as
// plain evidence text with no search tool available, so swapping the
// model that reads that evidence doesn't change what evidence exists --
// only how it's judged. Extraction and search stay on Sonnet regardless
// (Jev has no web_search/web_fetch), so this only ever replaces the
// scoreCandidates() call in pipeline.ts, nothing upstream of it.
//
// One real architectural difference from score.ts, worth calling out
// rather than hiding: score.ts's prompt has the model pick "the single
// best-fitting candidate" and only scores that one. Because Jev is cheap
// enough to run against every candidate in parallel, this scores ALL
// candidates and picks the highest-coverage one in code, deterministically,
// rather than asking a model to pre-select which candidate to look at.
// That's a plausible accuracy improvement (no chance of the picker step
// discarding a better-fitting candidate before scoring) but it is NOT a
// validated claim -- the benchmark in scripts/phase4-jev-comparison.mjs is
// what actually tests whether it helps or just adds noise.

import { callJev, type NoulQuestion } from "./jev.js";
import type { Candidate, RequirementChecked, ScoreStageResult } from "./types.js";

/** noul >= this counts the requirement as met. Configurable so the
 * benchmark can sweep it against gold data rather than guessing once. */
const MET_THRESHOLD = Number(process.env.PATTERN_JEV_MET_THRESHOLD ?? 0.5);

/** Per-item probabilities in this band are the new boundary-risk signal,
 * replacing score.ts's whole-pipeline 3x ensemble rerun -- see the spike
 * plan's section 3. Not yet validated against how often it agrees with
 * the existing ensemble; that comparison is part of the benchmark. */
const BOUNDARY_LOW = Number(process.env.PATTERN_JEV_BOUNDARY_LOW ?? 0.35);
const BOUNDARY_HIGH = Number(process.env.PATTERN_JEV_BOUNDARY_HIGH ?? 0.65);

export interface CandidateJevScore {
  source: string;
  name: string;
  coverage_fraction: number;
  probabilities: Record<string, number>;
  boundary_items: string[];
}

export interface JevScoreStageResult extends ScoreStageResult {
  /** Diagnostics beyond the ScoreStageResult contract -- kept separate so
   * this type stays a strict superset callers of score.ts can still use. */
  per_candidate: CandidateJevScore[];
}

function requirementKey(index: number): string {
  return `req_${index}`;
}

async function scoreOneCandidate(
  componentNeed: string,
  domain: string,
  requirements: string[],
  candidate: Candidate
): Promise<CandidateJevScore> {
  const questions: Record<string, NoulQuestion> = {};
  requirements.forEach((requirement, i) => {
    questions[requirementKey(i)] = {
      type: "noul",
      instructions: `The candidate component satisfies this requirement: ${requirement}`,
    };
  });

  const response = await callJev({
    state: {
      component_need: componentNeed,
      domain,
      candidate: {
        source: candidate.source,
        name: candidate.name,
        evidence: candidate.description,
      },
    },
    questions,
  });

  const probabilities: Record<string, number> = {};
  const boundary_items: string[] = [];
  let metCount = 0;
  requirements.forEach((requirement, i) => {
    const answer = response.answers[requirementKey(i)];
    const p = answer?.noul ?? 0;
    probabilities[requirement] = p;
    if (p >= MET_THRESHOLD) metCount += 1;
    if (p >= BOUNDARY_LOW && p <= BOUNDARY_HIGH) boundary_items.push(requirement);
  });

  return {
    source: candidate.source,
    name: candidate.name,
    coverage_fraction: requirements.length === 0 ? 0 : metCount / requirements.length,
    probabilities,
    boundary_items,
  };
}

export async function scoreCandidatesJev(
  componentNeed: string,
  domain: string,
  requirements: string[],
  candidates: Candidate[]
): Promise<JevScoreStageResult> {
  if (candidates.length === 0) {
    return {
      reason: "no_candidates_found",
      requirements_checked: null,
      coverage: null,
      recommendation: { source: null, install_command: null, component_description: null },
      per_candidate: [],
    };
  }

  // Score every candidate in parallel -- this is the step that's supposed
  // to be cheap and fast with Jev. See the file header note above: this is
  // a deliberate departure from score.ts's single-candidate-picked-first
  // approach, and needs the benchmark to confirm it's actually better and
  // not just different.
  const perCandidate = await Promise.all(
    candidates.map((c) => scoreOneCandidate(componentNeed, domain, requirements, c))
  );

  let best = perCandidate[0];
  let bestIndex = 0;
  perCandidate.forEach((c, i) => {
    if (c.coverage_fraction > best.coverage_fraction) {
      best = c;
      bestIndex = i;
    }
  });

  const bestCandidate = candidates[bestIndex];
  const metCount = Math.round(best.coverage_fraction * requirements.length);
  const requirements_checked: RequirementChecked[] = requirements.map((requirement) => {
    const p = best.probabilities[requirement];
    return {
      requirement,
      met: p >= MET_THRESHOLD,
      evidence: `Jev noul probability: ${p.toFixed(3)}`,
    };
  });

  const coveragePct = requirements.length === 0 ? 0 : (metCount / requirements.length) * 100;
  const coverage = `${metCount}/${requirements.length} (${coveragePct % 1 === 0 ? coveragePct : coveragePct.toFixed(1)}%)`;

  return {
    reason: "scored",
    requirements_checked,
    coverage,
    recommendation: {
      source: bestCandidate.source,
      install_command: bestCandidate.install_command ?? null,
      // Jev returns no prose -- it can't write a component_description.
      // Fall back to the search stage's own grounded description rather
      // than fabricate one here.
      component_description: bestCandidate.description,
    },
    per_candidate: perCandidate,
  };
}
