// Shared interactive-prompt plumbing for Pattern's CLI wizards
// (`pattern-check-gate init`, `pattern-mcp init`). Extracted from
// init-enforcement.ts so both wizards share one readline instance and one
// fix for the same bug, instead of drifting apart.
//
// A queue-based prompt helper, not readline/promises' question() --
// question() only starts listening for a line *after* it's called, but
// with piped/non-TTY stdin (as in an automated test, or `init | cat`)
// every line arrives in one synchronous burst, ahead of any await
// cycle. Confirmed directly: two sequential `rl.question()` calls on a
// piped `printf 'a\nb\n'` answer only the first and hang forever on the
// second -- Node even logs "Detected unsettled top-level await" in that
// repro. The fix is a small always-listening queue: a persistent 'line'
// listener buffers answers that arrive before they're asked for, so
// `askLine` either drains an already-buffered answer immediately or
// waits for the next 'line' event, whichever comes first -- correct for
// both a real interactive TTY (waiter path) and piped/scripted input
// (queue path).

import { createInterface, type Interface } from "node:readline";

export interface PromptOptions {
  yes: boolean;
}

let rl: Interface | null = null;
const lineQueue: string[] = [];
const waiters: Array<(line: string) => void> = [];

function ensureRl(): Interface {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.on("line", (line) => {
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else lineQueue.push(line);
    });
  }
  return rl;
}

export function askLine(promptStr: string): Promise<string> {
  ensureRl();
  process.stdout.write(promptStr);
  const queued = lineQueue.shift();
  if (queued !== undefined) return Promise.resolve(queued);
  return new Promise((resolve) => waiters.push(resolve));
}

export function closeRl(): void {
  rl?.close();
  rl = null;
}

export async function confirm(question: string, options: PromptOptions, defaultYes: boolean): Promise<boolean> {
  if (options.yes) return defaultYes;
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = (await askLine(`${question} ${suffix} `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

export async function promptText(question: string, defaultValue: string, options: PromptOptions): Promise<string> {
  if (options.yes) return defaultValue;
  const answer = (await askLine(`${question} [${defaultValue}]: `)).trim();
  return answer || defaultValue;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
