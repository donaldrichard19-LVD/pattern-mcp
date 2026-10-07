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
  // Layout / content fields used only by extractFigmaEvidence.
  layoutMode?: string;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  cornerRadius?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  characters?: string;
  componentId?: string;
}

interface FigmaFile {
  document?: FigmaNode;
  components?: Record<string, { description?: string; name?: string; componentSetId?: string }>;
  componentSets?: Record<string, { description?: string; name?: string }>;
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

/** One node of a candidate's stored structure tree (trimmed; no fills/effects). */
export interface FigmaEvidenceNode {
  name: string;
  type: string;
  size?: { w: number; h: number };
  /** TEXT nodes: the literal characters (capped). */
  text?: string;
  /** INSTANCE nodes: the name of the main component this is a copy of. */
  instance_of?: string;
  children?: FigmaEvidenceNode[];
}

/**
 * Raw design facts for one component, kept locally so a scorer or caller can
 * look at what Figma actually says (size, auto-layout, padding, gap, radius,
 * nested instances, text) instead of a one-line summary.
 */
export interface FigmaEvidence {
  node_id: string;
  name: string;
  /** The node the facts below were read from: the first variant of a set, or the component itself. */
  source_node: string;
  size?: { w: number; h: number };
  layout?: {
    direction?: "horizontal" | "vertical";
    gap?: number;
    padding?: { top: number; right: number; bottom: number; left: number };
    radius?: number;
    main_align?: string;
    cross_align?: string;
  };
  /** Distinct main-component names used inside (e.g. Button, Icon) -- the dependency list. */
  instances: string[];
  /** Distinct text contents inside, in document order. */
  texts: string[];
  tree: FigmaEvidenceNode;
  truncated: boolean;
}

const EVIDENCE_MAX_DEPTH = 5;
const EVIDENCE_MAX_NODES = 80;
const EVIDENCE_TEXT_CAP = 120;

/** Read the layout facts and structure tree for a COMPONENT / COMPONENT_SET node. */
export function extractFigmaEvidence(
  node: FigmaNode,
  id: string,
  // Resolves an INSTANCE's componentId to the name a designer would use: the
  // parent set's name ("Button"), not the variant's ("Variant=Outline, Size=lg").
  componentName: (componentId: string) => string | undefined
): FigmaEvidence {
  // A set's variants are its COMPONENT children; describe the first (the
  // default in Figma's ordering). A standalone component is its own source.
  const source = node.type === "COMPONENT_SET" ? (node.children ?? []).find((c) => c.type === "COMPONENT") ?? node : node;
  const instances = new Set<string>();
  const texts: string[] = [];
  let count = 0;
  let truncated = false;

  const walk = (n: FigmaNode, depth: number): FigmaEvidenceNode | undefined => {
    if (count >= EVIDENCE_MAX_NODES) {
      truncated = true;
      return undefined;
    }
    count++;
    const out: FigmaEvidenceNode = { name: (n.name ?? "").trim(), type: n.type ?? "UNKNOWN" };
    const size = sizeOf(n);
    if (size) out.size = size;
    if (n.type === "TEXT" && typeof n.characters === "string") {
      const t = n.characters.replace(/\s+/g, " ").trim().slice(0, EVIDENCE_TEXT_CAP);
      if (t) {
        out.text = t;
        if (!texts.includes(t)) texts.push(t);
      }
    }
    if (n.type === "INSTANCE") {
      const mainName = n.componentId ? componentName(n.componentId) : undefined;
      if (mainName) {
        out.instance_of = mainName;
        instances.add(mainName);
      }
    }
    if (n.children && n.children.length > 0) {
      if (depth >= EVIDENCE_MAX_DEPTH) truncated = true;
      else {
        const kids: FigmaEvidenceNode[] = [];
        for (const c of n.children) {
          const k = walk(c, depth + 1);
          if (k) kids.push(k);
        }
        if (kids.length > 0) out.children = kids;
      }
    }
    return out;
  };

  const tree = walk(source, 0) ?? { name: (source.name ?? "").trim(), type: source.type ?? "UNKNOWN" };
  const layout: NonNullable<FigmaEvidence["layout"]> = {};
  if (source.layoutMode === "HORIZONTAL") layout.direction = "horizontal";
  else if (source.layoutMode === "VERTICAL") layout.direction = "vertical";
  if (typeof source.itemSpacing === "number") layout.gap = source.itemSpacing;
  if ([source.paddingTop, source.paddingRight, source.paddingBottom, source.paddingLeft].some((v) => typeof v === "number")) {
    layout.padding = {
      top: source.paddingTop ?? 0,
      right: source.paddingRight ?? 0,
      bottom: source.paddingBottom ?? 0,
      left: source.paddingLeft ?? 0,
    };
  }
  if (typeof source.cornerRadius === "number") layout.radius = source.cornerRadius;
  if (source.primaryAxisAlignItems) layout.main_align = source.primaryAxisAlignItems;
  if (source.counterAxisAlignItems) layout.cross_align = source.counterAxisAlignItems;

  return {
    node_id: id,
    name: (node.name ?? "").trim(),
    source_node: source.id ?? id,
    size: sizeOf(source),
    ...(Object.keys(layout).length > 0 ? { layout } : {}),
    instances: [...instances],
    texts,
    tree,
    truncated,
  };
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
): { candidates: FigmaCandidate[]; stats: FigmaParseStats; evidence: Record<string, FigmaEvidence> } {
  const file = raw as FigmaFile;
  // A failed download saved as "the file" is the most common way to land here:
  // Figma's error body is {"status": 403, "err": "Invalid token"}. Say so,
  // instead of the generic "doesn't look like a Figma file" below.
  const apiError = raw as { status?: unknown; err?: unknown } | null;
  if (apiError && typeof apiError === "object" && typeof apiError.status === "number" && typeof apiError.err === "string" && !file.document) {
    throw new Error(
      `"${sourceLabel}" is a Figma API error response (status ${apiError.status}: ${apiError.err}), not a file -- the download failed. ` +
        `Fix the cause (for ${apiError.status === 403 ? "403: an invalid token or one without file_content:read access" : "this status: see Figma's message above"}) and download it again; do not paste tokens into a chat.`
    );
  }
  if (!file || typeof file !== "object" || !file.document || !Array.isArray(file.document.children)) {
    throw new Error(
      `"${sourceLabel}" doesn't look like a Figma file response (expected a top-level "document" with "children" pages). ` +
        `Save the JSON from GET https://api.figma.com/v1/files/<file_key> and pass that.`
    );
  }

  const stats: FigmaParseStats = { pages: 0, component_sets: 0, standalone_components: 0, skipped_private: 0 };
  if (options.mode === "frames") return { candidates: parseFigmaFrames(file, options.pages, options.excludePages), stats, evidence: {} };
  const candidates: FigmaCandidate[] = [];
  const evidence: Record<string, FigmaEvidence> = {};
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
      evidence[id] = extractFigmaEvidence(node, id, (cid) => {
        const comp = file.components?.[cid];
        return (comp?.componentSetId ? file.componentSets?.[comp.componentSetId]?.name : undefined) ?? comp?.name;
      });
      if (type === "COMPONENT_SET") stats.component_sets++;
      else stats.standalone_components++;
      continue; // never descend: a set's children are its variants
    }

    if (type === "INSTANCE") continue; // a copy of a component, not a definition

    const nextSection = (type === "FRAME" || type === "SECTION") && name ? name : section;
    for (const child of [...(node.children ?? [])].reverse()) stack.push({ node: child, page, section: nextSection });
  }

  return { candidates, stats, evidence };
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
  if (res.status === 403) throw new Error("Figma refused the request (403): check that FIGMA_ACCESS_TOKEN is valid (plain ASCII, starting figd_) and can read this file (file_content:read).");
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

const STOPWORDS = new Set(["the","and","for","with","that","this","from","when","shown","before","after","into","only","not","are","has","have","its","any","per","can","e.g","eg","user","users","item","items","slot","state","states","variant","variants","using","used","use"]);
const tokens = (text: string): string[] =>
  [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w)))];

/**
 * Cheap lexical ranking of Figma candidates against a need + checklist. Used
 * ONLY to choose which few candidates get their full stored evidence appended
 * to the scoring prompt; every candidate still reaches the scorer, so a weak
 * ranking costs some missed detail, never a missed match. Name hits weigh 3x.
 */
export function rankFigmaCandidates(
  candidates: { name: string; description: string | null; figma?: FigmaCandidateInfo }[],
  need: string,
  checklist: string[] | undefined,
  k: number
): number[] {
  if (k <= 0) return [];
  const q = tokens([need, ...(checklist ?? [])].join(" "));
  const scored = candidates.map((c, i) => {
    const name = new Set(tokens(c.name));
    const rest = new Set(tokens([c.description ?? "", c.figma?.page ?? "", c.figma?.section ?? "", ...(c.figma?.texts ?? [])].join(" ")));
    let score = 0;
    for (const w of q) {
      // Prefix match both ways so "dialog" finds "Dialogs" and "tab" finds "Tabs".
      if ([...name].some((n) => n === w || n.startsWith(w) || w.startsWith(n))) score += 3;
      else if ([...rest].some((n) => n === w)) score += 1;
    }
    return { i, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, k)
    .map((x) => x.i);
}

/** Compact, scorer-facing rendering of one stored evidence record (sizes, layout, dependencies, text, outline). */
export function formatFigmaEvidence(e: FigmaEvidence): string {
  const parts: string[] = [];
  if (e.size) parts.push(`size ${e.size.w}x${e.size.h}`);
  const l = e.layout;
  if (l) {
    const bits = [
      l.direction ? `${l.direction} auto-layout` : null,
      l.gap !== undefined ? `gap ${l.gap}` : null,
      l.padding ? `padding T${l.padding.top} R${l.padding.right} B${l.padding.bottom} L${l.padding.left}` : null,
      l.radius !== undefined ? `radius ${l.radius}` : null,
    ].filter(Boolean);
    if (bits.length > 0) parts.push(bits.join(", "));
  }
  if (e.instances.length > 0) parts.push(`uses components: ${e.instances.join(", ")}`);
  if (e.texts.length > 0) parts.push(`text: ${e.texts.slice(0, 8).join(" | ")}`);
  const outline = (n: FigmaEvidenceNode, depth: number): string => {
    if (depth > 2) return "";
    const label = n.instance_of ? `${n.name}<${n.instance_of}>` : n.name;
    const kids = (n.children ?? []).map((c) => outline(c, depth + 1)).filter(Boolean);
    return kids.length > 0 ? `${label}(${kids.join(", ")})` : label;
  };
  const tree = (e.tree.children ?? []).map((c) => outline(c, 1)).filter(Boolean).join(", ");
  if (tree) parts.push(`layers: ${tree.slice(0, 400)}`);
  return `FIGMA EVIDENCE (read from the first variant "${e.source_node}"): ${parts.join("; ")}`;
}
