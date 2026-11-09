import { createRequire } from "node:module";
import { ValidationError } from "./service.ts";

const require = createRequire(import.meta.url);

export interface Parsed { text: string; type: string; label: string; source_date?: string }

export function guessType(filename: string): { type: string; label: string } {
  const f = filename.toLowerCase();
  if (/granola/.test(f)) return { type: "research_input", label: "Granola" };
  if (/zoom/.test(f)) return { type: "research_input", label: "Zoom AI" };
  if (/slack/.test(f) || f.endsWith(".json")) return { type: "slack", label: "Slack export" };
  if (/prd/.test(f)) return { type: "prd", label: "PRD" };
  if (/brief/.test(f)) return { type: "brief", label: "Product brief" };
  if (/research|interview|survey/.test(f)) return { type: "research", label: "User research" };
  return { type: "note", label: "" };
}

/** Flatten a Slack export (array of messages, or {messages:[...]}) to one line per message so spans are quotable. */
export function slackToText(raw: string): { text: string; latest?: string } {
  let data: any;
  try { data = JSON.parse(raw); } catch { throw new ValidationError("Slack export is not valid JSON"); }
  const msgs: any[] = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : [];
  if (!msgs.length) throw new ValidationError("Slack export contains no messages");
  let latest = 0;
  const lines = msgs.filter((m) => typeof m?.text === "string" && m.text.trim()).map((m) => {
    const ts = Number(m.ts) * 1000;
    if (ts > latest) latest = ts;
    const when = Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 16).replace("T", " ") : "unknown time";
    return `[${when}] ${m.user_name ?? m.user ?? "unknown"}: ${m.text.replace(/\s*\n\s*/g, " ")}`;
  });
  return { text: lines.join("\n"), latest: latest ? new Date(latest).toISOString() : undefined };
}

export async function parseUpload(filename: string, data: Buffer, override?: { type?: string; label?: string }): Promise<Parsed> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const guess = guessType(filename);
  const meta = { type: override?.type || guess.type, label: override?.label ?? guess.label };
  if (["md", "markdown", "txt", "text"].includes(ext)) return { text: data.toString("utf8"), ...meta };
  if (ext === "json") { const s = slackToText(data.toString("utf8")); return { text: s.text, source_date: s.latest, type: override?.type || "slack", label: override?.label ?? "Slack export" }; }
  if (ext === "pdf") {
    const pdf = require("pdf-parse/lib/pdf-parse.js");
    return { text: (await pdf(data)).text, ...meta };
  }
  if (ext === "docx") {
    const mammoth = require("mammoth");
    return { text: (await mammoth.extractRawText({ buffer: data })).value, ...meta };
  }
  throw new ValidationError(`Unsupported file type .${ext} (use .md, .txt, .pdf, .docx or Slack .json)`);
}
