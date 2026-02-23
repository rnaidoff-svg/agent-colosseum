"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StrategyCard } from "@/components/configure/StrategyCard";
import { ModelSelector } from "@/components/ModelSelector";
import { STRATEGY_TEMPLATES } from "@/lib/constants/strategyTemplates";

interface TradingAgent {
  id: string;
  name: string;
  description: string;
  model: string;
}

export default function ConfigurePage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [model, setModel] = useState("google/gemini-2.5-flash");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [autoAgent, setAutoAgent] = useState(false);

  // Dynamic agent list from database
  const [tradingAgents, setTradingAgents] = useState<TradingAgent[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);

  // NPC enabled state + model state (dynamic length)
  const [npcEnabled, setNpcEnabled] = useState<boolean[]>([]);
  const [npcModels, setNpcModels] = useState<string[]>([]);

  // Fetch trading agents from API
  useEffect(() => {
    fetch("/api/agents/trading")
      .then((res) => res.json())
      .then((data) => {
        const agents: TradingAgent[] = data.agents || [];
        setTradingAgents(agents);
        // Initialize NPC state: all enabled, using their default models
        setNpcEnabled(agents.map(() => true));
        setNpcModels(agents.map((a: TradingAgent) => a.model));
        setAgentsLoaded(true);
      })
      .catch(() => {
        // Fallback to static templates
        const fallback = STRATEGY_TEMPLATES.map((t) => ({
          id: t.id, name: t.name, description: t.description, model: "google/gemini-2.5-flash",
        }));
        setTradingAgents(fallback);
        setNpcEnabled(fallback.map(() => true));
        setNpcModels(fallback.map(() => "google/gemini-2.5-flash"));
        setAgentsLoaded(true);
      });
  }, []);

  // Strategy options = dynamic agents for strategy picker
  const strategyOptions = agentsLoaded ? tradingAgents : STRATEGY_TEMPLATES.map((t) => ({
    id: t.id, name: t.name, description: t.description, model: "google/gemini-2.5-flash",
  }));

  const handleNext = () => {
    const agentName = name.trim() || "My Agent";
    const template = selectedTemplate ?? "custom";
    const params = new URLSearchParams({
      name: agentName,
      model,
      template,
    });

    // Only pass enabled NPCs — use their index into the tradingAgents array
    let npcIndex = 0;
    tradingAgents.forEach((agent, i) => {
      if (npcEnabled[i]) {
        npcIndex++;
        params.set(`npc${npcIndex}Model`, npcModels[i]);
        params.set(`npc${npcIndex}Name`, agent.name);
        params.set(`npc${npcIndex}Id`, agent.id);
      }
    });

    // Pass enabled NPC count for the battle engine
    const enabledCount = npcEnabled.filter(Boolean).length;
    params.set("npcCount", String(enabledCount));

    if (autoAgent) params.set("autoAgent", "1");
    if (template === "custom" && customPrompt.trim()) {
      params.set("prompt", customPrompt.trim());
      params.set("customPrompt", customPrompt.trim());
    }
    router.push(`/stocks?${params.toString()}`);
  };

  const allEnabled = npcEnabled.length > 0 && npcEnabled.every(Boolean);

  const toggleAll = () => {
    if (allEnabled) {
      setNpcEnabled(npcEnabled.map(() => false));
    } else {
      setNpcEnabled(npcEnabled.map(() => true));
    }
  };

  const enabledCount = npcEnabled.filter(Boolean).length;
  const modeLabel = enabledCount === 0
    ? "Solo Practice"
    : enabledCount === 1
    ? "Head-to-Head (1v1)"
    : `Battle Royale (${enabledCount + 1} agents)`;

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-4 py-12 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Configure Your Agent</h1>
        <p className="mt-2 text-neutral-400">
          Set up your AI trader before entering the pit.
        </p>
      </div>

      {/* Agent Name */}
      <Card className="p-6 mb-6">
        <label className="block text-sm font-medium text-neutral-300 mb-2">
          Agent Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Agent"
          className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
      </Card>

      {/* Model Selection */}
      <Card className="p-6 mb-6">
        <ModelSelector value={model} onChange={setModel} label="Model" variant="battle" />
      </Card>

      {/* Strategy Templates — dynamic from database */}
      <Card className="p-6 mb-6">
        <label className="block text-sm font-medium text-neutral-300 mb-3">
          Agent Strategy
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {strategyOptions.map((t) => (
            <StrategyCard
              key={t.id}
              name={t.name}
              description={t.description}
              selected={selectedTemplate === t.id}
              onClick={() =>
                setSelectedTemplate(selectedTemplate === t.id ? null : t.id)
              }
            />
          ))}
          <Card
            selected={selectedTemplate === "custom"}
            onClick={() =>
              setSelectedTemplate(
                selectedTemplate === "custom" ? null : "custom"
              )
            }
            className="p-4 cursor-pointer hover:border-amber-500/50 transition-colors"
          >
            <h3 className="font-semibold text-sm">Custom</h3>
            <p className="mt-1 text-xs text-neutral-400">
              Write your own system prompt.
            </p>
          </Card>
        </div>

        {selectedTemplate === "custom" && (
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="You are a trading agent that..."
            rows={4}
            className="mt-4 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
          />
        )}
      </Card>

      {/* Opponents — dynamic from database */}
      <Card className="p-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <label className="block text-sm font-medium text-neutral-300">
              Opponents
            </label>
            <p className="text-xs text-neutral-500 mt-0.5">
              {modeLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs font-medium text-amber-500 hover:text-amber-400 transition-colors"
          >
            {allEnabled ? "Deselect All" : "Select All"}
          </button>
        </div>
        <div className="space-y-3">
          {tradingAgents.map((agent, i) => (
            <div key={agent.id} className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer shrink-0 w-40">
                <input
                  type="checkbox"
                  checked={npcEnabled[i] ?? false}
                  onChange={() => {
                    const next = [...npcEnabled];
                    next[i] = !next[i];
                    setNpcEnabled(next);
                  }}
                  className="w-4 h-4 rounded border-neutral-600 bg-neutral-800 text-amber-500 focus:ring-amber-500 focus:ring-offset-0 cursor-pointer accent-amber-500"
                />
                <span className={`text-sm font-medium ${npcEnabled[i] ? "text-neutral-200" : "text-neutral-600"}`}>
                  {agent.name}
                </span>
              </label>
              <div className={`flex-1 ${npcEnabled[i] ? "" : "opacity-30 pointer-events-none"}`}>
                <ModelSelector
                  value={npcModels[i] || "google/gemini-2.5-flash"}
                  onChange={(v) => {
                    const next = [...npcModels];
                    next[i] = v;
                    setNpcModels(next);
                  }}
                  compact
                  variant="battle"
                />
              </div>
            </div>
          ))}
          {!agentsLoaded && (
            <div className="text-xs text-neutral-500 animate-pulse">Loading agents...</div>
          )}
        </div>
      </Card>

      {/* Auto-Agent Mode */}
      <Card className="p-6 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-sm font-medium text-neutral-300">
              Auto-Agent Mode
            </label>
            <p className="text-xs text-neutral-500 mt-0.5">
              {autoAgent
                ? "Your agent will trade fully automatically. You watch the battle unfold."
                : "Your agent advises. You decide and execute trades."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAutoAgent(!autoAgent)}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              autoAgent ? "bg-green-500" : "bg-neutral-700"
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              autoAgent ? "translate-x-5" : "translate-x-0"
            }`} />
          </button>
        </div>
      </Card>

      {/* Next Button */}
      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={handleNext}
          disabled={!name.trim() || !selectedTemplate}
        >
          Next &rarr;
        </Button>
      </div>
    </main>
  );
}
