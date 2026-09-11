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
const { deriveProjectId } = await import("../dist/project-id.js");

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

console.log("9. deriveProjectId (Option A)");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-check-gate-test-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "my-pkg-name" }), "utf8");
  check("uses package.json's name when present", deriveProjectId(root) === "my-pkg-name");
  rmSync(root, { recursive: true, force: true });
}
{
  const root = mkdtempSync(join(tmpdir(), "pattern-check-gate-test-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/some-owner/some-repo.git"], { cwd: root });
  check("falls back to the git remote's repo name when no package.json", deriveProjectId(root) === "some-repo");
  rmSync(root, { recursive: true, force: true });
}
{
  const root = mkdtempSync(join(tmpdir(), "pattern-check-gate-test-"));
  check("falls back to the directory name when neither exists", deriveProjectId(root) === root.split("/").pop());
  rmSync(root, { recursive: true, force: true });
}

console.log("10. check-gate CLI: write mode without --project-id auto-derives it");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-check-gate-test-"));
  const ledgerPath = join(root, "test-ledger.jsonl");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "auto-derived-project" }), "utf8");
  writeFileSync(
    ledgerPath,
    JSON.stringify({
      id: "entry-auto",
      timestamp: new Date().toISOString(),
      project_id: "auto-derived-project",
      feature_id: "feat-auto",
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
      coverage: "8/8",
      cost_usd: 0.02,
      cache_hit: false,
      project_conventions_snapshot: null,
      file_path: "src/ReferralBanner.tsx",
      snapshot_ref: null,
      last_verified_live: null,
      live_status: "unknown",
      reconstructed_snapshot_ref: null,
    }) + "\n",
    "utf8",
  );
  const result = runCheckGate(
    ["write", "--file", "src/ReferralBanner.tsx", "--is-new", "--project-root", root],
    GATED_COMPONENT_SOURCE,
    { PATTERN_LEDGER_PATH: ledgerPath },
  );
  check("exits 0 when the derived project_id matches the ledger entry, with no --project-id passed", result.status === 0);
  rmSync(root, { recursive: true, force: true });
}

console.log("11. pattern-check-gate init: fresh repo, no git, no existing settings");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-check-gate-test-"));
  const result = runInit(root, ["--yes"]);
  check("init exits 0", result.status === 0);
  const settingsPath = join(root, ".claude", "settings.json");
  check("settings.json was created", existsSync(settingsPath));
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const command = settings.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command ?? "";
  check("hook command references pattern-check-gate-hook", command.includes("pattern-check-gate-hook"));
  check("no PATTERN_PROJECT_ID override when the derived id was accepted", !command.includes("PATTERN_PROJECT_ID"));
  check("no workflow file written (no git remote to detect GitHub from)", !existsSync(join(root, ".github/workflows/pattern-gate.yml")));
  rmSync(root, { recursive: true, force: true });
}

console.log("12. pattern-check-gate init: preserves unrelated existing hooks");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-check-gate-test-"));
  mkdirSync(join(root, ".claude"), { recursive: true });
  const existing = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo unrelated" }] }] } };
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify(existing, null, 2), "utf8");

  const result = runInit(root, ["--yes"]);
  check("init exits 0", result.status === 0);
  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  check("still has 2 PreToolUse entries (unrelated + ours)", settings.hooks.PreToolUse.length === 2);
  check("unrelated hook entry untouched", settings.hooks.PreToolUse[0].hooks[0].command === "echo unrelated");
  check("our hook entry appended", settings.hooks.PreToolUse[1].hooks[0].command.includes("pattern-check-gate-hook"));
  rmSync(root, { recursive: true, force: true });
}

console.log("13. pattern-check-gate init: idempotent on rerun");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-check-gate-test-"));
  runInit(root, ["--yes"]);
  runInit(root, ["--yes"]);
  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  check("no duplicate hook entry after running init twice", settings.hooks.PreToolUse.length === 1);
  rmSync(root, { recursive: true, force: true });
}

console.log("14. pattern-check-gate init: writes the workflow file for a GitHub-remote repo");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-check-gate-test-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/some-owner/some-repo.git"], { cwd: root });

  const result = runInit(root, ["--yes"]);
  check("init exits 0", result.status === 0);
  const workflowPath = join(root, ".github", "workflows", "pattern-gate.yml");
  check("workflow file was written", existsSync(workflowPath));
  const templatePath = fileURLToPath(new URL("../templates/github-workflows/pattern-gate.yml", import.meta.url));
  check("workflow file matches the template exactly", readFileSync(workflowPath, "utf8") === readFileSync(templatePath, "utf8"));
  rmSync(root, { recursive: true, force: true });
}

console.log("15. pattern-check-gate init: never overwrites a conflicting workflow file, even with --yes");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-check-gate-test-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/some-owner/some-repo.git"], { cwd: root });
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "pattern-gate.yml"), "# a customized workflow, not ours\n", "utf8");

  runInit(root, ["--yes"]);
  const content = readFileSync(join(root, ".github", "workflows", "pattern-gate.yml"), "utf8");
  check("conflicting workflow file left untouched under --yes (safe default is 'no')", content === "# a customized workflow, not ours\n");
  rmSync(root, { recursive: true, force: true });
}

console.log("16. pattern-check-gate init: branch protection is never touched under --yes");
{
  const root = mkdtempSync(join(tmpdir(), "pattern-check-gate-test-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/some-owner/some-repo.git"], { cwd: root });

  const result = runInit(root, ["--yes"]);
  check("init still exits 0 (branch protection step is a no-op under --yes, not a failure)", result.status === 0);
  check(
    "output does not claim branch protection was configured",
    !/Required "pattern-gate" check added/.test(result.stdout),
  );
  rmSync(root, { recursive: true, force: true });
}

console.log("17. pattern-check-gate init: interactive (non---yes) prompt sequence, multiple piped answers");
{
  // Regression test for a real bug found in manual testing: readline's
  // question()-per-prompt pattern loses piped stdin after the first
  // question (Node logs "Detected unsettled top-level await" in
  // isolation). init-enforcement.ts's askLine queue is the fix -- this
  // locks it in so a future refactor can't silently reintroduce it. All
  // 4 answers are piped up front in one write, exactly the shape that
  // exposed the original bug (a real interactive TTY doesn't hit this,
  // since each answer only arrives after its prompt is shown).
  const root = mkdtempSync(join(tmpdir(), "pattern-check-gate-test-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/some-owner/some-repo.git"], { cwd: root });

  const result = runInit(root, [], "my-custom-id\ny\ny\nn\n");
  check("init exits 0 after all 4 prompts are answered", result.status === 0);
  check("prompted for project id", result.stdout.includes("Project id [some-repo]:"));
  check("prompted to write settings.json", result.stdout.includes("Write this?"));
  check("prompted for branch protection", result.stdout.includes("Mark the pattern-gate check as required"));
  check("reached the final Done message (i.e. didn't hang on question 2+)", result.stdout.includes("\nDone."));

  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  const command = settings.hooks.PreToolUse[0].hooks[0].command;
  check("captured the typed project-id override, not the derived default", command.includes("PATTERN_PROJECT_ID='my-custom-id'"));
  check("workflow file was written (second 'y' answer reached and processed)", existsSync(join(root, ".github/workflows/pattern-gate.yml")));
  rmSync(root, { recursive: true, force: true });
}

function runInit(root, extraArgs, stdin) {
  const cliPath = fileURLToPath(new URL("../dist/check-gate.js", import.meta.url));
  return spawnSync("node", [cliPath, "init", "--project-root", root, ...extraArgs], {
    input: stdin,
    encoding: "utf8",
    timeout: 10000,
    env: { ...process.env, PATTERN_NO_AUTOSTART: "1" },
  });
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
