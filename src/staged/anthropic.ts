// Thin, shared Anthropic Messages API caller for the staged pipeline's
// four independent calls. Deliberately separate from src/index.ts's own
// fetch logic (which is tuned for the single bundled call) rather than
// reused, since each stage here has a different tool/budget shape.

import { ANTHROPIC_API_KEY, MODEL, extractJson, extractUrlsForDomain } from "../index.js";

export interface AnthropicCallOptions {
  systemPrompt: string;
  userMessage: string;
  tools?: unknown[];
  maxTokens?: number;
}

export interface AnthropicCallResult {
  content: Array<{
    type: string;
    text?: string;
    name?: string;
    input?: unknown;
    id?: string;
    tool_use_id?: string;
    content?: unknown;
  }>;
  stop_reason?: string;
}

export async function callAnthropic({ systemPrompt, userMessage, tools, maxTokens = 4096 }: AnthropicCallOptions): Promise<AnthropicCallResult> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Export it in the environment running this pipeline.");
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMessage }],
      ...(tools ? { tools } : {}),
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }
  return (await response.json()) as AnthropicCallResult;
}

export function textFromResult(data: AnthropicCallResult): string {
  return data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();
}

export function parseJsonResponse<T>(data: AnthropicCallResult): { ok: true; value: T } | { ok: false; raw: string } {
  const text = textFromResult(data);
  if (!text) return { ok: false, raw: "" };
  const extracted = extractJson(text);
  try {
    return { ok: true, value: JSON.parse(extracted) as T };
  } catch {
    return { ok: false, raw: extracted };
  }
}

export function searchCallDiagnostics(data: AnthropicCallResult) {
  const searchCalls = data.content.filter((b) => b.type === "server_tool_use" && b.name === "web_search");
  const resultsById = new Map(data.content.filter((b) => b.type === "web_search_tool_result").map((b) => [b.tool_use_id, b.content]));
  return searchCalls.map((call) => {
    const result = resultsById.get(call.id);
    const isError = typeof result === "object" && result !== null && !Array.isArray(result) && "error_code" in (result as object);
    return {
      query: call.input,
      succeeded: !isError,
      error_code: isError ? (result as { error_code?: string }).error_code : undefined,
    };
  });
}

/**
 * Reconstructs the fallback-URL map enforceReferenceGrounding needs:
 * for each reference-source keyword (e.g. "mobbin", "figma"), every URL
 * found in that keyword's own successful search results. Mirrors the
 * inline logic in src/index.ts's runSinglePass exactly, since
 * enforceReferenceGrounding's fallback behavior depends on it.
 */
export function buildSearchResultUrlsByKeyword(
  data: AnthropicCallResult,
  domainForKeyword: Record<string, string>
): Map<string, string[]> {
  const searchCalls = data.content.filter((b) => b.type === "server_tool_use" && b.name === "web_search");
  const resultsById = new Map(data.content.filter((b) => b.type === "web_search_tool_result").map((b) => [b.tool_use_id, b.content]));
  const map = new Map<string, string[]>();
  for (const call of searchCalls) {
    const q = typeof call.input === "object" && call.input !== null ? JSON.stringify(call.input) : String(call.input ?? "");
    const qLower = q.toLowerCase();
    const keyword = Object.keys(domainForKeyword).find((k) => qLower.includes(k)) ?? null;
    if (!keyword) continue;
    const result = resultsById.get(call.id);
    const isError = typeof result === "object" && result !== null && !Array.isArray(result) && "error_code" in (result as object);
    if (isError) continue;
    const urls = extractUrlsForDomain(result, domainForKeyword[keyword]);
    map.set(keyword, (map.get(keyword) ?? []).concat(urls));
  }
  return map;
}

export function fetchCallDiagnostics(data: AnthropicCallResult) {
  const fetchCalls = data.content.filter((b) => b.type === "server_tool_use" && b.name === "web_fetch");
  const resultsById = new Map(data.content.filter((b) => b.type === "web_fetch_tool_result").map((b) => [b.tool_use_id, b.content]));
  return fetchCalls.map((call) => {
    const result = resultsById.get(call.id);
    const isError = typeof result === "object" && result !== null && !Array.isArray(result) && "error_code" in (result as object);
    const input = call.input as { url?: string } | undefined;
    let fetchedText: string | null = null;
    if (!isError && typeof result === "object" && result !== null) {
      const r = result as { content?: { source?: { type?: string; data?: string } } };
      if (r.content?.source?.type === "text" && typeof r.content.source.data === "string") {
        fetchedText = r.content.source.data;
      }
    }
    return {
      url: input?.url,
      succeeded: !isError,
      error_code: isError ? (result as { error_code?: string }).error_code : undefined,
      fetchedText,
    };
  });
}
