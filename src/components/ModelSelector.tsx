"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { QUICK_PICK_MODELS } from "@/lib/constants/defaultModels";
import { getModelLabel } from "@/lib/utils/format";

interface OpenRouterModel {
  id: string;
  name: string;
  provider: string;
  pricing: { input: number; output: number };
  contextWindow: number;
  isFree: boolean;
}

// Module-level cache so all ModelSelector instances share it
let modelCache: OpenRouterModel[] | null = null;
let cachePromise: Promise<OpenRouterModel[]> | null = null;

async function loadModels(): Promise<OpenRouterModel[]> {
  if (modelCache) return modelCache;
  if (cachePromise) return cachePromise;

  cachePromise = fetch("/api/models")
    .then((res) => res.json())
    .then((data) => {
      modelCache = data.models || [];
      return modelCache!;
    })
    .catch(() => {
      modelCache = [];
      return [];
    });

  return cachePromise;
}

function formatPrice(price: number): string {
  if (price === 0) return "Free";
  if (price < 0.01) return `<$0.01/M`;
  if (price >= 100) return `$${price.toFixed(0)}/M`;
  return `$${price.toFixed(2)}/M`;
}

function formatContext(ctx: number): string {
  if (ctx <= 0) return "";
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(0)}M ctx`;
  if (ctx >= 1000) return `${(ctx / 1000).toFixed(0)}K ctx`;
  return `${ctx} ctx`;
}

function providerLabel(provider: string): string {
  const map: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    meta: "Meta",
    "meta-llama": "Meta",
    deepseek: "DeepSeek",
    mistralai: "Mistral",
    cohere: "Cohere",
    qwen: "Qwen",
    perplexity: "Perplexity",
    x: "xAI",
    "x-ai": "xAI",
  };
  return map[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
}

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  label?: string;
  compact?: boolean;
}

export function ModelSelector({ value, onChange, label, compact = false }: ModelSelectorProps) {
  const [allModels, setAllModels] = useState<OpenRouterModel[]>([]);
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Load models on first interaction
  const ensureModelsLoaded = useCallback(async () => {
    if (modelCache && modelCache.length > 0) {
      setAllModels(modelCache);
      return;
    }
    setLoading(true);
    const models = await loadModels();
    setAllModels(models);
    setLoading(false);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setSearch("");
        setFocusIndex(-1);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Filter results
  const debouncedSearch = search.trim().toLowerCase();
  const filtered = debouncedSearch.length > 0
    ? allModels.filter((m) =>
        m.name.toLowerCase().includes(debouncedSearch) ||
        m.provider.toLowerCase().includes(debouncedSearch) ||
        m.id.toLowerCase().includes(debouncedSearch)
      ).slice(0, 20)
    : [];

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && focusIndex >= 0 && focusIndex < filtered.length) {
      e.preventDefault();
      handleSelect(filtered[focusIndex].id);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
      setSearch("");
      setFocusIndex(-1);
    }
  };

  // Scroll focused item into view
  useEffect(() => {
    if (focusIndex >= 0 && dropdownRef.current) {
      const items = dropdownRef.current.querySelectorAll("[data-model-item]");
      items[focusIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [focusIndex]);

  const handleSelect = (modelId: string) => {
    onChange(modelId);
    setShowDropdown(false);
    setSearch("");
    setFocusIndex(-1);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(val);
      setFocusIndex(-1);
    }, 150);
    // Update input immediately for responsiveness
    setSearch(val);
  };

  const isQuickPick = QUICK_PICK_MODELS.some((m) => m.id === value);
  const selectedLabel = getModelLabel(value);

  // Find selected model info from cache
  const selectedModelInfo = allModels.find((m) => m.id === value);

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="block text-sm font-medium text-neutral-300 mb-2">{label}</label>
      )}

      {/* Selected model chip */}
      <button
        type="button"
        onClick={() => {
          setShowDropdown(!showDropdown);
          ensureModelsLoaded();
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className={`w-full flex items-center justify-between rounded-lg border bg-neutral-800 text-left transition-colors ${
          showDropdown ? "border-amber-500 ring-1 ring-amber-500" : "border-neutral-700 hover:border-neutral-600"
        } ${compact ? "px-3 py-1.5 text-sm" : "px-4 py-2.5 text-sm"}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-neutral-100 font-medium truncate">{selectedLabel}</span>
          {selectedModelInfo && (
            <span className="text-[10px] text-neutral-500 font-[family-name:var(--font-geist-mono)] shrink-0">
              {selectedModelInfo.isFree ? "Free" : formatPrice(selectedModelInfo.pricing.input)}
            </span>
          )}
          {isQuickPick && (
            <span className="text-[8px] uppercase tracking-wider text-amber-500/70 font-semibold shrink-0">QP</span>
          )}
        </div>
        <svg className={`w-4 h-4 text-neutral-500 shrink-0 transition-transform ${showDropdown ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute z-50 mt-1 w-full bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl shadow-black/50 overflow-hidden">
          {/* Quick Picks */}
          <div className="px-3 py-2 border-b border-neutral-800">
            <div className="text-[9px] uppercase tracking-wider text-neutral-500 font-semibold mb-1.5">Quick Picks</div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PICK_MODELS.map((qp) => (
                <button
                  key={qp.id}
                  type="button"
                  onClick={() => handleSelect(qp.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    value === qp.id
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      : "bg-neutral-800 text-neutral-300 border border-neutral-700 hover:border-neutral-600 hover:text-neutral-100"
                  }`}
                >
                  {qp.label}
                </button>
              ))}
            </div>
          </div>

          {/* Search input */}
          <div className="px-3 py-2 border-b border-neutral-800">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={handleSearchChange}
                onKeyDown={handleKeyDown}
                placeholder="Search all OpenRouter models..."
                className="w-full pl-8 pr-3 py-1.5 rounded-md border border-neutral-700 bg-neutral-800 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
              {loading && (
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  <div className="w-3.5 h-3.5 border-2 border-neutral-600 border-t-amber-500 rounded-full animate-spin" />
                </div>
              )}
            </div>
          </div>

          {/* Search results */}
          {debouncedSearch.length > 0 && (
            <div ref={dropdownRef} className="max-h-64 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-neutral-500">
                  {loading ? "Loading models..." : "No models found"}
                </div>
              ) : (
                filtered.map((m, i) => (
                  <button
                    key={m.id}
                    type="button"
                    data-model-item
                    onClick={() => handleSelect(m.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                      i === focusIndex ? "bg-amber-500/10" : "hover:bg-neutral-800"
                    } ${value === m.id ? "bg-amber-500/5" : ""}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-neutral-200 truncate">{m.name}</span>
                        {value === m.id && (
                          <span className="text-[8px] text-amber-500 font-bold uppercase">Selected</span>
                        )}
                      </div>
                      <div className="text-[10px] text-neutral-500 truncate">{m.id}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-[10px] font-[family-name:var(--font-geist-mono)]">
                      <span className="text-neutral-500">{providerLabel(m.provider)}</span>
                      <span className={m.isFree ? "text-green-400 font-semibold" : "text-neutral-400"}>
                        {m.isFree ? "Free" : formatPrice(m.pricing.input)}
                      </span>
                      {m.contextWindow > 0 && (
                        <span className="text-neutral-600">{formatContext(m.contextWindow)}</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Hint when no search */}
          {debouncedSearch.length === 0 && !loading && (
            <div className="px-3 py-3 text-center text-[11px] text-neutral-600">
              Type to search {allModels.length > 0 ? `${allModels.length} models` : "models"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
