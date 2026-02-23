import { NextResponse } from "next/server";
import { getAgentTree } from "@/lib/agents/prompt-composer";

export async function GET() {
  try {
    const tree = getAgentTree();
    return NextResponse.json({ tree });
  } catch (error) {
    console.error("Agents API error:", error);
    return NextResponse.json({ error: "Failed to load agents" }, { status: 500 });
  }
}
