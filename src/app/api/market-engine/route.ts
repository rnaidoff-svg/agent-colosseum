import { NextRequest, NextResponse } from "next/server";
import { getEffectivePrompt, getEffectiveModel } from "@/lib/agents/prompt-composer";
import { getActivePrompt } from "@/lib/db/agents";

const FALLBACK_MODEL = "anthropic/claude-opus-4.6";

interface MarketEngineRequestBody {
  newsHeadline: string;
  stocks: {
    ticker: string;
    name: string;
    sector: string;
    beta: number;
    price: number;
    startPrice: number;
    changePct: number;
  }[];
  sectorImpacts: Record<string, number>;
}

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
        "X-Title": "Agent Colosseum",
      },
      body: JSON.stringify({ model: m, messages, max_tokens: maxTokens, temperature }),
    });
  };

  console.log(`[market-engine] OpenRouter call: model=${model}`);
  let res = await doCall(model);
  console.log(`[market-engine] OpenRouter response: model=${model}, status=${res.status}`);
  if (!res.ok) {
    const errText = await res.text();
    console.error(`Market engine OpenRouter error (model: ${model}, status: ${res.status}):`, errText);

    if (model !== FALLBACK_MODEL) {
      console.log(`Market engine retrying with fallback: ${FALLBACK_MODEL}`);
      res = await doCall(FALLBACK_MODEL);
      if (!res.ok) {
        const fallbackErr = await res.text();
        console.error(`Market engine fallback failed (${FALLBACK_MODEL}, status: ${res.status}):`, fallbackErr);
        return { content: null, error: "Both models failed" };
      }
      const data = await res.json();
      return { content: data.choices?.[0]?.message?.content ?? null };
    }

    return { content: null, error: errText };
  }

  const data = await res.json();
  return { content: data.choices?.[0]?.message?.content ?? null };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as MarketEngineRequestBody;
    const { newsHeadline, stocks, sectorImpacts } = body;

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ targets: null });
    }

    // Read prompt and model from registry
    const { composed: registryPrompt } = getEffectivePrompt("market_engine");
    const registryModel = getEffectiveModel("market_engine");
    const activeVersion = getActivePrompt("market_engine");
    const version = activeVersion?.version ?? 1;

    console.log(`[market-engine] Using Market Engine Agent v${version}, model: ${registryModel}`);

    const stockSummary = stocks
      .map((s) => `${s.ticker} "${s.name}" (${s.sector}) $${s.price.toFixed(2)} [${s.changePct >= 0 ? "+" : ""}${(s.changePct * 100).toFixed(1)}% from start] beta:${s.beta}`)
      .join("\n");

    const impactSummary = Object.entries(sectorImpacts)
      .filter(([s]) => s !== "index")
      .map(([sector, impact]) => `${sector}: ${impact > 0 ? "+" : ""}${(impact * 100).toFixed(1)}%`)
      .join(", ");

    const contextPrompt = `${registryPrompt}

NEWS EVENT: "${newsHeadline}"
SECTOR IMPACTS: ${impactSummary}

CURRENT STOCKS:
${stockSummary}`;

    const result = await callOpenRouter(apiKey, registryModel, [
      { role: "system", content: contextPrompt },
      { role: "user", content: "Predict the price changes. Respond with JSON only." },
    ], 256, 0.5);

    if (!result.content) {
      return NextResponse.json({ targets: null });
    }

    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const validTickers = new Set(stocks.map((s) => s.ticker));
        const targets: Record<string, number> = {};

        for (const [ticker, value] of Object.entries(parsed)) {
          if (validTickers.has(ticker) && typeof value === "number") {
            // Clamp to reasonable range
            targets[ticker] = Math.max(-0.15, Math.min(0.15, value));
          }
        }

        if (Object.keys(targets).length > 0) {
          console.log(`[market-engine] Market Engine Agent (from registry) price impacts: ${Object.entries(targets).map(([t, v]) => `${t} ${(v as number) >= 0 ? "+" : ""}${((v as number) * 100).toFixed(1)}%`).join(", ")}`);
          return NextResponse.json({ targets });
        }
      }
    } catch {
      console.log("[market-engine] Failed to parse response, falling back");
    }

    console.log("[market-engine] Falling back to hardcoded behavior for Market Engine Agent");
    return NextResponse.json({ targets: null });
  } catch (error) {
    console.error("Market engine error:", error);
    return NextResponse.json({ targets: null });
  }
}
