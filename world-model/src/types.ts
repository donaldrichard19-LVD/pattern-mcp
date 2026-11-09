export const NODE_TYPES = [
  "product_area", "segment", "outcome", "problem", "feature", "metric", "assumption", "decision",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_TYPES = ["wants", "blocked_by", "addresses", "moves", "affects"] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export const CHANGE_TYPES = ["add", "update", "link", "flag"] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export type Confidence = "low" | "medium" | "high";

/** Which node types an edge type may connect (§5). `affects` may start at a decision or assumption. */
export const EDGE_RULES: Record<EdgeType, { from: NodeType[]; to: NodeType[] }> = {
  wants: { from: ["segment"], to: ["outcome"] },
  blocked_by: { from: ["outcome"], to: ["problem"] },
  addresses: { from: ["feature"], to: ["problem", "outcome"] },
  moves: { from: ["feature"], to: ["metric"] },
  affects: { from: ["decision", "assumption"], to: [...NODE_TYPES] },
};

export interface NodeRow {
  id: string; model_id: string; type: NodeType; title: string; description: string;
  status: string; owner: string; confidence: Confidence; flags: Flag[];
  created_at: string; updated_at: string; version: number;
}
export interface Flag { flag: string; note: string; actor: string; at: string }
export interface EdgeRow {
  id: string; model_id: string; from_id: string; to_id: string; type: EdgeType; confidence: Confidence;
}
export interface EvidenceRow {
  id: string; model_id: string; node_ids: string[]; source_id: string | null; quote: string;
  span_start: number | null; span_end: number | null; source_date: string; source_type: string;
  stance: "supports" | "contradicts"; actor: string; created_at: string;
}
export interface SourceRow {
  id: string; model_id: string; type: string; label: string; filename: string;
  text: string; source_date: string; ingested_at: string;
}
export interface ProposalRow {
  id: string; model_id: string; batch_id: string | null; actor: string; actor_type: "human" | "agent";
  change_type: ChangeType; payload: any; rationale: string; source_ref: any;
  status: "pending" | "accepted" | "rejected"; reviewed_by: string | null; review_note: string | null;
  conflicts: string[]; created_at: string; reviewed_at: string | null;
}
export interface ChangelogEntry {
  proposal_id: string | null; actor: string; actor_type: string; at: string;
  change_type: string; summary: string; diff: { before: any; after: any };
}
export interface VersionRow { id: string; model_id: string; number: number; changelog: ChangelogEntry[]; created_at: string }

export const SOURCE_TYPES = ["prd", "brief", "slack", "research", "research_input", "note", "agent_note"] as const;
