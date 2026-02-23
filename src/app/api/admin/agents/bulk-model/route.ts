import { NextRequest, NextResponse } from "next/server";
import { updateAllAgentModels } from "@/lib/db/agents";

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { model } = body;
    if (!model) return NextResponse.json({ error: "model required" }, { status: 400 });

    updateAllAgentModels(model);

    return NextResponse.json({ model, updated: "all" });
  } catch (error) {
    console.error("Bulk model update error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
