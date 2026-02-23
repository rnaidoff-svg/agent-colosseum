// Default "Quick Pick" models — latest flagships from major providers.
// Edit this list to change the models shown as quick picks on the configure page.

export interface QuickPickModel {
  id: string;
  label: string;
}

export const QUICK_PICK_MODELS: QuickPickModel[] = [
  { id: "anthropic/claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek V3" },
  { id: "x-ai/grok-4-fast", label: "Grok 4 Fast" },
];

export const FALLBACK_MODEL_ID = "google/gemini-2.5-flash";

// NPC default model assignments
export const NPC_DEFAULTS = [
  { name: "Momentum Trader", defaultModel: "google/gemini-2.5-flash" },
  { name: "Contrarian", defaultModel: "deepseek/deepseek-chat" },
  { name: "Sector Rotator", defaultModel: "openai/gpt-4o-mini" },
  { name: "Value Hunter", defaultModel: "anthropic/claude-sonnet-4-20250514" },
];
