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

// Deliberately generous floor: this only needs to exclude obviously
// trivial files (a one-line re-export, a tiny wrapper). The same "is this
// non-trivial" judgment SKILL.md already leaves to the calling agent's
// discretion isn't solvable more precisely here without re-implementing
// Pattern's own requirement-extraction step.
const MIN_NON_BLANK_LINES = 15;

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
