import { NextRequest, NextResponse } from "next/server";
import { getEffectivePrompt, getEffectiveModel } from "@/lib/agents/prompt-composer";
import { getActivePrompt } from "@/lib/db/agents";
import { parseAIResponse } from "@/lib/utils/parseAIResponse";

const FALLBACK_MODEL = "anthropic/claude-opus-4.6";

// Severity → max absolute % per stock
const SEVERITY_CLAMP: Record<string, number> = {
  LOW: 2, MODERATE: 4, HIGH: 7, EXTREME: 12,
};

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
        "X-Title": "Agent Colosseum - Macro News Agent",
      },
      body: JSON.stringify({ model: m, messages, max_tokens: maxTokens, temperature }),
    });
  };

  let res = await doCall(model);
  if (!res.ok && model !== FALLBACK_MODEL) {
    console.log(`[macro-news] ${model} failed, falling back to ${FALLBACK_MODEL}`);
    res = await doCall(FALLBACK_MODEL);
    if (!res.ok) return { content: null, error: "Both models failed" };
  }
  if (!res.ok) return { content: null, error: "Model failed" };
  const data = await res.json();
  return { content: data.choices?.[0]?.message?.content ?? null, usage: data.usage };
}

/** Fallback: derive per-stock impacts from headline sentiment + stock beta */
function generateFallbackImpacts(
  headline: string,
  stocks: { ticker: string; beta: number }[]
): Record<string, number> {
  const positiveWords = ["beats", "surges", "growth", "upgrade", "approval", "record", "boost", "stimulus", "cut", "expansion", "wins", "soars"];
  const negativeWords = ["misses", "crashes", "recession", "downgrade", "reject", "fraud", "tariff", "war", "inflation", "investigation", "recall", "slump"];

  let direction = 0;
  const lower = headline.toLowerCase();
  for (const word of positiveWords) if (lower.includes(word)) direction += 1;
  for (const word of negativeWords) if (lower.includes(word)) direction -= 1;

  const sign = direction >= 0 ? 1 : -1;
  const impacts: Record<string, number> = {};
  for (const stock of stocks) {
    const beta = stock.beta || 1.0;
    const noise = (Math.random() - 0.5) * 0.5;
    impacts[stock.ticker] = Math.round((2.0 * sign * beta + noise) * 100) / 100;
  }
  return impacts;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { stocks, roundNumber, usedHeadlines } = body as {
      stocks: { ticker: string; name: string; sector: string; beta: number; peRatio?: number; marketCap?: string; eps?: number; debtEbitda?: number }[];
      roundNumber: number;
      usedHeadlines: string[];
    };

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    if (!apiKey) {
      console.log("[macro-news] No API key, falling back to hardcoded");
      return NextResponse.json({ headline: null, fallback: true });
    }

    // Read prompt from registry
    const { composed: effectivePrompt } = getEffectivePrompt("macro_news");
    const model = getEffectiveModel("macro_news");
    const activeVersion = getActivePrompt("macro_news");
    const version = activeVersion?.version ?? 1;

    console.log(`[macro-news] Using Macro News Agent v${version}, model: ${model}`);

    // Full stock context (PART 7)
    const stockSummary = stocks.map((s) =>
      `- ${s.ticker} (${s.name}) | Sector: ${s.sector} | Beta: ${s.beta}${s.peRatio ? ` | P/E: ${s.peRatio}` : ""}${s.marketCap ? ` | Mkt Cap: ${s.marketCap}` : ""}${s.eps ? ` | EPS: ${s.eps}` : ""}`
    ).join("\n");

    const usedStr = usedHeadlines.length > 0
      ? `\nPrevious headlines (DO NOT repeat): ${usedHeadlines.join(" | ")}`
      : "";

    // Event escalation guidance
    const escalation = roundNumber <= 1
      ? "Event 1: Generate LOW to MODERATE severity events."
      : roundNumber <= 3
        ? `Event ${roundNumber}: Generate MODERATE to HIGH severity.`
        : `Event ${roundNumber}: Generate HIGH to EXTREME severity — make it dramatic, this is the finale.`;

    const allTickers = stocks.map((s) => s.ticker).join(", ");

    const userMessage = `Generate 1 macro-economic news headline for Event ${roundNumber} of 5.
This is EVENT ${roundNumber} of 5. ${escalation}${usedStr}

STOCKS IN THIS MATCH:
${stockSummary}

You MUST include ALL of these tickers in per_stock_impacts: ${allTickers}

REALISM GUIDE — per_stock_impacts values are PERCENTAGES (e.g. 2.5 means +2.5%):
- LOW severity: ±0.5 to ±2%
- MODERATE severity: ±1 to ±4%
- HIGH severity: ±2 to ±7%
- EXTREME severity: ±3 to ±12%
Higher-beta stocks should move more. Do NOT return values above ±12 for any stock.

Return ONLY valid JSON — no markdown, no code fences, no explanation.`;

    const result = await callOpenRouter(apiKey, model, [
      { role: "system", content: effectivePrompt },
      { role: "user", content: userMessage },
    ], 512, 0.8);

    if (!result.content) {
      console.log("[macro-news] API call failed, falling back to hardcoded");
      return NextResponse.json({ headline: null, fallback: true });
    }

    try {
      const parsed = parseAIResponse(result.content);
      if (parsed) {
        if (parsed.headline) {
          // Extract per_stock_impacts
          let perStockImpacts: Record<string, number> | null = parsed.per_stock_impacts || null;

          // Validate all tickers present
          if (perStockImpacts) {
            const missingTickers = stocks.filter((s) => perStockImpacts![s.ticker] === undefined);
            if (missingTickers.length > 0) {
              console.log(`[macro-news] Missing tickers in impacts: ${missingTickers.map((s) => s.ticker).join(", ")}`);
              // Fill missing with fallback
              for (const s of missingTickers) {
                const sign = (parsed.direction === "NEGATIVE" || parsed.direction === "negative") ? -1 : 1;
                perStockImpacts[s.ticker] = Math.round(sign * s.beta * 1.0 * 100) / 100;
              }
            }

            // Log RAW impacts, then clamp to severity bounds
            const severity = (parsed.severity || "MODERATE").toUpperCase();
            const maxAbs = SEVERITY_CLAMP[severity] || 4;
            const rawImpacts = { ...perStockImpacts };
            for (const ticker of Object.keys(perStockImpacts)) {
              perStockImpacts[ticker] = Math.max(-maxAbs, Math.min(maxAbs, perStockImpacts[ticker]));
            }
            // Log RAW vs CLAMPED for every stock
            const clamped = Object.keys(rawImpacts).filter(t => rawImpacts[t] !== perStockImpacts![t]);
            if (clamped.length > 0) {
              console.log(`[macro-news] CLAMPED (severity=${severity}, max=±${maxAbs}%): ${clamped.map(t => `${t} RAW:${rawImpacts[t].toFixed(1)}→CLAMPED:${perStockImpacts![t].toFixed(1)}`).join(", ")}`);
            } else {
              console.log(`[macro-news] No clamping needed (severity=${severity}, max=±${maxAbs}%)`);
            }
          } else {
            // No per_stock_impacts from AI — use fallback
            console.log("[macro-news] AI response missing per_stock_impacts, using fallback");
            perStockImpacts = generateFallbackImpacts(parsed.headline, stocks);
          }

          // Build legacy sectorImpacts for backward compat
          const sectorImpacts: Record<string, number> = parsed.sectorImpacts || {};

          console.log(`[macro-news] Macro News Agent generated: "${parsed.headline}" | Severity: ${parsed.severity} | Impacts: ${JSON.stringify(perStockImpacts)}`);

          return NextResponse.json({
            headline: parsed.headline,
            category: parsed.category || "ECONOMIC_DATA",
            severity: parsed.severity || "MODERATE",
            direction: parsed.direction || "MIXED",
            sectorImpacts,
            per_stock_impacts: perStockImpacts,
            reasoning: parsed.reasoning || "",
            version,
            model,
            fallback: false,
            usage: result.usage,
          });
        }
      }
    } catch (e) {
      console.log("[macro-news] Failed to parse response:", e);
    }

    return NextResponse.json({ headline: null, fallback: true });
  } catch (error) {
    console.error("[macro-news] Error:", error);
    return NextResponse.json({ headline: null, fallback: true });
  }
}
