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
  return { content: data.choices?.[0]?.message?.content ?? null };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { stocks, roundNumber, usedHeadlines } = body as {
      stocks: { ticker: string; name: string; sector: string; beta: number }[];
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

    const stockSummary = stocks.map((s) =>
      `${s.ticker} "${s.name}" (${s.sector}) beta:${s.beta}`
    ).join("\n");

    const usedStr = usedHeadlines.length > 0
      ? `\nPrevious headlines (DO NOT repeat): ${usedHeadlines.join(" | ")}`
      : "";

    const userMessage = `Generate 1 macro-economic news headline for Round ${roundNumber} of 5.${usedStr}

STOCKS IN THIS MATCH:
${stockSummary}

Respond with ONLY a JSON object:
{"headline": "the headline text", "category": "CATEGORY_TAG", "sectorImpacts": {"tech": 0.05, "energy": -0.03, ...}}

Categories: FED_RATE, EARNINGS, SECTOR, CRISIS, REGULATION, PRODUCT_LAUNCH, SCANDAL, ECONOMIC_DATA, ANALYST_ACTION, MERGER_ACQUISITION, GEOPOLITICAL
Sector impact values should be decimals (e.g., 0.05 for +5%, -0.03 for -3%).
Round ${roundNumber}/5 — ${roundNumber <= 2 ? "mild news" : roundNumber <= 3 ? "moderate news" : "dramatic/chaotic news"}.`;

    const result = await callOpenRouter(apiKey, model, [
      { role: "system", content: effectivePrompt },
      { role: "user", content: userMessage },
    ], 256, 0.8);

    if (!result.content) {
      console.log("[macro-news] API call failed, falling back to hardcoded");
      return NextResponse.json({ headline: null, fallback: true });
    }

    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.headline && parsed.sectorImpacts) {
          console.log(`[macro-news] Macro News Agent (from registry) generated: ${parsed.headline}`);
          return NextResponse.json({
            headline: parsed.headline,
            category: parsed.category || "ECONOMIC_DATA",
            sectorImpacts: parsed.sectorImpacts,
            version,
            model,
            fallback: false,
          });
        }
      }
    } catch {
      console.log("[macro-news] Failed to parse response, falling back");
    }

    return NextResponse.json({ headline: null, fallback: true });
  } catch (error) {
    console.error("[macro-news] Error:", error);
    return NextResponse.json({ headline: null, fallback: true });
  }
}
