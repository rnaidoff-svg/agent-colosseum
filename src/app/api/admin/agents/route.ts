import { NextRequest, NextResponse } from "next/server";
import { createNewAgent } from "@/lib/db/agents";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, rank, type, parentId, description, systemPrompt } = body;
    if (!id || !name || !parentId || !systemPrompt) {
      return NextResponse.json({ error: "id, name, parentId, and systemPrompt are required" }, { status: 400 });
    }

    const agent = createNewAgent(
      id,
      name,
      rank || "soldier",
      type || "trading",
      parentId,
      description || "",
      systemPrompt
    );
    return NextResponse.json({ agent });
  } catch (error) {
    console.error("Create agent error:", error);
    return NextResponse.json({ error: "Failed to create agent" }, { status: 500 });
  }
}
