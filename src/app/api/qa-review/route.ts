import { NextRequest } from "next/server";
import { getAgent } from "@/lib/db/agents";
import { getEffectiveModel } from "@/lib/agents/prompt-composer";

const FALLBACK_MODEL = "anthropic/claude-opus-4.6";

const SUMMARY_SYSTEM_PROMPT = `You are the Trade Reviewer performing a full-round summary analysis.

You will receive the QA results from all events in a battle round. Your job is to:

1. Aggregate results — how many trades passed vs failed, how many market engine checks passed vs failed
2. Identify patterns — which agents consistently fail? Which market scenarios cause issues?
3. Produce specific, actionable recommendations for improving agent prompts

Think through your analysis step by step, showing your reasoning.

After your reasoning, output a JSON block wrapped in \`\`\`json fences:
\`\`\`json
{
  "recommendations": [
    { "agentId": "momentum_trader", "issue": "Went long on negative news in 2/3 macro events", "suggestedChange": "Add rule: check news direction before entering — negative macro = consider SHORT or hold" },
    { "agentId": "market_engine", "issue": "SPY moves consistently 2x intended impact", "suggestedChange": "Reduce SPY sensitivity multiplier" }
  ],
  "overallVerdict": "NEEDS IMPROVEMENT",
  "summary": "3/5 events had trade failures. Momentum Trader struggled with macro events. Market engine was accurate."
}
\`\`\`

Rules:
- Only include recommendations for agents that actually had issues
- Be specific about what to change in the prompt
- overallVerdict should be one of: EXCELLENT, GOOD, NEEDS IMPROVEMENT, POOR
- If everything passed, say so and provide no recommendations`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { eventIndex, eventData, enrichedDecisions, roundSnapshot, allEventResults, mode } = body as {
      eventIndex?: number;
      eventData?: Record<string, unknown>;
      enrichedDecisions?: Record<string, unknown>[];
      roundSnapshot?: Record<string, unknown>;
      allEventResults?: Record<string, unknown>[];
      mode: "event" | "summary";
    };

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "No API key configured" }), { status: 500 });
    }

    // Load Trade Reviewer agent
    const agent = getAgent("trade_reviewer");
    if (!agent) {
      return new Response(JSON.stringify({ error: "Trade Reviewer agent not found" }), { status: 500 });
    }

    const model = getEffectiveModel("trade_reviewer");
    let systemPrompt: string;
    let userMessage: string;

    if (mode === "event") {
      systemPrompt = agent.system_prompt;
      userMessage = buildEventMessage(eventIndex ?? 0, eventData, enrichedDecisions, roundSnapshot);
    } else {
      systemPrompt = SUMMARY_SYSTEM_PROMPT;
      userMessage = buildSummaryMessage(allEventResults);
    }

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    // Call OpenRouter with streaming
    const orResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Agent Colosseum - QA Review",
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_tokens: 1500,
        temperature: 0.3,
      }),
    });

    if (!orResponse.ok) {
      // Retry with fallback model
      if (model !== FALLBACK_MODEL) {
        const fallbackResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "Agent Colosseum - QA Review",
          },
          body: JSON.stringify({
            model: FALLBACK_MODEL,
            messages,
            stream: true,
            max_tokens: 1500,
            temperature: 0.3,
          }),
        });
        if (!fallbackResponse.ok || !fallbackResponse.body) {
          return new Response(JSON.stringify({ error: "Both models failed" }), { status: 502 });
        }
        return createSSEResponse(fallbackResponse.body);
      }
      return new Response(JSON.stringify({ error: "Model failed" }), { status: 502 });
    }

    if (!orResponse.body) {
      return new Response(JSON.stringify({ error: "No response body" }), { status: 502 });
    }

    return createSSEResponse(orResponse.body);
  } catch (error) {
    console.error("QA Review API error:", error);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
}

function createSSEResponse(upstreamBody: ReadableStream<Uint8Array>): Response {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let fullContent = "";

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstreamBody.getReader();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "token", content: delta })}\n\n`)
                );
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }

        // Parse the final JSON result from the full content
        const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)```/);
        if (jsonMatch) {
          try {
            const result = JSON.parse(jsonMatch[1].trim());
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "result", content: result })}\n\n`)
            );
          } catch {
            // JSON parse failed — send raw content as result
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "result", content: null, raw: fullContent })}\n\n`)
            );
          }
        } else {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "result", content: null, raw: fullContent })}\n\n`)
          );
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        controller.close();
      } catch (err) {
        console.error("SSE stream error:", err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", message: "Stream error" })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function buildEventMessage(
  eventIndex: number,
  eventData: Record<string, unknown> | undefined,
  decisions: Record<string, unknown>[] | undefined,
  snapshot: Record<string, unknown> | undefined
): string {
  const parts: string[] = [];

  parts.push(`## Event ${eventIndex + 1} Analysis\n`);

  if (eventData) {
    parts.push(`### News Event`);
    parts.push(`- Headline: ${eventData.headline || "Unknown"}`);
    parts.push(`- Type: ${eventData.newsType || "Unknown"}`);
    parts.push(`- Severity: ${eventData.severity || "Unknown"}`);
    parts.push(`- Direction: ${eventData.direction || "Unknown"}`);
    if (eventData.category) parts.push(`- Category: ${eventData.category}`);
    parts.push("");
  }

  if (snapshot) {
    const snapEvents = snapshot.events as Array<{
      pricesBefore: Record<string, number>;
      pricesAfter: Record<string, number>;
      intendedImpacts?: Record<string, number>;
    }> | undefined;
    const snapEvt = snapEvents?.[eventIndex];
    if (snapEvt) {
      parts.push(`### Price Movements`);
      const tickers = Object.keys(snapEvt.pricesAfter || {});
      for (const ticker of tickers) {
        const before = snapEvt.pricesBefore?.[ticker];
        const after = snapEvt.pricesAfter?.[ticker];
        if (before !== undefined && after !== undefined) {
          const actualPct = ((after - before) / before) * 100;
          const intended = snapEvt.intendedImpacts?.[ticker];
          parts.push(`- ${ticker}: $${before.toFixed(2)} -> $${after.toFixed(2)} (${actualPct >= 0 ? "+" : ""}${actualPct.toFixed(2)}%)${intended !== undefined ? ` [intended: ${intended >= 0 ? "+" : ""}${intended.toFixed(2)}%]` : ""}`);
        }
      }
      parts.push("");
    }
  }

  if (decisions && decisions.length > 0) {
    parts.push(`### Agent Trades`);
    for (const d of decisions) {
      const pnl = d.pnlFromTrade as number | undefined;
      const correct = d.wasCorrect as number | undefined;
      parts.push(`- ${d.agentName}: ${d.actionTaken} ${d.qty}x ${d.ticker} @ $${(d.price as number)?.toFixed(2)}${pnl !== undefined ? ` -> P&L: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}% (${correct === 1 ? "correct" : "incorrect"})` : ""}`);
    }
    parts.push("");
  } else {
    parts.push(`### Agent Trades\nNo trades were made for this event.\n`);
  }

  return parts.join("\n");
}

function buildSummaryMessage(allEventResults: Record<string, unknown>[] | undefined): string {
  if (!allEventResults || allEventResults.length === 0) {
    return "No event results to summarize.";
  }

  const parts: string[] = [];
  parts.push("## Full Round QA Results\n");

  for (let i = 0; i < allEventResults.length; i++) {
    const result = allEventResults[i];
    parts.push(`### Event ${i + 1}`);

    if (result.marketEngineVerdict) {
      parts.push(`Market Engine: ${result.marketEngineVerdict}${result.marketEngineNote ? ` — ${result.marketEngineNote}` : ""}`);
    }

    const trades = result.trades as Array<{ agent: string; ticker: string; action: string; verdict: string; reason: string }> | undefined;
    if (trades && trades.length > 0) {
      for (const t of trades) {
        parts.push(`- ${t.agent} ${t.action} ${t.ticker}: ${t.verdict} — ${t.reason}`);
      }
    } else {
      parts.push("- No trade results");
    }
    parts.push("");
  }

  parts.push("Please analyze patterns across all events and provide recommendations.");
  return parts.join("\n");
}
