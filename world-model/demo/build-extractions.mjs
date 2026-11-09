// Generates demo/extractions/*.json: the structured output an LLM extractor would produce for each demo source.
// Offline mode uses these; test/demo.test.ts verifies every quote appears verbatim in its source.
import { writeFileSync } from "node:fs";
const T = {
  s1: "Product managers and product leaders", s2: "Cross-functional teammates (design and engineering)",
  o1: "Produce a clear, well-grounded first draft in under 30 minutes", o2: "Keep a document current as decisions change",
  o3: "Define success metrics tied to the user outcome", o4: "Understand a product area and trace any feature to its purpose",
  o5: "Turn meeting conversations into written artifacts without retyping",
  p1: "Blank-page start: PMs copy an old document", p2: "Drafts ship without a measurable success metric",
  p3: "Documents go stale as decisions are made in Slack", p4: "Context is scattered across documents, Slack threads and meeting notes",
  p5: "AI meeting notes are unstructured, so PMs reshape them by hand",
  f1: "Template-guided PRD drafting", f2: "Metric suggestion assistant", f3: "Stale-document alerts", f4: "Decision log sidebar",
  f5: "Shared area context panel", f6: "Dark mode editor",
  m1: "Time to first draft", m2: "Share of PRDs with a defined success metric", m3: "Median days since last document update", m4: "New-teammate comprehension in 15 minutes",
  a1: "PMs will trust AI-suggested metrics enough to keep them in the document", a2: "AI meeting notes are a primary input to PRDs",
  d1: "Ship stale-document alerts before the metric suggestion assistant",
};
const n = (ref, type, extra = {}) => ({ ref, type, title: T[ref], ...extra });
const e = (from, to, type) => ({ from, to, type });
const out = (file, o) => writeFileSync(new URL(`./extractions/${file}.json`, import.meta.url), JSON.stringify(o, null, 2) + "\n");

out("prd-brief-studio", {
  nodes: [
    n("s1", "segment", { description: "Write and maintain PRDs and briefs. Primary user.", quote: "Primary: product managers and product leaders who write and maintain PRDs and briefs." }),
    n("s2", "segment", { description: "Read PRDs and briefs to understand why a feature exists.", quote: "Secondary: designers and engineers who read those documents to understand why a feature exists." }),
    n("o1", "outcome", { quote: "A PM can produce a clear, well-grounded first draft in under 30 minutes." }),
    n("o3", "outcome", { quote: "A PM can define success metrics that are tied to the user outcome the feature serves." }),
    n("o2", "outcome", { quote: "A PM can keep a document current as decisions change." }),
    n("o4", "outcome", { quote: "A teammate can understand a product area and trace any feature back to its purpose." }),
    n("p1", "problem", { quote: "Product managers start most PRDs from a blank page or by copying an old document." }),
    n("p2", "problem", { quote: "Drafts routinely ship without a measurable success metric" }),
    n("p3", "problem", { quote: "the finished document goes out of date as soon as decisions are made in Slack" }),
    n("f1", "feature", { status: "in-flight", description: "Structured prompts for problem, users, outcomes and metrics.", quote: "Template-guided PRD drafting (in flight): structured prompts for problem, users, outcomes and metrics." }),
    n("f2", "feature", { status: "proposed", description: "Suggests an input metric and an output metric for each outcome.", quote: "Metric suggestion assistant (proposed): suggests an input metric and an output metric for each outcome." }),
    n("f3", "feature", { status: "shipped", description: "Notifies the owner when a document has had no edits or evidence for 30 days.", quote: "Stale-document alerts (shipped): notifies the owner when a document has had no edits or new evidence for 30 days." }),
    n("f4", "feature", { status: "proposed", description: "Records decisions and reasons next to the text they affect.", quote: "Decision log sidebar (proposed): records decisions and the reasons behind them next to the text they affect." }),
    n("f5", "feature", { status: "in-flight", description: "One panel with the users, outcomes and metrics for the area a document belongs to.", quote: "Shared area context panel (in flight): one panel showing the users, outcomes and metrics for the area a document belongs to." }),
    n("f6", "feature", { status: "proposed", description: "A dark theme for the editor.", quote: "Dark mode editor (proposed): a dark theme for the editor." }),
    n("m1", "metric", { description: "Median under 30 minutes (currently about 90).", quote: "Time to first draft: median under 30 minutes (currently about 90 minutes)." }),
    n("m2", "metric", { description: "Target 80% (currently about 45%).", quote: "Share of PRDs with a defined success metric: 80% (currently about 45%)." }),
    n("m3", "metric", { description: "Target under 21 days.", quote: "Median days since last document update: under 21." }),
    n("m4", "metric", { description: "A new teammate can explain the area after 15 minutes.", quote: "New-teammate comprehension: a new teammate can explain the area's users, outcomes and metrics after 15 minutes." }),
    n("d1", "decision", { description: "Decided 2026-09-14 by Priya Nair: stale documents were the most cited complaint in interviews.", quote: "Priya Nair decided to ship stale-document alerts before the metric suggestion assistant, because stale documents were the most cited complaint in interviews." }),
  ],
  edges: [
    e("s1", "o1", "wants"), e("s1", "o2", "wants"), e("s1", "o3", "wants"), e("s2", "o4", "wants"),
    e("o1", "p1", "blocked_by"), e("o3", "p2", "blocked_by"), e("o2", "p3", "blocked_by"),
    e("f1", "p1", "addresses"), e("f1", "o1", "addresses"), e("f1", "m1", "moves"),
    e("f2", "p2", "addresses"), e("f2", "o3", "addresses"), e("f2", "m2", "moves"),
    e("f3", "p3", "addresses"), e("f3", "o2", "addresses"), e("f3", "m3", "moves"),
    e("f4", "p3", "addresses"), e("f5", "o4", "addresses"), e("f5", "m4", "moves"),
    e("d1", "f3", "affects"), e("d1", "f2", "affects"),
  ],
});

out("product-brief-pm-context", {
  nodes: [
    n("s1", "segment", { quote: "Product managers who write PRDs and briefs." }),
    n("s2", "segment", { quote: "Cross-functional teammates in design and engineering who read them to decide what to build." }),
    n("o1", "outcome", { quote: "PMs want to write a defensible PRD without starting from scratch." }),
    n("o4", "outcome", { quote: "Teammates want to understand why a feature exists without asking the PM." }),
    n("p3", "problem", { quote: "Documents go stale after decisions are made elsewhere." }),
    n("p4", "problem", { description: "Documents, Slack threads and meeting notes each hold part of the picture.", quote: "Context is scattered across documents, Slack threads and meeting notes." }),
    n("a1", "assumption", { description: "Open question from the brief.", quote: "Will PMs trust AI-suggested metrics enough to keep them in the document?" }),
    n("a2", "assumption", { description: "Open question from the brief.", quote: "Are AI meeting notes a primary input to PRDs, or only a reference?" }),
  ],
  edges: [e("o4", "p4", "blocked_by")],
});

out("slack-pm-writing", {
  nodes: [
    n("f6", "feature", { quote: "Can we get a dark mode in the editor?" }),
    n("p3", "problem", { quote: "The brief is stale. We agreed in the thread last week to slip the launch by two weeks and nobody updated either doc." }),
    n("p2", "problem", { quote: "Reminder that every PRD needs a success metric before it goes to review. Half of the drafts I see this month still have none." }),
    n("s2", "segment", { quote: "As an engineer I read the brief first. I only open the PRD when I need an edge case." }),
    n("a1", "assumption"),
    n("f2", "feature"),
  ],
  edges: [e("a1", "f2", "affects")],
  evidence: [{ ref: "a1", quote: "I do not trust a suggested metric unless I can see why it was picked. Show me the reasoning and I will use it.", stance: "contradicts" }],
});

out("research-pm-writing-summary", {
  nodes: [
    n("p1", "problem", { quote: "Seven of eight PMs said they start a PRD by copying the last one they wrote." }),
    n("p2", "problem", { quote: "Six of eight PMs said the success metrics section is the part they rewrite or skip." }),
    n("p3", "problem", { quote: "Five PMs said documents are out of date within two weeks of kickoff because decisions are made in Slack and never written back." }),
    n("s2", "segment", { quote: "Engineers and designers said they usually read the one-page brief and only open the PRD to check details." }),
    n("a1", "assumption"),
  ],
  edges: [],
  evidence: [{ ref: "a1", quote: "Most PMs said they edit AI-suggested text heavily before sharing it with anyone.", stance: "contradicts" }],
});

out("granola-excerpts", {
  nodes: [
    n("s1", "segment"),
    n("o5", "outcome", { description: "Meeting conversations should flow into PRDs and briefs without manual rework.", quote: "I like that I can share the notes with my team. I wish they linked to the document where the decision ends up." }),
    n("p5", "problem", { description: "AI notes summarize what was said but not the problem, outcome and metric structure of a PRD.", quote: "Granola's notes are accurate, but they are a transcript summary, not a PRD. I still rebuild the structure by hand." }),
    n("a2", "assumption", { quote: "Granola's notes are accurate, but they are a transcript summary, not a PRD." }),
  ],
  edges: [e("s1", "o5", "wants"), e("o5", "p5", "blocked_by")],
  evidence: [{ ref: "p5", quote: "It captures what was said. It does not know which user outcome we were talking about." }],
});

out("zoom-ai-excerpts", {
  nodes: [
    n("o5", "outcome", { quote: "The summaries pile up in my inbox. Nobody goes back to read them, and they never reach the PRD." }),
    n("p5", "problem", { quote: "I copy the summary into a doc and then spend half an hour turning it into something a teammate can use." }),
  ],
  edges: [],
  evidence: [{ ref: "p5", quote: "Zoom's summary lists action items well, but it has no idea which product outcome we were discussing." }],
});
