// Shared classifier for the enforcement-boundary feature (hook + CI gate).
// Used identically by check-gate.ts's write mode (the local PreToolUse
// hook) and verify mode (the CI check) -- lives in its own module,
// deliberately with zero dependency on index.ts, so the two call sites can
// never silently drift on what counts as "a non-trivial new UI component."
// This is host-agnostic and opt-in: nothing here runs unless a consuming
// repo explicitly wires up the hook template or the workflow template --
// Pattern's core MCP tools (recommend_component, record_component_decision,
// etc.) are unaffected either way, so Codex/Cursor/any other MCP host keeps
// working exactly as before.

const GATED_EXTENSIONS = new Set([".tsx", ".jsx"]);

// Deliberately NOT a "non-trivial" threshold -- an earlier version used
// 15 here specifically to auto-exempt "trivial" files, and a real,
// 14-non-blank-line component (a labeled progress-bar widget) slipped
// through ungated in end-to-end testing on 2026-09-11 as a direct result.
// Any fixed line-count threshold used as an exemption has this problem by
// construction: there's always a real component sitting just under
// whatever number you pick, and tuning the number only moves the
// boundary to a different real component, it doesn't close the class of
// bug. This floor exists ONLY to exclude degenerate non-components (a
// bare re-export line, an empty file) -- genuine trivial-but-real
// components are meant to go through the manual override instead
// (parseManualOverride below), which requires a reason and still leaves
// a visible, logged receipt, rather than being silently auto-exempted.
const MIN_NON_BLANK_LINES = 3;

const COMPONENT_EXPORT_PATTERN =
  /^export\s+(default\s+)?(function|class)\s+[A-Z]|^export\s+(default\s+)?const\s+[A-Z]\w*\s*[:=]/m;

// isNewFile is passed in, not derived here -- the local hook knows it via
// existsSync before the write happens; CI verify mode knows it via the
// workflow's own `git diff --diff-filter=A` filtering. Keeping that
// detection out of this module keeps it a pure, easily-tested function.
export function isGatedComponentFile(filePath: string, fileContent: string, isNewFile: boolean): boolean {
  if (!isNewFile) return false;
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return false;
  if (!GATED_EXTENSIONS.has(filePath.slice(dot))) return false;
  if (!COMPONENT_EXPORT_PATTERN.test(fileContent)) return false;
  const nonBlankLines = fileContent.split("\n").filter((l) => l.trim().length > 0).length;
  return nonBlankLines >= MIN_NON_BLANK_LINES;
}

// Per-file escape hatch (Q3 from the enforcement-boundary design): a
// magic comment with a required reason. The hook and CI both honor this
// identically because both call this same function -- but it never
// silently bypasses: check-gate.ts still writes a receipt recording
// manual_override: true and the reason, so the exception stays visible in
// the same committed artifact as a normal pass.
const OVERRIDE_PATTERN = /\/\/\s*pattern-mcp:override\s+reason="([^"]+)"/;

export function parseManualOverride(fileContent: string): { overridden: boolean; reason: string | null } {
  const match = fileContent.match(OVERRIDE_PATTERN);
  if (!match || !match[1].trim()) return { overridden: false, reason: null };
  return { overridden: true, reason: match[1].trim() };
}
