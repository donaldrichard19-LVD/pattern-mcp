import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.ts";
import { NotFoundError, Service, ValidationError } from "./service.ts";
import { ingestSource } from "./extract.ts";
import { parseUpload } from "./parse.ts";
import { seedDemo } from "./seed.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "public");
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

export function createApp(svc: Service) {
  const ownerToken = () => process.env.WM_OWNER_TOKEN;
  const apiToken = () => process.env.WM_API_TOKEN;
  const bearer = (req: IncomingMessage) => /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
  const isOwner = (req: IncomingMessage) => !ownerToken() || bearer(req) === ownerToken();
  const canRead = (req: IncomingMessage) => !apiToken() || [apiToken(), ownerToken()].includes(bearer(req));

  const send = (res: ServerResponse, code: number, body: unknown, type = "application/json") => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage): Promise<any> => new Promise((ok, fail) => {
    const chunks: Buffer[] = []; let n = 0;
    req.on("data", (c) => { n += c.length; if (n > 30e6) { fail(new ValidationError("body too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { fail(new ValidationError("body must be JSON")); } });
    req.on("error", fail);
  });

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://x"), path = url.pathname, method = req.method ?? "GET";
      const actor = String(req.headers["x-actor"] ?? "owner");
      const m = (re: RegExp) => re.exec(path);
      const needOwner = () => { if (!isOwner(req)) throw Object.assign(new Error("owner token required"), { code: 403 }); };

      // Static UI
      if (method === "GET" && !path.startsWith("/models") && !path.startsWith("/nodes") && !path.startsWith("/sources") && !path.startsWith("/proposals") && path !== "/demo") {
        const rel = path === "/" ? "index.html" : normalize(path).replace(/^(\.\.[/\\])+/, "").replace(/^\/+/, "");
        try { return send(res, 200, await readFile(join(PUBLIC, rel)), MIME[extname(rel)] ?? "application/octet-stream"); }
        catch { return send(res, 404, { error: "not found" }); }
      }
      if (!canRead(req)) return send(res, 401, { error: "api token required" });

      let r: RegExpExecArray | null;
      if (method === "GET" && path === "/models") return send(res, 200, svc.listModels());
      if (method === "POST" && path === "/models") { needOwner(); return send(res, 201, svc.createModel((await readBody(req)).name)); }
      if (method === "POST" && path === "/demo") { needOwner(); return send(res, 201, { id: await seedDemo(svc) }); }
      if ((r = m(/^\/models\/([^/]+)$/)) && method === "GET") return send(res, 200, svc.getModel(r[1], Number(url.searchParams.get("stale_days") ?? 30)));
      if ((r = m(/^\/models\/([^/]+)\/query$/)) && method === "GET") {
        const task = url.searchParams.get("task");
        if (!task) throw new ValidationError("task query parameter is required");
        return send(res, 200, svc.query(r[1], task));
      }
      if ((r = m(/^\/models\/([^/]+)\/export$/)) && method === "GET") {
        const fmt = url.searchParams.get("format") === "json" ? "json" : "md";
        const out = svc.exportModel(r[1], fmt);
        return fmt === "json" ? send(res, 200, out) : send(res, 200, out as string, "text/markdown; charset=utf-8");
      }
      if ((r = m(/^\/models\/([^/]+)\/health$/)) && method === "GET") return send(res, 200, svc.health(r[1], Number(url.searchParams.get("stale_days") ?? 30)));
      if ((r = m(/^\/models\/([^/]+)\/changelog$/)) && method === "GET") return send(res, 200, svc.changelog(r[1]));
      if ((r = m(/^\/models\/([^/]+)\/sources$/))) {
        if (method === "GET") return send(res, 200, svc.listSources(r[1]));
        if (method === "POST") {
          needOwner();
          const b = await readBody(req);
          let parsed;
          if (b.content_base64) parsed = await parseUpload(b.filename ?? "upload.txt", Buffer.from(b.content_base64, "base64"), b);
          else parsed = { text: String(b.text ?? ""), type: b.type || "note", label: b.label ?? "" } as any;
          const src = svc.addSource(r[1], { type: b.type || parsed.type, label: b.label ?? parsed.label, filename: b.filename ?? "", text: parsed.text, source_date: b.source_date ?? parsed.source_date });
          const result = b.ingest === false ? null : await ingestSource(svc, src.id);
          return send(res, 201, { source: { ...src, text: undefined }, ingestion: result });
        }
      }
      if ((r = m(/^\/sources\/([^/]+)$/)) && method === "GET") return send(res, 200, svc.getSource(r[1]));
      if ((r = m(/^\/sources\/([^/]+)\/ingest$/)) && method === "POST") { needOwner(); return send(res, 200, await ingestSource(svc, r[1])); }
      if ((r = m(/^\/models\/([^/]+)\/proposals$/))) {
        if (method === "GET") return send(res, 200, svc.listProposals(r[1], url.searchParams.get("status") ?? undefined));
        if (method === "POST") {
          const b = await readBody(req);
          return send(res, 201, svc.createProposal(r[1], { actor: b.actor ?? actor, actor_type: b.actor_type ?? "agent", change_type: b.change_type, payload: b.payload, rationale: b.rationale, source_ref: b.source_ref }));
        }
      }
      if (path === "/proposals/approve" && method === "POST") { needOwner(); const b = await readBody(req); return send(res, 200, svc.approve(b.ids ?? [], actor, b.edits ?? {}, b.note ?? "")); }
      if (path === "/proposals/reject" && method === "POST") { needOwner(); const b = await readBody(req); svc.reject(b.ids ?? [], actor, b.note ?? ""); return send(res, 200, { ok: true }); }
      if ((r = m(/^\/nodes\/([^/]+)$/)) && method === "GET") return send(res, 200, svc.getNode(r[1]));
      if ((r = m(/^\/nodes\/([^/]+)\/trace$/)) && method === "GET") return send(res, 200, svc.trace(r[1]));
      if ((r = m(/^\/nodes\/([^/]+)\/resolve-flag$/)) && method === "POST") { needOwner(); return send(res, 200, svc.resolveFlag(r[1], (await readBody(req)).flag, actor)); }
      return send(res, 404, { error: "not found" });
    } catch (e: any) {
      const code = e.code === 403 ? 403 : e instanceof ValidationError ? 400 : e instanceof NotFoundError ? 404 : 500;
      if (code === 500) console.error(e);
      send(res, code, { error: e.message });
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const svc = new Service(openDb());
  const port = Number(process.env.PORT ?? 3737), host = process.env.WM_HOST ?? "127.0.0.1";
  createServer(createApp(svc)).listen(port, host, () => {
    console.log(`World model running at http://${host}:${port}`);
    if (!process.env.WM_OWNER_TOKEN) console.log("  (no WM_OWNER_TOKEN set: anyone who can reach this port can approve changes; it only listens on localhost by default)");
  });
}
