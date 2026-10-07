import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

// Shell commands that create a UI component file skip the Write/Edit hook, so
// the receipt check never runs. Recognises the common ways a command writes a
// .tsx/.jsx path: a redirect, tee, cp/mv/install, or an inline script's write
// call. It is a heuristic, not a shell parser: it catches the usual shapes and
// errs toward allowing anything it cannot read as a write.
const UI_FILE = String.raw`[^\s"'|;&<>()]*\.(?:tsx|jsx)`;
const SHELL_WRITE_PATTERNS: RegExp[] = [
  new RegExp(String.raw`>>?\s*["']?(${UI_FILE})`, "g"),
  new RegExp(String.raw`\btee\s+(?:-a\s+)?["']?(${UI_FILE})`, "g"),
  new RegExp(String.raw`\b(?:cp|mv|install)\s+[^;&|]*?["']?(${UI_FILE})["']?\s*(?:$|[;&|])`, "g"),
  new RegExp(String.raw`\bopen\(\s*["'](${UI_FILE})["']\s*,\s*["'][wax]`, "g"),
  new RegExp(String.raw`\b(?:writeFileSync|writeFile|write_text|appendFileSync)\(\s*["'](${UI_FILE})["']`, "g"),
];

export function newUiFilesWrittenByShell(command: string, cwd: string): string[] {
  const found = new Set<string>();
  for (const re of SHELL_WRITE_PATTERNS) {
    for (const m of command.matchAll(re)) {
      const target = m[1];
      if (!target) continue;
      const abs = isAbsolute(target) ? target : join(cwd, target);
      if (!existsSync(abs)) found.add(target);
    }
  }
  return [...found];
}
