import { NextRequest, NextResponse } from "next/server";
import { getAgent, updateAgentBattleModel } from "@/lib/db/agents";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const agent = getAgent(id);
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    const body = await request.json();
    const battleModel = body.model || null;

    updateAgentBattleModel(id, battleModel);

    return NextResponse.json({ id, battle_model: battleModel });
  } catch (error) {
    console.error("Agent battle model update error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
