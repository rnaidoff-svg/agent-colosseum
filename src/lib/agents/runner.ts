// ============================================================
// Agent runner — generic interface between engine and AI models
// Supports: OpenRouter LLM, mock (testing), future: external API
// ============================================================

import {
  AgentConfig,
  AgentDecision,
  AgentState,
  MarketState,
  StockPrice,
} from "../engine/types";
import { AgentDecisionFn } from "../engine/game";
import { parseAIResponse } from "../utils/parseAIResponse";

// ------ Prompt builder ------

function formatPrice(sp: StockPrice): string {
  const dir = sp.change >= 0 ? "+" : "";
  return `  ${sp.ticker} (${sp.name}): $${sp.price.toFixed(2)} ${dir}${sp.change.toFixed(2)} (${dir}${(sp.changePct * 100).toFixed(2)}%)`;
}

function buildPrompt(marketState: MarketState, agentState: AgentState): string {
  const lines: string[] = [];

  lines.push(`=== ROUND ${marketState.round} of ${marketState.totalRounds} ===`);
  lines.push("");

  // Prices
  lines.push("CURRENT PRICES:");
  for (const sp of Object.values(marketState.prices)) {
    lines.push(formatPrice(sp));
  }
  lines.push("");

  // News
  if (marketState.news.length > 0) {
    lines.push("NEWS THIS ROUND:");
    for (const event of marketState.news) {
      lines.push(`  * ${event.headline}`);
    }
    lines.push("");
  }

  // Portfolio
  lines.push("YOUR PORTFOLIO:");
  lines.push(`  Cash: $${agentState.portfolio.cash.toFixed(2)}`);
  lines.push(`  Total Value: $${agentState.totalValue.toFixed(2)}`);
  lines.push(`  P&L: ${(agentState.pnlPct * 100).toFixed(2)}%`);

  const positions = Object.values(agentState.portfolio.positions);
  if (positions.length > 0) {
    lines.push("  Positions:");
    for (const pos of positions) {
      const price = marketState.prices[pos.ticker]?.price ?? 0;
      const value = pos.quantity * price;
      const unrealizedPnl = pos.side === "long"
        ? (price - pos.avgCost) * pos.quantity
        : (pos.avgCost - price) * pos.quantity;
      lines.push(
        `    ${pos.side.toUpperCase()} ${pos.quantity}x ${pos.ticker} @ avg $${pos.avgCost.toFixed(2)} (val: $${value.toFixed(2)}, P&L: $${unrealizedPnl.toFixed(2)})`
      );
    }
  } else {
    lines.push("  Positions: none");
  }
  lines.push("");

  // Competitor standings
  lines.push("STANDINGS:");
  for (let i = 0; i < marketState.standings.length; i++) {
    const s = marketState.standings[i];
    const marker = s.agentId === agentState.agentId ? " (YOU)" : "";
    lines.push(
      `  ${i + 1}. ${s.agentName}${marker}: $${s.totalValue.toFixed(2)} (${(s.pnlPct * 100).toFixed(2)}%)`
    );
  }
  lines.push("");

  lines.push("AVAILABLE ACTIONS: BUY, SELL, SHORT, HOLD");
  lines.push("Available tickers: " + Object.values(marketState.prices)
    .filter(p => p.sector !== "index")
    .map(p => p.ticker)
    .join(", "));
  lines.push("");
  lines.push(
    `Respond with a JSON object: { "actions": [{"action": "BUY"|"SELL"|"SHORT"|"HOLD", "asset": "TICKER", "quantity": NUMBER}], "reasoning": "your brief reasoning" }`
  );
  lines.push("You may include multiple actions. Keep reasoning under 200 words.");

  return lines.join("\n");
}

// ------ OpenRouter LLM agent ------

interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

async function callOpenRouter(
  model: string,
  messages: OpenRouterMessage[],
  temperature: number
): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("NEXT_PUBLIC_OPENROUTER_API_KEY environment variable is not set");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://agent-colosseum.local",
      "X-Title": "Agent Colosseum",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as OpenRouterResponse;
  return data.choices?.[0]?.message?.content ?? "";
}

function parseAgentResponse(raw: string): AgentDecision {
  const parsed = parseAIResponse(raw, { requiredKey: "actions" });

  if (!parsed) {
    return { actions: [], reasoning: `Failed to parse response — holding. Raw: ${raw.slice(0, 200)}` };
  }

  const actions = Array.isArray(parsed.actions)
    ? parsed.actions
        .filter(
          (a: Record<string, unknown>) =>
            a &&
            typeof a.action === "string" &&
            ["BUY", "SELL", "SHORT", "HOLD"].includes(a.action as string)
        )
        .map((a: Record<string, unknown>) => ({
          action: a.action as "BUY" | "SELL" | "SHORT" | "HOLD",
          asset: String(a.asset || ""),
          quantity: Math.floor(Number(a.quantity) || 0),
        }))
    : [];

  return {
    actions,
    reasoning: String(parsed.reasoning || "No reasoning provided"),
  };
}

async function llmDecision(
  agentConfig: AgentConfig,
  marketState: MarketState,
  agentState: AgentState
): Promise<AgentDecision> {
  const userPrompt = buildPrompt(marketState, agentState);

  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: agentConfig.systemPrompt,
    },
    {
      role: "user",
      content: userPrompt,
    },
  ];

  const raw = await callOpenRouter(
    agentConfig.model,
    messages,
    agentConfig.temperature ?? 0.7
  );

  return parseAgentResponse(raw);
}

// ------ Mock agent (for testing) ------

function mockDecision(
  agentConfig: AgentConfig,
  marketState: MarketState,
  agentState: AgentState
): AgentDecision {
  const tickers = Object.values(marketState.prices)
    .filter((p) => p.sector !== "index")
    .map((p) => p.ticker);

  // Simple mock strategies based on agent name
  const name = agentConfig.name.toLowerCase();

  if (name.includes("aggressive") || name.includes("bull")) {
    // Aggressive: buy stocks that dropped, concentrate
    const dropped = tickers
      .filter((t) => marketState.prices[t].changePct < 0)
      .sort((a, b) => marketState.prices[a].changePct - marketState.prices[b].changePct);

    const target = dropped[0] || tickers[0];
    const price = marketState.prices[target].price;
    const maxSpend = agentState.portfolio.cash * 0.3;
    const qty = Math.floor(maxSpend / price);

    if (qty > 0 && agentState.portfolio.cash > price * qty) {
      return {
        actions: [{ action: "BUY", asset: target, quantity: qty }],
        reasoning: `Mock aggressive: buying ${qty}x ${target} (it dropped, buying the dip)`,
      };
    }
    return { actions: [], reasoning: "Mock aggressive: holding (no cash or no drops)" };
  }

  if (name.includes("conservative") || name.includes("safe")) {
    // Conservative: small buys of healthcare and consumer
    const safeTickers = tickers.filter((t) => {
      const sector = marketState.prices[t].sector;
      return sector === "healthcare" || sector === "consumer";
    });
    const target = safeTickers[Math.floor(Math.random() * safeTickers.length)] || tickers[0];
    const price = marketState.prices[target].price;
    const qty = Math.floor((agentState.portfolio.cash * 0.15) / price);

    if (qty > 0 && agentState.portfolio.cash > price * qty) {
      return {
        actions: [{ action: "BUY", asset: target, quantity: qty }],
        reasoning: `Mock conservative: small buy of ${qty}x ${target} (safe sector)`,
      };
    }
    return { actions: [], reasoning: "Mock conservative: holding" };
  }

  // Default: random trader
  const action = Math.random() > 0.5 ? "BUY" as const : "HOLD" as const;
  if (action === "HOLD") {
    return { actions: [], reasoning: "Mock random: decided to hold this round" };
  }

  const target = tickers[Math.floor(Math.random() * tickers.length)];
  const price = marketState.prices[target].price;
  const qty = Math.floor((agentState.portfolio.cash * 0.2) / price);

  if (qty > 0) {
    return {
      actions: [{ action: "BUY", asset: target, quantity: qty }],
      reasoning: `Mock random: buying ${qty}x ${target}`,
    };
  }
  return { actions: [], reasoning: "Mock random: holding (no cash)" };
}

// ------ Exported decision function ------

/**
 * Creates the decision function used by the game engine.
 * Routes to the right provider based on each agent's config.
 */
export function createDecisionFn(): AgentDecisionFn {
  return async (agentConfig, marketState, agentState) => {
    if (agentConfig.provider === "mock") {
      return mockDecision(agentConfig, marketState, agentState);
    }
    return llmDecision(agentConfig, marketState, agentState);
  };
}

/** Exported for testing */
export { buildPrompt, parseAgentResponse };
