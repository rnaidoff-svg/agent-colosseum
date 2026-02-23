import { NextResponse } from "next/server";
import { getAllAgents, getActivePrompt, getSystemConfig } from "@/lib/db/agents";
import { getEffectivePrompt, getEffectiveModel } from "@/lib/agents/prompt-composer";

export const dynamic = "force-dynamic";

interface TestResult {
  id: number;
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

const EXPECTED_AGENTS = [
  "general", "trading_lt", "market_lt",
  "momentum_trader", "contrarian", "scalper", "news_sniper", "yolo_trader", "custom_wrapper",
  "macro_news", "company_news", "stock_selector", "market_engine",
];

const TRADING_SOLDIERS = ["momentum_trader", "contrarian", "scalper", "news_sniper", "yolo_trader"];

export async function GET() {
  const results: TestResult[] = [];
  let testId = 0;

  const agents = getAllAgents();
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  // TEST 1: All 13 agents exist in DB
  testId++;
  const missing = EXPECTED_AGENTS.filter((id) => !agentMap.has(id));
  results.push({
    id: testId,
    name: "All 13 agents exist in database",
    status: missing.length === 0 ? "pass" : "fail",
    detail: missing.length === 0
      ? `All ${EXPECTED_AGENTS.length} agents present`
      : `Missing: ${missing.join(", ")}`,
  });

  // TEST 2: All agents have active prompts
  testId++;
  const noPrompt: string[] = [];
  for (const id of EXPECTED_AGENTS) {
    const prompt = getActivePrompt(id);
    if (!prompt) noPrompt.push(id);
  }
  results.push({
    id: testId,
    name: "All agents have active prompt versions",
    status: noPrompt.length === 0 ? "pass" : "fail",
    detail: noPrompt.length === 0
      ? "All agents have active prompts"
      : `No active prompt: ${noPrompt.join(", ")}`,
  });

  // TEST 3: All agents have model_override set
  testId++;
  const noModel: string[] = [];
  for (const id of EXPECTED_AGENTS) {
    const agent = agentMap.get(id);
    if (!agent?.model_override) noModel.push(id);
  }
  results.push({
    id: testId,
    name: "All agents have model_override set",
    status: noModel.length === 0 ? "pass" : "fail",
    detail: noModel.length === 0
      ? "All agents have explicit model assignments"
      : `Missing model: ${noModel.join(", ")}`,
  });

  // TEST 4: General prompt contains DELEGATION format
  testId++;
  const generalPrompt = getActivePrompt("general");
  const hasDelegation = generalPrompt?.prompt_text?.includes("DELEGATION") ?? false;
  results.push({
    id: testId,
    name: "General prompt contains DELEGATION format",
    status: hasDelegation ? "pass" : "fail",
    detail: hasDelegation ? "DELEGATION keyword found in General prompt" : "General prompt missing DELEGATION format",
  });

  // TEST 5: Trading LT prompt contains JSON response format
  testId++;
  const tradingLtPrompt = getActivePrompt("trading_lt");
  const tradingLtJson = tradingLtPrompt?.prompt_text?.includes("affected_soldiers") ?? false;
  results.push({
    id: testId,
    name: "Trading LT prompt contains JSON format",
    status: tradingLtJson ? "pass" : "warn",
    detail: tradingLtJson ? "JSON format instructions found" : "Trading LT prompt may lack structured JSON format",
  });

  // TEST 6: Market LT prompt contains JSON response format
  testId++;
  const marketLtPrompt = getActivePrompt("market_lt");
  const marketLtJson = marketLtPrompt?.prompt_text?.includes("affected_soldiers") ?? false;
  results.push({
    id: testId,
    name: "Market LT prompt contains JSON format",
    status: marketLtJson ? "pass" : "warn",
    detail: marketLtJson ? "JSON format instructions found" : "Market LT prompt may lack structured JSON format",
  });

  // TEST 7: All trading soldiers have unique models
  testId++;
  const tradingModels = TRADING_SOLDIERS.map((id) => agentMap.get(id)?.model_override || "unknown");
  const uniqueModels = new Set(tradingModels);
  results.push({
    id: testId,
    name: "Trading soldiers have unique models",
    status: uniqueModels.size === TRADING_SOLDIERS.length ? "pass" : "warn",
    detail: uniqueModels.size === TRADING_SOLDIERS.length
      ? `All ${TRADING_SOLDIERS.length} trading soldiers have different models: ${Array.from(uniqueModels).map(m => m.split("/").pop()).join(", ")}`
      : `Only ${uniqueModels.size}/${TRADING_SOLDIERS.length} unique models. Models: ${tradingModels.map((m, i) => `${TRADING_SOLDIERS[i]}=${m.split("/").pop()}`).join(", ")}`,
  });

  // TEST 8: Macro news prompt includes per_stock_impacts
  testId++;
  const macroPrompt = getActivePrompt("macro_news");
  const macroHasPerStock = macroPrompt?.prompt_text?.includes("per_stock_impacts") ?? false;
  results.push({
    id: testId,
    name: "Macro news prompt includes per_stock_impacts",
    status: macroHasPerStock ? "pass" : "fail",
    detail: macroHasPerStock ? "per_stock_impacts format found in macro news prompt" : "Macro news prompt missing per_stock_impacts format",
  });

  // TEST 9: Company news prompt includes per_stock_impacts
  testId++;
  const companyPrompt = getActivePrompt("company_news");
  const companyHasPerStock = companyPrompt?.prompt_text?.includes("per_stock_impacts") ?? false;
  results.push({
    id: testId,
    name: "Company news prompt includes per_stock_impacts",
    status: companyHasPerStock ? "pass" : "fail",
    detail: companyHasPerStock ? "per_stock_impacts format found in company news prompt" : "Company news prompt missing per_stock_impacts format",
  });

  // TEST 10: Stock selector prompt exists and mentions diversity
  testId++;
  const selectorPrompt = getActivePrompt("stock_selector");
  const selectorValid = selectorPrompt?.prompt_text?.includes("sector") ?? false;
  results.push({
    id: testId,
    name: "Stock selector prompt exists and mentions sector diversity",
    status: selectorValid ? "pass" : "warn",
    detail: selectorValid ? "Stock selector prompt mentions sector diversity" : "Stock selector prompt may be incomplete",
  });

  // TEST 11: Market engine prompt exists
  testId++;
  const enginePrompt = getActivePrompt("market_engine");
  const engineValid = (enginePrompt?.prompt_text?.length ?? 0) > 50;
  results.push({
    id: testId,
    name: "Market engine prompt exists and is non-trivial",
    status: engineValid ? "pass" : "fail",
    detail: engineValid ? `Market engine prompt: ${enginePrompt!.prompt_text.length} chars` : "Market engine prompt missing or too short",
  });

  // TEST 12: System model config exists
  testId++;
  const sysModel = getSystemConfig("system_model");
  results.push({
    id: testId,
    name: "System model config exists",
    status: sysModel ? "pass" : "fail",
    detail: sysModel ? `system_model = ${sysModel}` : "system_model config not found",
  });

  // TEST 13: getEffectivePrompt works for all agents
  testId++;
  const promptErrors: string[] = [];
  for (const id of EXPECTED_AGENTS) {
    try {
      const { composed, sections } = getEffectivePrompt(id);
      if (!composed || composed.length === 0) promptErrors.push(`${id}: empty`);
      else if (sections.length === 0) promptErrors.push(`${id}: no sections`);
    } catch (e) {
      promptErrors.push(`${id}: ${e}`);
    }
  }
  results.push({
    id: testId,
    name: "getEffectivePrompt works for all 13 agents",
    status: promptErrors.length === 0 ? "pass" : "fail",
    detail: promptErrors.length === 0
      ? "All agents return valid composed prompts"
      : `Errors: ${promptErrors.join("; ")}`,
  });

  // TEST 14: getEffectiveModel works for all agents
  testId++;
  const modelErrors: string[] = [];
  const modelResults: Record<string, string> = {};
  for (const id of EXPECTED_AGENTS) {
    try {
      const model = getEffectiveModel(id);
      if (!model || model.length === 0) modelErrors.push(`${id}: empty`);
      modelResults[id] = model;
    } catch (e) {
      modelErrors.push(`${id}: ${e}`);
    }
  }
  results.push({
    id: testId,
    name: "getEffectiveModel works for all 13 agents",
    status: modelErrors.length === 0 ? "pass" : "fail",
    detail: modelErrors.length === 0
      ? `All agents have models: ${Object.entries(modelResults).map(([id, m]) => `${id}=${m.split("/").pop()}`).join(", ")}`
      : `Errors: ${modelErrors.join("; ")}`,
  });

  // TEST 15: Agent hierarchy is intact (all parents exist)
  testId++;
  const brokenParents: string[] = [];
  for (const agent of agents) {
    if (agent.parent_id && !agentMap.has(agent.parent_id)) {
      brokenParents.push(`${agent.id} → parent ${agent.parent_id} not found`);
    }
  }
  results.push({
    id: testId,
    name: "Agent hierarchy intact (all parents exist)",
    status: brokenParents.length === 0 ? "pass" : "fail",
    detail: brokenParents.length === 0
      ? "All parent references valid"
      : `Broken: ${brokenParents.join("; ")}`,
  });

  // Summary
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const warned = results.filter((r) => r.status === "warn").length;

  return NextResponse.json({
    summary: { total: results.length, passed, failed, warned },
    results,
    timestamp: new Date().toISOString(),
  });
}
