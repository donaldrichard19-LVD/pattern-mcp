// Figma as a design-system source for register_design_system.
//
// Input is the JSON a Figma file exposes at GET /v1/files/:key -- either saved
// to disk (`figma_json_path`, fully local) or fetched with the user's own
// token (`figma_file_key` + FIGMA_ACCESS_TOKEN). One candidate is produced per
// COMPONENT_SET (Figma's "component with variants") and per standalone
// COMPONENT; the variant COMPONENTs inside a set are part of that one
// candidate, and INSTANCEs (copies of components) are never candidates.
//
// STATUS: written against Figma's documented file schema and tested on
// fixtures modelled on it (scripts/verify-design-system-figma.mjs). It has NOT
// been run on a real Figma file or measured in an eval -- there was no Figma
// file or token available when it was built. In particular, whether variant
// option values help or hurt the scorer (prop names hurt on code libraries) is
// unmeasured; PATTERN_JEV_FIGMA_VARIANTS=0 exists to A/B that.

export interface FigmaCandidateInfo {
  node_id: string;
  page: string | null;
  section: string | null;
  /** VARIANT property name -> its options, e.g. { State: ["Default", "Hover"] } */
  variants: Record<string, string[]>;
  /** Non-variant property names (BOOLEAN / TEXT / INSTANCE_SWAP), e.g. "Show icon". */
  properties: string[];
}

export interface FigmaCandidate {
  name: string;
  props: string[];
  description: string | null;
  usage_example: string | null;
  file_path: string | null;
  figma: FigmaCandidateInfo;
}

export interface FigmaParseStats {
  pages: number;
  component_sets: number;
  standalone_components: number;
  skipped_private: number;
}

interface FigmaNode {
  id?: string;
  name?: string;
  type?: string;
  description?: string;
  children?: FigmaNode[];
  componentPropertyDefinitions?: Record<string, { type?: string; variantOptions?: string[] }>;
}

interface FigmaFile {
  document?: FigmaNode;
  components?: Record<string, { description?: string }>;
  componentSets?: Record<string, { description?: string }>;
}

const DESCRIPTION_CAP = 500;
// Figma's own convention: components named with a leading "." or "_" are
// private/hidden and are not published to a team library.
const isPrivateName = (name: string) => /^[._]/.test(name);
const cleanPropertyName = (name: string) => name.replace(/#\d+:\d+$/, "").trim();
const clean = (text: string | undefined): string | null => {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, DESCRIPTION_CAP) : null;
};

/** "Size=Small, State=Hover" -> { Size: "Small", State: "Hover" } (variant COMPONENT naming). */
function parseVariantName(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of name.split(",")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

export function parseFigmaFile(raw: unknown, sourceLabel: string): { candidates: FigmaCandidate[]; stats: FigmaParseStats } {
  const file = raw as FigmaFile;
  if (!file || typeof file !== "object" || !file.document || !Array.isArray(file.document.children)) {
    throw new Error(
      `"${sourceLabel}" doesn't look like a Figma file response (expected a top-level "document" with "children" pages). ` +
        `Save the JSON from GET https://api.figma.com/v1/files/<file_key> and pass that.`
    );
  }

  const stats: FigmaParseStats = { pages: 0, component_sets: 0, standalone_components: 0, skipped_private: 0 };
  const candidates: FigmaCandidate[] = [];
  type Frame = { node: FigmaNode; page: string | null; section: string | null };
  const stack: Frame[] = [];
  for (const page of [...file.document.children].reverse()) {
    if (page.type === "CANVAS") stats.pages++;
    stack.push({ node: page, page: page.type === "CANVAS" ? (page.name ?? null) : null, section: null });
  }

  while (stack.length > 0) {
    const { node, page, section } = stack.pop()!;
    const type = node.type;
    const name = (node.name ?? "").trim();

    if (type === "COMPONENT_SET" || type === "COMPONENT") {
      if (!name || isPrivateName(name)) {
        stats.skipped_private++;
        continue;
      }
      const id = node.id ?? `${type}:${name}`;
      const variants: Record<string, string[]> = {};
      const properties: string[] = [];
      for (const [rawKey, def] of Object.entries(node.componentPropertyDefinitions ?? {})) {
        const key = cleanPropertyName(rawKey);
        if (def.type === "VARIANT") variants[key] = [...(def.variantOptions ?? [])];
        else properties.push(key);
      }
      if (type === "COMPONENT_SET" && Object.keys(variants).length === 0) {
        // No property definitions in the payload: recover variants from child names.
        const seen = new Map<string, Set<string>>();
        for (const child of node.children ?? []) {
          if (child.type !== "COMPONENT") continue;
          for (const [k, v] of Object.entries(parseVariantName(child.name ?? ""))) {
            (seen.get(k) ?? seen.set(k, new Set()).get(k)!).add(v);
          }
        }
        for (const [k, vs] of seen) variants[k] = [...vs];
      }
      const meta = type === "COMPONENT_SET" ? file.componentSets?.[id] : file.components?.[id];
      candidates.push({
        name,
        props: [...Object.keys(variants), ...properties],
        description: clean(meta?.description ?? node.description),
        usage_example: null,
        file_path: null,
        figma: { node_id: id, page, section, variants, properties },
      });
      if (type === "COMPONENT_SET") stats.component_sets++;
      else stats.standalone_components++;
      continue; // never descend: a set's children are its variants
    }

    if (type === "INSTANCE") continue; // a copy of a component, not a definition

    const nextSection = (type === "FRAME" || type === "SECTION") && name ? name : section;
    for (const child of [...(node.children ?? [])].reverse()) stack.push({ node: child, page, section: nextSection });
  }

  return { candidates, stats };
}

/** One-line human/model-readable description of a Figma candidate's structure. */
export function describeFigma(c: { figma?: FigmaCandidateInfo }, includeVariants = true): string | null {
  const f = c.figma;
  if (!f) return null;
  const where = [f.page, f.section].filter(Boolean).join(" > ");
  const variants = Object.entries(f.variants)
    .map(([k, vs]) => `${k}: ${vs.join(" | ")}`)
    .join("; ");
  const parts = [
    ...(where ? [`located: ${where}`] : []),
    ...(includeVariants && variants ? [`variants: ${variants}`] : []),
    ...(includeVariants && f.properties.length > 0 ? [`toggles/slots: ${f.properties.join(", ")}`] : []),
  ];
  return parts.length > 0 ? parts.join("; ") : null;
}

/** BYO-token fetch of a Figma file. The token comes from the environment only, never a tool argument. */
export async function fetchFigmaFile(fileKey: string, token: string): Promise<unknown> {
  const base = process.env.FIGMA_API_URL ?? "https://api.figma.com";
  let res: Response;
  try {
    res = await fetch(`${base}/v1/files/${encodeURIComponent(fileKey)}`, {
      headers: { "X-Figma-Token": token },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new Error(`Could not reach the Figma API: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status === 403) throw new Error("Figma refused the request (403): check that FIGMA_ACCESS_TOKEN is valid and can read this file.");
  if (res.status === 404) throw new Error(`Figma file "${fileKey}" was not found (404): check the file key.`);
  if (!res.ok) throw new Error(`Figma API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
