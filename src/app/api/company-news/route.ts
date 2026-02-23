import { NextRequest, NextResponse } from "next/server";
import { getEffectivePrompt, getEffectiveModel } from "@/lib/agents/prompt-composer";
import { getActivePrompt } from "@/lib/db/agents";

const FALLBACK_MODEL = "google/gemini-2.5-flash";

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { stocks, roundNumber, usedTickers } = body as {
      stocks: { ticker: string; name: string; sector: string; subSector: string; beta: number }[];
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

    const stockSummary = availableStocks.map((s) =>
      `${s.ticker} "${s.name}" (${s.sector}/${s.subSector}) beta:${s.beta}`
    ).join("\n");

    const usedStr = usedTickers.length > 0
      ? `\nStocks already targeted this round (DO NOT use): ${usedTickers.join(", ")}`
      : "";

    const userMessage = `Generate 1 company-specific news event for Round ${roundNumber} of 5.${usedStr}

AVAILABLE STOCKS:
${stockSummary}

Pick ONE stock and generate news about it. Respond with ONLY a JSON object:
{"headline": "the headline text", "category": "CATEGORY_TAG", "tickerAffected": "TICKER", "sectorImpacts": {"sectorName": 0.08, ...}}

The primary stock should have a 5-10% impact. Cross-sector effects should be 1-2%.
Categories: EARNINGS, REGULATION, PRODUCT_LAUNCH, SCANDAL, ANALYST_ACTION, MERGER_ACQUISITION, CRISIS
Round ${roundNumber}/5 — ${roundNumber <= 2 ? "normal company news" : "dramatic company news"}.`;

    const result = await callOpenRouter(apiKey, model, [
      { role: "system", content: effectivePrompt },
      { role: "user", content: userMessage },
    ], 256, 0.8);

    if (!result.content) {
      console.log("[company-news] API call failed, falling back to hardcoded");
      return NextResponse.json({ headline: null, fallback: true });
    }

    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.headline && parsed.tickerAffected && parsed.sectorImpacts) {
          // Validate ticker exists
          const validTicker = stocks.find((s) => s.ticker === parsed.tickerAffected);
          if (validTicker) {
            console.log(`[company-news] Company News Agent (from registry) generated: ${parsed.headline}`);
            return NextResponse.json({
              headline: parsed.headline,
              category: parsed.category || "EARNINGS",
              tickerAffected: parsed.tickerAffected,
              sectorImpacts: parsed.sectorImpacts,
              version,
              model,
              fallback: false,
            });
          }
        }
      }
    } catch {
      console.log("[company-news] Failed to parse response, falling back");
    }

    return NextResponse.json({ headline: null, fallback: true });
  } catch (error) {
    console.error("[company-news] Error:", error);
    return NextResponse.json({ headline: null, fallback: true });
  }
}
