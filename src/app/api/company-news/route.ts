import { NextRequest, NextResponse } from "next/server";
import { getEffectivePrompt, getEffectiveModel } from "@/lib/agents/prompt-composer";
import { getActivePrompt } from "@/lib/db/agents";

const FALLBACK_MODEL = "anthropic/claude-opus-4.6";

// Severity → max absolute % per stock
const SEVERITY_CLAMP: Record<string, number> = {
  LOW: 6, MODERATE: 8, HIGH: 10, EXTREME: 14,
};

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  temperature: number
): Promise<{ content: string | null; error?: string }> {
  const doCall = async (m: string) => {
    return fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Agent Colosseum - Company News Agent",
      },
      body: JSON.stringify({ model: m, messages, max_tokens: maxTokens, temperature }),
    });
  };

  let res = await doCall(model);
  if (!res.ok && model !== FALLBACK_MODEL) {
    console.log(`[company-news] ${model} failed, falling back to ${FALLBACK_MODEL}`);
    res = await doCall(FALLBACK_MODEL);
    if (!res.ok) return { content: null, error: "Both models failed" };
  }
  if (!res.ok) return { content: null, error: "Model failed" };
  const data = await res.json();
  return { content: data.choices?.[0]?.message?.content ?? null };
}

/** Fallback: derive per-stock impacts from headline sentiment */
function generateFallbackImpacts(
  headline: string,
  targetTicker: string,
  stocks: { ticker: string; sector: string; beta: number }[]
): Record<string, number> {
  const positiveWords = ["beats", "surges", "growth", "upgrade", "approval", "record", "boost", "wins", "soars", "patent", "split", "insider"];
  const negativeWords = ["misses", "crashes", "recession", "downgrade", "reject", "fraud", "recall", "resign", "short", "warning", "disruption", "slump"];

  let direction = 0;
  const lower = headline.toLowerCase();
  for (const word of positiveWords) if (lower.includes(word)) direction += 1;
  for (const word of negativeWords) if (lower.includes(word)) direction -= 1;

  const sign = direction >= 0 ? 1 : -1;
  const targetStock = stocks.find((s) => s.ticker === targetTicker);
  const targetSector = targetStock?.sector;

  const impacts: Record<string, number> = {};
  for (const stock of stocks) {
    if (stock.ticker === targetTicker) {
      impacts[stock.ticker] = Math.round((5.0 * sign + (Math.random() - 0.5) * 2) * 100) / 100;
    } else if (stock.sector === targetSector) {
      impacts[stock.ticker] = Math.round((1.0 * sign * stock.beta + (Math.random() - 0.5) * 0.5) * 100) / 100;
    } else {
      impacts[stock.ticker] = Math.round(((Math.random() - 0.5) * 0.3) * 100) / 100;
    }
  }
  return impacts;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { stocks, roundNumber, usedTickers } = body as {
      stocks: { ticker: string; name: string; sector: string; subSector: string; beta: number; peRatio?: number; marketCap?: string; eps?: number; debtEbitda?: number }[];
      roundNumber: number;
      usedTickers: string[];
    };

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    if (!apiKey) {
      console.log("[company-news] No API key, falling back to hardcoded");
      return NextResponse.json({ headline: null, fallback: true });
    }

    // Read prompt from registry
    const { composed: effectivePrompt } = getEffectivePrompt("company_news");
    const model = getEffectiveModel("company_news");
    const activeVersion = getActivePrompt("company_news");
    const version = activeVersion?.version ?? 1;

    console.log(`[company-news] Using Company News Agent v${version}, model: ${model}`);

    const availableStocks = stocks.filter((s) => !usedTickers.includes(s.ticker));
    if (availableStocks.length === 0) {
      return NextResponse.json({ headline: null, fallback: true });
    }

    // Full stock context (PART 7)
    const stockSummary = stocks.map((s) =>
      `- ${s.ticker} (${s.name}) | Sector: ${s.sector}/${s.subSector} | Beta: ${s.beta}${s.peRatio ? ` | P/E: ${s.peRatio}` : ""}${s.marketCap ? ` | Mkt Cap: ${s.marketCap}` : ""}`
    ).join("\n");

    const availableTickers = availableStocks.map((s) => s.ticker).join(", ");
    const allTickers = stocks.map((s) => s.ticker).join(", ");

    const usedStr = usedTickers.length > 0
      ? `\nStocks already targeted this round (DO NOT use as target): ${usedTickers.join(", ")}`
      : "";

    // Round escalation guidance (PART 6)
    const escalation = roundNumber === 1
      ? "Round 1: Generate normal company news."
      : roundNumber === 2
        ? "Round 2: Generate dramatic company news."
        : "Round 3: Generate very dramatic company news — big moves, this is the finale.";

    const userMessage = `Generate 1 company-specific news event for Round ${roundNumber} of 3.
This is ROUND ${roundNumber} of 3. ${escalation}${usedStr}

STOCKS IN THIS MATCH:
${stockSummary}

Pick ONE target stock from the available tickers: ${availableTickers}
You MUST include ALL of these tickers in per_stock_impacts: ${allTickers}
The target stock gets the biggest impact. Same-sector stocks get sympathy moves. Others get minimal noise.

Return ONLY valid JSON — no markdown, no code fences, no explanation.`;

    const result = await callOpenRouter(apiKey, model, [
      { role: "system", content: effectivePrompt },
      { role: "user", content: userMessage },
    ], 512, 0.8);

    if (!result.content) {
      console.log("[company-news] API call failed, falling back to hardcoded");
      return NextResponse.json({ headline: null, fallback: true });
    }

    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const tickerAffected = parsed.target_ticker || parsed.tickerAffected;

        if (parsed.headline && tickerAffected) {
          // Validate ticker exists
          const validTicker = stocks.find((s) => s.ticker === tickerAffected);
          if (!validTicker) {
            console.log(`[company-news] Invalid ticker: ${tickerAffected}`);
            return NextResponse.json({ headline: null, fallback: true });
          }

          // Extract per_stock_impacts
          let perStockImpacts: Record<string, number> | null = parsed.per_stock_impacts || null;

          if (perStockImpacts) {
            // Fill missing tickers
            const missingTickers = stocks.filter((s) => perStockImpacts![s.ticker] === undefined);
            for (const s of missingTickers) {
              if (s.sector === validTicker.sector) {
                const sign = (parsed.direction === "NEGATIVE" || parsed.direction === "negative") ? -1 : 1;
                perStockImpacts[s.ticker] = Math.round(sign * 0.8 * s.beta * 100) / 100;
              } else {
                perStockImpacts[s.ticker] = Math.round((Math.random() - 0.5) * 0.2 * 100) / 100;
              }
            }

            // Clamp to severity bounds
            const severity = (parsed.severity || "MODERATE").toUpperCase();
            const maxAbs = SEVERITY_CLAMP[severity] || 8;
            for (const ticker of Object.keys(perStockImpacts)) {
              perStockImpacts[ticker] = Math.max(-maxAbs, Math.min(maxAbs, perStockImpacts[ticker]));
            }
          } else {
            console.log("[company-news] AI response missing per_stock_impacts, using fallback");
            perStockImpacts = generateFallbackImpacts(parsed.headline, tickerAffected, stocks);
          }

          // Build legacy sectorImpacts
          const sectorImpacts: Record<string, number> = parsed.sectorImpacts || {
            [validTicker.sector]: (perStockImpacts[tickerAffected] || 5) / 100,
          };

          console.log(`[company-news] Company News Agent generated: "${parsed.headline}" | Target: ${tickerAffected} | Severity: ${parsed.severity} | Impacts: ${JSON.stringify(perStockImpacts)}`);

          return NextResponse.json({
            headline: parsed.headline,
            category: parsed.category || "EARNINGS",
            tickerAffected,
            severity: parsed.severity || "MODERATE",
            direction: parsed.direction || "POSITIVE",
            sectorImpacts,
            per_stock_impacts: perStockImpacts,
            reasoning: parsed.reasoning || "",
            version,
            model,
            fallback: false,
          });
        }
      }
    } catch (e) {
      console.log("[company-news] Failed to parse response:", e);
    }

    return NextResponse.json({ headline: null, fallback: true });
  } catch (error) {
    console.error("[company-news] Error:", error);
    return NextResponse.json({ headline: null, fallback: true });
  }
}
