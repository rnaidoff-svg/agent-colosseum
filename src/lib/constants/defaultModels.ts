// Default "Quick Pick" models — latest flagships from major providers.
// Edit this list to change the models shown as quick picks on the configure page.

export interface QuickPickModel {
  id: string;
  label: string;
}

export const QUICK_PICK_MODELS: QuickPickModel[] = [
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  { id: "anthropic/claude-opus-4.6", label: "Claude Opus 4.6" },
  { id: "openai/gpt-5.2", label: "GPT 5.2" },
  { id: "x-ai/grok-4", label: "Grok 4" },
  { id: "minimax/minimax-m2.5", label: "Minimax M2.5" },
];

export const FALLBACK_MODEL_ID = "anthropic/claude-opus-4.6";

// NPC default model assignments
export const NPC_DEFAULTS = [
  { name: "Momentum Trader", defaultModel: "google/gemini-3.1-pro-preview" },
  { name: "Contrarian", defaultModel: "openai/gpt-5.2" },
  { name: "Sector Rotator", defaultModel: "x-ai/grok-4" },
  { name: "Value Hunter", defaultModel: "minimax/minimax-m2.5" },
];
