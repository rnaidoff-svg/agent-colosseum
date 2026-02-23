import { NextRequest, NextResponse } from "next/server";
import { getEffectivePrompt, getEffectiveModel } from "@/lib/agents/prompt-composer";
import { getAgent } from "@/lib/db/agents";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const agent = getAgent(id);
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    const { composed, sections } = getEffectivePrompt(id);
    const effectiveModel = getEffectiveModel(id);

    return NextResponse.json({ composed, sections, effectiveModel });
  } catch (error) {
    console.error("Effective prompt error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
