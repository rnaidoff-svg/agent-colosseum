"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getModelLabel } from "@/lib/utils/format";

interface ModelSummary {
  model: string;
  total_matches: number;
  wins: number;
  win_rate: number;
  avg_pnl_pct: number;
  best_pnl: number;
  worst_pnl: number;
  top2_rate: number;
  avg_rank: number;
  avg_trades: number;
}

interface StrategyBreakdown {
  strategy: string;
  matches: number;
  wins: number;
  win_rate: number;
  avg_pnl_pct: number;
}

interface SituationBreakdown {
  news_type: string;
  decisions: number;
  correct: number;
  incorrect: number;
  accuracy: number | null;
  avg_pnl: number | null;
}

interface RecentMatch {
  id: number;
  timestamp: string;
  strategy: string;
  final_rank: number;
  final_pnl_pct: number;
  num_trades: number;
}

interface OpponentRow {
  opponent: string;
  matches: number;
  wins: number;
}

const NEWS_TYPE_LABELS: Record<string, string> = {
  macro: "Macro News",
  company_specific: "Company-Specific News",
};

export default function ModelDetailPage() {
  const params = useParams();
  const modelId = decodeURIComponent(params.model as string);

  const [summary, setSummary] = useState<ModelSummary | null>(null);
  const [byStrategy, setByStrategy] = useState<StrategyBreakdown[]>([]);
  const [bySituation, setBySituation] = useState<SituationBreakdown[]>([]);
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([]);
  const [opponents, setOpponents] = useState<OpponentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/match-results?view=model_detail&model=${encodeURIComponent(modelId)}`);
        const data = await res.json();
        setSummary(data.summary || null);
        setByStrategy(data.byStrategy || []);
        setBySituation(data.bySituation || []);
        setRecentMatches(data.recentMatches || []);
        setOpponents(data.opponents || []);
      } catch {
        // API error
      }
      setLoading(false);
    }
    load();
  }, [modelId]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-neutral-500">Loading...</div>
      </main>
    );
  }

  if (!summary || !summary.total_matches) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] px-4 py-8 max-w-5xl mx-auto">
        <Link href="/leaderboard" className="text-xs text-neutral-500 hover:text-neutral-300">&larr; Back to Leaderboard</Link>
        <div className="mt-12 text-center text-neutral-500">
          <p className="text-lg">No data found for this model.</p>
        </div>
      </main>
    );
  }

  const label = getModelLabel(modelId);

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-4 py-8 max-w-5xl mx-auto">
      <Link href="/leaderboard" className="text-xs text-neutral-500 hover:text-neutral-300">&larr; Back to Leaderboard</Link>

      {/* Header */}
      <div className="mt-4 mb-8">
        <h1 className="text-3xl font-bold text-neutral-100">{label}</h1>
        <p className="text-sm text-neutral-500 mt-1 font-mono">{modelId}</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        <StatCard label="Matches" value={String(summary.total_matches)} />
        <StatCard
          label="Win Rate"
          value={`${summary.win_rate}%`}
          color={summary.win_rate > 50 ? "text-green-400" : "text-amber-400"}
        />
        <StatCard
          label="Avg P&L"
          value={`${summary.avg_pnl_pct >= 0 ? "+" : ""}${summary.avg_pnl_pct}%`}
          color={summary.avg_pnl_pct >= 0 ? "text-green-400" : "text-red-400"}
        />
        <StatCard label="Avg Rank" value={`#${summary.avg_rank}`} />
        <StatCard label="Top 2 Rate" value={`${summary.top2_rate}%`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* By Strategy */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-800">
            <span className="text-sm font-semibold text-neutral-300">Performance by Strategy</span>
          </div>
          {byStrategy.length === 0 ? (
            <div className="p-6 text-center text-neutral-600 text-sm">No data</div>
          ) : (
            <table className="w-full">
              <thead className="border-b border-neutral-800">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider">Strategy</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider">Matches</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider">Win Rate</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider">Avg P&L</th>
                </tr>
              </thead>
              <tbody>
                {byStrategy.map((s) => (
                  <tr key={s.strategy} className="border-b border-neutral-800/50">
                    <td className="px-3 py-2.5 text-sm font-medium text-neutral-200 capitalize">{s.strategy.replace("_", " ")}</td>
                    <td className="px-3 py-2.5 text-sm text-neutral-400">{s.matches}</td>
                    <td className="px-3 py-2.5 text-sm font-medium">
                      <span className={s.win_rate > 50 ? "text-green-400" : s.win_rate > 0 ? "text-amber-400" : "text-neutral-500"}>
                        {s.win_rate}%
                      </span>
                    </td>
                    <td className={`px-3 py-2.5 text-sm font-medium ${s.avg_pnl_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {s.avg_pnl_pct >= 0 ? "+" : ""}{s.avg_pnl_pct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Decision Accuracy by News Type */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-800">
            <span className="text-sm font-semibold text-neutral-300">Decision Accuracy</span>
          </div>
          {bySituation.length === 0 ? (
            <div className="p-6 text-center text-neutral-600 text-sm">No decision data yet</div>
          ) : (
            <div className="divide-y divide-neutral-800/50">
              {bySituation.map((s) => {
                const acc = s.accuracy;
                const barWidth = acc != null ? acc : 0;
                const barColor = acc != null && acc >= 70 ? "bg-green-500/40" : acc != null && acc >= 50 ? "bg-amber-500/40" : "bg-red-500/40";
                return (
                  <div key={s.news_type} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-neutral-300">{NEWS_TYPE_LABELS[s.news_type] || s.news_type}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-neutral-600">{s.decisions} decisions</span>
                        {s.avg_pnl != null && (
                          <span className={`text-xs font-medium ${s.avg_pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {s.avg_pnl >= 0 ? "+" : ""}{s.avg_pnl}% avg
                          </span>
                        )}
                        <span className={`text-sm font-semibold ${acc != null && acc >= 70 ? "text-green-400" : acc != null && acc >= 50 ? "text-amber-400" : "text-red-400"}`}>
                          {acc != null ? `${acc}%` : "-"}
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-neutral-800 overflow-hidden">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barWidth}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Opponent Record */}
      {opponents.length > 0 && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 overflow-hidden mb-8">
          <div className="px-4 py-3 border-b border-neutral-800">
            <span className="text-sm font-semibold text-neutral-300">vs Opponents</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-neutral-800/50">
            {opponents.map((opp) => {
              const winPct = opp.matches > 0 ? Math.round((opp.wins / opp.matches) * 100) : 0;
              return (
                <div key={opp.opponent} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <Link href={`/leaderboard/${encodeURIComponent(opp.opponent)}`} className="text-sm font-medium text-neutral-300 hover:text-amber-400 transition-colors">
                      {getModelLabel(opp.opponent)}
                    </Link>
                    <div className="text-[10px] text-neutral-600">{opp.matches} encounters</div>
                  </div>
                  <div className="text-right">
                    <span className={`text-sm font-bold ${winPct > 50 ? "text-green-400" : winPct > 0 ? "text-amber-400" : "text-red-400"}`}>
                      {opp.wins}W
                    </span>
                    <span className="text-xs text-neutral-500 ml-1">({winPct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Recent Matches */}
      {recentMatches.length > 0 && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-800">
            <span className="text-sm font-semibold text-neutral-300">Recent Matches</span>
          </div>
          <table className="w-full">
            <thead className="border-b border-neutral-800">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider">Date</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider">Strategy</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider">Rank</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider">P&L</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider">Trades</th>
              </tr>
            </thead>
            <tbody>
              {recentMatches.map((m) => (
                <tr key={m.id} className="border-b border-neutral-800/50">
                  <td className="px-3 py-2.5 text-xs text-neutral-500">{new Date(m.timestamp).toLocaleDateString()}</td>
                  <td className="px-3 py-2.5 text-sm text-neutral-400 capitalize">{m.strategy.replace("_", " ")}</td>
                  <td className="px-3 py-2.5 text-sm">
                    <span className={m.final_rank === 1 ? "text-amber-400 font-bold" : m.final_rank <= 2 ? "text-neutral-300" : "text-neutral-500"}>
                      #{m.final_rank}
                    </span>
                  </td>
                  <td className={`px-3 py-2.5 text-sm font-medium ${m.final_pnl_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {m.final_pnl_pct >= 0 ? "+" : ""}{(m.final_pnl_pct * 100).toFixed(2)}%
                  </td>
                  <td className="px-3 py-2.5 text-sm text-neutral-400">{m.num_trades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
      <p className="text-xs text-neutral-500 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold mt-1 ${color || "text-neutral-200"}`}>{value}</p>
    </div>
  );
}
