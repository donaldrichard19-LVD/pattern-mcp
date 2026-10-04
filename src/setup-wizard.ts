// The guided steps of `npx pattern-mcp init` that sit around client
// connection (client-connect.ts): check the keys, register the user's design
// system, optionally turn on the enforcement gate, and say exactly what is
// and isn't ready at the end. Everything here is a small function with its
// network / registration / filesystem dependencies passed in, so it can be
// tested without a real client, key or Figma file.

import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { askLine, confirm, promptText, type PromptOptions } from "./prompt.js";

export type WizardEnv = Record<string, string>;

export type RegisterRequest =
  | { kind: "figma"; fileKey: string; token: string; replace?: boolean }
  | { kind: "directory"; path: string; replace?: boolean; summarizeWithKey?: string }
  | { kind: "manifest"; path: string; replace?: boolean };

export interface RegisterResult {
  candidateCount: number;
  source: string;
  /** Present when capability summaries were written. */
  summaries?: { generated: number; costUsd: number };
  /** Present when summaries were attempted and failed; the registration itself is saved. */
  summaryError?: string;
}

export interface WizardDeps {
  projectId: string;
  /** Registers a design system for `projectId`; throws with the registrar's own message on failure. */
  register(req: RegisterRequest): Promise<RegisterResult>;
  /** Defaults to global fetch; overridable in tests. */
  fetchImpl?: typeof fetch;
}

export interface WizardState {
  anthropicKey: "valid" | "unverified" | "invalid" | "missing";
  figmaToken: "valid" | "unverified" | "invalid" | "missing";
  clientConnected: boolean;
  skill: string | null;
  designSystem: { source: string; candidateCount: number } | null;
  gate: "set up" | "skipped" | "not asked";
  summaries: number | null;
}

export function newWizardState(): WizardState {
  return { anthropicKey: "missing", figmaToken: "missing", clientConnected: false, skill: null, designSystem: null, gate: "not asked", summaries: null };
}

// Accepts a bare key or any figma.com/design|file|proto|board URL.
export function parseFigmaFileKey(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const url = text.match(/figma\.com\/(?:design|file|proto|board|make)\/([A-Za-z0-9]{10,})/);
  if (url) return url[1];
  return /^[A-Za-z0-9]{10,}$/.test(text) ? text : null;
}

export type KeyCheck = { status: "valid" | "invalid" | "unverified"; message: string };

export async function checkAnthropicKey(key: string, fetchImpl: typeof fetch = fetch): Promise<KeyCheck> {
  if (!/^sk-ant-/.test(key)) {
    return { status: "invalid", message: 'does not start with "sk-ant-" (bad paste?)' };
  }
  const base = process.env.PATTERN_ANTHROPIC_URL ?? "https://api.anthropic.com";
  try {
    const res = await fetchImpl(`${base}/v1/models?limit=1`, {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { status: "valid", message: "accepted by the Anthropic API" };
    if (res.status === 401 || res.status === 403) return { status: "invalid", message: `rejected by the Anthropic API (${res.status})` };
    return { status: "unverified", message: `the Anthropic API answered ${res.status}, so the key could not be confirmed` };
  } catch (err) {
    return { status: "unverified", message: `could not reach the Anthropic API (${err instanceof Error ? err.message : String(err)})` };
  }
}

export async function checkFigmaToken(token: string, fetchImpl: typeof fetch = fetch): Promise<KeyCheck> {
  if (token !== token.trim() || /["'\s]/.test(token) || !/^[\x21-\x7e]+$/.test(token)) {
    return { status: "invalid", message: "contains whitespace, quotes or odd characters (bad paste?)" };
  }
  if (!token.startsWith("figd_")) return { status: "invalid", message: 'does not start with "figd_"' };
  const base = process.env.FIGMA_API_URL ?? "https://api.figma.com";
  try {
    const res = await fetchImpl(`${base}/v1/me`, { headers: { "X-Figma-Token": token }, signal: AbortSignal.timeout(15_000) });
    if (res.ok) return { status: "valid", message: "accepted by Figma" };
    if (res.status === 403) return { status: "invalid", message: "rejected by Figma (403); make a new token with the file_content:read scope" };
    return { status: "unverified", message: `Figma answered ${res.status}, so the token could not be confirmed` };
  } catch (err) {
    return { status: "unverified", message: `could not reach Figma (${err instanceof Error ? err.message : String(err)})` };
  }
}

function stepHeader(n: number, total: number, title: string): void {
  console.log(`\n[${n}/${total}] ${title}`);
}

export const WIZARD_STEPS = 5;

export function wizardIntro(): string {
  return [
    "Pattern setup. Five short steps, each skippable:",
    "  1. Anthropic key   (needed to score components and write build lists)",
    "  2. Figma token     (only if your design system lives in Figma)",
    "  3. Connect         (Claude Code, Claude Desktop, Cursor)",
    "  4. Design system   (the thing Pattern judges every request against)",
    "  5. Enforcement     (optional: make the check mandatory)",
  ].join("\n");
}

async function askKey(
  label: string,
  hint: string,
  check: (k: string) => Promise<KeyCheck>,
  options: PromptOptions,
): Promise<{ value: string | null; status: WizardState["anthropicKey"] }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const answer = (await askLine(`${hint ? `${hint}\n` : ""}  Paste your ${label}, or press Enter to skip: `)).trim();
    if (!answer) return { value: null, status: "missing" };
    process.stdout.write("  Checking it... ");
    const result = await check(answer);
    console.log(result.status === "valid" ? `ok (${result.message}).` : `${result.message}.`);
    if (result.status === "valid") return { value: answer, status: "valid" };
    const keep = await confirm(
      result.status === "invalid" ? "  That key looks wrong. Use it anyway?" : "  Could not confirm it. Use it anyway?",
      options,
      result.status === "unverified",
    );
    if (keep) return { value: answer, status: result.status };
  }
  console.log("  Skipping. You can add it to the server's env block later.");
  return { value: null, status: "missing" };
}

export async function runKeysSteps(
  options: PromptOptions,
  state: WizardState,
  fetchImpl?: typeof fetch,
): Promise<WizardEnv> {
  const env: WizardEnv = {};
  if (options.yes) return env;

  stepHeader(1, WIZARD_STEPS, "Anthropic key");
  console.log(
    "  Written in plain text into the client configs you set up below (the client passes it to\n" +
      "  Pattern; Pattern never reads a project .env). Create one at console.anthropic.com.",
  );
  const a = await askKey("ANTHROPIC_API_KEY", "", (k) => checkAnthropicKey(k, fetchImpl), options);
  state.anthropicKey = a.status;
  if (a.value) env.ANTHROPIC_API_KEY = a.value;

  stepHeader(2, WIZARD_STEPS, "Figma token (optional)");
  const usesFigma = await confirm("  Is your design system in Figma?", options, false);
  if (usesFigma) {
    const f = await askKey(
      "FIGMA_ACCESS_TOKEN",
      "  Figma > Settings > Security > Personal access tokens, scope file_content:read.",
      (k) => checkFigmaToken(k, fetchImpl),
      options,
    );
    state.figmaToken = f.status;
    if (f.value) env.FIGMA_ACCESS_TOKEN = f.value;
  } else {
    console.log("  Skipped.");
  }
  return env;
}

const COMMON_COMPONENT_DIRS = [
  "src/components/ui",
  "components/ui",
  "src/components",
  "components",
  "app/components",
  "packages/ui/src",
  "packages/ui",
];

export function guessComponentsDir(root: string): string | null {
  for (const d of COMMON_COMPONENT_DIRS) {
    try {
      if (statSync(join(root, d)).isDirectory()) return d;
    } catch {
      // not there
    }
  }
  return null;
}

// Paths the registrar accepts are relative to the project root and inside it.
function toRootRelative(root: string, input: string): { rel: string } | { error: string } {
  const abs = isAbsolute(input) ? input : resolve(root, input);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return { error: `${input} is outside the project (${root}); Pattern only reads inside it.` };
  if (!existsSync(abs)) return { error: `${input} does not exist.` };
  return { rel: rel || "." };
}

async function registerWithReplacePrompt(
  deps: WizardDeps,
  req: RegisterRequest,
  options: PromptOptions,
): Promise<RegisterResult | null> {
  try {
    return await deps.register(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/replace: true/.test(message)) {
      console.log(`  A different design system is already registered for "${deps.projectId}".`);
      const ok = await confirm("  Replace it with this one? (the old one is overwritten)", options, false);
      if (!ok) return null;
      return deps.register({ ...req, replace: true });
    }
    console.log(`  Registration failed: ${message}`);
    return null;
  }
}

export async function runDesignSystemStep(
  root: string,
  deps: WizardDeps,
  env: WizardEnv,
  state: WizardState,
  options: PromptOptions,
): Promise<void> {
  stepHeader(4, WIZARD_STEPS, "Your design system");
  if (options.yes) {
    console.log("  Skipped in --yes mode (it needs your input). Run `npx pattern-mcp init` again to register one.");
    return;
  }
  console.log(
    "  Pattern judges every request against ONE design system: yours. It never falls back to\n" +
      "  outside libraries. Where does yours live?\n" +
      "    1. A Figma file\n" +
      "    2. A components folder in this repo\n" +
      "    3. A manifest (JSON list or Storybook index)\n" +
      "    4. Skip for now",
  );
  const guess = guessComponentsDir(root);
  const choice = (await askLine(`  Choose 1-4 [${guess ? "2" : "4"}]: `)).trim() || (guess ? "2" : "4");

  let req: RegisterRequest | null = null;
  if (choice === "1") {
    const token = env.FIGMA_ACCESS_TOKEN ?? process.env.FIGMA_ACCESS_TOKEN;
    if (!token) {
      console.log("  Registering a Figma file needs a Figma token (step 2). Re-run init and add one, or choose a folder.");
      return;
    }
    const link = (await askLine("  Paste the Figma file link (or its file key): ")).trim();
    const fileKey = parseFigmaFileKey(link);
    if (!fileKey) {
      console.log("  That does not look like a Figma file link. Skipping; you can paste it to your agent later.");
      return;
    }
    req = { kind: "figma", fileKey, token };
  } else if (choice === "2" || choice === "3") {
    const kind = choice === "2" ? "directory" : "manifest";
    const def = kind === "directory" ? (guess ?? ".") : "";
    const raw = def ? await promptText(`  Path to the ${kind === "directory" ? "components folder" : "manifest file"}`, def, options) : (await askLine("  Path to the manifest file: ")).trim();
    if (!raw) {
      console.log("  Skipped.");
      return;
    }
    const rel = toRootRelative(root, raw);
    if ("error" in rel) {
      console.log(`  ${rel.error} Skipping.`);
      return;
    }
    const next: RegisterRequest = { kind, path: rel.rel };
    req = next;
    const key = env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
    if (kind === "directory" && key && process.env.PATTERN_NO_SUMMARIES !== "1") {
      console.log(
        "  Pattern can write a short summary of what each component does, which makes matching\n" +
          "  noticeably more accurate. That sends up to 8000 characters of each component file to\n" +
          "  api.anthropic.com (Claude Haiku), about 0.2 cents per file, cached so re-runs only pay for changes.",
      );
      if (next.kind === "directory" && (await confirm("  Write summaries?", options, true))) next.summarizeWithKey = key;
    }
  } else {
    console.log("  Skipped. Until one is registered, recommend_component returns an error saying so.");
    return;
  }
  if (!req) return;

  console.log(choice === "1" ? "  Fetching the file from Figma (large files take a minute)..." : "  Reading your components...");
  const result = await registerWithReplacePrompt(deps, req, options);
  if (!result) {
    console.log("  Nothing registered. Your agent can register one later; the tool explains what it needs.");
    return;
  }
  state.designSystem = { source: result.source, candidateCount: result.candidateCount };
  console.log(`  Registered ${result.candidateCount} component${result.candidateCount === 1 ? "" : "s"} from ${result.source} for project "${deps.projectId}".`);
  if (result.summaries) {
    console.log(`  Wrote ${result.summaries.generated} summar${result.summaries.generated === 1 ? "y" : "ies"} (about $${result.summaries.costUsd.toFixed(3)}).`);
    state.summaries = result.summaries.generated;
  }
  if (result.summaryError) {
    console.log(`  Summaries failed (${result.summaryError}). The registration is saved and works without them; ask your agent to re-register to retry.`);
  }
  if (result.candidateCount === 0) {
    console.log("  Zero components were found, so every request will come back as \"build new\". Check the path or page names.");
  }
}

export function wizardSummary(state: WizardState, projectId: string): string {
  const mark = (ok: boolean) => (ok ? "[x]" : "[ ]");
  const keyLine = state.anthropicKey === "valid" ? "Anthropic key checked" : state.anthropicKey === "unverified" ? "Anthropic key saved (not confirmed)" : state.anthropicKey === "invalid" ? "Anthropic key saved but looks wrong" : "Anthropic key not set";
  const lines = [
    "\nSetup summary",
    `  ${mark(state.anthropicKey === "valid" || state.anthropicKey === "unverified")} ${keyLine}`,
    `  ${mark(state.clientConnected)} Client connected`,
    `  ${mark(state.skill === "installed" || state.skill === "updated" || state.skill === "current")} Agent skill installed`,
    `  ${mark(state.designSystem !== null)} Design system registered${state.designSystem ? ` (${state.designSystem.candidateCount} components${state.summaries ? `, ${state.summaries} summarised` : ""}, project "${projectId}")` : ""}`,
    `  ${mark(state.gate === "set up")} Enforcement ${state.gate === "set up" ? "on" : "off (optional)"}`,
  ];
  const todo: string[] = [];
  if (state.anthropicKey === "missing" || state.anthropicKey === "invalid") todo.push("Add ANTHROPIC_API_KEY to the Pattern server's env block in your client config.");
  if (!state.clientConnected) todo.push("Connect a client: see the README's \"Connect Pattern to your MCP client\".");
  if (!state.designSystem) todo.push("Register a design system: paste a Figma link to your agent, or point it at your components folder.");
  todo.push("Restart your client so it loads Pattern.");
  lines.push("\nStill to do:", ...todo.map((t) => `  - ${t}`));
  if (state.clientConnected && state.designSystem) {
    lines.push(
      "\nTry it: after the restart, ask your agent for a screen, for example \"build a settings page\".",
      "It should call extract_requirements, then recommend_component, and tell you to reuse a component or",
      "build specific missing pieces. Check your setup any time with: npx -p pattern-mcp pattern doctor",
    );
  } else {
    lines.push("\nCheck your setup any time with: npx -p pattern-mcp pattern doctor");
  }
  return lines.join("\n");
}
