// The ONE place the enforcement boundary's shell commands are spelled.
//
// `pattern-check-gate` and `pattern-check-gate-hook` are bin names INSIDE the
// pattern-mcp package; they are not npm packages. `npx pattern-check-gate ...`
// asks the registry for a package of that name (404, or worse, someone else's
// code), so every ad hoc invocation must name the package explicitly:
// `npx --yes -p pattern-mcp <bin>`. (`npx pattern-mcp` is fine: there the bin
// and the package share a name.) scripts/verify-npx-commands.mjs fails the
// build if a bare form reappears anywhere in the repo.

export const GATE_NPX = "npx --yes -p pattern-mcp";
export const HOOK_COMMAND = `${GATE_NPX} pattern-check-gate-hook`;
/** For docs and messages that tell a human to run init. */
export const GATE_INIT_COMMAND = "npx -p pattern-mcp pattern-check-gate init";

/**
 * True for the pre-0.19.1 form that cannot work on a machine where
 * pattern-mcp is not already installed: npx followed directly by the bin name.
 */
export function isLegacyGateInvocation(text: string): boolean {
  return /\bnpx\s+(?:(?:--yes|-y)\s+)?pattern-check-gate(?:-hook)?\b/.test(text);
}
