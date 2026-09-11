#!/usr/bin/env node
/**
 * verify-check-gate.mjs
 *
 * Standalone check for the enforcement-boundary feature: component-gate.ts's
 * classifier, gate-receipt.ts's schema/round-trip, and check-gate.ts's
 * write/verify CLI modes end to end (spawned as a real subprocess against
 * a temp "consuming repo" + a temp ledger file, never the real
 * ~/.pattern/ledger.jsonl).
 *
 * Run: node scripts/verify-check-gate.mjs (after `npm run build`)
 * Exits non-zero on any failed assertion.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.PATTERN_NO_AUTOSTART = "1";

const { isGatedComponentFile, parseManualOverride } = await import("../dist/component-gate.js");
const { assertGateReceiptShape, writeGateReceipt, readAllGateReceipts, deriveOverrideFeatureId } = await import(
  "../dist/gate-receipt.js"
);

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ok: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

const GATED_COMPONENT_SOURCE = `import { useState } from "react";

export function ReferralBanner({ code, onDismiss }) {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
  };

  return (
    <div className="banner">
      <span className="code">{code}</span>
      <button onClick={onCopy}>{copied ? "Copied" : "Copy"}</button>
      <button onClick={onDismiss} aria-label="Dismiss">
        &times;
      </button>
    </div>
  );
}
`;

const TRIVIAL_SOURCE = `export const Spacer = () => <div className="h-4" />;\n`;

// Regression fixture: the exact real component (14 non-blank lines) that
// slipped through ungated during end-to-end testing on coop-commerce on
// 2026-09-11, when MIN_NON_BLANK_LINES was 15. Locks in the fix that
// removed the line-count floor's role as a "trivial" exemption -- see
// component-gate.ts's comment on MIN_NON_BLANK_LINES.
const REGRESSION_SLIPPED_THROUGH_SOURCE = `export default function UngatedWidget({ label, count }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <span className="text-sm font-medium">{label}</span>
      <span className="text-sm text-[var(--color-text-muted)]">{count}</span>
      <div className="mt-1 h-1 w-full rounded bg-[var(--color-border)]">
        <div
          className="h-1 rounded bg-[var(--color-tint)]"
          style={{ width: \`\${Math.min(100, count)}%\` }}
        />
      </div>
    </div>
  )
}
`;

console.log("1. isGatedComponentFile classifier");
{
  check("gates a new, non-trivial .tsx component", isGatedComponentFile("src/ReferralBanner.tsx", GATED_COMPONENT_SOURCE, true));
  check("does not gate a non-new file", !isGatedComponentFile("src/ReferralBanner.tsx", GATED_COMPONENT_SOURCE, false));
  check("does not gate a trivial one-liner", !isGatedComponentFile("src/Spacer.tsx", TRIVIAL_SOURCE, true));
  check("does not gate a non-.tsx/.jsx file", !isGatedComponentFile("src/util.ts", GATED_COMPONENT_SOURCE, true));
  check("does not gate a file with no component export", !isGatedComponentFile("src/data.tsx", "export const items = [1,2,3];\n".repeat(20), true));
  check(
    "regression: the 14-line component that slipped through the old 15-line floor is now gated",
    isGatedComponentFile("src/components/common/UngatedWidget.jsx", REGRESSION_SLIPPED_THROUGH_SOURCE, true),
  );
}

console.log("2. parseManualOverride");
{
  const withOverride = `// pattern-mcp:override reason="copied verbatim from internal lib"\n` + GATED_COMPONENT_SOURCE;
  const result = parseManualOverride(withOverride);
  check("detects a well-formed override", result.overridden === true);
  check("captures the reason", result.reason === "copied verbatim from internal lib");
  const noReason = parseManualOverride(`// pattern-mcp:override reason=""\n` + GATED_COMPONENT_SOURCE);
  check("rejects an empty reason", noReason.overridden === false);
  const none = parseManualOverride(GATED_COMPONENT_SOURCE);
  check("no override on ordinary content", none.overridden === false);
}

console.log("3. GateReceipt shape + round-trip");
const scratchRoot = mkdtempSync(join(tmpdir(), "pattern-check-gate-test-"));
{
  const receipt = {
    schema_version: 1,
    feature_id: "abc12345",
    file_path: "src/ReferralBanner.tsx",
    ledger_entry_id: "entry-1",
    verdict: "use_existing",
    chosen_candidate: "shadcn/ui button",
    snapshot_ref: "deadbeef",
    checked_at: new Date().toISOString(),
    manual_override: false,
    override_reason: null,
  };
  let threw = false;
  try {
    assertGateReceiptShape(receipt);
  } catch {
    threw = true;
  }
  check("valid receipt does not throw", !threw);

  writeGateReceipt(scratchRoot, receipt);
  const readBack = readAllGateReceipts(scratchRoot);
  check("readAllGateReceipts finds exactly the written receipt", readBack.length === 1 && readBack[0].feature_id === "abc12345");

  let unknownKeyThrew = false;
  try {
    assertGateReceiptShape({ ...receipt, extra_field: "nope" });
  } catch {
    unknownKeyThrew = true;
  }
  check("throws on an unknown key", unknownKeyThrew);

  const featureId1 = deriveOverrideFeatureId("proj-a", "src/Foo.tsx");
  const featureId2 = deriveOverrideFeatureId("proj-a", "src/Foo.tsx");
  const featureId3 = deriveOverrideFeatureId("proj-b", "src/Foo.tsx");
  check("deriveOverrideFeatureId is stable for the same input", featureId1 === featureId2);
  check("deriveOverrideFeatureId differs across project_id", featureId1 !== featureId3);
}
rmSync(scratchRoot, { recursive: true, force: true });

console.log("4. check-gate CLI: write mode, no ledger entry -> blocked");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-check-gate-test-"));
  const ledgerPath = join(root, "test-ledger.jsonl");
  const projectId = "test-project";

  const result = runCheckGate(
    ["write", "--file", "src/ReferralBanner.tsx", "--is-new", "--project-id", projectId, "--project-root", root],
    GATED_COMPONENT_SOURCE,
    { PATTERN_LEDGER_PATH: ledgerPath },
  );
  check("exits non-zero when no matching ledger entry", result.status !== 0);
  const parsed = JSON.parse(result.stdout.trim());
  check("ok is false", parsed.ok === false);
  check("no receipt was written", !existsSync(join(root, ".pattern/receipts")));
  rmSync(root, { recursive: true, force: true });
}

console.log("5. check-gate CLI: write mode, matching ledger entry -> allowed + receipt written");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-check-gate-test-"));
  const ledgerPath = join(root, "test-ledger.jsonl");
  const projectId = "test-project";

  const ledgerEntry = {
    id: "entry-xyz",
    timestamp: new Date().toISOString(),
    project_id: projectId,
    feature_id: "feat-001",
    component_need: "referral banner",
    domain: "web",
    framework: "react",
    checklist: [],
    checklist_source: "extracted",
    candidates_evaluated: [],
    verdict: "use_existing",
    chosen_candidate: "shadcn/ui alert",
    confidence: "high",
    reason: "scored",
    coverage: "8/8 (100%)",
    cost_usd: 0.02,
    cache_hit: false,
    project_conventions_snapshot: null,
    file_path: "src/ReferralBanner.tsx",
    snapshot_ref: null,
    last_verified_live: null,
    live_status: "unknown",
    reconstructed_snapshot_ref: null,
  };
  writeFileSync(ledgerPath, JSON.stringify(ledgerEntry) + "\n", "utf8");

  const result = runCheckGate(
    ["write", "--file", "src/ReferralBanner.tsx", "--is-new", "--project-id", projectId, "--project-root", root],
    GATED_COMPONENT_SOURCE,
    { PATTERN_LEDGER_PATH: ledgerPath },
  );
  check("exits 0 when a matching ledger entry exists", result.status === 0);
  const parsed = JSON.parse(result.stdout.trim());
  check("ok is true", parsed.ok === true);
  check("feature_id matches the ledger entry's", parsed.feature_id === "feat-001");
  const receiptPath = join(root, ".pattern/receipts/feat-001.json");
  check("receipt file was written", existsSync(receiptPath));
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  check("receipt records the matched ledger_entry_id", receipt.ledger_entry_id === "entry-xyz");
  check("receipt is not a manual override", receipt.manual_override === false);
  rmSync(root, { recursive: true, force: true });
}

console.log("6. check-gate CLI: write mode, manual override -> allowed + receipt records override");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-check-gate-test-"));
  const ledgerPath = join(root, "test-ledger.jsonl");
  const projectId = "test-project";
  const overriddenSource = `// pattern-mcp:override reason="matches internal design system exactly"\n` + GATED_COMPONENT_SOURCE;

  const result = runCheckGate(
    ["write", "--file", "src/ReferralBanner.tsx", "--is-new", "--project-id", projectId, "--project-root", root],
    overriddenSource,
    { PATTERN_LEDGER_PATH: ledgerPath },
  );
  check("exits 0 on a valid override with no ledger entry", result.status === 0);
  const parsed = JSON.parse(result.stdout.trim());
  check("manual_override reported true", parsed.manual_override === true);
  const receiptPath = join(root, `.pattern/receipts/${parsed.feature_id}.json`);
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  check("receipt records manual_override true", receipt.manual_override === true);
  check("receipt records the override reason", receipt.override_reason === "matches internal design system exactly");
  check("receipt has no ledger_entry_id", receipt.ledger_entry_id === null);
  rmSync(root, { recursive: true, force: true });
}

console.log("7. check-gate CLI: write mode, non-gated file -> passes through, no receipt");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-check-gate-test-"));
  const ledgerPath = join(root, "test-ledger.jsonl");
  const result = runCheckGate(
    ["write", "--file", "src/Spacer.tsx", "--is-new", "--project-id", "test-project", "--project-root", root],
    TRIVIAL_SOURCE,
    { PATTERN_LEDGER_PATH: ledgerPath },
  );
  check("exits 0 for a non-gated file", result.status === 0);
  const parsed = JSON.parse(result.stdout.trim());
  check("gated reported false", parsed.gated === false);
  check("no receipt directory created", !existsSync(join(root, ".pattern/receipts")));
  rmSync(root, { recursive: true, force: true });
}

console.log("8. check-gate CLI: verify mode against a committed receipt");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-check-gate-test-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/ReferralBanner.tsx"), GATED_COMPONENT_SOURCE, "utf8");
  writeGateReceipt(root, {
    schema_version: 1,
    feature_id: "feat-committed",
    file_path: "src/ReferralBanner.tsx",
    ledger_entry_id: "entry-abc",
    verdict: "use_existing",
    chosen_candidate: "shadcn/ui alert",
    snapshot_ref: null,
    checked_at: new Date().toISOString(),
    manual_override: false,
    override_reason: null,
  });

  const passResult = runCheckGate(["verify", "--files", "src/ReferralBanner.tsx", "--project-root", root]);
  check("verify passes when a matching receipt is committed", passResult.status === 0);

  rmSync(join(root, ".pattern/receipts/feat-committed.json"));
  const failResult = runCheckGate(["verify", "--files", "src/ReferralBanner.tsx", "--project-root", root]);
  check("verify fails when the receipt is missing", failResult.status !== 0);
  const failParsed = JSON.parse(failResult.stdout.trim());
  check("ungated_files lists the file", (failParsed.ungated_files ?? []).includes("src/ReferralBanner.tsx"));

  rmSync(root, { recursive: true, force: true });
}

function runCheckGate(args, stdin, extraEnv = {}) {
  const cliPath = fileURLToPath(new URL("../dist/check-gate.js", import.meta.url));
  return spawnSync("node", [cliPath, ...args], {
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, PATTERN_NO_AUTOSTART: "1", ...extraEnv },
  });
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
