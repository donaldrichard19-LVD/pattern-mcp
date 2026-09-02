#!/usr/bin/env node
// Cost-attribution build plan, task 1.5: 3 new real Coop rewards widgets,
// each judged with an explicit feature_id against the real ~/.pattern
// ledger. Real API calls -- real cost.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = "/home/donaldrichard19/ui-component-judgment-mcp";
if (!process.env.ANTHROPIC_API_KEY) {
  const envText = readFileSync(resolve(projectRoot, ".env"), "utf8");
  for (const line of envText.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) process.env[match[1]] = match[2];
  }
}

const PROJECT_ID = "coop-commerce";
const DOMAIN = "local commerce / ordering app";
const FRAMEWORK = "React + Tailwind";

const WIDGETS = [
  {
    feature_id: "coop-rewards-redeem-confirm-modal",
    component_need:
      "confirmation modal shown before redeeming Coop Cash balance toward a purchase, showing the exact amount to be applied and requiring an explicit confirm or cancel action",
  },
  {
    feature_id: "coop-rewards-earning-streak-badge",
    component_need:
      "earning streak badge shown near the rewards balance indicating consecutive weeks with at least one Coop Cash earning activity",
  },
];

const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(projectRoot, "dist/index.js")],
  env: { ...process.env },
});
const client = new Client({ name: "coop-rewards-1.5-validation", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);

const results = [];
for (const w of WIDGETS) {
  console.log(`\n=== ${w.feature_id} ===`);
  console.log("component_need:", w.component_need);
  const start = Date.now();
  const res = await client.callTool(
    {
      name: "recommend_component",
      arguments: { component_need: w.component_need, domain: DOMAIN, framework: FRAMEWORK, project_id: PROJECT_ID, feature_id: w.feature_id },
    },
    undefined,
    { timeout: 240000 }
  );
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const parsed = JSON.parse(res.content[0].text);
  console.log(`(${elapsed}s) verdict=${parsed.verdict} confidence=${parsed.confidence} coverage=${parsed.coverage} cost=$${parsed._meta?.estimated_cost_usd}`);
  if (parsed.verdict === "use_existing") {
    console.log("recommendation:", parsed.recommendation?.component_description);
  } else {
    console.log("reference:", JSON.stringify(parsed.recommendation?.reference));
  }
  results.push({ feature_id: w.feature_id, verdict: parsed.verdict, confidence: parsed.confidence, cost: parsed._meta?.estimated_cost_usd, full: parsed });
}

console.log("\n=== SUMMARY ===");
let totalJudgmentCost = 0;
for (const r of results) {
  console.log(`${r.feature_id}: ${r.verdict} (${r.confidence}) — $${r.cost}`);
  totalJudgmentCost += r.cost ?? 0;
}
console.log("total judgment cost: $" + totalJudgmentCost.toFixed(4));

await client.close();
