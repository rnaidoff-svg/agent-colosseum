/**
 * Robust AI/LLM response JSON parser.
 *
 * Handles all common LLM formatting issues:
 *  - Markdown code fences (```json ... ```)
 *  - Text before/after JSON ("Here is the result: { ... } Hope that helps!")
 *  - Trailing commas in objects/arrays
 *  - Single quotes instead of double quotes
 *  - Unquoted property keys
 *  - Nested JSON objects
 *  - JSON arrays (stocks route returns [...])
 */

export interface ParseOptions {
  /** Expected top-level type: "object" (default) or "array" */
  type?: "object" | "array";
  /** If set, prefer an object containing this key (e.g. "trades", "changes") */
  requiredKey?: string;
}

/**
 * Parse an AI/LLM response string into a JSON value.
 * Returns null if parsing fails after all recovery attempts.
 *
 * Return type mirrors JSON.parse() — callers access fields freely
 * without needing explicit casts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseAIResponse(
  rawResponse: string | null | undefined,
  options?: ParseOptions,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any | null {
  if (!rawResponse || typeof rawResponse !== "string") return null;

  let text = rawResponse.trim();
  if (text.length === 0) return null;

  // ── Step 1: Strip markdown code fences ───────────────────────
  // Handles ```json, ```typescript, ```js, or plain ```
  const fenceMatch = text.match(/```(?:json|typescript|js|javascript)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // ── Step 2: Locate the JSON substring ────────────────────────
  const wantArray = options?.type === "array";
  const requiredKey = options?.requiredKey;

  const jsonStr = locateJson(text, wantArray, requiredKey);
  if (!jsonStr) return null;

  // ── Step 3: Try direct parse ─────────────────────────────────
  const direct = tryParse(jsonStr);
  if (direct !== null) return direct;

  // ── Step 4: Fix trailing commas  { a: 1, } → { a: 1 }  ─────
  let fixed = fixTrailingCommas(jsonStr);
  const afterCommas = tryParse(fixed);
  if (afterCommas !== null) return afterCommas;

  // ── Step 5: Fix single quotes  'key' → "key"  ───────────────
  fixed = fixSingleQuotes(jsonStr);
  fixed = fixTrailingCommas(fixed);
  const afterQuotes = tryParse(fixed);
  if (afterQuotes !== null) return afterQuotes;

  // ── Step 6: Fix unquoted keys  { key: "val" } → { "key": "val" }
  fixed = fixUnquotedKeys(jsonStr);
  fixed = fixTrailingCommas(fixed);
  const afterKeys = tryParse(fixed);
  if (afterKeys !== null) return afterKeys;

  // ── Step 7: Nuclear option — all fixes combined ──────────────
  fixed = fixUnquotedKeys(fixSingleQuotes(fixTrailingCommas(jsonStr)));
  const nuclear = tryParse(fixed);
  if (nuclear !== null) return nuclear;

  return null;
}

// ── Helpers ────────────────────────────────────────────────────

function locateJson(text: string, wantArray: boolean, requiredKey?: string): string | null {
  if (wantArray) {
    // Find outermost array
    const m = text.match(/\[[\s\S]*\]/);
    return m ? m[0] : null;
  }

  // If a required key is specified, prefer an object that contains it
  if (requiredKey) {
    const keyRe = new RegExp(`\\{[\\s\\S]*"${escapeRegex(requiredKey)}"[\\s\\S]*\\}`);
    const keyMatch = text.match(keyRe);
    if (keyMatch) return keyMatch[0];
  }

  // Fall back to outermost { ... }
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tryParse(str: string): any | null {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function fixTrailingCommas(s: string): string {
  return s.replace(/,\s*([}\]])/g, "$1");
}

function fixSingleQuotes(s: string): string {
  // Only replace single quotes that look like they're used as string delimiters.
  // This is a best-effort heuristic — replace ' around keys/values.
  return s.replace(/'/g, '"');
}

function fixUnquotedKeys(s: string): string {
  // Match { key: or , key: where key is unquoted
  return s.replace(/([\{,])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
