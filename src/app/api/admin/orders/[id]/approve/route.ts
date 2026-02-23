import { NextRequest, NextResponse } from "next/server";
import { getOrder, getAgent, updateOrder, createPromptVersion, createNewAgent, deactivateAgent } from "@/lib/db/agents";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orderId = parseInt(id);
    const order = getOrder(orderId);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.status === "executed") return NextResponse.json({ error: "Already executed" }, { status: 400 });
    if (order.status === "rejected") return NextResponse.json({ error: "Already rejected" }, { status: 400 });

    // Optional body: approve specific agents only
    let specificAgentIds: string[] | null = null;
    try {
      const body = await request.json();
      if (body.agentIds && Array.isArray(body.agentIds)) {
        specificAgentIds = body.agentIds;
      }
    } catch {
      // No body — approve all
    }

    const proposedChanges = order.proposed_changes ? JSON.parse(order.proposed_changes) : [];
    if (proposedChanges.length === 0) {
      return NextResponse.json({ error: "No changes to approve" }, { status: 400 });
    }

    // Look up the lieutenant that proposed the changes
    const ltId = order.lieutenant_id || "general";
    const ltAgent = order.lieutenant_id ? getAgent(order.lieutenant_id) : null;
    const ltName = ltAgent?.name || ltId;

    const approved: string[] = [];
    for (const change of proposedChanges) {
      if (specificAgentIds && !specificAgentIds.includes(change.agent_id)) continue;
      if (change.action === "create_agent") {
        // Create a new agent from proposal
        try {
          createNewAgent(
            change.agent_id, change.agent_name, change.rank || "soldier",
            change.type || "trading", change.parent_id || "general",
            change.description || "", change.new_prompt
          );
        } catch (err) {
          console.error(`Failed to create agent ${change.agent_id}:`, err);
          continue;
        }
      } else if (change.action === "delete_agent") {
        // Deactivate (soft-delete) an agent
        const success = deactivateAgent(change.agent_id);
        if (!success) {
          console.error(`Failed to deactivate agent ${change.agent_id}`);
          continue;
        }
      } else {
        const notes = `Updated via Order #${orderId} from ${ltName}`;
        createPromptVersion(change.agent_id, change.new_prompt, notes, ltId);
      }
      approved.push(change.agent_id);
    }

    // Only mark fully executed if all changes approved (or no specific filter)
    if (!specificAgentIds || approved.length === proposedChanges.length) {
      updateOrder(orderId, {
        status: "executed",
        executed_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({ approved, status: specificAgentIds && approved.length < proposedChanges.length ? "partial" : "executed" });
  } catch (error) {
    console.error("Approve order error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
