#!/usr/bin/env node
/**
 * verify-design-system-recall-check.mjs
 *
 * Unit-level check for findKeywordOverlapCandidates -- the deterministic,
 * zero-cost keyword-overlap check that runs whenever a design-system-scored
 * recommend_component call comes back with reason "no_candidates_found",
 * to catch the model missing a real match sitting in its own prompt (see
 * BACKLOG.md's "Design-system recall check on false custom_build" entry).
 *
 * Imports the function directly (no MCP server needed -- it's a pure
 * function of its three arguments, same "pure function" testing shape as
 * verify-provenance-artifact.mjs). Does NOT exercise the live wiring in
 * runSinglePass (attaching design_system_recall_check to a real API
 * response) -- that requires a real model call to genuinely produce
 * reason "no_candidates_found", which this script deliberately doesn't
 * spend money on. See BACKLOG.md for that scoping note.
 *
 * Run: node scripts/verify-design-system-recall-check.mjs (after `npm run build`)
 * Exits non-zero on any failed assertion.
 */
process.env.PATTERN_NO_AUTOSTART = "1";

const { findKeywordOverlapCandidates } = await import("../dist/index.js");

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    console.error(`    expected: ${e}`);
    console.error(`    actual:   ${a}`);
    failures++;
  }
}

const candidate = (name, props, description, usage_example) => ({
  name,
  props,
  description: description ?? null,
  usage_example: usage_example ?? null,
  file_path: null,
});

const CANDIDATES = [
  candidate("ReferralBanner", ["code", "bonusAmount"], null, null),
  candidate("StreakBadge", ["weeks", "size"], null, null),
  candidate("PaymentMethodsList", ["paymentMethods", "onSetDefault", "onRemove", "onAdd"], null, null),
  candidate("OrderListRow", ["order", "onClick"], null, null),
  candidate(
    "Spinner",
    [],
    "A loading indicator with no configurable behavior.",
    null
  ),
];

console.log("1. Name-based overlap: need text shares a word with the candidate's own name");
check(
  "ReferralBanner surfaces for a referral-shaped need",
  findKeywordOverlapCandidates(
    "a way to invite friends and earn a referral bonus",
    "peer-to-peer marketplace",
    CANDIDATES
  ).map((m) => m.name),
  ["ReferralBanner"]
);

console.log("\n2. Prop-based overlap via camelCase splitting (bonusAmount -> bonus, amount)");
check(
  "ReferralBanner surfaces purely from its 'bonusAmount' prop, no 'referral' wording in the need",
  findKeywordOverlapCandidates("show the signup bonus amount to a new user", "marketplace app", CANDIDATES).map((m) => m.name),
  ["ReferralBanner"]
);

console.log("\n3. Description-based overlap");
check(
  "Spinner surfaces from its description text ('loading indicator'), not its name or props",
  findKeywordOverlapCandidates("a loading spinner for async actions", "any app", CANDIDATES)
    .map((m) => m.name)
    .sort(),
  ["Spinner"].sort()
);

console.log("\n4. No overlap at all -- genuinely unrelated need returns empty");
check(
  "an unrelated need (video call scheduling) matches nothing",
  findKeywordOverlapCandidates("schedule a video call between two users", "telehealth app", CANDIDATES),
  []
);

console.log("\n5. Generic stopwords don't count as a match on their own");
check(
  "'component', 'user', 'display', 'app' alone (all stopwords) don't create a false match",
  findKeywordOverlapCandidates("display a component for the user", "app", CANDIDATES),
  []
);

console.log("\n6. Ranking: more shared keywords sorts first");
const rankedCandidates = [
  candidate("StreakDisplay", ["weeks", "streak", "badge"], null, null),
  candidate("StreakBadgeSmall", ["weeks", "size", "streak", "badge", "compact"], null, null),
];
{
  const result = findKeywordOverlapCandidates("weeks streak badge size compact display", "loyalty app", rankedCandidates);
  check(
    "StreakBadgeSmall (5 shared keywords) ranks above StreakDisplay (3 shared keywords)",
    result.map((m) => m.name),
    ["StreakBadgeSmall", "StreakDisplay"]
  );
  check("shared_keywords for the top match lists the actual overlapping words", result[0].shared_keywords.sort(), ["badge", "compact", "size", "streak", "weeks"].sort());
}

console.log("\n7. Capped at 5 results even when more than 5 candidates overlap");
{
  const manyCandidates = Array.from({ length: 8 }, (_, i) => candidate(`WidgetKind${i}`, ["widget"], null, null));
  const result = findKeywordOverlapCandidates("a widget for the dashboard", "internal tools", manyCandidates);
  check("returns at most 5 matches even with 8 real overlaps", result.length, 5);
}

console.log("\n8. Empty candidate list returns empty, doesn't throw");
check("no registered candidates at all", findKeywordOverlapCandidates("anything at all", "any domain", []), []);

console.log("\n9. Need text with only stopwords/short words returns empty (nothing to match on)");
check(
  "a need with no real keywords at all",
  findKeywordOverlapCandidates("the a an of to", "in on at", CANDIDATES),
  []
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
