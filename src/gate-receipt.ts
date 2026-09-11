// Receipt schema + read/write for the enforcement-boundary feature.
// Deliberately committed into the CONSUMING repo (e.g. `.pattern/receipts/`
// at that repo's root) rather than `~/.pattern/` -- this is the one
// artifact a CI runner can see without any access to the local, homedir-
// scoped ledger (see SECURITY.md's "not sent anywhere by Pattern itself").
// One JSON file per feature, git-diffable, not an append-only jsonl --
// receipts are meant to be read directly out of a small PR diff, not
// grown forever like the homedir ledger overlays.
//
// No dependency on index.ts by design: importing index.ts triggers its
// module-level MCP-server autostart unless PATTERN_NO_AUTOSTART is set
// before the import resolves, which a static import from this module
// could not guarantee. check-gate.ts handles that ordering itself via a
// dynamic import for the one piece of real reuse it needs
// (readLedgerEntries/computeSnapshotRef) -- this module stays
// self-contained.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const RECEIPTS_DIR = ".pattern/receipts";

export interface GateReceipt {
  schema_version: 1;
  feature_id: string;
  file_path: string;
  ledger_entry_id: string | null;
  verdict: string | null;
  chosen_candidate: string | null;
  snapshot_ref: string | null;
  checked_at: string;
  manual_override: boolean;
  override_reason: string | null;
}

const ALLOWED_GATE_RECEIPT_KEYS = new Set([
  "schema_version",
  "feature_id",
  "file_path",
  "ledger_entry_id",
  "verdict",
  "chosen_candidate",
  "snapshot_ref",
  "checked_at",
  "manual_override",
  "override_reason",
]);

// Same throw-on-unknown-key discipline as index.ts's
// assertDistilledCandidateShape -- a receipt reaching this function with
// an extra key is a bug, not something to silently strip, since this
// shape is the one thing CI trusts without re-deriving it.
export function assertGateReceiptShape(value: unknown): asserts value is GateReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("GateReceipt must be a plain object");
  }
  const record = value as Record<string, unknown>;
  const extra = Object.keys(record).filter((k) => !ALLOWED_GATE_RECEIPT_KEYS.has(k));
  if (extra.length > 0) {
    throw new Error(`GateReceipt has disallowed key(s): ${extra.join(", ")}`);
  }
  if (record.schema_version !== 1) {
    throw new Error("GateReceipt.schema_version must be 1");
  }
}

// feature_id can be caller-supplied (recommend_component's optional
// feature_id arg) -- never trust it as a bare filename. Sanitizing to a
// safe character set makes path traversal structurally impossible here
// without needing index.ts's resolveWithinRoot (see file header).
function sanitizeFeatureIdForFilename(featureId: string): string {
  return featureId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// Only used on the manual-override path, which has no ledger entry to
// derive a feature_id from. Deliberately a separate, local derivation
// rather than index.ts's deriveFeatureId (not exported, and this only
// ever needs to be stable for one project_id+file_path pair -- it's never
// joined against real ledger data).
export function deriveOverrideFeatureId(projectId: string, filePath: string): string {
  return createHash("sha256").update(`override::${projectId}::${filePath}`).digest("hex").slice(0, 8);
}

export function writeGateReceipt(root: string, receipt: GateReceipt): void {
  assertGateReceiptShape(receipt);
  const abs = join(root, RECEIPTS_DIR, `${sanitizeFeatureIdForFilename(receipt.feature_id)}.json`);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(receipt, null, 2) + "\n", "utf8");
}

// verify mode's only read path: it doesn't know a file's feature_id ahead
// of time (that lives in the local ledger, invisible to CI), so it scans
// every committed receipt and matches on file_path instead. A malformed
// receipt is treated as absent, not fatal -- the caller reports the gated
// file as unreceipted, same as if no file existed at all.
export function readAllGateReceipts(root: string): GateReceipt[] {
  const dirAbs = join(root, RECEIPTS_DIR);
  if (!existsSync(dirAbs)) return [];
  const receipts: GateReceipt[] = [];
  for (const name of readdirSync(dirAbs)) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dirAbs, name), "utf8"));
      assertGateReceiptShape(parsed);
      receipts.push(parsed);
    } catch {
      // skip malformed/unreadable receipt
    }
  }
  return receipts;
}
