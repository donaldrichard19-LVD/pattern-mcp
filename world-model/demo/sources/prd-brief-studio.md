# PRD: Brief Studio, AI-assisted drafting for PRDs and product briefs

> Demo document. Brief Studio is a fictional product used to seed the world-model prototype.

## Problem
Product managers start most PRDs from a blank page or by copying an old document. Drafts routinely ship without a measurable success metric, and the finished document goes out of date as soon as decisions are made in Slack.

## Users
Primary: product managers and product leaders who write and maintain PRDs and briefs. Secondary: designers and engineers who read those documents to understand why a feature exists.

## Desired outcomes
- A PM can produce a clear, well-grounded first draft in under 30 minutes.
- A PM can define success metrics that are tied to the user outcome the feature serves.
- A PM can keep a document current as decisions change.
- A teammate can understand a product area and trace any feature back to its purpose.

## Features
1. Template-guided PRD drafting (in flight): structured prompts for problem, users, outcomes and metrics.
2. Metric suggestion assistant (proposed): suggests an input metric and an output metric for each outcome.
3. Stale-document alerts (shipped): notifies the owner when a document has had no edits or new evidence for 30 days.
4. Decision log sidebar (proposed): records decisions and the reasons behind them next to the text they affect.
5. Shared area context panel (in flight): one panel showing the users, outcomes and metrics for the area a document belongs to.
6. Dark mode editor (proposed): a dark theme for the editor.

## Success metrics
- Time to first draft: median under 30 minutes (currently about 90 minutes).
- Share of PRDs with a defined success metric: 80% (currently about 45%).
- Median days since last document update: under 21.
- New-teammate comprehension: a new teammate can explain the area's users, outcomes and metrics after 15 minutes.

## Decisions
- 2026-09-14: Priya Nair decided to ship stale-document alerts before the metric suggestion assistant, because stale documents were the most cited complaint in interviews.
