#!/usr/bin/env node
/**
 * Bundles the four published bin entry points into self-contained files, run
 * after `tsc` by `npm run build`.
 *
 * Why: with ~98 runtime packages, a first `npx pattern-mcp` spends tens of
 * seconds downloading before a single line of Pattern runs, which is longer
 * than some MCP clients wait for a spawned server to answer `initialize`.
 * Inlining the dependencies leaves the published package with no runtime
 * dependencies, so a cold `npx` fetches one small tarball.
 *
 * Only the bin entries are overwritten; `tsc`'s per-module output stays in
 * dist/ because the verify-*.mjs scripts import those modules directly. The
 * bundles are written to the same paths, so the files the code locates
 * relative to itself (../package.json, ../SKILL.md, ../templates,
 * ./check-gate.js) still resolve.
 */

import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entries = ["index", "cli", "check-gate", "check-gate-hook"];

await build({
  entryPoints: entries.map((name) => join(root, "src", `${name}.ts`)),
  outdir: join(root, "dist"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  // check-gate.ts loads ./index.js with a dynamic import, and only for a file
  // that is actually gated. Left to esbuild that import is inlined, which
  // makes check-gate (run by a hook on every edit) carry a second copy of the
  // whole server. Keeping it external loads the sibling dist/index.js bundle
  // at runtime instead, exactly as the unbundled build did.
  external: ["./index.js"],
  // Some bundled dependencies are CommonJS and call require() on node
  // builtins; ESM output has no require, so provide one.
  banner: {
    js: 'import { createRequire as __patternCreateRequire } from "node:module"; const require = __patternCreateRequire(import.meta.url);',
  },
  logLevel: "info",
});
