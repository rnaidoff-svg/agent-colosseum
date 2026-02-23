"use client";

import { useState, useEffect } from "react";
import { getModelLabel } from "@/lib/utils/format";

interface MatchAgent {
  agent_name: string;
  model: string;
  strategy: string;
  final_pnl_pct: number;
  final_rank: number;
  num_trades: number;
  is_user: number;
}

interface MatchGroup {
  id: number;
  timestamp: string;
  num_rounds: number;
  stocks_json: string;
  agents: MatchAgent[];
}

function rankLabel(rank: number): string {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";
  return `${rank}th`;
}

function rankColor(rank: number): string {
  if (rank === 1) return "text-amber-400";
  if (rank === 2) return "text-neutral-300";
  if (rank === 3) return "text-amber-700";
  return "text-neutral-500";
}

function rankBg(rank: number): string {
  if (rank === 1) return "bg-amber-500/10 border-amber-500/30";
  if (rank === 2) return "bg-neutral-400/5 border-neutral-400/20";
  if (rank === 3) return "bg-amber-800/10 border-amber-700/20";
  return "bg-neutral-800/30 border-neutral-800";
}

export default function HistoryPage() {
  const [matches, setMatches] = useState<MatchGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/match-results?view=matches");
        const data = await res.json();
        // Group flat rows into match groups
        const grouped = new Map<number, MatchGroup>();
        for (const row of data.matches || []) {
          if (!grouped.has(row.id)) {
            grouped.set(row.id, {
              id: row.id,
              timestamp: row.timestamp,
              num_rounds: row.num_rounds,
              stocks_json: row.stocks_json,
              agents: [],
            });
          }
          grouped.get(row.id)!.agents.push({
            agent_name: row.agent_name,
            model: row.model,
            strategy: row.strategy,
            final_pnl_pct: row.final_pnl_pct,
            final_rank: row.final_rank,
            num_trades: row.num_trades,
            is_user: row.is_user,
          });
        }
        setMatches(Array.from(grouped.values()));
      } catch {
        // Failed to load
      }
      setLoading(false);
    }
    load();
  }, []);

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function formatDate(ts: string): string {
    try {
      const d = new Date(ts + "Z");
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
        " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    } catch {
      return ts;
    }
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-4 py-8 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Match History</h1>
      <p className="text-neutral-400 mb-6">All past battles in reverse chronological order.</p>

      {loading ? (
        <div className="text-center py-20 text-neutral-500">Loading...</div>
      ) : matches.length === 0 ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-12 text-center">
          <p className="text-neutral-500">No matches yet. Enter the pit to start battling!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {matches.map((match) => {
            const userAgent = match.agents.find((a) => a.is_user === 1);
            const stocks = (() => {
              try { return JSON.parse(match.stocks_json) as string[]; } catch { return []; }
            })();
            const isExpanded = expanded.has(match.id);

            return (
              <div
                key={match.id}
                className="rounded-xl border border-neutral-800 bg-neutral-900/50 overflow-hidden"
              >
                {/* Header */}
                <button
                  onClick={() => toggleExpand(match.id)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-neutral-800/30 transition-colors text-left"
                >
                  {/* Date */}
                  <div className="shrink-0 w-36">
                    <p className="text-sm text-neutral-300">{formatDate(match.timestamp)}</p>
                    <p className="text-xs text-neutral-500">{match.num_rounds} rounds</p>
                  </div>

                  {/* User result */}
                  {userAgent ? (
                    <div className="flex items-center gap-3 flex-1">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${rankBg(userAgent.final_rank)} ${rankColor(userAgent.final_rank)}`}>
                        {rankLabel(userAgent.final_rank)}
                      </span>
                      <span className="text-sm font-medium text-neutral-200">{userAgent.agent_name}</span>
                      <span className="text-xs text-neutral-500">({getModelLabel(userAgent.model)})</span>
                      <span className={`text-sm font-medium ml-auto ${userAgent.final_pnl_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {userAgent.final_pnl_pct >= 0 ? "+" : ""}{userAgent.final_pnl_pct.toFixed(2)}%
                      </span>
                    </div>
                  ) : (
                    <div className="flex-1 text-sm text-neutral-500">NPC-only match</div>
                  )}

                  {/* Expand indicator */}
                  <span className={`text-neutral-500 text-xs transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                    {"\u25B6"}
                  </span>
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-neutral-800 px-5 py-4 space-y-4">
                    {/* All participants */}
                    <div>
                      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">Participants</p>
                      <div className="space-y-1.5">
                        {match.agents
                          .sort((a, b) => a.final_rank - b.final_rank)
                          .map((a) => (
                            <div
                              key={`${match.id}-${a.agent_name}`}
                              className={`flex items-center gap-3 px-3 py-2 rounded-lg ${a.is_user ? "bg-amber-500/5 border border-amber-500/20" : "bg-neutral-800/30"}`}
                            >
                              <span className={`text-xs font-bold w-8 ${rankColor(a.final_rank)}`}>
                                {rankLabel(a.final_rank)}
                              </span>
                              <span className="text-sm font-medium text-neutral-200 w-36">{a.agent_name}</span>
                              <span className="text-xs text-neutral-500 w-32">{getModelLabel(a.model)}</span>
                              <span className="text-xs text-neutral-500 capitalize w-28">{a.strategy.replace("_", " ")}</span>
                              <span className="text-xs text-neutral-500">{a.num_trades} trades</span>
                              <span className={`text-sm font-medium ml-auto ${a.final_pnl_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                                {a.final_pnl_pct >= 0 ? "+" : ""}{a.final_pnl_pct.toFixed(2)}%
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>

                    {/* Stocks */}
                    {stocks.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">Stocks in Match</p>
                        <div className="flex flex-wrap gap-2">
                          {stocks.map((ticker) => (
                            <span key={ticker} className="px-2 py-0.5 rounded bg-neutral-800 text-xs text-neutral-300 font-mono">
                              {ticker}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
