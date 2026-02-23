import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// In-memory cache: { data, timestamp }
let cache: { data: OpenRouterModel[]; timestamp: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

interface OpenRouterModelRaw {
  id: string;
  name: string;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  context_length?: number;
  architecture?: {
    modality?: string;
  };
}

interface OpenRouterModel {
  id: string;
  name: string;
  provider: string;
  pricing: {
    input: number;  // per million tokens
    output: number; // per million tokens
  };
  contextWindow: number;
  isFree: boolean;
}

function parseModel(raw: OpenRouterModelRaw): OpenRouterModel {
  const parts = raw.id.split("/");
  const provider = parts.length > 1 ? parts[0] : "unknown";

  const inputPerToken = parseFloat(raw.pricing?.prompt || "0");
  const outputPerToken = parseFloat(raw.pricing?.completion || "0");

  // Convert from per-token to per-million-tokens for display
  const inputPerMillion = inputPerToken * 1_000_000;
  const outputPerMillion = outputPerToken * 1_000_000;

  const isFree = inputPerMillion === 0 && outputPerMillion === 0;

  return {
    id: raw.id,
    name: raw.name || raw.id,
    provider,
    pricing: {
      input: Math.round(inputPerMillion * 100) / 100,
      output: Math.round(outputPerMillion * 100) / 100,
    },
    contextWindow: raw.context_length || 0,
    isFree,
  };
}

async function fetchModels(): Promise<OpenRouterModel[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("[models] No OPENROUTER_API_KEY found");
    return [];
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      console.error(`[models] OpenRouter API returned ${res.status}`);
      return [];
    }

    const json = await res.json();
    const rawModels: OpenRouterModelRaw[] = json.data || [];

    // Filter to text models only, parse and sort
    const models = rawModels
      .filter((m) => {
        // Skip image/audio-only models
        const modality = m.architecture?.modality || "";
        if (modality === "image" || modality === "audio") return false;
        return true;
      })
      .map(parseModel);

    // Sort: free first, then by input price ascending
    models.sort((a, b) => {
      if (a.isFree && !b.isFree) return -1;
      if (!a.isFree && b.isFree) return 1;
      return a.pricing.input - b.pricing.input;
    });

    return models;
  } catch (err) {
    console.error("[models] Failed to fetch from OpenRouter:", err);
    return [];
  }
}

export async function GET() {
  const now = Date.now();

  // Return cached data if fresh
  if (cache && now - cache.timestamp < CACHE_TTL) {
    return NextResponse.json({ models: cache.data, cached: true });
  }

  const models = await fetchModels();

  if (models.length > 0) {
    cache = { data: models, timestamp: now };
  }

  return NextResponse.json({ models, cached: false });
}
