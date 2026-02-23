// Default "Quick Pick" models — split by context.
// Battle picks = cheap/fast models for NPC and user agents in matches.
// Command picks = premium models for the admin Command Center.

export interface QuickPickModel {
  id: string;
  label: string;
}

// --- Battle quick picks (cheap / fast) ---
export const BATTLE_QUICK_PICKS: QuickPickModel[] = [
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek V3" },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { id: "x-ai/grok-3-mini", label: "Grok 3 Mini" },
];

// --- Command Center quick picks (premium) ---
export const COMMAND_QUICK_PICKS: QuickPickModel[] = [
  { id: "anthropic/claude-opus-4.6", label: "Claude Opus 4.6" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek V3" },
];

// Backwards compat: default export = battle picks (used by most consumers)
export const QUICK_PICK_MODELS = BATTLE_QUICK_PICKS;

export const FALLBACK_MODEL_ID = "anthropic/claude-opus-4.6";

// NPC default model assignments (battle-context)
export const NPC_DEFAULTS = [
  { name: "Momentum Trader", defaultModel: "google/gemini-2.5-flash" },
  { name: "Contrarian", defaultModel: "openai/gpt-4o-mini" },
  { name: "Sector Rotator", defaultModel: "deepseek/deepseek-chat" },
  { name: "Value Hunter", defaultModel: "x-ai/grok-3-mini" },
];
