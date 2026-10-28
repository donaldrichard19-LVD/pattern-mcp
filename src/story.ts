// Story layer (prototype): a long-lived record of what a project BELIEVES and
// SAYS, sitting above the per-decision component ledger.
//
// The component ledger answers "did this UI decision match the design
// system?". This answers a different question: "does this decision serve the
// message, and does that message still hold up against what we said before?"
//
//   claims     what the team asserts (a message, a belief, an assumption, a
//              goal, a constraint), each with a source, a confidence and
//              evidence. Claims are superseded or retracted, never edited, so
//              the history of what was believed when stays readable.
//   decisions  what was chosen, linked to the claims it serves (optionally to
//              a component-ledger entry id).
//   challenges deterministic checks over the two (no model call): unsupported
//              claims, contradictions, drift, dilution, orphan decisions.
//              Every finding cites the claims/decisions it rests on and can be
//              dismissed with a reason, which is recorded.
//
// Storage is an append-only jsonl per project under ~/.pattern/story/, same
// homedir/project_id convention as the ledger. No dependency on index.ts, so
// scripts can import it without autostarting the server.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";

const STORY_DIR = () => process.env.PATTERN_STORY_DIR ?? join(homedir(), ".pattern", "story");
const STALE_ASSUMPTION_DAYS = Number(process.env.PATTERN_STORY_STALE_DAYS ?? 30);

export const CLAIM_KINDS = ["message", "belief", "assumption", "goal", "constraint"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];
export type Confidence = "low" | "medium" | "high";
type Severity = "high" | "medium" | "low";

type StoryEvent =
  | {
      t: "claim";
      id: string;
      ts: string;
      text: string;
      kind: ClaimKind;
      source: string;
      confidence: Confidence;
      evidence: string[];
      topic?: string;
      supersedes?: string;
      reason?: string;
    }
  | { t: "retract"; ts: string; id: string; reason: string }
  | { t: "evidence"; ts: string; id: string; evidence: string[] }
  | { t: "decision"; id: string; ts: string; summary: string; serves: string[]; surface?: string; ledger_entry_id?: string }
  | { t: "dismiss"; ts: string; finding_id: string; reason: string };

interface Claim {
  id: string;
  ts: string;
  text: string;
  kind: ClaimKind;
  source: string;
  confidence: Confidence;
  evidence: string[];
  topic?: string;
  status: "active" | "superseded" | "retracted";
  superseded_by?: string;
  supersedes?: string;
  end_reason?: string;
}

interface Decision {
  id: string;
  ts: string;
  summary: string;
  serves: string[];
  surface?: string;
  ledger_entry_id?: string;
}

interface Story {
  claims: Map<string, Claim>;
  decisions: Decision[];
  dismissed: Map<string, string>;
  events: StoryEvent[];
}

interface Cite {
  type: "claim" | "decision";
  id: string;
  text: string;
  ts: string;
  source?: string;
}

export interface Finding {
  id: string;
  kind: string;
  severity: Severity;
  message: string;
  question: string;
  cites: Cite[];
  heuristic?: boolean;
}

function storyPath(projectId: string): string {
  return join(STORY_DIR(), `${projectId.replace(/[^A-Za-z0-9._-]/g, "_")}.jsonl`);
}

function loadEvents(projectId: string): StoryEvent[] {
  const path = storyPath(projectId);
  if (!existsSync(path)) return [];
  const events: StoryEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as StoryEvent);
    } catch {
      // A torn or hand-edited line should not take the whole story down.
    }
  }
  return events;
}

function append(projectId: string, event: StoryEvent): void {
  mkdirSync(STORY_DIR(), { recursive: true });
  appendFileSync(storyPath(projectId), JSON.stringify(event) + "\n");
}

function fold(events: StoryEvent[]): Story {
  const claims = new Map<string, Claim>();
  const decisions: Decision[] = [];
  const dismissed = new Map<string, string>();
  for (const e of events) {
    if (e.t === "claim") {
      claims.set(e.id, {
        id: e.id,
        ts: e.ts,
        text: e.text,
        kind: e.kind,
        source: e.source,
        confidence: e.confidence,
        evidence: [...e.evidence],
        topic: e.topic,
        status: "active",
        supersedes: e.supersedes,
      });
      const old = e.supersedes ? claims.get(e.supersedes) : undefined;
      if (old) {
        old.status = "superseded";
        old.superseded_by = e.id;
        old.end_reason = e.reason;
      }
    } else if (e.t === "retract") {
      const c = claims.get(e.id);
      if (c) {
        c.status = "retracted";
        c.end_reason = e.reason;
      }
    } else if (e.t === "evidence") {
      claims.get(e.id)?.evidence.push(...e.evidence);
    } else if (e.t === "decision") {
      decisions.push({ id: e.id, ts: e.ts, summary: e.summary, serves: e.serves, surface: e.surface, ledger_entry_id: e.ledger_entry_id });
    } else if (e.t === "dismiss") {
      dismissed.set(e.finding_id, e.reason);
    }
  }
  return { claims, decisions, dismissed, events };
}

function nextId(events: StoryEvent[], t: "claim" | "decision"): string {
  const n = events.filter((e) => e.t === t).length + 1;
  return `${t === "claim" ? "c" : "d"}${n}`;
}

function findingId(kind: string, subjects: string[]): string {
  return `${kind}:${[...subjects].sort().join("+")}`;
}

const claimCite = (c: Claim): Cite => ({ type: "claim", id: c.id, text: c.text, ts: c.ts, source: c.source });
const decisionCite = (d: Decision): Cite => ({ type: "decision", id: d.id, text: d.summary, ts: d.ts });

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

const NEGATIONS = new Set([
  "not", "never", "no", "dont", "doesnt", "wont", "shouldnt", "isnt", "arent", "cant", "cannot", "without", "avoid", "stop",
]);
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "are", "be", "we", "our", "users", "user", "it",
  "that", "this", "with", "as", "at", "by", "should", "will", "must", "can",
]);

function tokens(text: string): { content: Set<string>; negated: boolean } {
  const words = text.toLowerCase().replace(/['’]/g, "").match(/[a-z0-9]+/g) ?? [];
  const content = new Set<string>();
  let negated = false;
  for (const w of words) {
    if (NEGATIONS.has(w)) negated = true;
    else if (!STOPWORDS.has(w) && w.length > 2) content.add(w);
  }
  return { content, negated };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function runChallenges(story: Story, now = new Date()): Finding[] {
  const findings: Finding[] = [];
  const active = [...story.claims.values()].filter((c) => c.status === "active");
  const servedBy = new Map<string, Decision[]>();
  for (const d of story.decisions) {
    for (const id of d.serves) servedBy.set(id, [...(servedBy.get(id) ?? []), d]);
  }

  // No thesis at all: decisions are being made with nothing to serve.
  const activeMessages = active.filter((c) => c.kind === "message");
  if (story.decisions.length > 0 && activeMessages.length === 0) {
    findings.push({
      id: findingId("no_message", []),
      kind: "no_message",
      severity: "high",
      message: `${story.decisions.length} decision(s) recorded, but no active message claim. There is nothing for them to serve.`,
      question: "What is the one thing this product should make someone believe or do? Record it as a message claim.",
      cites: story.decisions.slice(-3).map(decisionCite),
    });
  }

  // Claims that carry weight without evidence.
  for (const c of active) {
    if (c.kind === "constraint" || c.kind === "goal") continue;
    const load = servedBy.get(c.id)?.length ?? 0;
    if (c.evidence.length === 0) {
      const overconfident = c.confidence === "high";
      findings.push({
        id: findingId("unsupported_claim", [c.id]),
        kind: "unsupported_claim",
        severity: load > 0 || overconfident ? "high" : "medium",
        message:
          `"${c.text}" is stated as ${c.confidence} confidence with no evidence` +
          (load > 0 ? `, and ${load} decision(s) rest on it.` : "."),
        question: "What have you actually seen or measured that says this is true? Add evidence, or lower the confidence.",
        cites: [claimCite(c), ...(servedBy.get(c.id) ?? []).map(decisionCite)],
      });
    }
    // An assumption nobody has revisited in a long time.
    const ageDays = (now.getTime() - new Date(c.ts).getTime()) / 86_400_000;
    if (c.kind === "assumption" && c.evidence.length === 0 && ageDays >= STALE_ASSUMPTION_DAYS) {
      findings.push({
        id: findingId("stale_assumption", [c.id]),
        kind: "stale_assumption",
        severity: "medium",
        message: `Assumption "${c.text}" is ${Math.floor(ageDays)} days old and was never tested or revisited.`,
        question: "Is this still an assumption, or did you quietly start treating it as fact?",
        cites: [claimCite(c)],
      });
    }
  }

  // Contradictions: same topic, or opposite polarity on near-identical wording.
  const seenPairs = new Set<string>();
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const sameTopic = a.topic && b.topic && a.topic.toLowerCase() === b.topic.toLowerCase();
      const ta = tokens(a.text);
      const tb = tokens(b.text);
      const polarityClash = ta.negated !== tb.negated && jaccard(ta.content, tb.content) >= 0.5;
      const key = findingId("contradiction", [a.id, b.id]);
      if ((sameTopic || polarityClash) && !seenPairs.has(key)) {
        seenPairs.add(key);
        findings.push({
          id: key,
          kind: "contradiction",
          severity: "high",
          heuristic: !sameTopic,
          message: sameTopic
            ? `Two active claims on topic "${a.topic}" and neither replaces the other.`
            : "Two active claims read as opposites (wording overlap with reversed polarity). Heuristic match; confirm.",
          question: "Which of these is true now? Supersede the older one, or explain why both hold.",
          cites: [claimCite(a), claimCite(b)],
        });
      }
    }
  }

  // Decisions: orphaned, broken links, or resting on a claim that has since ended.
  for (const d of story.decisions) {
    const known = d.serves.map((id) => story.claims.get(id)).filter((c): c is Claim => !!c);
    const unknown = d.serves.filter((id) => !story.claims.has(id));
    if (d.serves.length === 0) {
      findings.push({
        id: findingId("orphan_decision", [d.id]),
        kind: "orphan_decision",
        severity: "medium",
        message: `Decision "${d.summary}" serves no claim.`,
        question: "Why does this exist? Link it to the claim it serves, or admit it serves none.",
        cites: [decisionCite(d)],
      });
    }
    if (unknown.length) {
      findings.push({
        id: findingId("broken_link", [d.id, ...unknown]),
        kind: "broken_link",
        severity: "medium",
        message: `Decision "${d.summary}" links to unknown claim id(s): ${unknown.join(", ")}.`,
        question: "Fix the link; the rationale it points at does not exist.",
        cites: [decisionCite(d)],
      });
    }
    const ended = known.filter((c) => c.status !== "active");
    const stillServing = known.some((c) => c.status === "active");
    if (ended.length && !stillServing) {
      findings.push({
        id: findingId("stale_rationale", [d.id, ...ended.map((c) => c.id)]),
        kind: "stale_rationale",
        severity: "high",
        message:
          `Decision "${d.summary}" rests only on claims that no longer hold: ` +
          ended
            .map((c) => `${c.id} (${c.status}${c.superseded_by ? ` by ${c.superseded_by}` : ""}${c.end_reason ? `: ${c.end_reason}` : ""})`)
            .join("; ") +
          ".",
        question: "The reason you made this has changed. Keep it for a new reason, or revisit it?",
        cites: [decisionCite(d), ...ended.map(claimCite)],
      });
    }
  }

  // Dilution: one surface serving more than one message.
  const bySurface = new Map<string, Decision[]>();
  for (const d of story.decisions) if (d.surface) bySurface.set(d.surface, [...(bySurface.get(d.surface) ?? []), d]);
  for (const [surface, ds] of bySurface) {
    const messages = new Map<string, Claim>();
    for (const d of ds)
      for (const id of d.serves) {
        const c = story.claims.get(id);
        if (c && c.kind === "message" && c.status === "active") messages.set(c.id, c);
      }
    if (messages.size > 1) {
      findings.push({
        id: findingId("dilution", [surface, ...messages.keys()]),
        kind: "dilution",
        severity: "high",
        message: `Surface "${surface}" is trying to say ${messages.size} different things.`,
        question: "Which one message does this surface exist to land? The rest belong somewhere else.",
        cites: [...messages.values()].map(claimCite),
      });
    }
  }

  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ---------------------------------------------------------------------------
// Ingest: pull candidate claims out of notes. Pattern-matching only; a model
// pass is the intended upgrade. Candidates are returned for review and only
// written when commit is true.
// ---------------------------------------------------------------------------

const INGEST_RULES: Array<{ kind: ClaimKind; re: RegExp }> = [
  { kind: "message", re: /\b(the (one )?(message|story|point|promise) is|positioning|tagline|the idea is)\b/i },
  { kind: "assumption", re: /\b(we assume|i assume|assuming|presumably)\b/i },
  { kind: "belief", re: /\b(users? (want|need|prefer|hate|expect)|customers? (want|need)|people (want|need)|we believe|i believe)\b/i },
  { kind: "goal", re: /\b(our goal|the goal|north star|objective|success (is|means))\b/i },
  { kind: "constraint", re: /\b(non-negotiable|out of scope|we won't|we will not|must not|never)\b/i },
];

export function extractCandidates(text: string, source: string): Array<{ text: string; kind: ClaimKind; source: string }> {
  const out: Array<{ text: string; kind: ClaimKind; source: string }> = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/^\s*(?:[-*>]|\d+\.)\s*/, "").replace(/[*_`#]/g, "").trim();
    if (line.length < 12 || line.length > 400) return;
    const rule = INGEST_RULES.find((r) => r.re.test(line));
    if (rule) out.push({ text: line, kind: rule.kind, source: `${source}:${i + 1}` });
  });
  return out.slice(0, 50);
}

// Model-assisted extraction (opt-in: sends the file's text to Anthropic). The
// model proposes claims, but each must carry a QUOTE that really appears on a
// single line of the file; the server locates it and uses that line as the
// source. A proposal whose quote is not in the file is dropped, so a
// hallucinated claim can't enter the record with a believable-looking source.

export type StoryModelCall = (prompt: string) => Promise<string>;
const STORY_MODEL = process.env.PATTERN_STORY_MODEL ?? "claude-haiku-4-5-20251001";
const MODEL_INPUT_CHARS = 30_000;

export function makeAnthropicStoryCall(apiKey: string): StoryModelCall {
  return async (prompt) => {
    const res = await fetch(process.env.PATTERN_STORY_API_URL ?? "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: STORY_MODEL, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { content?: Array<{ text?: string }> };
    return (j.content ?? []).map((c) => c.text ?? "").join("").trim();
  };
}

export async function extractCandidatesWithModel(
  text: string,
  source: string,
  complete: StoryModelCall
): Promise<{ candidates: Array<{ text: string; kind: ClaimKind; source: string }>; dropped: number }> {
  const body = text.slice(0, MODEL_INPUT_CHARS);
  const prompt =
    "You extract the claims a product team is making from their own notes. A claim is one of: " +
    CLAIM_KINDS.map((k) => `"${k}"`).join(", ") +
    ' ("message" = the one thing the product should make someone believe or do; "belief" = a statement about users or the world; "assumption" = something taken as true without proof; "goal"; "constraint" = a rule or boundary).\n' +
    "Return ONLY a JSON array of objects {\"text\": a one-sentence claim in plain words, \"kind\": one of the kinds, \"quote\": an EXACT contiguous substring copied from a single line of the notes that the claim is based on}. " +
    "Skip anything that is not a claim. Do not invent claims the notes do not support.\n\nNOTES:\n" +
    body;
  const raw = await complete(prompt);
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("Model did not return a JSON array of claims");
  }
  if (!Array.isArray(parsed)) throw new Error("Model did not return a JSON array of claims");
  const lines = body.split("\n");
  const candidates: Array<{ text: string; kind: ClaimKind; source: string }> = [];
  let dropped = 0;
  for (const item of parsed.slice(0, 80)) {
    const o = item as { text?: unknown; kind?: unknown; quote?: unknown };
    const claimText = typeof o.text === "string" ? o.text.trim().slice(0, 300) : "";
    const quote = typeof o.quote === "string" ? o.quote.trim() : "";
    const lineIdx = quote ? lines.findIndex((l) => l.includes(quote)) : -1;
    if (!claimText || !CLAIM_KINDS.includes(o.kind as ClaimKind) || lineIdx < 0) {
      dropped++;
      continue;
    }
    candidates.push({ text: claimText, kind: o.kind as ClaimKind, source: `${source}:${lineIdx + 1}` });
  }
  return { candidates, dropped };
}

// ---------------------------------------------------------------------------
// MCP tool surface
// ---------------------------------------------------------------------------

const projectIdProp = {
  type: "string",
  description: "The same project_id used with the other Pattern tools.",
};

export const STORY_TOOL_NAMES = {
  record_claim: "record_claim",
  link_decision: "link_decision",
  challenge: "challenge",
  read_story: "read_story",
  ingest_notes: "ingest_notes",
} as const;

export const STORY_TOOLS = [
  {
    name: STORY_TOOL_NAMES.record_claim,
    description:
      "Records something this project asserts: its message (the one thing it must make someone believe or do), a belief about users, an assumption, a goal, or a constraint. " +
      "Claims are never edited: use action 'supersede' (with supersedes = the old claim id and a reason) when the view changes, 'retract' when it was wrong, " +
      "'add_evidence' to attach proof. Returns the new claim id (c1, c2, ...), which link_decision and challenge cite. Local write only.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: projectIdProp,
        action: { type: "string", enum: ["add", "supersede", "retract", "add_evidence"], description: "Defaults to 'add'." },
        text: { type: "string", description: "The claim, one plain sentence. Required for add/supersede." },
        kind: { type: "string", enum: [...CLAIM_KINDS], description: "Required for add/supersede." },
        source: { type: "string", description: "Where this came from: a person, a doc, a conversation, a metric. Required for add/supersede." },
        confidence: { type: "string", enum: ["low", "medium", "high"], description: "Defaults to 'low'." },
        evidence: { type: "array", items: { type: "string" }, description: "What you have seen or measured that supports it." },
        topic: { type: "string", description: "Optional tag. Two active claims on one topic are flagged as a contradiction unless one supersedes the other." },
        supersedes: { type: "string", description: "Claim id this replaces (action 'supersede')." },
        claim_id: { type: "string", description: "Target claim id (action 'retract' or 'add_evidence')." },
        reason: { type: "string", description: "Why it was superseded or retracted. Required for those actions." },
      },
      required: ["project_id"],
    },
  },
  {
    name: STORY_TOOL_NAMES.link_decision,
    description:
      "Records a design/product decision and the claim ids it serves, so it can later be challenged against them. " +
      "Optionally tag the surface (screen/section) it belongs to and the component-ledger entry id it came from. " +
      "A decision serving no claim is allowed but will be flagged by challenge.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: projectIdProp,
        summary: { type: "string", description: "What was decided, in a sentence." },
        serves: { type: "array", items: { type: "string" }, description: "Claim ids (c1, c2, ...) this decision serves." },
        surface: { type: "string", description: "Optional screen/section name, used to detect a surface trying to say several things." },
        ledger_entry_id: { type: "string", description: "Optional id of the related recommend_component ledger entry." },
      },
      required: ["project_id", "summary", "serves"],
    },
  },
  {
    name: STORY_TOOL_NAMES.challenge,
    description:
      "Pushes back on the project's own record, with no model call. Finds: claims asserted without evidence (worse when decisions rest on them), contradictions, " +
      "decisions resting on claims that were since superseded or retracted, one surface carrying several messages, decisions serving nothing, and a missing message. " +
      "Every finding cites the claims/decisions it rests on and carries a question to answer. Pass dismiss_finding_id + dismiss_reason to dismiss one; the reason is recorded.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: projectIdProp,
        dismiss_finding_id: { type: "string", description: "A finding id from a previous challenge call." },
        dismiss_reason: { type: "string", description: "Why the finding does not apply. Required with dismiss_finding_id." },
        include_dismissed: { type: "boolean", description: "Also list findings already dismissed (with their reasons)." },
      },
      required: ["project_id"],
    },
  },
  {
    name: STORY_TOOL_NAMES.read_story,
    description:
      "Returns the project's story: current active claims (grouped by kind), the history of superseded/retracted claims with reasons, and decisions with what they serve. Local read only.",
    inputSchema: { type: "object", properties: { project_id: projectIdProp }, required: ["project_id"] },
  },
  {
    name: STORY_TOOL_NAMES.ingest_notes,
    description:
      "Scans a notes/doc file in the project (relative path) for sentences that look like claims (messages, beliefs, assumptions, goals, constraints) and returns candidates with file:line sources. " +
      "Pattern-matching by default (no model call; low recall); use_model: true for a verified model pass. Candidates are only recorded (low confidence, no evidence) when commit is true, so a human or agent should review first.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: projectIdProp,
        file_path: { type: "string", description: "Path relative to the project root. Absolute paths and '..' are rejected." },
        commit: { type: "boolean", description: "Record the candidates as claims. Default false (preview only)." },
        use_model: {
          type: "boolean",
          description:
            "Use a model (Haiku, needs ANTHROPIC_API_KEY) instead of pattern matching. Sends the file's text (first 30k chars) to Anthropic. " +
            "Each proposed claim must quote a line that really exists in the file; unverifiable proposals are dropped and counted.",
        },
      },
      required: ["project_id", "file_path"],
    },
  },
];

type Args = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function need<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`${what} is required`);
  return v;
}

function recordClaim(a: Args): unknown {
  const projectId = need(str(a.project_id), "project_id");
  const action = str(a.action) ?? "add";
  const events = loadEvents(projectId);
  const story = fold(events);
  const ts = new Date().toISOString();

  if (action === "retract" || action === "add_evidence") {
    const id = need(str(a.claim_id), "claim_id");
    if (!story.claims.has(id)) throw new Error(`Unknown claim ${id}`);
    if (action === "retract") {
      append(projectId, { t: "retract", ts, id, reason: need(str(a.reason), "reason") });
      return { ok: true, retracted: id };
    }
    const evidence = ((a.evidence as unknown[]) ?? []).filter((x): x is string => typeof x === "string" && !!x.trim());
    if (!evidence.length) throw new Error("evidence is required for add_evidence");
    append(projectId, { t: "evidence", ts, id, evidence });
    return { ok: true, claim_id: id, evidence_count: story.claims.get(id)!.evidence.length + evidence.length };
  }

  if (action !== "add" && action !== "supersede") throw new Error(`Unknown action ${action}`);
  const kind = need(str(a.kind), "kind") as ClaimKind;
  if (!CLAIM_KINDS.includes(kind)) throw new Error(`kind must be one of ${CLAIM_KINDS.join(", ")}`);
  let supersedes: string | undefined;
  let reason: string | undefined;
  if (action === "supersede") {
    supersedes = need(str(a.supersedes), "supersedes");
    if (!story.claims.has(supersedes)) throw new Error(`Unknown claim ${supersedes}`);
    reason = need(str(a.reason), "reason");
  }
  const confidence = (str(a.confidence) ?? "low") as Confidence;
  if (!["low", "medium", "high"].includes(confidence)) throw new Error("confidence must be low, medium or high");
  const id = nextId(events, "claim");
  append(projectId, {
    t: "claim",
    id,
    ts,
    text: need(str(a.text), "text"),
    kind,
    source: need(str(a.source), "source"),
    confidence,
    evidence: ((a.evidence as unknown[]) ?? []).filter((x): x is string => typeof x === "string" && !!x.trim()),
    topic: str(a.topic),
    supersedes,
    reason,
  });
  return { ok: true, claim_id: id, ...(supersedes ? { superseded: supersedes } : {}) };
}

function linkDecision(a: Args): unknown {
  const projectId = need(str(a.project_id), "project_id");
  const events = loadEvents(projectId);
  const serves = ((a.serves as unknown[]) ?? []).filter((x): x is string => typeof x === "string");
  const id = nextId(events, "decision");
  append(projectId, {
    t: "decision",
    id,
    ts: new Date().toISOString(),
    summary: need(str(a.summary), "summary"),
    serves,
    surface: str(a.surface),
    ledger_entry_id: str(a.ledger_entry_id),
  });
  return { ok: true, decision_id: id };
}

function challenge(a: Args): unknown {
  const projectId = need(str(a.project_id), "project_id");
  if (str(a.dismiss_finding_id)) {
    const story = fold(loadEvents(projectId));
    const findingId = str(a.dismiss_finding_id)!;
    if (!runChallenges(story).some((f) => f.id === findingId)) throw new Error(`No current finding ${findingId}`);
    append(projectId, {
      t: "dismiss",
      ts: new Date().toISOString(),
      finding_id: findingId,
      reason: need(str(a.dismiss_reason), "dismiss_reason"),
    });
    return { ok: true, dismissed: findingId };
  }
  const story = fold(loadEvents(projectId));
  const all = runChallenges(story);
  const open = all.filter((f) => !story.dismissed.has(f.id));
  const dismissed = all.filter((f) => story.dismissed.has(f.id));
  return {
    project_id: projectId,
    open_count: open.length,
    findings: open,
    ...(a.include_dismissed ? { dismissed: dismissed.map((f) => ({ ...f, dismissed_reason: story.dismissed.get(f.id) })) } : {}),
    note: story.claims.size === 0 && story.decisions.length === 0 ? "Nothing recorded yet. Start with a message claim." : undefined,
  };
}

function readStory(a: Args): unknown {
  const projectId = need(str(a.project_id), "project_id");
  const story = fold(loadEvents(projectId));
  const claims = [...story.claims.values()];
  const active: Record<string, Claim[]> = {};
  for (const c of claims.filter((c) => c.status === "active")) (active[c.kind] ??= []).push(c);
  return {
    project_id: projectId,
    active,
    history: claims.filter((c) => c.status !== "active"),
    decisions: story.decisions,
  };
}

async function ingestNotes(a: Args, root: string, deps: StoryDeps): Promise<unknown> {
  const projectId = need(str(a.project_id), "project_id");
  const rel = need(str(a.file_path), "file_path");
  const abs = resolve(root, rel);
  if (isAbsolute(rel) || normalize(rel).split(sep).includes("..") || !(abs + sep).startsWith(resolve(root) + sep)) {
    throw new Error("file_path must be relative to the project root and may not contain '..'");
  }
  if (!existsSync(abs)) throw new Error(`File not found: ${rel}`);
  const story = fold(loadEvents(projectId));
  const existing = new Set([...story.claims.values()].filter((c) => c.status === "active").map((c) => c.text.toLowerCase()));
  const fileText = readFileSync(abs, "utf8");
  let dropped: number | undefined;
  let found: Array<{ text: string; kind: ClaimKind; source: string }>;
  if (a.use_model === true) {
    const complete = deps.complete ?? (process.env.ANTHROPIC_API_KEY ? makeAnthropicStoryCall(process.env.ANTHROPIC_API_KEY) : undefined);
    if (!complete) throw new Error("use_model needs ANTHROPIC_API_KEY (run `npx pattern-mcp keys`), or call without use_model for pattern matching");
    const r = await extractCandidatesWithModel(fileText, rel, complete);
    found = r.candidates;
    dropped = r.dropped;
  } else {
    found = extractCandidates(fileText, rel);
  }
  const candidates = found.filter((c) => !existing.has(c.text.toLowerCase()));
  if (a.commit === true) {
    const ids: string[] = [];
    for (const c of candidates) {
      const events = loadEvents(projectId);
      const id = nextId(events, "claim");
      append(projectId, { t: "claim", id, ts: new Date().toISOString(), text: c.text, kind: c.kind, source: c.source, confidence: "low", evidence: [] });
      ids.push(id);
    }
    return { committed: ids.length, claim_ids: ids, candidates, ...(dropped !== undefined ? { dropped_unverifiable: dropped } : {}) };
  }
  return { committed: 0, candidates, ...(dropped !== undefined ? { dropped_unverifiable: dropped } : {}), note: "Preview only. Pass commit: true to record these as low-confidence claims." };
}

export interface StoryDeps {
  /** Model call for ingest_notes use_model; tests inject a stub. */
  complete?: StoryModelCall;
}

/** Returns the tool result, or undefined when `name` is not a story tool. */
export async function handleStoryTool(
  name: string,
  args: Args,
  projectRoot: string,
  deps: StoryDeps = {}
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean } | undefined> {
  const handlers: Record<string, (a: Args) => unknown | Promise<unknown>> = {
    [STORY_TOOL_NAMES.record_claim]: recordClaim,
    [STORY_TOOL_NAMES.link_decision]: linkDecision,
    [STORY_TOOL_NAMES.challenge]: challenge,
    [STORY_TOOL_NAMES.read_story]: readStory,
    [STORY_TOOL_NAMES.ingest_notes]: (a) => ingestNotes(a, projectRoot, deps),
  };
  const handler = handlers[name];
  if (!handler) return undefined;
  try {
    return { content: [{ type: "text", text: JSON.stringify(await handler(args ?? {})) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
}

// Exposed for scripts/verify-story.mjs.
export const _internal = { fold, loadEvents };
