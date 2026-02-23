import { NextRequest, NextResponse } from "next/server";
import { getSystemConfig, setSystemConfig } from "@/lib/db/agents";

export async function GET() {
  try {
    const model = getSystemConfig("system_model") || "google/gemini-2.5-flash";
    return NextResponse.json({ model });
  } catch (error) {
    console.error("System model GET error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { model } = body;
    if (!model) return NextResponse.json({ error: "model required" }, { status: 400 });

    setSystemConfig("system_model", model);
    return NextResponse.json({ model });
  } catch (error) {
    console.error("System model PUT error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
