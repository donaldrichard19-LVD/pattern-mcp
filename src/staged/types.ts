// Shared types for the staged (extract / search / score) pipeline.
//
// This is Phase 2 of validation-plan-staged-pipeline.md: an experimental,
// standalone alternative to the bundled single-call pipeline in
// src/index.ts, built to be compared against it in Phase 3 -- not (yet)
// the production path. Nothing here is wired into the shipped MCP server.

export interface StagedInput {
  component_need: string;
  domain: string;
  framework: string;
  existing_stack?: string;
}

export interface Candidate {
  /** e.g. "shadcn/ui", "21st.dev" -- whatever the model itself reports finding it under */
  source: string;
  name: string;
  url?: string | null;
  /** Grounded write-up of what was actually found -- real props/structure, not marketing copy */
  description: string;
  install_command?: string | null;
}

export interface ExtractStageResult {
  requirements: string[];
  diagnostics: { searchCalls: 0; note: "extraction makes no tool calls" };
}

export interface SearchStageResult {
  candidates: Candidate[];
  diagnostics: {
    searchCalls: Array<{ query: unknown; succeeded: boolean; error_code?: string }>;
  };
}

export interface RequirementChecked {
  requirement: string;
  met: boolean;
  evidence: string;
}

export interface ScoreStageResult {
  reason: "scored" | "no_candidates_found";
  requirements_checked: RequirementChecked[] | null;
  coverage: string | null;
  recommendation: {
    source: string | null;
    install_command: string | null;
    component_description: string | null;
  };
}

export interface ReferenceStageResult {
  reference: import("../index.js").ReferenceEntry | import("../index.js").ReferenceEntry[] | null;
  diagnostics: {
    searchCalls: Array<{ query: unknown; succeeded: boolean; error_code?: string }>;
    fetchCalls: Array<{ url?: string; succeeded: boolean; error_code?: string }>;
  };
}

/** Final shape, matching JudgmentResult's public fields so it's directly comparable to the bundled pipeline's output. */
export interface StagedJudgmentResult {
  verdict: string;
  confidence: string;
  reason: string;
  computed_at: string;
  requirements_checked: RequirementChecked[] | null;
  coverage: string | null;
  recommendation: {
    source: string | null;
    install_command: string | null;
    component_description: string | null;
    reference?: import("../index.js").ReferenceEntry | import("../index.js").ReferenceEntry[] | null;
  } | null;
  ensemble?: { triggered: boolean; runs?: string[]; agreement?: string };
  [key: string]: unknown;
}

/** Independent per-stage log entry -- the whole point of staging is that each stage's input/output is separately inspectable. */
export interface StageLogEntry {
  stage: "extract" | "search" | "score" | "reference";
  timestamp: string;
  input: unknown;
  output: unknown;
  ok: boolean;
  error?: string;
}
