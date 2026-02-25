import { NextRequest, NextResponse } from "next/server";
import { getEffectivePrompt, getEffectiveModel } from "@/lib/agents/prompt-composer";
import { getActivePrompt } from "@/lib/db/agents";
import { parseAIResponse } from "@/lib/utils/parseAIResponse";

const FALLBACK_MODEL = "anthropic/claude-opus-4.6";

// Map NPC strategy names to registry agent IDs
const STRATEGY_TO_AGENT_ID: Record<string, string> = {
  momentum: "momentum_trader",
  momentum_trader: "momentum_trader",
  contrarian: "contrarian",
  scalper: "scalper",
  news_sniper: "news_sniper",
  yolo_trader: "yolo_trader",
  // Legacy aliases for old URLs
  sector_rotation: "momentum_trader",
  value: "contrarian",
  risk_averse: "scalper",
};

interface NpcTradeRequestBody {
  agent: {
    name: string;
    model: string;
    strategy: string;
    systemPrompt: string;
    registryId?: string; // agent ID in registry (e.g. 'momentum_trader')
  };
  stocks: {
    ticker: string;
    name: string;
    sector: string;
    beta: number;
    peRatio: number;
    eps: number;
    debtEbitda: number;
    marketCap: string;
    price: number;
    startPrice: number;
    changePct: number;
  }[];
  newsEvents: { headline: string; sectorImpacts: Record<string, number> }[];
  latestEvent?: {
    headline: string;
    eventIndex: number;
    newsType: string;
    targetTicker?: string | null;
  };
  portfolio: {
    cash: number;
    positions: Record<string, { qty: number; side: string; avgCost: number }>;
  };
  standings: { name: string; model?: string; pnl: number; pnlPct?: number }[];
  totalValue: number;
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  temperature: number
): Promise<{ content: string | null; usage?: unknown; error?: string }> {
  const doCall = async (m: string) => {
    return fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Agent Colosseum",
      },
      body: JSON.stringify({ model: m, messages, max_tokens: maxTokens, temperature }),
    });
  };

  console.log(`[npc-trade] OpenRouter call: model=${model}`);
  let res = await doCall(model);
  console.log(`[npc-trade] OpenRouter response: model=${model}, status=${res.status}`);
  if (!res.ok) {
    const errText = await res.text();
    console.error(`NPC OpenRouter error (model: ${model}, status: ${res.status}):`, errText);

    if (model !== FALLBACK_MODEL) {
      console.log(`NPC retrying with fallback: ${FALLBACK_MODEL}`);
      res = await doCall(FALLBACK_MODEL);
      if (!res.ok) {
        const fallbackErr = await res.text();
        console.error(`NPC fallback failed (model: ${FALLBACK_MODEL}, status: ${res.status}):`, fallbackErr);
        return { content: null, error: "Both models failed" };
      }
      const data = await res.json();
      return { content: data.choices?.[0]?.message?.content ?? null, usage: data.usage };
    }

    return { content: null, error: errText };
  }

  const data = await res.json();
  return { content: data.choices?.[0]?.message?.content ?? null, usage: data.usage };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as NpcTradeRequestBody;
    const { agent, stocks, newsEvents, latestEvent, portfolio, standings, totalValue } = body;

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ trades: [], reasoning: "No API key configured" });
    }

    // --- REGISTRY LOOKUP: Get prompt + model from agent database ---
    let effectivePrompt = agent.systemPrompt; // fallback to what client sent
    let effectiveModel = agent.model; // fallback to what client sent
    const registryId = agent.registryId || STRATEGY_TO_AGENT_ID[agent.strategy];

    if (registryId) {
      try {
        const { composed } = getEffectivePrompt(registryId);
        const dbModel = getEffectiveModel(registryId);
        const activeVersion = getActivePrompt(registryId);
        const version = activeVersion?.version ?? 1;

        if (composed) {
          effectivePrompt = composed;
          console.log(`[npc-trade] Loading ${agent.name} prompt from registry (v${version}) with model ${dbModel}`);
        }
        if (dbModel) {
          effectiveModel = dbModel;
        }
      } catch (err) {
        console.warn(`[npc-trade] WARNING: Registry lookup failed for ${registryId}, using fallback prompt/model:`, err);
      }
    } else {
      console.log(`[npc-trade] No registry ID for ${agent.name} (strategy: ${agent.strategy}), using client-provided prompt`);
    }

    const startingCash = 100000;
    const returnPct = ((totalValue || startingCash) - startingCash) / startingCash * 100;

    const stockSummary = stocks
      .map((s) => `${s.ticker} "${s.name}" (${s.sector}) $${s.price.toFixed(2)} [${s.changePct >= 0 ? "+" : ""}${(s.changePct * 100).toFixed(2)}%] Beta:${s.beta} MCap:${s.marketCap} P/E:${s.peRatio} EPS:$${s.eps} D/E:${s.debtEbitda}`)
      .join("\n");

    // Build detailed position info with P&L
    const positionEntries = Object.entries(portfolio.positions);
    let positionBlock: string;
    if (positionEntries.length === 0) {
      positionBlock = "  No open positions.";
    } else {
      positionBlock = positionEntries.map(([ticker, pos]) => {
        const stock = stocks.find(s => s.ticker === ticker);
        const curPrice = stock ? stock.price : pos.avgCost;
        const pnl = pos.side === "long"
          ? (curPrice - pos.avgCost) * pos.qty
          : (pos.avgCost - curPrice) * pos.qty;
        const pnlPct = ((curPrice - pos.avgCost) / pos.avgCost) * 100 * (pos.side === "long" ? 1 : -1);
        return `  - ${pos.side.toUpperCase()} ${pos.qty} shares ${ticker} @ $${pos.avgCost.toFixed(2)} (current: $${curPrice.toFixed(2)}, P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)}, ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`;
      }).join("\n");
    }

    // Build news context with clear latest event highlighting
    const priorEvents = latestEvent
      ? newsEvents.filter((_, i) => i < newsEvents.length - 1)
      : newsEvents;
    const priorSummary = priorEvents.length > 0
      ? priorEvents.map((n) => `"${n.headline}"`).join(" | ")
      : "";

    const competitorBlock = standings.length > 0
      ? standings.map(s => `  - ${s.name}${s.model ? ` (${s.model})` : ""}: ${s.pnlPct != null ? `${(s.pnlPct * 100).toFixed(2)}%` : `${s.pnl >= 0 ? "+" : ""}$${s.pnl.toFixed(0)}`} return`).join("\n")
      : "  No data";

    // Build the latest event block prominently
    const latestEventBlock = latestEvent
      ? `\n>>> NEW EVENT (Event #${latestEvent.eventIndex + 1}) — REACT TO THIS <<<
"${latestEvent.headline}"
Type: ${latestEvent.newsType === "company_specific" ? "COMPANY-SPECIFIC" : latestEvent.newsType === "macro" ? "MACRO" : latestEvent.newsType}${latestEvent.targetTicker ? ` | Target: ${latestEvent.targetTicker}` : ""}
IMPORTANT: Stock prices shown below have NOT yet moved in response to this event. Prices will change in ~10 seconds.
You must decide NOW how you think each stock will move based on this news, and trade BEFORE prices change.`
      : "";

    const systemPrompt = `${effectivePrompt}

CURRENT MARKET STATE (prices are PRE-NEWS — they have not reacted to the latest event yet):
${stockSummary}
${priorSummary ? `\nPRIOR NEWS (already priced in): ${priorSummary}` : ""}
${latestEventBlock}

YOUR CURRENT PORTFOLIO:
${positionBlock}
Available Cash: $${portfolio.cash.toFixed(0)}
Total Portfolio Value: $${(totalValue || startingCash).toFixed(0)}
Total Return: ${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(2)}%

COMPETITOR STANDINGS:
${competitorBlock}

You are a PORTFOLIO MANAGER reacting to the latest market event. You MUST make a decision on EVERY SINGLE SECURITY.

For EACH security: LONG (buy), SHORT (sell short), HOLD (keep existing), CLOSE_LONG/CLOSE_SHORT (exit position), or SKIP (no action).
Your trades execute at CURRENT prices (before the market reacts). This is your edge — trade on the news before prices move.

Respond with ONLY a JSON object:
{"trades": [{"action": "LONG" or "SHORT" or "CLOSE_LONG" or "CLOSE_SHORT", "ticker": "SYMBOL", "qty": NUMBER}], "skips": [{"ticker": "SYMBOL", "reason": "why"}], "reasoning": "1-2 sentences explaining your reaction to the NEW event"}

Rules:
- Address ALL ${stocks.length} securities — trade or skip each one
- Only use tickers from the stocks listed
- qty must be > 0 and affordable (each share costs its current price)
- 1-2 trades (only 2 securities). Concentrate positions.
- Deploy 60-80% of available capital on concentrated positions.
- React to the NEW event — this is why you're being called`;

    const result = await callOpenRouter(apiKey, effectiveModel, [
      { role: "system", content: systemPrompt },
      { role: "user", content: "Review your portfolio and make your trading decision. Respond with JSON only." },
    ], 512, 0.7);

    if (!result.content) {
      console.error(`NPC trade failed for ${agent.name} (${effectiveModel}): ${result.error}`);
      return NextResponse.json({ trades: [], reasoning: `API error for ${effectiveModel}, holding position` });
    }

    const content = result.content;
    const usage = result.usage;

    try {
      const parsed = parseAIResponse(content, { requiredKey: "trades" });
      if (parsed) {
        if (parsed.trades && Array.isArray(parsed.trades)) {
          const validTickers = new Set(stocks.map((s) => s.ticker));
          const validTrades = parsed.trades
            .filter((t: Record<string, unknown>) => {
              const validAction = ["LONG", "SHORT", "CLOSE_LONG", "CLOSE_SHORT"].includes(t.action as string);
              const validTicker = validTickers.has(t.ticker as string);
              const validQty = typeof t.qty === "number" && t.qty > 0;
              return validAction && validTicker && validQty;
            })
            .map((t: Record<string, unknown>) => {
              const stock = stocks.find((s) => s.ticker === t.ticker);
              let qty = Math.floor(t.qty as number);
              if (stock && (t.action === "LONG" || t.action === "SHORT")) {
                const maxAffordable = Math.floor(portfolio.cash / stock.price);
                qty = Math.min(qty, maxAffordable);
              }
              return { action: t.action, ticker: t.ticker, qty };
            })
            .filter((t: { qty: number }) => t.qty > 0);

          return NextResponse.json({
            trades: validTrades,
            reasoning: parsed.reasoning || "Executing strategy",
            usage,
          });
        }
      }
    } catch {
      // Parse failed
    }

    return NextResponse.json({ trades: [], reasoning: "Could not parse response, holding" });
  } catch (error) {
    console.error("NPC trade error:", error);
    return NextResponse.json({ trades: [], reasoning: "Error, holding position" });
  }
}
