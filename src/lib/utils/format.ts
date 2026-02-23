// Currency, percentage, and price formatters

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactCurrencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatCurrency(value: number): string {
  return currencyFmt.format(value);
}

export function formatCompactCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return compactCurrencyFmt.format(value);
}

export function formatPrice(value: number): string {
  return value.toFixed(2);
}

export function formatPct(value: number): string {
  const pct = value * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatPnl(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${formatCurrency(value)}`;
}

// ------ Model label lookup ------

const MODEL_LABELS: Record<string, string> = {
  // Battle quick picks
  "google/gemini-2.5-flash": "Gemini 2.5 Flash",
  "openai/gpt-4o-mini": "GPT-4o Mini",
  "deepseek/deepseek-chat": "DeepSeek V3",
  "anthropic/claude-haiku-4.5": "Claude Haiku 4.5",
  "x-ai/grok-3-mini": "Grok 3 Mini",
  // Command Center quick picks
  "anthropic/claude-opus-4.6": "Claude Opus 4.6",
  "google/gemini-2.5-pro": "Gemini 2.5 Pro",
  "openai/gpt-4o": "GPT-4o",
  "anthropic/claude-sonnet-4": "Claude Sonnet 4",
  // Other known models
  "google/gemini-2.0-flash-001": "Gemini 2.0 Flash",
  "anthropic/claude-sonnet-4-20250514": "Claude Sonnet 4",
  "anthropic/claude-3.5-haiku": "Claude 3.5 Haiku",
  "anthropic/claude-3-haiku": "Claude 3 Haiku",
  "x-ai/grok-3": "Grok 3",
  "meta-llama/llama-3.3-70b-instruct:free": "Llama 3.3 70B",
  "deepseek/deepseek-v3-base:free": "DeepSeek V3 Base",
  "qwen/qwen3-235b-a22b:free": "Qwen 235B",
};

export function getModelLabel(modelId: string): string {
  if (MODEL_LABELS[modelId]) return MODEL_LABELS[modelId];
  // Fallback: strip provider prefix, return model name portion
  const parts = modelId.split("/");
  const raw = parts.length > 1 ? parts[parts.length - 1] : modelId;
  // Clean up common suffixes
  return raw
    .replace(/:free$/, "")
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
