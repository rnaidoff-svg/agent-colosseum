import { NextResponse } from "next/server";
import { getAllAgents } from "@/lib/db/agents";

export const dynamic = "force-dynamic";

export async function GET() {
  const agents = getAllAgents();
  const trading = agents
    .filter((a) => a.type === "trading" && a.is_active === 1 && a.rank === "soldier" && a.id !== "custom_wrapper")
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description || "",
      model: a.battle_model || "google/gemini-2.5-flash",
    }));

  return NextResponse.json({ agents: trading });
}
