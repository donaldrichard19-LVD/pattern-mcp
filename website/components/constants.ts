export const REPO = "https://github.com/donaldrichard19-LVD/pattern-mcp";
export const DOCS = REPO + "/blob/main/README.md";
export const QUICKSTART = REPO + "#quickstart";

// The command people run. Interactive on purpose: it is the one that walks through the key,
// Figma token, design system and optional check. `init --yes` skips every prompt (it only
// connects the client), so it is offered separately for coding agents, never as the default.
export const INSTALL_COMMAND = "npx pattern-mcp init";
export const INSTALL_COMMAND_AGENT = "npx pattern-mcp init --yes";
// Update by hand alongside each pattern-mcp release (this directory deploys in isolation).
export const PATTERN_VERSION = "0.24.1";
