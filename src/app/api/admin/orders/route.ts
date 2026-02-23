import { NextResponse } from "next/server";
import { getOrders } from "@/lib/db/agents";

export async function GET() {
  try {
    const orders = getOrders(50);
    return NextResponse.json({ orders });
  } catch (error) {
    console.error("Orders list error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
