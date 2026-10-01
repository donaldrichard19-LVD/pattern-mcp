#!/usr/bin/env node
// Offline: isNearVerdictBoundary generalizes the 8-item boundary set.
process.env.PATTERN_NO_AUTOSTART = "1";
process.env.PATTERN_TELEMETRY = "0";
const m = await import("../dist/index.js");
const risky = (t) => [...Array(t + 1).keys()].filter((x) => m.isNearVerdictBoundary(x, t));
let fail = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) fail++; };
check("8 items == legacy set {3,4,6,7}", risky(8).join() === [...m.BOUNDARY_RISK_MET_COUNTS_FOR_8_ITEMS].sort().join());
check("9 items == {3,4,7,8}", risky(9).join() === "3,4,7,8");
check("5/9 (dialog need) skips the ensemble", !m.isNearVerdictBoundary(5, 9));
check("10 items == {3,4,7,8}", risky(10).join() === "3,4,7,8");
const mk = (met, total) => ({ reason: "scored", requirements_checked: Array.from({ length: total }, (_, i) => ({ requirement: "r", met: i < met, evidence: "" })) });
check("isBoundaryRisk 5/9 false", m.isBoundaryRisk(mk(5, 9)) === false);
check("isBoundaryRisk 4/9 true", m.isBoundaryRisk(mk(4, 9)) === true);
check("isBoundaryRisk empty list true", m.isBoundaryRisk({ reason: "scored", requirements_checked: [] }) === true);
console.log(fail ? `${fail} failed` : "All checks passed.");
process.exit(fail ? 1 : 0);
