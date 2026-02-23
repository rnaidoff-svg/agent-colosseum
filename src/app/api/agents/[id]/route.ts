import { NextRequest, NextResponse } from "next/server";
import { getAgent, getActivePrompt, getPromptHistory, getOrdersForAgent } from "@/lib/db/agents";
import { getEffectiveModel } from "@/lib/agents/prompt-composer";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const agent = getAgent(id);
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    const activePrompt = getActivePrompt(id);
    const history = getPromptHistory(id);
    const effectiveModel = getEffectiveModel(id);
    const relatedOrders = getOrdersForAgent(id, 10);

    return NextResponse.json({
      agent,
      activePrompt,
      history,
      effectiveModel,
      relatedOrders,
    });
  } catch (error) {
    console.error("Agent detail error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
