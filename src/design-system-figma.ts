// Figma as a design-system source for register_design_system.
//
// Input is the JSON a Figma file exposes at GET /v1/files/:key -- either saved
// to disk (`figma_json_path`, fully local) or fetched with the user's own
// token (`figma_file_key` + FIGMA_ACCESS_TOKEN). One candidate is produced per
// COMPONENT_SET (Figma's "component with variants") and per standalone
// COMPONENT; the variant COMPONENTs inside a set are part of that one
// candidate, and INSTANCEs (copies of components) are never candidates.
//
// STATUS: built to Figma's documented file schema, tested on fixtures modelled
// on it (scripts/verify-design-system-figma.mjs), and run on two real files: a
// community chart template (frames mode; scripts/figma-frames-eval.mjs) and the
// 135 MB shadcn/ui design system (components mode; scripts/figma-components-eval.mjs).
// Both are one-file samples with Claude-authored labels.

export interface FigmaCandidateInfo {
  node_id: string;
  page: string | null;
  section: string | null;
  /** VARIANT property name -> its options, e.g. { State: ["Default", "Hover"] } */
  variants: Record<string, string[]>;
  /** Non-variant property names (BOOLEAN / TEXT / INSTANCE_SWAP), e.g. "Show icon". */
  properties: string[];
  /** "frame" for frames mode candidates (a design, not a defined component); absent = component. */
  kind?: "frame";
  /** Frames mode: distinct meaningful layer names inside the design (default names like "Rectangle 4" dropped). */
  layers?: string[];
  /** Frames mode: distinct text contents inside the design (labels, headings, sample data). */
  texts?: string[];
  /** Rendered size in Figma px (from absoluteBoundingBox); lets the caption step pick a render scale. */
  size?: { w: number; h: number };
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
  absoluteBoundingBox?: { width?: number; height?: number };
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
const sizeOf = (n: FigmaNode): { w: number; h: number } | undefined => {
  const b = n.absoluteBoundingBox;
  return b && typeof b.width === "number" && typeof b.height === "number" ? { w: Math.round(b.width), h: Math.round(b.height) } : undefined;
};
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

export interface FigmaParseOptions {
  /** "components" (default): defined COMPONENT / COMPONENT_SET nodes. "frames": named designs on pages. */
  mode?: "components" | "frames";
  /** Only these pages (matched case-insensitively by substring). Default: every page. Both modes. */
  pages?: string[];
  /** Skip pages whose name contains any of these (case-insensitive), e.g. ["Icons"]. Both modes. */
  excludePages?: string[];
}

function pageAllowed(pageName: string | null | undefined, include: string[] | undefined, exclude: string[] | undefined): boolean {
  const n = (pageName ?? "").toLowerCase();
  if (include && include.length > 0 && !include.some((w) => n.includes(w.toLowerCase()))) return false;
  if (exclude && exclude.some((w) => w.trim() && n.includes(w.toLowerCase()))) return false;
  return true;
}

export function parseFigmaFile(
  raw: unknown,
  sourceLabel: string,
  options: FigmaParseOptions = {}
): { candidates: FigmaCandidate[]; stats: FigmaParseStats } {
  const file = raw as FigmaFile;
  if (!file || typeof file !== "object" || !file.document || !Array.isArray(file.document.children)) {
    throw new Error(
      `"${sourceLabel}" doesn't look like a Figma file response (expected a top-level "document" with "children" pages). ` +
        `Save the JSON from GET https://api.figma.com/v1/files/<file_key> and pass that.`
    );
  }

  const stats: FigmaParseStats = { pages: 0, component_sets: 0, standalone_components: 0, skipped_private: 0 };
  if (options.mode === "frames") return { candidates: parseFigmaFrames(file, options.pages, options.excludePages), stats };
  const candidates: FigmaCandidate[] = [];
  type Frame = { node: FigmaNode; page: string | null; section: string | null };
  const stack: Frame[] = [];
  for (const page of [...file.document.children].reverse()) {
    if (page.type === "CANVAS" && !pageAllowed(page.name, options.pages, options.excludePages)) continue;
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
        figma: { node_id: id, page, section, variants, properties, size: sizeOf(node) },
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
  // Frames-mode content (what is drawn inside the design). PATTERN_JEV_FIGMA_TEXT=0
  // leaves it out, for A/B testing.
  const includeContent = process.env.PATTERN_JEV_FIGMA_TEXT !== "0";
  const parts = [
    ...(where ? [`located: ${where}`] : []),
    ...(includeVariants && variants ? [`variants: ${variants}`] : []),
    ...(includeVariants && f.properties.length > 0 ? [`toggles/slots: ${f.properties.join(", ")}`] : []),
    ...(includeContent && f.layers && f.layers.length > 0 ? [`layers: ${f.layers.join(", ")}`] : []),
    ...(includeContent && f.texts && f.texts.length > 0 ? [`text: ${f.texts.join(" | ")}`] : []),
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

// ---------------------------------------------------------------------------
// Frames mode
//
// Many real Figma files -- community templates especially -- never use Figma
// components: the reusable designs are plain frames/groups (the BRIX chart file
// this was built against has 4 components, all style-guide helpers, and 30+
// charts as ungrouped layers named "Chart 1".."Chart 13"). Frames mode treats
// each named design as a candidate and builds its evidence from what is inside:
// layer names and text. Heuristics, deliberately simple:
//   - a top-level frame/group with >= 3 substantial container children is a
//     "sheet" (Bar Charts > Chart 1..13): each child is a candidate, the
//     sheet's name becomes its `section`;
//   - otherwise a substantial top-level frame/group is itself a candidate;
//   - "substantial" = at least FRAMES_MIN_DESCENDANTS nodes, which drops
//     headings and labels;
//   - instances are never descended into.
// ---------------------------------------------------------------------------

const FRAMES_MIN_DESCENDANTS = 5;
const FRAMES_SHEET_MIN_CHILDREN = 3;
const FRAMES_MAX_CANDIDATES = 500;
const FRAMES_MAX_LAYERS = 25;
const FRAMES_MAX_TEXTS = 25;
const FRAMES_TEXT_CAP = 40;
const CONTAINER_TYPES = new Set(["FRAME", "GROUP", "SECTION", "COMPONENT", "COMPONENT_SET"]);
const DEFAULT_LAYER_NAME = /^(rectangle|ellipse|vector|line|frame|group|union|subtract|intersect|exclude|polygon|star|image|text|boolean|mask|arrow|slice|layer|shape|container)( ?\d+)?$/i;

interface FramesNode extends FigmaNode {
  characters?: string;
}

function descendantCount(node: FramesNode): number {
  let n = 0;
  const stack: FramesNode[] = [...(node.children ?? [])];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    n++;
    if (cur.type !== "INSTANCE") for (const c of cur.children ?? []) stack.push(c);
  }
  return n;
}

function collectFrameEvidence(node: FramesNode): { layers: string[]; texts: string[] } {
  const layers = new Set<string>();
  const texts = new Set<string>();
  const stack: FramesNode[] = [...(node.children ?? [])].reverse();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const name = (cur.name ?? "").trim();
    if (cur.type === "TEXT") {
      const t = (cur.characters ?? "").replace(/\s+/g, " ").trim();
      if (t) texts.add(t.slice(0, FRAMES_TEXT_CAP));
    } else if (name && !DEFAULT_LAYER_NAME.test(name)) {
      layers.add(name);
    }
    if (cur.type !== "INSTANCE") for (const c of [...(cur.children ?? [])].reverse()) stack.push(c);
  }
  return { layers: [...layers].slice(0, FRAMES_MAX_LAYERS), texts: [...texts].slice(0, FRAMES_MAX_TEXTS) };
}

function parseFigmaFrames(file: FigmaFile, pageFilter: string[] | undefined, excludeFilter: string[] | undefined): FigmaCandidate[] {
  const out: FigmaCandidate[] = [];
  const pages = (file.document?.children ?? []).filter((p) => p.type === "CANVAS");
  const push = (node: FramesNode, page: string | null, section: string | null) => {
    if (out.length >= FRAMES_MAX_CANDIDATES) return;
    const name = (node.name ?? "").trim();
    if (!name) return;
    const { layers, texts } = collectFrameEvidence(node);
    out.push({
      name: section ? `${section} > ${name}` : name,
      props: [],
      description: null,
      usage_example: null,
      file_path: null,
      figma: { node_id: node.id ?? `frame:${section ?? ""}:${name}`, page, section, variants: {}, properties: [], kind: "frame", layers, texts, size: sizeOf(node) },
    });
  };
  for (const page of pages) {
    const pageName = page.name ?? null;
    if (!pageAllowed(pageName, pageFilter, excludeFilter)) continue;
    for (const top of page.children ?? []) {
      if (!CONTAINER_TYPES.has(top.type ?? "") || !(top.name ?? "").trim()) continue;
      const kids = (top.children ?? []).filter((c) => CONTAINER_TYPES.has(c.type ?? "") && descendantCount(c) >= FRAMES_MIN_DESCENDANTS);
      if (kids.length >= FRAMES_SHEET_MIN_CHILDREN) {
        for (const kid of kids) push(kid, pageName, (top.name ?? "").trim());
      } else if (descendantCount(top) >= FRAMES_MIN_DESCENDANTS) {
        push(top, pageName, null);
      }
    }
  }
  return out;
}
