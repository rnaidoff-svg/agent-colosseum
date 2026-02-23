import { NextRequest, NextResponse } from "next/server";
import { getAgent, createPromptVersion, activatePromptVersion, getPromptHistory } from "@/lib/db/agents";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const agent = getAgent(id);
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    const body = await request.json();

    if (body.activateVersion) {
      // Activate a specific version
      const result = activatePromptVersion(id, body.activateVersion);
      if (!result) return NextResponse.json({ error: "Version not found" }, { status: 404 });
      return NextResponse.json({ activated: result });
    }

    // Create new version
    const { promptText, notes } = body;
    if (!promptText) return NextResponse.json({ error: "promptText required" }, { status: 400 });

    const newVersion = createPromptVersion(id, promptText, notes || "Manual edit", "admin");
    const history = getPromptHistory(id);

    return NextResponse.json({ newVersion, history });
  } catch (error) {
    console.error("Agent prompt update error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
