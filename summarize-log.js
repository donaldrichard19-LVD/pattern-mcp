#!/usr/bin/env node
/**
 * summarize-log.js
 *
 * Reads a ui-component-judgment-mcp calls.log file (see README.md's
 * "Local call log" section for the format) and prints a human-readable
 * summary: verdict/confidence/reason breakdown, ensemble trigger and
 * agreement rates, reference-source grounding rates, and repeat
 * component_need calls (a signal of a looping calling agent -- see
 * SECURITY.md's session-cap section for why that matters).
 *
 * This is the way to review a tester's log file: ask them to send you
 * their calls.log (see README), then run this against the file they sent
 * -- there's no automatic collection, this project doesn't phone home.
 *
 * Usage:
 *   node summarize-log.js [path-to-calls.log]
 *
 * With no argument, reads from the same default location the server
 * itself uses: $UI_JUDGMENT_LOG_PATH, or ~/.ui-component-judgment-mcp/calls.log
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const logPath =
  process.argv[2] ?? process.env.UI_JUDGMENT_LOG_PATH ?? join(homedir(), ".ui-component-judgment-mcp", "calls.log");

if (!existsSync(logPath)) {
  console.error(`No log file found at ${logPath}`);
  console.error(`(Nothing has called recommend_component yet, or the path is wrong -- pass an explicit path as the first argument to summarize a different file, e.g. one a tester sent you.)`);
  process.exit(1);
}

const raw = readFileSync(logPath, "utf8");
const lines = raw.split("\n").filter((l) => l.trim().length > 0);

const entries = [];
let unparseableLines = 0;
for (const line of lines) {
  try {
    entries.push(JSON.parse(line));
  } catch {
    unparseableLines++;
  }
}

if (entries.length === 0) {
  console.log(`${logPath}: 0 parseable entries (${unparseableLines} unparseable line(s)). Nothing to summarize.`);
  process.exit(0);
}

const timestamps = entries.map((e) => e.timestamp).filter(Boolean).sort();
const errorEntries = entries.filter((e) => e.error);
const resultEntries = entries.filter((e) => !e.error);

function countBy(list, keyFn) {
  const counts = new Map();
  for (const item of list) {
    const key = keyFn(item) ?? "(missing)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function printBreakdown(title, pairs, total) {
  console.log(`\n${title}`);
  if (pairs.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const [key, count] of pairs) {
    const pct = total > 0 ? ((count / total) * 100).toFixed(0) : "0";
    console.log(`  ${String(key).padEnd(20)} ${String(count).padStart(4)}  (${pct}%)`);
  }
}

console.log(`=== Summary: ${logPath} ===`);
console.log(`Total entries: ${entries.length}${unparseableLines ? ` (+ ${unparseableLines} unparseable line(s), skipped)` : ""}`);
if (timestamps.length > 0) {
  console.log(`Date range: ${timestamps[0]} -> ${timestamps[timestamps.length - 1]}`);
}
if (errorEntries.length > 0) {
  console.log(`Model-output parse errors: ${errorEntries.length} (reached the API, but the response didn't parse as JSON)`);
}

printBreakdown("Verdict breakdown:", countBy(resultEntries, (e) => e.verdict), resultEntries.length);
printBreakdown("Confidence breakdown:", countBy(resultEntries, (e) => e.confidence), resultEntries.length);
printBreakdown("Reason breakdown:", countBy(resultEntries, (e) => e.reason), resultEntries.length);

const ensembleTriggered = resultEntries.filter((e) => e.ensemble_triggered === true);
console.log(`\nBoundary-risk ensemble:`);
console.log(`  Triggered: ${ensembleTriggered.length} / ${resultEntries.length} (${resultEntries.length > 0 ? ((ensembleTriggered.length / resultEntries.length) * 100).toFixed(0) : 0}%)`);
if (ensembleTriggered.length > 0) {
  printBreakdown("  Agreement when triggered:", countBy(ensembleTriggered, (e) => e.ensemble_agreement), ensembleTriggered.length);
}

const customBuildEntries = resultEntries.filter((e) => e.verdict === "custom_build");
if (customBuildEntries.length > 0) {
  console.log(`\nReference grounding on custom_build verdicts (${customBuildEntries.length} total):`);
  const groundingBuckets = countBy(customBuildEntries, (e) => {
    const sources = e.reference_sources_grounded ?? [];
    if (sources.length === 0) return "neither";
    if (sources.length === 2) return "both (Mobbin + Figma Community)";
    return sources[0] + " only";
  });
  for (const [key, count] of groundingBuckets) {
    const pct = ((count / customBuildEntries.length) * 100).toFixed(0);
    console.log(`  ${String(key).padEnd(28)} ${String(count).padStart(4)}  (${pct}%)`);
  }
}

// Repeated component_need calls can indicate a calling agent stuck in a
// retry loop -- exactly the failure mode the session cap protects
// against (see README's Session call cap section). Surfacing it here so
// reviewing a tester's log can catch it even if they never hit the cap.
const needCounts = countBy(entries, (e) => e.component_need);
const repeated = needCounts.filter(([, count]) => count > 1);
if (repeated.length > 0) {
  console.log(`\nRepeated component_need values (possible retry loop -- see SECURITY.md's session-cap section):`);
  for (const [need, count] of repeated.slice(0, 10)) {
    console.log(`  ${count}x  "${need}"`);
  }
  if (repeated.length > 10) console.log(`  ... and ${repeated.length - 10} more`);
} else {
  console.log(`\nNo repeated component_need values -- no sign of a retry loop in this log.`);
}
