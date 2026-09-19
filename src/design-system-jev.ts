// Design-system-mode scoring with Jev (TypeSafe AI's System One model): pick
// the best-fitting component from a project's OWN registered design system,
// or report honestly that nothing fits. No web search, no Anthropic call.
//
// Every choice below comes from eval/design-system-eval-set.json runs
// (scripts/design-system-jev-eval.mjs, 38 needs over two real libraries):
//   - ONE candidate per source file, not per exported name: sub-components
//     (DialogTitle, DialogHeader...) are noise that halved Jev's token cost
//     to remove and diluted its confidence margin (variant R vs R2).
//   - Prop names are NOT sent: they misled the scorer (a `ChatDrawer` with an
//     `alert` prop scored 0.37 vs 0.71 without props) and dropping them
//     raised accuracy from ~26 to ~28 of 29 (R2 vs R2B/R2AB).
//   - Re-exported names ARE sent: they advertise what a file bundles
//     (markdown.tsx re-exporting SyntaxHighlightedCode; R2A).
//   - A cached natural-language `summary`, when the registration has one,
//     is the biggest single accuracy/margin gain (R3B: 29/29 in 5 of 5 runs,
//     lowest correct pick 0.55 vs highest "nothing fits" 0.18).
// Jev's probabilities rank well but are NOT calibrated (see the Phase 4
// benchmark), so callers must not present them as confidence percentages.

import { callJev, type NoulQuestion } from "./staged/jev.js";
import { describeFigma, type FigmaCandidateInfo } from "./design-system-figma.js";

export interface JevDesignCandidate {
  name: string;
  props: string[];
  description: string | null;
  usage_example: string | null;
  file_path: string | null;
  reexports?: string[];
  summary?: string | null;
  figma?: FigmaCandidateInfo;
}

export interface JevPoolEntry {
  /** Stable id used as the Jev answer key. */
  key: string;
  /** Source file when known (directory scan); null for manifest components. */
  file: string | null;
  /** Component names this entry stands for. */
  components: string[];
  /** The only text Jev sees about this entry. */
  evidence: string;
}

export interface RankedEntry {
  entry: JevPoolEntry;
  score: number;
}

/** Collapse name-level candidates into one pool entry per source file. */
export function collapseForJev(candidates: JevDesignCandidate[]): JevPoolEntry[] {
  const groups = new Map<string, JevDesignCandidate[]>();
  for (const c of candidates) {
    // Figma components have no file; the node id keeps two same-named
    // components on different pages from merging into one entry.
    const groupKey = c.file_path ?? (c.figma ? `figma:${c.figma.node_id}` : `name:${c.name}`);
    const list = groups.get(groupKey);
    if (list) list.push(c);
    else groups.set(groupKey, [c]);
  }
  const pool: JevPoolEntry[] = [];
  let i = 0;
  for (const group of groups.values()) {
    const file = group[0].file_path;
    const components = [...new Set(group.map((c) => c.name))];
    const reexports = [...new Set(group.flatMap((c) => c.reexports ?? []))].filter((n) => !components.includes(n));
    const description = group.map((c) => c.description).find((d): d is string => !!d);
    const usage = group.map((c) => c.usage_example).find((u): u is string => !!u);
    const summary = group.map((c) => c.summary).find((t): t is string => !!t);
    const figmaText = describeFigma(group[0], process.env.PATTERN_JEV_FIGMA_VARIANTS !== "0");
    const parts = [
      file ? `file: ${file}` : "component",
      `exports: ${[...components, ...reexports].join(", ")}`,
      ...(figmaText ? [figmaText] : []),
      ...(description ? [`doc: ${description}`] : []),
      ...(usage ? [`usage: ${usage}`] : []),
      ...(summary ? [`summary: ${summary}`] : []),
    ];
    pool.push({ key: `c${i++}`, file, components, evidence: parts.join("; ") });
  }
  return pool;
}

const estimateTokens = (text: string): number => Math.ceil(text.length / 3.5) + 30;

/** Split a pool into batches whose Jev `state` stays under a token budget. */
export function chunkPool(pool: JevPoolEntry[], maxTokens: number): JevPoolEntry[][] {
  const batches: JevPoolEntry[][] = [];
  let current: JevPoolEntry[] = [];
  let used = 0;
  for (const entry of pool) {
    const cost = estimateTokens(entry.evidence);
    if (current.length > 0 && used + cost > maxTokens) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(entry);
    used += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export interface JevRankResult {
  ranked: RankedEntry[];
  usage: { input_tokens: number; output_tokens: number };
  batches: number;
}

/**
 * Score every pool entry against the need. Large pools are split into batches
 * (Jev's request budget is ~32k tokens of state) and scored in parallel; each
 * batch is ranked on its own, so cross-batch comparison rests on Jev's scores
 * being comparable across calls -- unverified beyond the single-batch eval.
 */
export async function rankWithJev(
  componentNeed: string,
  pool: JevPoolEntry[],
  maxBatchTokens: number
): Promise<JevRankResult> {
  const batches = chunkPool(pool, maxBatchTokens);
  const usage = { input_tokens: 0, output_tokens: 0 };
  const ranked: RankedEntry[] = [];
  await Promise.all(
    batches.map(async (batch) => {
      const state = {
        component_need: componentNeed,
        candidates: batch.map((e) => ({ id: e.key, evidence: e.evidence })),
      };
      const questions: Record<string, NoulQuestion> = {};
      for (const e of batch) {
        questions[e.key] = {
          type: "noul",
          instructions: `Candidate ${e.key} (${e.components.join(", ")} ${e.file ?? ""}) can fully satisfy the component_need as-is, without being rebuilt.`,
        };
      }
      const res = await callJev({ state, questions });
      usage.input_tokens += res.usage?.input_tokens ?? 0;
      usage.output_tokens += res.usage?.output_tokens ?? 0;
      for (const e of batch) ranked.push({ entry: e, score: res.answers[e.key]?.noul ?? 0 });
    })
  );
  ranked.sort((a, b) => b.score - a.score);
  return { ranked, usage, batches: batches.length };
}
