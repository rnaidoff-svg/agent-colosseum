import { NextRequest, NextResponse } from "next/server";
import { getEffectivePrompt } from "@/lib/agents/prompt-composer";
import { getActivePrompt } from "@/lib/db/agents";

const FALLBACK_MODEL = "anthropic/claude-opus-4.6";

// Map user strategy labels to registry agent IDs
const STRATEGY_TO_AGENT_ID: Record<string, string> = {
  momentum: "momentum_trader",
  contrarian: "contrarian",
  sector_rotation: "sector_rotator",
  value: "value_hunter",
  risk_averse: "risk_averse",
  custom: "custom_wrapper",
};

interface StockInfo {
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
}

interface StrategyRequestBody {
  model: string;
  systemPrompt: string;
  userStrategy?: string; // e.g. "momentum", "contrarian", "custom"
  customPrompt?: string; // user's custom text for custom strategy
  stocks: StockInfo[];
  newsEvents: { headline: string; sectorImpacts: Record<string, number> }[];
  portfolio: {
    cash: number;
    positions: Record<string, { qty: number; side: string; avgCost: number }>;
  };
  standings: { name: string; model?: string; pnl: number; pnlPct?: number }[];
  totalValue: number;
  isUpdate: boolean;
  messages?: { role: "user" | "assistant"; content: string }[];
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  temperature: number
): Promise<{ content: string | null; usedModel: string; error?: string }> {
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

  console.log(`[chat] OpenRouter call: model=${model}`);
  let res = await doCall(model);
  console.log(`[chat] OpenRouter response: model=${model}, status=${res.status}`);
  if (!res.ok) {
    const errText = await res.text();
    console.error(`OpenRouter error (model: ${model}, status: ${res.status}):`, errText);

    if (model !== FALLBACK_MODEL) {
      console.log(`Retrying with fallback model: ${FALLBACK_MODEL}`);
      res = await doCall(FALLBACK_MODEL);
      if (!res.ok) {
        const fallbackErr = await res.text();
        console.error(`Fallback also failed (model: ${FALLBACK_MODEL}, status: ${res.status}):`, fallbackErr);
        return { content: null, usedModel: FALLBACK_MODEL, error: `${model} failed, fallback also failed` };
      }
      const data = await res.json();
      return { content: data.choices?.[0]?.message?.content ?? null, usedModel: FALLBACK_MODEL };
    }

    return { content: null, usedModel: model, error: errText };
  }

  const data = await res.json();
  return { content: data.choices?.[0]?.message?.content ?? null, usedModel: model };
}

/**
 * Build the effective system prompt for the user's agent from the registry.
 * - For template strategies: General + Trading LT + Soldier prompt (from registry)
 * - For custom: General + Trading LT + Custom Wrapper (with {USER_CUSTOM_PROMPT} replaced)
 * - Falls back to client-provided systemPrompt if registry lookup fails
 */
function buildUserAgentPrompt(userStrategy: string | undefined, customPrompt: string | undefined, clientPrompt: string): string {
  if (!userStrategy) return clientPrompt;

  const agentId = STRATEGY_TO_AGENT_ID[userStrategy];
  if (!agentId) return clientPrompt;

  try {
    const { composed } = getEffectivePrompt(agentId);
    const activeVersion = getActivePrompt(agentId);
    const version = activeVersion?.version ?? 1;

    if (!composed) {
      console.warn(`[chat] WARNING: No composed prompt for agent ${agentId}, using client prompt`);
      return clientPrompt;
    }

    let finalPrompt = composed;

    // For custom strategy, replace the placeholder with user's text
    if (userStrategy === "custom" && customPrompt) {
      finalPrompt = finalPrompt.replace("{USER_CUSTOM_PROMPT}", customPrompt);
    }

    console.log(`[chat] Loading user agent prompt from registry: ${agentId} (v${version})`);
    return finalPrompt;
  } catch (err) {
    console.warn(`[chat] WARNING: Registry lookup failed for user agent ${agentId}, using client prompt:`, err);
    return clientPrompt;
  }
}

function buildPortfolioContext(
  stocks: StockInfo[],
  portfolio: StrategyRequestBody["portfolio"],
  standings: StrategyRequestBody["standings"],
  totalValue: number
): string {
  const startingCash = 100000;
  const totalReturn = ((totalValue - startingCash) / startingCash) * 100;

  // Build position details with P&L
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

  // Build competitor standings
  const competitorBlock = standings.length > 0
    ? standings.map(s => `  - ${s.name}${s.model ? ` (${s.model})` : ""}: ${s.pnlPct != null ? `${(s.pnlPct * 100).toFixed(2)}%` : `${s.pnl >= 0 ? "+" : ""}$${s.pnl.toFixed(0)}`} return`).join("\n")
    : "  No competitor data yet.";

  return `YOUR CURRENT PORTFOLIO:
${positionBlock}
Available Cash: $${portfolio.cash.toFixed(0)}
Total Portfolio Value: $${totalValue.toFixed(0)}
Total Return: ${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(2)}%

COMPETITOR STANDINGS:
${competitorBlock}`;
}

const PORTFOLIO_MANAGER_INSTRUCTIONS = `
You are a PORTFOLIO MANAGER. You MUST make a decision on EVERY SINGLE SECURITY in this match — no exceptions.

For EACH of the securities listed above, you must decide one of:
- LONG [shares]: buy shares (new or add to existing position)
- SHORT [shares]: short sell shares (new or add to existing position)
- HOLD: keep existing position unchanged (explain why)
- SKIP: no position, not interested (explain why)

You MUST address ALL securities. Consider ALL news events this round, your existing positions, current stock prices, and competitor standings. Think about risk management, diversification, and capital allocation. Deploy 60-80% of available capital across multiple positions.`;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as StrategyRequestBody;
    const { model, systemPrompt, userStrategy, customPrompt, stocks, newsEvents, portfolio, standings, totalValue, isUpdate, messages } = body;

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ content: "No API key configured. Set OPENROUTER_API_KEY in .env.local." });
    }

    // --- REGISTRY LOOKUP: Build effective prompt from agent hierarchy ---
    // Model always comes from user's configure screen selection (NOT from registry)
    const effectivePrompt = buildUserAgentPrompt(userStrategy, customPrompt, systemPrompt);

    const stockSummary = stocks
      .map((s) => `${s.ticker} "${s.name}" (${s.sector}) | Price: $${s.price.toFixed(2)} | Change: ${s.changePct >= 0 ? "+" : ""}${(s.changePct * 100).toFixed(2)}% | Beta: ${s.beta} | MCap: ${s.marketCap} | P/E: ${s.peRatio} | EPS: $${s.eps} | D/EBITDA: ${s.debtEbitda}`)
      .join("\n");

    const newsSummary = newsEvents.length > 0
      ? newsEvents.map((n) => {
          const impacts = Object.entries(n.sectorImpacts)
            .filter(([s]) => s !== "index")
            .map(([sector, impact]) => `${sector} ${impact > 0 ? "+" : ""}${(impact * 100).toFixed(1)}%`)
            .join(", ");
          return `"${n.headline}" [${impacts}]`;
        }).join("\n")
      : "No current news events.";

    const portfolioContext = buildPortfolioContext(stocks, portfolio, standings, totalValue || 100000);

    if (isUpdate) {
      const updatePrompt = `${effectivePrompt}

CURRENT MARKET STATE:
${stockSummary}

NEWS EVENTS THIS ROUND:
${newsSummary}

${portfolioContext}

${PORTFOLIO_MANAGER_INSTRUCTIONS}

New news just dropped. Review ALL your existing positions and the new information. Recommend any urgent portfolio adjustments.

You MUST respond with a JSON block:
\`\`\`json
{
  "reasoning": "1-2 sentence reaction to the news, including what you're doing with existing positions",
  "trades": [
    { "action": "LONG" or "SHORT" or "CLOSE_LONG" or "CLOSE_SHORT", "ticker": "SYMBOL", "qty": NUMBER, "reason": "brief reason" }
  ]
}
\`\`\`

Rules:
- Only use tickers from the stocks listed
- CLOSE_LONG/CLOSE_SHORT: close an existing position
- If holding all positions unchanged, return empty trades array with reasoning explaining WHY you're holding
- 0-3 trades maximum
- qty must be > 0 and affordable`;

      const result = await callOpenRouter(apiKey, model, [
        { role: "system", content: updatePrompt },
        { role: "user", content: "React to the latest news. Review your existing positions. Recommend adjustments. Respond with JSON only." },
      ], 500, 0.7);

      if (!result.content) {
        return NextResponse.json({
          content: `Model ${model} unavailable. Check the news and act on your judgment.`,
          trades: [],
        });
      }

      const content = result.content;

      try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*"trades"[\s\S]*\}/);
        if (jsonMatch) {
          const jsonStr = jsonMatch[1] || jsonMatch[0];
          const parsed = JSON.parse(jsonStr);
          if (parsed.trades && Array.isArray(parsed.trades)) {
            const validTickers = new Set(stocks.map((s: StockInfo) => s.ticker));
            const validTrades = parsed.trades
              .filter((t: Record<string, unknown>) => {
                const validAction = ["LONG", "SHORT", "CLOSE_LONG", "CLOSE_SHORT"].includes(t.action as string);
                const validTicker = validTickers.has(t.ticker as string);
                const validQty = typeof t.qty === "number" && t.qty > 0;
                return validAction && validTicker && validQty;
              })
              .map((t: Record<string, unknown>) => ({
                action: t.action,
                ticker: t.ticker,
                qty: Math.floor(t.qty as number),
                reason: t.reason || "",
              }));

            return NextResponse.json({
              content,
              reasoning: parsed.reasoning || content,
              trades: validTrades,
            });
          }
        }
      } catch {
        // Parse failed
      }

      return NextResponse.json({ content, reasoning: content, trades: [] });
    }

    // Full strategy request
    const strategyPrompt = `${effectivePrompt}

CURRENT MARKET STATE:
${stockSummary}

NEWS EVENTS THIS ROUND:
${newsSummary}

${portfolioContext}

${PORTFOLIO_MANAGER_INSTRUCTIONS}

INSTRUCTIONS:
Provide a FULL portfolio allocation strategy covering ALL ${stocks.length} securities. For EACH security, state your decision.

You MUST respond with a JSON block in this exact format:
\`\`\`json
{
  "trades": [
    { "action": "LONG" or "SHORT", "ticker": "TICKER", "qty": NUMBER, "dollarAmt": NUMBER, "reason": "brief reason" }
  ],
  "skips": [
    { "ticker": "TICKER", "reason": "why skipping or holding" }
  ],
  "cashReserve": NUMBER,
  "summary": "1-3 sentence strategy summary covering ALL securities"
}
\`\`\`

Rules:
- You MUST address ALL ${stocks.length} securities — either trade them or include them in skips
- Only use tickers from the stocks listed above
- Total dollarAmt of all trades + cashReserve should roughly equal your available cash ($${portfolio.cash.toFixed(0)})
- qty must be a whole number > 0
- Consider news impacts, your existing positions, competitor standings, and risk/reward
- Deploy 60-80% of available capital across 3-5 positions
- Diversify across sectors when possible`;

    const apiMessages: { role: string; content: string }[] = [
      { role: "system", content: strategyPrompt },
    ];

    if (messages && messages.length > 0) {
      for (const m of messages) {
        apiMessages.push({ role: m.role, content: m.content });
      }
    } else {
      apiMessages.push({ role: "user", content: "Analyze the market, review your existing positions, and give me your full trading strategy. Respond with JSON." });
    }

    const result = await callOpenRouter(apiKey, model, apiMessages, 700, 0.7);

    if (!result.content) {
      return NextResponse.json({
        content: `Could not connect to ${model}. Try a different model or check your API key.`,
      });
    }

    const content = result.content;

    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*"trades"[\s\S]*\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const parsed = JSON.parse(jsonStr);
        if (parsed.trades && Array.isArray(parsed.trades)) {
          const validTrades = parsed.trades.filter((t: Record<string, unknown>) => {
            const validAction = t.action === "LONG" || t.action === "SHORT";
            const validTicker = stocks.some((s) => s.ticker === t.ticker);
            const validQty = typeof t.qty === "number" && t.qty > 0;
            return validAction && validTicker && validQty;
          });

          return NextResponse.json({
            content,
            trades: validTrades,
            cashReserve: typeof parsed.cashReserve === "number" ? parsed.cashReserve : 0,
            summary: parsed.summary || "",
          });
        }
      }
    } catch {
      // Parse failed
    }

    return NextResponse.json({ content });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json({ content: "An error occurred. Please try again." });
  }
}
