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

// --- Components added inside files that already existed -----------------
//
// isGatedComponentFile above only looks at brand-new files, so a component
// declared inside an existing file (a sub-component, or a rewrite under a new
// name) never reached the gate. CI verify mode diffs each modified file's
// component declarations against the base branch and treats the names that
// are new as gated. Deliberately NOT size-based, for the reason documented at
// MIN_NON_BLANK_LINES: any threshold has a real component just under it. A
// name that did not exist before is a deterministic signal.
//
// Heuristic, line-start only: PascalCase functions, classes that extend
// something, and PascalCase consts assigned an arrow function, memo() or
// forwardRef(). A name must contain a lowercase letter so SHOUTY_CONSTANTS
// are never mistaken for components.
const DECLARATION_PATTERNS: RegExp[] = [
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Z][A-Za-z0-9]*)\s*[(<]/,
  /^(?:export\s+)?(?:default\s+)?class\s+([A-Z][A-Za-z0-9]*)\s+extends\b/,
  /^(?:export\s+)?const\s+([A-Z][A-Za-z0-9]*)\s*(?::[^=]+)?=\s*(?:(?:async\s+)?\(|(?:async\s+)?[a-z_]\w*\s*=>|(?:React\.)?(?:memo|forwardRef)\s*[(<]|function\b)/,
];

export interface ComponentDeclaration {
  name: string;
  /** 0-based index into the file's lines. */
  line: number;
}

export function extractComponentDeclarations(content: string): ComponentDeclaration[] {
  const found: ComponentDeclaration[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const re of DECLARATION_PATTERNS) {
      const m = lines[i].match(re);
      if (m && /[a-z]/.test(m[1])) {
        found.push({ name: m[1], line: i });
        break;
      }
    }
  }
  return found;
}

// Names declared in `head` that `base` did not declare. A null base (the file
// has no previous version) counts every declaration as new.
export function newComponentDeclarations(base: string | null, head: string): ComponentDeclaration[] {
  const before = new Set(base === null ? [] : extractComponentDeclarations(base).map((d) => d.name));
  return extractComponentDeclarations(head).filter((d) => !before.has(d.name));
}

// Explicit, reasoned skip for one component: a comment on one of the two lines
// directly above its declaration. A file-level override (parseManualOverride)
// also skips every new component in the file. Either way the reason is
// surfaced in the CI output, so a skip is visible in the PR, never silent.
const SKIP_PATTERN = /\/\/\s*pattern-mcp:skip\s+reason="([^"]+)"/;

export function skipReasonFor(content: string, decl: ComponentDeclaration): string | null {
  const lines = content.split("\n");
  for (let i = decl.line - 1; i >= Math.max(0, decl.line - 2); i--) {
    const m = lines[i].match(SKIP_PATTERN);
    if (m && m[1].trim()) return m[1].trim();
  }
  const fileLevel = parseManualOverride(content);
  return fileLevel.overridden ? fileLevel.reason : null;
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
