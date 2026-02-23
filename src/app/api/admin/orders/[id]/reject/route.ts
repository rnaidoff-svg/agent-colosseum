import { NextRequest, NextResponse } from "next/server";
import { getOrder, updateOrder } from "@/lib/db/agents";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orderId = parseInt(id);
    const order = getOrder(orderId);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.status === "executed") return NextResponse.json({ error: "Already executed" }, { status: 400 });

    updateOrder(orderId, { status: "rejected" });
    return NextResponse.json({ status: "rejected" });
  } catch (error) {
    console.error("Reject order error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
