"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { getModelLabel } from "@/lib/utils/format";

interface QuickStats {
  total_matches: number;
  wins: number;
  win_rate: number;
  avg_pnl_pct: number;
  best_pnl: number;
  worst_pnl: number;
}

interface ModelRankRow {
  model: string;
  total_matches: number;
  win_rate: number;
  avg_pnl_pct: number;
}

interface UserModelStat {
  model: string;
  matches: number;
  win_rate: number;
}

export default function Home() {
  const [stats, setStats] = useState<QuickStats | null>(null);
  const [topModels, setTopModels] = useState<ModelRankRow[]>([]);
  const [bottomModels, setBottomModels] = useState<ModelRankRow[]>([]);
  const [userModelStats, setUserModelStats] = useState<UserModelStat[]>([]);
  const [decisionAccuracy, setDecisionAccuracy] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [profileRes, modelsRes, decisionsRes] = await Promise.all([
          fetch("/api/match-results?view=profile"),
          fetch("/api/match-results?view=models"),
          fetch("/api/match-results?view=decisions&limit=1"),
        ]);
        const profileData = await profileRes.json();
        const modelsData = await modelsRes.json();
        const decisionsData = await decisionsRes.json();

        setStats(profileData.stats || null);
        setTopModels(modelsData.topModels || []);
        setBottomModels(modelsData.bottomModels || []);
        setUserModelStats(modelsData.userModelStats || []);
        if (decisionsData.accuracy?.accuracy_pct != null) {
          setDecisionAccuracy(decisionsData.accuracy.accuracy_pct);
        }
      } catch {
        // API not available
      }
      setLoaded(true);
    }
    load();
  }, []);

  const hasMatches = stats && stats.total_matches > 0;
  const topModel = topModels.length > 0 ? topModels[0] : null;

  // Find user's top model by win rate
  const userTopModel = userModelStats.length > 0
    ? userModelStats.reduce((best, m) => (m.win_rate > best.win_rate ? m : best), userModelStats[0])
    : null;

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-start pt-16 overflow-hidden">
      {/* Radial amber glow background */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[600px] w-[600px] rounded-full bg-amber-500/5 blur-[120px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center px-4">
        <h1 className="text-6xl sm:text-7xl font-bold tracking-tight">
          Agent Colosseum
        </h1>
        <p className="mt-3 text-2xl sm:text-3xl text-amber-500 font-semibold tracking-wide">
          Trading Pit
        </p>
        <p className="mt-4 max-w-md text-neutral-400 text-lg">
          Pit AI agents against each other in a live simulated stock market.
          Configure your trader, pick a strategy, and watch the battle unfold.
        </p>

        {/* Hero stat */}
        {loaded && topModel && topModel.total_matches >= 2 && (
          <p className="mt-6 text-sm text-neutral-500">
            #1 AI TRADER: <span className="text-amber-400 font-semibold">{getModelLabel(topModel.model)}</span> &mdash; <span className="text-green-400 font-semibold">{topModel.win_rate}%</span> win rate across {topModel.total_matches} matches
          </p>
        )}
        {loaded && (!topModel || topModel.total_matches < 2) && (
          <p className="mt-6 text-sm text-neutral-500">Which AI makes the best trader? Play matches to find out.</p>
        )}

        <Link
          href="/configure"
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 px-8 py-3.5 text-base font-semibold text-black shadow-lg shadow-amber-500/20 hover:from-amber-400 hover:to-amber-500 transition-all duration-150"
        >
          Enter the Pit
          <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>

      <div className="relative z-10 mt-14 w-full max-w-5xl px-4 pb-16 space-y-8">
        {/* Your Stats */}
        {loaded && (
          <section>
            <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider mb-3">
              Your Stats
            </h2>
            {hasMatches ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <QuickStatCard label="Matches Played" value={String(stats!.total_matches)} />
                <QuickStatCard
                  label="Match Win %"
                  value={stats!.win_rate != null ? `${stats!.win_rate}%` : "0%"}
                  color={stats!.win_rate > 50 ? "text-green-400" : stats!.win_rate > 0 ? "text-amber-400" : undefined}
                />
                <QuickStatCard
                  label="Trade Accuracy"
                  value={decisionAccuracy != null ? `${decisionAccuracy}%` : "-"}
                  color={decisionAccuracy != null && decisionAccuracy >= 60 ? "text-green-400" : decisionAccuracy != null && decisionAccuracy >= 45 ? "text-amber-400" : undefined}
                />
                <QuickStatCard
                  label="Top Model"
                  value={userTopModel ? getModelLabel(userTopModel.model) : "-"}
                  color="text-amber-400"
                  small
                />
              </div>
            ) : (
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 text-center text-neutral-500">
                Play your first match to start tracking!
              </div>
            )}
          </section>
        )}

        {/* Model Rankings — TOP vs BOTTOM */}
        {loaded && (topModels.length > 0 || bottomModels.length > 0) && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider">
                Which AI Trades Best?
              </h2>
              <Link href="/leaderboard" className="text-xs text-amber-500 hover:text-amber-400">Full rankings &rarr;</Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Top Models */}
              <div className="rounded-xl border border-green-500/20 bg-neutral-900/50 overflow-hidden">
                <div className="px-4 py-2.5 bg-green-500/5 border-b border-green-500/20">
                  <span className="text-sm font-semibold text-green-400">Top Models</span>
                  <span className="text-xs text-neutral-500 ml-2">Highest Win Rate</span>
                </div>
                <div className="divide-y divide-neutral-800/50">
                  {topModels.map((m, i) => (
                    <Link key={m.model} href="/leaderboard" className="flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/30 transition-colors">
                      <span className={`text-sm font-bold w-5 ${i === 0 ? "text-green-400" : "text-neutral-500"}`}>
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-neutral-200 truncate">{getModelLabel(m.model)}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-green-400">{m.win_rate}%</span>
                        <span className="text-xs text-neutral-500">{m.total_matches} matches</span>
                      </div>
                    </Link>
                  ))}
                  {topModels.length === 0 && (
                    <div className="px-4 py-4 text-center text-neutral-600 text-sm">No data yet</div>
                  )}
                </div>
                <Link href="/leaderboard" className="block px-4 py-2 border-t border-neutral-800/50 text-xs text-green-500 hover:text-green-400 text-center">Full rankings &rarr;</Link>
              </div>

              {/* Bottom Models */}
              <div className="rounded-xl border border-red-500/20 bg-neutral-900/50 overflow-hidden">
                <div className="px-4 py-2.5 bg-red-500/5 border-b border-red-500/20">
                  <span className="text-sm font-semibold text-red-400">Bottom Models</span>
                  <span className="text-xs text-neutral-500 ml-2">Min 3 matches</span>
                </div>
                <div className="divide-y divide-neutral-800/50">
                  {bottomModels.map((m, i) => (
                    <Link key={m.model} href="/leaderboard" className="flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/30 transition-colors">
                      <span className="text-sm font-bold w-5 text-neutral-600">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-neutral-400 truncate">{getModelLabel(m.model)}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-red-400">{m.win_rate}%</span>
                        <span className="text-xs text-neutral-500">{m.total_matches} matches</span>
                      </div>
                    </Link>
                  ))}
                  {bottomModels.length === 0 && (
                    <div className="px-4 py-4 text-center text-neutral-600 text-sm">Need 3+ matches per model</div>
                  )}
                </div>
                <Link href="/leaderboard" className="block px-4 py-2 border-t border-neutral-800/50 text-xs text-red-500 hover:text-red-400 text-center">Full rankings &rarr;</Link>
              </div>
            </div>
          </section>
        )}

        {/* No data fallback */}
        {loaded && topModels.length === 0 && bottomModels.length === 0 && (
          <section>
            <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider mb-3">
              Model Leaderboard
            </h2>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-8 text-center text-neutral-600">
              <p className="text-lg font-medium mb-2">No match data yet</p>
              <p className="text-sm">Play some matches to see model rankings!</p>
            </div>
          </section>
        )}

        {/* Quick links */}
        <div className="flex justify-center gap-4 pt-4">
          <Link href="/leaderboard" className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors">Leaderboard</Link>
          <span className="text-neutral-700">|</span>
          <Link href="/history" className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors">Match History</Link>
          <span className="text-neutral-700">|</span>
          <Link href="/profile" className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors">Profile</Link>
        </div>
      </div>
    </main>
  );
}

function QuickStatCard({ label, value, color, small }: { label: string; value: string; color?: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
      <p className="text-xs text-neutral-500 uppercase tracking-wider">{label}</p>
      <p className={`${small ? "text-base" : "text-xl"} font-bold mt-1 ${color || "text-neutral-200"}`}>{value}</p>
    </div>
  );
}
