import { NextRequest, NextResponse } from "next/server";
import { getAgent, updateAgentModel } from "@/lib/db/agents";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const agent = getAgent(id);
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    const body = await request.json();
    const modelOverride = body.model || null;

    updateAgentModel(id, modelOverride);

    return NextResponse.json({ id, model_override: modelOverride });
  } catch (error) {
    console.error("Agent model update error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
