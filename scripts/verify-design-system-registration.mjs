#!/usr/bin/env node
/**
 * verify-design-system-registration.mjs
 *
 * Solo Dev design-system architecture
 * (pattern-solo-design-system-architecture.md), P1's test plan: "Test
 * against a real Storybook-exported manifest and a hand-authored fixture
 * manifest; test rejection of malformed manifests with a clear error" --
 * plus the directory-scan input mode this build added on top of the
 * doc's original two formats (see the register_design_system tool's own
 * description). Spawns the real MCP server over stdio against a temp
 * PROJECT_ROOT and a temp PATTERN_DESIGN_SYSTEMS_PATH, so every assertion
 * below is against a throwaway sandbox, never this repo or the real
 * ~/.pattern/design_systems.json. register_design_system never calls the
 * Anthropic API, so this whole script is free and deterministic to run
 * repeatedly.
 *
 * The one live check of recommend_component's own dispatch (that a
 * project_id with NO registration still takes the unaffected default
 * path) is included too, and is also free -- it's a skip-list case, which
 * short-circuits before any API call regardless of the design-system
 * branch. Full live verification of the design-system-scored scoring
 * path itself (an actual Anthropic call) is deliberately out of scope for
 * this script, same cost/effort tradeoff this project has made elsewhere
 * (see e.g. eval-search-budget-2.mjs's own "single run per case" note).
 *
 * Run: node scripts/verify-design-system-registration.mjs (after `npm run build`)
 * Exits non-zero on any failed assertion.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist/index.js");

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ok: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

async function connect(env) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "unused-not-needed-for-this-script",
      ...env,
    },
  });
  const client = new Client({ name: "verify-design-system-registration", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

function parseResult(result) {
  const text = result.content?.[0]?.text ?? "";
  try {
    return { isError: !!result.isError, body: JSON.parse(text), raw: text };
  } catch {
    return { isError: !!result.isError, body: null, raw: text };
  }
}

// ---------------------------------------------------------------------
// Sandbox: a temp PROJECT_ROOT holding every fixture this script needs --
// a hand-authored manifest, a Storybook-shaped index export, a malformed
// manifest, and a components/ directory for the directory-scan mode.
// ---------------------------------------------------------------------
const root = mkdtempSync(join(tmpdir(), "pattern-verify-design-system-"));
const designSystemsPath = join(root, ".pattern-design-systems.json");

writeFileSync(
  join(root, "hand-authored-manifest.json"),
  JSON.stringify([
    {
      name: "PricingCard",
      props: ["tier", "price", "isHighlighted", "ctaLabel"],
      description: "A single pricing tier card with an optional highlighted state.",
      usage_example: "<PricingCard tier=\"Pro\" price=\"$12/mo\" isHighlighted ctaLabel=\"Upgrade\" />",
    },
    { name: "PricingGrid", props: ["tiers"] },
  ])
);

writeFileSync(
  join(root, "manifest-wrapped.json"),
  JSON.stringify({ components: [{ name: "Alert", props: ["variant", "title"] }] })
);

writeFileSync(
  join(root, "storybook-index.json"),
  JSON.stringify({
    v: 4,
    entries: {
      "components-button--primary": { id: "components-button--primary", title: "Components/Button", name: "Primary" },
      "components-button--secondary": { id: "components-button--secondary", title: "Components/Button", name: "Secondary" },
      "components-modal--default": { id: "components-modal--default", title: "Components/Modal", name: "Default" },
    },
  })
);

writeFileSync(join(root, "malformed-manifest.json"), JSON.stringify({ some: "unrecognized shape" }));
writeFileSync(join(root, "not-json.json"), "this is not { valid json");
writeFileSync(join(root, "missing-name.json"), JSON.stringify([{ props: ["a"] }]));

// Directory-scan fixtures -- one file per parsing heuristic, plus the
// exclusion cases (lowercase export, test file, node_modules).
mkdirSync(join(root, "components", "node_modules", "some-lib"), { recursive: true });
writeFileSync(
  join(root, "components", "Button.tsx"),
  [
    "interface ButtonProps {",
    "  label: string;",
    "  onClick?: () => void;",
    "  variant?: \"primary\" | \"secondary\";",
    "}",
    "",
    "export function Button({ label, onClick, variant }: ButtonProps) {",
    "  return null;",
    "}",
  ].join("\n")
);
writeFileSync(
  join(root, "components", "Card.jsx"),
  [
    "import PropTypes from \"prop-types\";",
    "",
    "export default function Card({ title, children }) {",
    "  return null;",
    "}",
    "",
    "Card.propTypes = {",
    "  title: PropTypes.string,",
    "  children: PropTypes.node,",
    "};",
  ].join("\n")
);
writeFileSync(
  join(root, "components", "Badge.jsx"),
  ["export function Badge({ text, color }) {", "  return null;", "}"].join("\n")
);
writeFileSync(join(root, "components", "Spinner.jsx"), ["export function Spinner() {", "  return null;", "}"].join("\n"));
writeFileSync(join(root, "components", "helpers.js"), ["export function formatDate(d) {", "  return String(d);", "}"].join("\n"));
writeFileSync(join(root, "components", "Button.test.tsx"), ["export function Button() {", "  return null;", "}"].join("\n"));
writeFileSync(
  join(root, "components", "node_modules", "some-lib", "Fake.jsx"),
  ["export function Fake() {", "  return null;", "}"].join("\n")
);

const client = await connect({
  PATTERN_PROJECT_ROOT: root,
  PATTERN_DESIGN_SYSTEMS_PATH: designSystemsPath,
});

console.log("=== 1. Hand-authored manifest (top-level array) ===");
{
  const result = await client.callTool({
    name: "register_design_system",
    arguments: { project_id: "hand-authored-project", manifest_path: "hand-authored-manifest.json" },
  });
  const { isError, body } = parseResult(result);
  check("no error", !isError);
  check("status recorded", body?.status === "registered");
  check("source_kind is manifest", body?.registration?.source_kind === "manifest");
  check("candidate_count is 2", body?.registration?.candidate_count === 2);
  const pricingCard = body?.registration?.candidates?.find((c) => c.name === "PricingCard");
  check("PricingCard props parsed", JSON.stringify(pricingCard?.props) === JSON.stringify(["tier", "price", "isHighlighted", "ctaLabel"]));
  check("PricingCard description parsed", pricingCard?.description === "A single pricing tier card with an optional highlighted state.");
  const pricingGrid = body?.registration?.candidates?.find((c) => c.name === "PricingGrid");
  check("PricingGrid with no description/usage_example is null, not missing", pricingGrid?.description === null && pricingGrid?.usage_example === null);
}

console.log("\n=== 2. Hand-authored manifest wrapped in {components: [...]} ===");
{
  const result = await client.callTool({
    name: "register_design_system",
    arguments: { project_id: "wrapped-project", manifest_path: "manifest-wrapped.json" },
  });
  const { isError, body } = parseResult(result);
  check("no error", !isError);
  check("candidate_count is 1", body?.registration?.candidate_count === 1);
  check("Alert candidate parsed", body?.registration?.candidates?.[0]?.name === "Alert");
}

console.log("\n=== 3. Storybook-exported index (entries map, title-grouped) ===");
{
  const result = await client.callTool({
    name: "register_design_system",
    arguments: { project_id: "storybook-project", manifest_path: "storybook-index.json" },
  });
  const { isError, body } = parseResult(result);
  check("no error", !isError);
  check("deduped to 2 components (Button, Modal)", body?.registration?.candidate_count === 2);
  const names = (body?.registration?.candidates ?? []).map((c) => c.name).sort();
  check("names are Button and Modal", JSON.stringify(names) === JSON.stringify(["Button", "Modal"]));
  check("Storybook-sourced candidates have empty props (no docgen data in this export)", (body?.registration?.candidates ?? []).every((c) => c.props.length === 0));
}

console.log("\n=== 4. Malformed manifest: unrecognized shape ===");
{
  const result = await client.callTool({
    name: "register_design_system",
    arguments: { project_id: "malformed-project", manifest_path: "malformed-manifest.json" },
  });
  const { isError, raw } = parseResult(result);
  check("returns isError", isError === true);
  check("error message names the unrecognized-shape reason", raw.includes("doesn't match a recognized shape"));
}

console.log("\n=== 5. Malformed manifest: not valid JSON ===");
{
  const result = await client.callTool({
    name: "register_design_system",
    arguments: { project_id: "not-json-project", manifest_path: "not-json.json" },
  });
  const { isError, raw } = parseResult(result);
  check("returns isError", isError === true);
  check("error message says not valid JSON", raw.includes("is not valid JSON"));
}

console.log("\n=== 6. Malformed manifest: entry missing required name ===");
{
  const result = await client.callTool({
    name: "register_design_system",
    arguments: { project_id: "missing-name-project", manifest_path: "missing-name.json" },
  });
  const { isError, raw } = parseResult(result);
  check("returns isError", isError === true);
  check("error message names index 0", raw.includes("index 0"));
}

console.log("\n=== 7. Directory scan: parsing heuristics ===");
{
  const result = await client.callTool({
    name: "register_design_system",
    arguments: { project_id: "directory-scan-project", directory_path: "components" },
  });
  const { isError, body } = parseResult(result);
  check("no error", !isError);
  check("source_kind is directory_scan", body?.registration?.source_kind === "directory_scan");

  const byName = Object.fromEntries((body?.registration?.candidates ?? []).map((c) => [c.name, c]));
  check("Button found with TS interface props", JSON.stringify(byName.Button?.props?.sort()) === JSON.stringify(["label", "onClick", "variant"]));
  check("Card (export default) found with PropTypes props", JSON.stringify(byName.Card?.props?.sort()) === JSON.stringify(["children", "title"]));
  check("Badge found with destructured-param fallback props", JSON.stringify(byName.Badge?.props?.sort()) === JSON.stringify(["color", "text"]));
  check("Spinner found with genuinely zero props (not a scan failure)", Array.isArray(byName.Spinner?.props) && byName.Spinner.props.length === 0);
  check("lowercase-named export (formatDate) excluded", byName.formatDate === undefined);
  check("Button.test.tsx excluded by filename fragment", byName.Button?.file_path === "Button.tsx");
  check("node_modules subfolder excluded (Fake not present)", byName.Fake === undefined);
  check("exactly 4 real components found (Button, Card, Badge, Spinner)", Object.keys(byName).length === 4);
}

console.log("\n=== 8. Exactly one of manifest_path/directory_path is required ===");
{
  const both = await client.callTool({
    name: "register_design_system",
    arguments: { project_id: "both-project", manifest_path: "hand-authored-manifest.json", directory_path: "components" },
  });
  check("both provided -> isError", parseResult(both).isError === true);

  const neither = await client.callTool({
    name: "register_design_system",
    arguments: { project_id: "neither-project" },
  });
  check("neither provided -> isError", parseResult(neither).isError === true);
}

console.log("\n=== 9. Path escaping the project root is rejected ===");
{
  const absolute = await client.callTool({
    name: "register_design_system",
    arguments: { project_id: "escape-project", manifest_path: "/etc/hosts" },
  });
  const { isError, raw } = parseResult(absolute);
  check("absolute manifest_path -> isError", isError === true);
  check("error explains relative-path-within-project-root requirement", raw.includes("relative path within the project root"));

  const traversal = await client.callTool({
    name: "register_design_system",
    arguments: { project_id: "escape-project-2", directory_path: "../../etc" },
  });
  check("directory_path escaping root -> isError", parseResult(traversal).isError === true);
}

console.log("\n=== 10. Re-registering the same project_id overwrites, doesn't merge ===");
{
  await client.callTool({
    name: "register_design_system",
    arguments: { project_id: "overwrite-project", manifest_path: "hand-authored-manifest.json" },
  });
  await client.callTool({
    name: "register_design_system",
    arguments: { project_id: "overwrite-project", directory_path: "components" },
  });
  const stored = JSON.parse(readFileSync(designSystemsPath, "utf8"));
  check("stored registration reflects only the second (directory_scan) call", stored["overwrite-project"]?.source_kind === "directory_scan");
  check("stored registration has exactly one entry for this project_id (no merge/append)", stored["overwrite-project"]?.candidate_count === 4);
}

console.log("\n=== 11. No registration for a project_id -> recommend_component's default dispatch is unaffected (free, skip-list) ===");
{
  const result = await client.callTool({
    name: "recommend_component",
    arguments: {
      component_need: "button",
      domain: "test domain",
      framework: "React + Tailwind",
      project_id: "no-registration-project",
    },
  });
  const { isError, body } = parseResult(result);
  check("no error", !isError);
  check("skip-list verdict unaffected by this feature", body?.reason === "skip_list" && body?.verdict === "use_existing");
  check("zero cost (no API call reached)", body?._meta?.estimated_cost_usd === 0);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
