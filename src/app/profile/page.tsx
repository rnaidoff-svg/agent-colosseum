"use client";

import { useState, useEffect } from "react";
import { getModelLabel } from "@/lib/utils/format";

interface ProfileStats {
  total_matches: number;
  wins: number;
  win_rate: number;
  avg_pnl_pct: number;
  best_pnl: number;
  worst_pnl: number;
}

interface RecentMatch {
  timestamp: string;
  final_rank: number;
  final_pnl_pct: number;
  model: string;
  strategy: string;
  agent_name: string;
}

interface UsageStat {
  strategy?: string;
  model?: string;
  uses: number;
  wins: number;
}

interface Badge {
  id: string;
  name: string;
  description: string;
  earned: boolean;
}

export default function ProfilePage() {
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([]);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [strategyStats, setStrategyStats] = useState<UsageStat[]>([]);
  const [modelStats, setModelStats] = useState<UsageStat[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/match-results?view=profile");
        const data = await res.json();
        setStats(data.stats || null);
        setRecentMatches(data.recentMatches || []);
        setCurrentStreak(data.currentStreak || 0);
        setBestStreak(data.bestStreak || 0);
        setStrategyStats(data.strategyStats || []);
        setModelStats(data.modelStats || []);

        // Compute badges
        const totalMatches = data.stats?.total_matches || 0;
        const totalWins = data.stats?.wins || 0;
        const distinctWinModels = data.distinctWinModels || 0;
        const distinctStrategies = data.distinctStrategies || 0;

        setBadges([
          {
            id: "first_blood",
            name: "First Blood",
            description: "Completed your first match",
            earned: totalMatches >= 1,
          },
          {
            id: "winner",
            name: "Winner",
            description: "Won a match",
            earned: totalWins >= 1,
          },
          {
            id: "on_fire",
            name: "On Fire",
            description: "3 wins in a row",
            earned: data.bestStreak >= 3,
          },
          {
            id: "comeback_kid",
            name: "Comeback Kid",
            description: "Won after being last mid-match",
            earned: false, // Would need mid-match tracking
          },
          {
            id: "model_master",
            name: "Model Master",
            description: "Won with 3 different models",
            earned: distinctWinModels >= 3,
          },
          {
            id: "diversified",
            name: "Diversified",
            description: "Used all 5 strategy types",
            earned: distinctStrategies >= 5,
          },
        ]);
      } catch {
        // Failed to load
      }
      setLoading(false);
    }
    load();
  }, []);

  function formatDate(ts: string): string {
    try {
      const d = new Date(ts + "Z");
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return ts;
    }
  }

  const mostUsedStrategy = strategyStats.length > 0 ? strategyStats[0] : null;
  const bestStrategy = [...strategyStats].sort((a, b) => b.wins - a.wins)[0] || null;
  const mostUsedModel = modelStats.length > 0 ? modelStats[0] : null;
  const bestModel = [...modelStats].sort((a, b) => b.wins - a.wins)[0] || null;

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] px-4 py-8 max-w-5xl mx-auto">
        <div className="text-center py-20 text-neutral-500">Loading...</div>
      </main>
    );
  }

  const hasData = stats && stats.total_matches > 0;

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-4 py-8 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Agent Profile</h1>
      <p className="text-neutral-400 mb-6">Your cumulative performance across all matches.</p>

      {!hasData ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-12 text-center">
          <p className="text-neutral-500">No matches played yet. Enter the pit to build your profile!</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Matches" value={String(stats!.total_matches)} />
            <StatCard
              label="Win Rate"
              value={`${stats!.win_rate}%`}
              color={stats!.win_rate > 50 ? "text-green-400" : stats!.win_rate > 0 ? "text-amber-400" : "text-neutral-400"}
            />
            <StatCard
              label="Avg P&L"
              value={`${stats!.avg_pnl_pct >= 0 ? "+" : ""}${stats!.avg_pnl_pct}%`}
              color={stats!.avg_pnl_pct >= 0 ? "text-green-400" : "text-red-400"}
            />
            <StatCard label="Current Streak" value={`${currentStreak}W`} color={currentStreak > 0 ? "text-amber-400" : undefined} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              label="Best P&L"
              value={`+${(stats!.best_pnl || 0).toFixed(1)}%`}
              color="text-green-400"
            />
            <StatCard
              label="Worst P&L"
              value={`${(stats!.worst_pnl || 0).toFixed(1)}%`}
              color="text-red-400"
            />
            <StatCard label="Best Streak" value={`${bestStreak}W`} />
            <StatCard label="Total Wins" value={String(stats!.wins)} color="text-amber-400" />
          </div>

          {/* Strategy & Model insights */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
              <h3 className="text-sm font-medium text-neutral-400 uppercase tracking-wider mb-3">Strategy Insights</h3>
              <div className="space-y-2">
                <InsightRow label="Most Used" value={mostUsedStrategy?.strategy?.replace("_", " ") || "-"} sub={`${mostUsedStrategy?.uses || 0} times`} />
                <InsightRow label="Most Successful" value={bestStrategy?.strategy?.replace("_", " ") || "-"} sub={`${bestStrategy?.wins || 0} wins`} />
              </div>
              {strategyStats.length > 0 && (
                <div className="mt-3 pt-3 border-t border-neutral-800 space-y-1">
                  {strategyStats.map((s) => (
                    <div key={s.strategy} className="flex items-center justify-between text-xs">
                      <span className="text-neutral-400 capitalize">{s.strategy?.replace("_", " ")}</span>
                      <span className="text-neutral-500">{s.uses} played, {s.wins} wins</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
              <h3 className="text-sm font-medium text-neutral-400 uppercase tracking-wider mb-3">Model Insights</h3>
              <div className="space-y-2">
                <InsightRow label="Most Used" value={mostUsedModel?.model ? getModelLabel(mostUsedModel.model) : "-"} sub={`${mostUsedModel?.uses || 0} times`} />
                <InsightRow label="Most Successful" value={bestModel?.model ? getModelLabel(bestModel.model) : "-"} sub={`${bestModel?.wins || 0} wins`} />
              </div>
              {modelStats.length > 0 && (
                <div className="mt-3 pt-3 border-t border-neutral-800 space-y-1">
                  {modelStats.map((m) => (
                    <div key={m.model} className="flex items-center justify-between text-xs">
                      <span className="text-neutral-400">{getModelLabel(m.model!)}</span>
                      <span className="text-neutral-500">{m.uses} played, {m.wins} wins</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* P&L Chart (simple ASCII-style since no chart library) */}
          {recentMatches.length > 1 && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
              <h3 className="text-sm font-medium text-neutral-400 uppercase tracking-wider mb-3">P&L History</h3>
              <div className="flex items-end gap-1 h-32">
                {[...recentMatches].reverse().map((m, i) => {
                  const maxAbs = Math.max(...recentMatches.map((r) => Math.abs(r.final_pnl_pct)), 1);
                  const heightPct = Math.abs(m.final_pnl_pct) / maxAbs;
                  const isPositive = m.final_pnl_pct >= 0;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end h-full relative group">
                      {/* Tooltip */}
                      <div className="absolute -top-8 hidden group-hover:block bg-neutral-800 text-xs text-neutral-200 px-2 py-1 rounded whitespace-nowrap z-10">
                        {m.final_pnl_pct >= 0 ? "+" : ""}{m.final_pnl_pct.toFixed(1)}% | {formatDate(m.timestamp)}
                      </div>
                      <div
                        className={`w-full rounded-t ${isPositive ? "bg-green-500/60" : "bg-red-500/60"}`}
                        style={{ height: `${Math.max(heightPct * 100, 4)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-1 text-[10px] text-neutral-600">
                <span>Oldest</span>
                <span>Latest</span>
              </div>
            </div>
          )}

          {/* Badges */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
            <h3 className="text-sm font-medium text-neutral-400 uppercase tracking-wider mb-3">Badges</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {badges.map((badge) => (
                <div
                  key={badge.id}
                  className={`rounded-lg border p-3 transition-colors ${
                    badge.earned
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-neutral-800 bg-neutral-900/30 opacity-40"
                  }`}
                >
                  <p className={`text-sm font-semibold ${badge.earned ? "text-amber-400" : "text-neutral-500"}`}>
                    {badge.name}
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5">{badge.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Recent matches */}
          {recentMatches.length > 0 && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
              <h3 className="text-sm font-medium text-neutral-400 uppercase tracking-wider mb-3">Recent Matches</h3>
              <div className="space-y-2">
                {recentMatches.slice(0, 10).map((m, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-neutral-800/30">
                    <span className={`text-xs font-bold w-8 ${m.final_rank === 1 ? "text-amber-400" : m.final_rank === 2 ? "text-neutral-300" : "text-neutral-500"}`}>
                      {m.final_rank === 1 ? "1st" : m.final_rank === 2 ? "2nd" : m.final_rank === 3 ? "3rd" : `${m.final_rank}th`}
                    </span>
                    <span className="text-sm text-neutral-300">{m.agent_name}</span>
                    <span className="text-xs text-neutral-500">{getModelLabel(m.model)}</span>
                    <span className="text-xs text-neutral-500 capitalize">{m.strategy.replace("_", " ")}</span>
                    <span className={`text-sm font-medium ml-auto ${m.final_pnl_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {m.final_pnl_pct >= 0 ? "+" : ""}{m.final_pnl_pct.toFixed(2)}%
                    </span>
                    <span className="text-xs text-neutral-600">{formatDate(m.timestamp)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
      <p className="text-xs text-neutral-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color || "text-neutral-200"}`}>{value}</p>
    </div>
  );
}

function InsightRow({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-neutral-500">{label}</span>
      <div className="text-right">
        <span className="text-sm text-neutral-200 capitalize">{value}</span>
        <span className="text-xs text-neutral-500 ml-2">{sub}</span>
      </div>
    </div>
  );
}
