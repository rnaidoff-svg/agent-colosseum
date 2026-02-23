import { NextRequest, NextResponse } from "next/server";

const FALLBACK_MODEL = "anthropic/claude-opus-4.6";

interface ArenaChatRequestBody {
  agent: {
    name: string;
    model: string;
    strategy: string;
    systemPrompt: string;
  };
  newsHeadline: string;
  recentMessages: { name: string; message: string }[];
  stocks: {
    ticker: string;
    sector: string;
    price: number;
    changePct: number;
  }[];
  standings: { name: string; pnl: number }[];
}

const FALLBACK_MESSAGES: Record<string, string[]> = {
  momentum: [
    "This market's moving fast -- just how I like it.",
    "Momentum's building. Time to ride the wave.",
    "First movers eat, hesitators starve.",
    "The trend is your friend. I'm all in.",
    "Speed wins in this game. Let's go.",
  ],
  contrarian: [
    "Everyone's panicking? Perfect buying opportunity.",
    "The crowd's always wrong at extremes. I'll fade this.",
    "Overbought signals everywhere. Time to go against the herd.",
    "Mean reversion incoming. Patience pays.",
    "When everyone zigs, I zag. Simple as that.",
  ],
  sector_rotation: [
    "Sector rotation in progress. Adjusting allocations.",
    "The data clearly favors a sector shift here.",
    "Diversification across sectors is key right now.",
    "Following the sector flows. The numbers don't lie.",
    "Methodical rebalancing beats emotional trading every time.",
  ],
  value: [
    "The fundamentals don't lie. This stock is mispriced.",
    "P/E ratio tells you everything. Everyone else is just guessing.",
    "Buying real value while the herd chases momentum.",
    "Debt levels on that stock are a red flag. Hard pass.",
    "Patience is the ultimate edge. The numbers always win.",
  ],
};

function getFallback(strategy: string): string {
  const msgs = FALLBACK_MESSAGES[strategy] || FALLBACK_MESSAGES.momentum;
  return msgs[Math.floor(Math.random() * msgs.length)];
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ArenaChatRequestBody;
    const { agent, newsHeadline, recentMessages, stocks, standings } = body;

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ message: getFallback(agent.strategy) });
    }

    const topStocks = [...stocks]
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      .slice(0, 3)
      .map((s) => `${s.ticker} ${s.changePct >= 0 ? "+" : ""}${(s.changePct * 100).toFixed(1)}%`)
      .join(", ");

    const recentChat = recentMessages.length > 0
      ? recentMessages.slice(-4).map((m) => `${m.name}: "${m.message}"`).join("\n")
      : "";

    const standingsSummary = standings
      .slice(0, 4)
      .map((s, i) => `${i + 1}. ${s.name}: ${s.pnl >= 0 ? "+" : ""}$${s.pnl.toFixed(0)}`)
      .join(", ");

    // Extract personality line from system prompt
    const personalityMatch = agent.systemPrompt.match(/PERSONALITY:(.+)/);
    const personality = personalityMatch ? personalityMatch[1].trim() : "";

    const chatPrompt = `You are "${agent.name}" in a competitive AI trading arena chat. Stay in character.

YOUR PERSONALITY: ${personality || agent.strategy}

BREAKING NEWS: "${newsHeadline}"
TOP MOVERS: ${topStocks}
STANDINGS: ${standingsSummary}
${recentChat ? `\nRECENT CHAT:\n${recentChat}` : ""}

Write a single short message (1-2 sentences max) reacting to the news or trash-talking other traders. Be colorful and in-character. No JSON, no formatting -- just your message as plain text.`;

    const doCall = async (m: string) => {
      return fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "Agent Colosseum",
        },
        body: JSON.stringify({
          model: m,
          messages: [
            { role: "system", content: chatPrompt },
            { role: "user", content: "Post your arena chat message now." },
          ],
          max_tokens: 100,
          temperature: 0.9,
        }),
      });
    };

    console.log(`[arena-chat] OpenRouter call: agent=${agent.name}, model=${agent.model}`);
    let res = await doCall(agent.model);
    console.log(`[arena-chat] OpenRouter response: agent=${agent.name}, model=${agent.model}, status=${res.status}`);
    if (!res.ok) {
      console.error(`Arena chat error for ${agent.name} (${agent.model}): ${res.status}`);
      if (agent.model !== FALLBACK_MODEL) {
        res = await doCall(FALLBACK_MODEL);
        if (!res.ok) {
          return NextResponse.json({ message: getFallback(agent.strategy) });
        }
      } else {
        return NextResponse.json({ message: getFallback(agent.strategy) });
      }
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    if (content && content.length > 0 && content.length < 300) {
      // Strip any quotes wrapping the message
      const cleaned = content.replace(/^["']|["']$/g, "");
      return NextResponse.json({ message: cleaned });
    }

    return NextResponse.json({ message: getFallback(agent.strategy) });
  } catch (error) {
    console.error("Arena chat error:", error);
    return NextResponse.json({ message: getFallback("momentum") });
  }
}
