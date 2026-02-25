import { NextRequest, NextResponse } from "next/server";
import { getSystemConfig, setSystemConfig } from "@/lib/db/agents";

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing 'key' parameter" }, { status: 400 });
  }
  const value = getSystemConfig(key);
  return NextResponse.json({ key, value: value ?? "false" });
}

export async function PUT(request: NextRequest) {
  try {
    const { key, value } = await request.json();
    if (!key || value === undefined) {
      return NextResponse.json({ error: "Missing 'key' or 'value'" }, { status: 400 });
    }
    setSystemConfig(key, String(value));
    return NextResponse.json({ key, value: String(value) });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
