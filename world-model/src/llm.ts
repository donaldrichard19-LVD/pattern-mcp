import Anthropic from "@anthropic-ai/sdk";

export const llmEnabled = () => !!process.env.ANTHROPIC_API_KEY;
export const MODEL = () => process.env.WM_MODEL ?? "claude-sonnet-5-5";

/** Force a single structured tool call and return its input. */
export async function structured<T>(system: string, user: string, tool: { name: string; description: string; input_schema: any }): Promise<T> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL(), max_tokens: 8000, system,
    tools: [tool], tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content: user }],
  });
  const block = res.content.find((b: any) => b.type === "tool_use") as any;
  if (!block) throw new Error("model returned no structured output");
  return block.input as T;
}

export async function complete(system: string, user: string): Promise<string> {
  const client = new Anthropic();
  const res = await client.messages.create({ model: MODEL(), max_tokens: 1200, system, messages: [{ role: "user", content: user }] });
  return res.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
}
