"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getModelLabel } from "@/lib/utils/format";

type Tab = "rankings" | "strategy_combos" | "decisions" | "h2h";
type TimeFilter = "all" | "7d" | "24h" | "today";

interface ModelRow {
  model: string;
  total_matches: number;
  win_rate: number;
  avg_pnl_pct: number;
  top2_rate: number;
}

interface StrategyRow {
  strategy: string;
  total_matches: number;
  win_rate: number;
  avg_pnl_pct: number;
}

interface DecisionRow {
  id: number;
  agent_name: string;
  model: string;
  round: number;
  news_headline: string;
  news_type: string;
  news_category: string;
  action_taken: string;
  ticker: string;
  qty: number;
  price: number;
  reasoning: string;
  pnl_from_trade: number | null;
  was_correct: number | null;
  timestamp: string;
  match_id: number;
}

interface DecisionAccuracy {
  total: number;
  correct: number;
  incorrect: number;
  accuracy_pct: number | null;
  avg_pnl: number | null;
}

interface H2HRow {
  model_a: string;
  model_b: string;
  matches: number;
  a_wins: number;
  b_wins: number;
  ties: number;
}

type SortKey = string;
type SortDir = "asc" | "desc";

const TIME_OPTIONS: { value: TimeFilter; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "7d", label: "7 Days" },
  { value: "24h", label: "24h" },
  { value: "today", label: "Today" },
];

function rankColor(i: number): string {
  if (i === 0) return "text-amber-400";
  if (i === 1) return "text-neutral-300";
  if (i === 2) return "text-amber-700";
  return "text-neutral-500";
}

function rankBadge(i: number): string {
  if (i === 0) return "bg-amber-500/20 border-amber-500/40";
  if (i === 1) return "bg-neutral-400/10 border-neutral-400/30";
  if (i === 2) return "bg-amber-800/20 border-amber-700/30";
  return "";
}

export default function LeaderboardPage() {
  const [tab, setTab] = useState<Tab>("rankings");
  const [time, setTime] = useState<TimeFilter>("all");
  const [models, setModels] = useState<ModelRow[]>([]);
  const [strategies, setStrategies] = useState<StrategyRow[]>([]);
  const [bestModelMap, setBestModelMap] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [decisionAccuracy, setDecisionAccuracy] = useState<DecisionAccuracy | null>(null);
  const [decisionTotalCount, setDecisionTotalCount] = useState(0);
  const [decisionFilter, setDecisionFilter] = useState({ model: "", ticker: "", newsType: "", category: "" });
  const [h2hData, setH2hData] = useState<H2HRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("win_rate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "rankings") {
        const res = await fetch(`/api/match-results?view=models&time=${time}`);
        const data = await res.json();
        setModels(data.models || []);
      } else if (tab === "strategy_combos") {
        const res = await fetch(`/api/match-results?view=strategies&time=${time}`);
        const data = await res.json();
        setStrategies(data.strategies || []);
        setBestModelMap(data.bestModelMap || {});
      } else if (tab === "decisions") {
        const params = new URLSearchParams({ view: "decisions", time, limit: "50" });
        if (decisionFilter.model) params.set("model", decisionFilter.model);
        if (decisionFilter.ticker) params.set("ticker", decisionFilter.ticker);
        if (decisionFilter.newsType) params.set("newsType", decisionFilter.newsType);
        if (decisionFilter.category) params.set("category", decisionFilter.category);
        const res = await fetch(`/api/match-results?${params.toString()}`);
        const data = await res.json();
        setDecisions(data.decisions || []);
        setDecisionAccuracy(data.accuracy || null);
        setDecisionTotalCount(data.totalCount || 0);
      } else if (tab === "h2h") {
        const res = await fetch(`/api/match-results?view=head2head&time=${time}`);
        const data = await res.json();
        setH2hData(data.h2h || []);
      }
    } catch {
      // Failed to fetch
    }
    setLoading(false);
  }, [tab, time, decisionFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function sorted<T>(arr: T[]): T[] {
    return [...arr].sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey];
      const bv = (b as Record<string, unknown>)[sortKey];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "desc" ? -cmp : cmp;
    });
  }

  function SortHeader({ label, field }: { label: string; field: string }) {
    const active = sortKey === field;
    return (
      <th
        className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider cursor-pointer hover:text-neutral-200 select-none"
        onClick={() => handleSort(field)}
      >
        {label} {active ? (sortDir === "desc" ? "\u2193" : "\u2191") : ""}
      </th>
    );
  }

  // Get unique models for decision filter
  const uniqueModels = Array.from(new Set(decisions.map((d) => d.model)));
  const uniqueTickers = Array.from(new Set(decisions.map((d) => d.ticker)));

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-4 py-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-3xl font-bold">Leaderboard</h1>
        <Link href="/" className="text-xs text-neutral-500 hover:text-neutral-300">&larr; Home</Link>
      </div>
      <p className="text-neutral-400 mb-6">Performance rankings across all matches.</p>

      {/* Tab toggles */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-5">
        <div className="flex bg-neutral-900 rounded-lg border border-neutral-800 p-0.5">
          {([
            { key: "rankings" as Tab, label: "Rankings" },
            { key: "strategy_combos" as Tab, label: "Strategy Combos" },
            { key: "decisions" as Tab, label: "Decision Browser" },
            { key: "h2h" as Tab, label: "Head to Head" },
          ]).map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSortKey("win_rate"); setSortDir("desc"); }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t.key ? "bg-amber-500/20 text-amber-500" : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Time filters */}
        <div className="flex bg-neutral-900 rounded-lg border border-neutral-800 p-0.5 sm:ml-auto">
          {TIME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTime(opt.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                time === opt.value ? "bg-neutral-700 text-neutral-200" : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-neutral-500">Loading...</div>
      ) : (
        <>
          {/* Rankings tab */}
          {tab === "rankings" && (
            models.length === 0 ? <Empty /> : (
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 overflow-hidden">
                {models.length > 0 && (
                  <div className="px-4 py-3 border-b border-neutral-800 bg-amber-500/5">
                    <span className="text-amber-500 font-semibold text-sm">
                      Top Model: {getModelLabel(sorted(models)[0].model)}
                    </span>
                    <span className="ml-3 text-neutral-400 text-sm">
                      {sorted(models)[0].win_rate}% win rate across {sorted(models)[0].total_matches} matches
                    </span>
                  </div>
                )}
                <table className="w-full">
                  <thead className="border-b border-neutral-800">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider w-10">#</th>
                      <SortHeader label="Model" field="model" />
                      <SortHeader label="Matches" field="total_matches" />
                      <SortHeader label="Win Rate" field="win_rate" />
                      <SortHeader label="Avg P&L" field="avg_pnl_pct" />
                      <SortHeader label="Top 2 Rate" field="top2_rate" />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted(models).map((m, i) => (
                      <tr key={m.model} className={`border-b border-neutral-800/50 hover:bg-neutral-800/30 ${i === 0 ? "bg-amber-500/5" : ""}`}>
                        <td className={`px-3 py-2.5 text-sm font-bold ${rankColor(i)}`}>
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs border ${rankBadge(i)}`}>
                            {i + 1}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-sm font-medium text-neutral-200">
                          <Link href={`/leaderboard/${encodeURIComponent(m.model)}`} className="hover:text-amber-400 transition-colors">
                            {getModelLabel(m.model)}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-sm text-neutral-400">{m.total_matches}</td>
                        <td className="px-3 py-2.5 text-sm font-medium">
                          <span className={m.win_rate > 50 ? "text-green-400" : m.win_rate > 0 ? "text-amber-400" : "text-neutral-500"}>
                            {m.win_rate}%
                          </span>
                        </td>
                        <td className={`px-3 py-2.5 text-sm font-medium ${m.avg_pnl_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {m.avg_pnl_pct >= 0 ? "+" : ""}{m.avg_pnl_pct}%
                        </td>
                        <td className="px-3 py-2.5 text-sm text-neutral-300">{m.top2_rate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* Strategy Combos tab */}
          {tab === "strategy_combos" && (
            strategies.length === 0 ? <Empty /> : (
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 overflow-hidden">
                <table className="w-full">
                  <thead className="border-b border-neutral-800">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider w-10">#</th>
                      <SortHeader label="Strategy" field="strategy" />
                      <SortHeader label="Matches" field="total_matches" />
                      <SortHeader label="Win Rate" field="win_rate" />
                      <SortHeader label="Avg P&L" field="avg_pnl_pct" />
                      <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider">Best Model</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted(strategies).map((s, i) => (
                      <tr key={s.strategy} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                        <td className={`px-3 py-2.5 text-sm font-bold ${rankColor(i)}`}>
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs border ${rankBadge(i)}`}>
                            {i + 1}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-sm font-medium text-neutral-200 capitalize">{s.strategy.replace("_", " ")}</td>
                        <td className="px-3 py-2.5 text-sm text-neutral-400">{s.total_matches}</td>
                        <td className="px-3 py-2.5 text-sm font-medium">
                          <span className={s.win_rate > 50 ? "text-green-400" : s.win_rate > 0 ? "text-amber-400" : "text-neutral-500"}>
                            {s.win_rate}%
                          </span>
                        </td>
                        <td className={`px-3 py-2.5 text-sm font-medium ${s.avg_pnl_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {s.avg_pnl_pct >= 0 ? "+" : ""}{s.avg_pnl_pct}%
                        </td>
                        <td className="px-3 py-2.5 text-sm text-neutral-400">
                          {bestModelMap[s.strategy] ? getModelLabel(bestModelMap[s.strategy]) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* Decision Browser tab */}
          {tab === "decisions" && (
            <div className="space-y-4">
              {/* Filters */}
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-sm text-neutral-300 focus:outline-none focus:border-amber-500/50"
                  value={decisionFilter.model}
                  onChange={(e) => setDecisionFilter((f) => ({ ...f, model: e.target.value }))}
                >
                  <option value="">All Models</option>
                  {uniqueModels.map((m) => (
                    <option key={m} value={m}>{getModelLabel(m)}</option>
                  ))}
                </select>
                <select
                  className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-sm text-neutral-300 focus:outline-none focus:border-amber-500/50"
                  value={decisionFilter.ticker}
                  onChange={(e) => setDecisionFilter((f) => ({ ...f, ticker: e.target.value }))}
                >
                  <option value="">All Tickers</option>
                  {uniqueTickers.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <select
                  className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-sm text-neutral-300 focus:outline-none focus:border-amber-500/50"
                  value={decisionFilter.newsType}
                  onChange={(e) => setDecisionFilter((f) => ({ ...f, newsType: e.target.value }))}
                >
                  <option value="">All News Types</option>
                  <option value="macro">Macro</option>
                  <option value="company_specific">Company-Specific</option>
                </select>
                <select
                  className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-sm text-neutral-300 focus:outline-none focus:border-amber-500/50"
                  value={decisionFilter.category}
                  onChange={(e) => setDecisionFilter((f) => ({ ...f, category: e.target.value }))}
                >
                  <option value="">All Categories</option>
                  <option value="fed_rate">Fed Rate</option>
                  <option value="earnings">Earnings</option>
                  <option value="sector_news">Sector News</option>
                  <option value="crisis">Crisis</option>
                  <option value="regulation">Regulation</option>
                  <option value="product_launch">Product Launch</option>
                  <option value="scandal">Scandal</option>
                  <option value="economic_data">Economic Data</option>
                  <option value="analyst_action">Analyst Action</option>
                  <option value="merger_acquisition">M&A</option>
                  <option value="geopolitical">Geopolitical</option>
                </select>
                {(decisionFilter.model || decisionFilter.ticker || decisionFilter.newsType || decisionFilter.category) && (
                  <button
                    onClick={() => setDecisionFilter({ model: "", ticker: "", newsType: "", category: "" })}
                    className="text-xs text-neutral-500 hover:text-neutral-300 px-2"
                  >
                    Clear filters
                  </button>
                )}
              </div>

              {/* Accuracy summary */}
              {decisionAccuracy && decisionAccuracy.total > 0 && (
                <div className="flex gap-3 flex-wrap">
                  <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-2">
                    <span className="text-xs text-neutral-500">Total Decisions</span>
                    <span className="ml-2 text-sm font-semibold text-neutral-200">{decisionTotalCount}</span>
                  </div>
                  {decisionAccuracy.accuracy_pct != null && (
                    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-2">
                      <span className="text-xs text-neutral-500">Accuracy</span>
                      <span className={`ml-2 text-sm font-semibold ${decisionAccuracy.accuracy_pct >= 60 ? "text-green-400" : decisionAccuracy.accuracy_pct >= 45 ? "text-amber-400" : "text-red-400"}`}>
                        {decisionAccuracy.accuracy_pct}%
                      </span>
                      <span className="text-xs text-neutral-600 ml-1">
                        ({decisionAccuracy.correct}/{decisionAccuracy.correct + (decisionAccuracy.incorrect || 0)})
                      </span>
                    </div>
                  )}
                  {decisionAccuracy.avg_pnl != null && (
                    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-2">
                      <span className="text-xs text-neutral-500">Avg P&L per Trade</span>
                      <span className={`ml-2 text-sm font-semibold ${decisionAccuracy.avg_pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {decisionAccuracy.avg_pnl >= 0 ? "+" : ""}{decisionAccuracy.avg_pnl}%
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Decision table */}
              {decisions.length === 0 ? (
                <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-12 text-center">
                  <p className="text-neutral-500">No decision data yet. Decision tracking starts with your next match.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 overflow-x-auto">
                  <table className="w-full min-w-[800px]">
                    <thead className="border-b border-neutral-800">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider">Agent</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider">Action</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider">News</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider">P&L</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider">Result</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider">Reasoning</th>
                      </tr>
                    </thead>
                    <tbody>
                      {decisions.map((d) => (
                        <tr key={d.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                          <td className="px-3 py-2.5">
                            <div className="text-sm font-medium text-neutral-200">{d.agent_name}</div>
                            <div className="text-[10px] text-neutral-600">{getModelLabel(d.model)}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                              d.action_taken === "LONG" ? "bg-green-500/20 text-green-400" :
                              d.action_taken === "SHORT" ? "bg-red-500/20 text-red-400" :
                              "bg-neutral-700 text-neutral-300"
                            }`}>
                              {d.action_taken}
                            </span>
                            <span className="text-sm text-neutral-300 ml-1.5">{d.qty}x {d.ticker}</span>
                            <div className="text-[10px] text-neutral-600">@ ${d.price.toFixed(2)}</div>
                          </td>
                          <td className="px-3 py-2.5 max-w-[200px]">
                            <div className="text-xs text-neutral-400 truncate" title={d.news_headline}>{d.news_headline}</div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className={`text-[10px] px-1 py-0.5 rounded ${
                                d.news_type === "macro" ? "bg-yellow-500/10 text-yellow-500" : "bg-blue-500/10 text-blue-400"
                              }`}>
                                {d.news_type === "macro" ? "Macro" : "Company"}
                              </span>
                              {d.news_category && d.news_category !== "unknown" && (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-neutral-800 text-neutral-500 capitalize">
                                  {d.news_category.replace(/_/g, " ")}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            {d.pnl_from_trade != null ? (
                              <span className={`text-sm font-semibold ${d.pnl_from_trade >= 0 ? "text-green-400" : "text-red-400"}`}>
                                {d.pnl_from_trade >= 0 ? "+" : ""}{d.pnl_from_trade.toFixed(2)}%
                              </span>
                            ) : (
                              <span className="text-xs text-neutral-600">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {d.was_correct === 1 ? (
                              <span className="text-green-400 text-sm font-bold">&#10003;</span>
                            ) : d.was_correct === 0 ? (
                              <span className="text-red-400 text-sm font-bold">&#10007;</span>
                            ) : (
                              <span className="text-neutral-600 text-xs">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 max-w-[250px]">
                            <div className="text-xs text-neutral-500 truncate" title={d.reasoning}>{d.reasoning}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Head to Head tab */}
          {tab === "h2h" && (
            h2hData.length === 0 ? (
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-12 text-center">
                <p className="text-neutral-500">No head-to-head data yet. Play more matches!</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-neutral-500 mb-1">Models that competed in the same matches</div>
                {h2hData.map((row, i) => {
                  const aWinPct = row.matches > 0 ? Math.round((row.a_wins / row.matches) * 100) : 0;
                  const bWinPct = row.matches > 0 ? Math.round((row.b_wins / row.matches) * 100) : 0;
                  const aLeading = row.a_wins > row.b_wins;
                  const bLeading = row.b_wins > row.a_wins;
                  return (
                    <div key={i} className="rounded-xl border border-neutral-800 bg-neutral-900/50 overflow-hidden">
                      <div className="flex items-stretch">
                        {/* Model A */}
                        <div className={`flex-1 p-4 ${aLeading ? "bg-green-500/5" : ""}`}>
                          <Link href={`/leaderboard/${encodeURIComponent(row.model_a)}`} className="text-sm font-semibold text-neutral-200 hover:text-amber-400 transition-colors">
                            {getModelLabel(row.model_a)}
                          </Link>
                          <div className="mt-1">
                            <span className={`text-2xl font-bold ${aLeading ? "text-green-400" : "text-neutral-400"}`}>{row.a_wins}</span>
                            <span className="text-xs text-neutral-500 ml-1">wins ({aWinPct}%)</span>
                          </div>
                        </div>
                        {/* VS */}
                        <div className="flex items-center justify-center px-4 border-x border-neutral-800">
                          <div className="text-center">
                            <div className="text-xs text-neutral-600 uppercase tracking-wider">vs</div>
                            <div className="text-[10px] text-neutral-700 mt-1">{row.matches} matches</div>
                            {row.ties > 0 && <div className="text-[10px] text-neutral-700">{row.ties} ties</div>}
                          </div>
                        </div>
                        {/* Model B */}
                        <div className={`flex-1 p-4 text-right ${bLeading ? "bg-green-500/5" : ""}`}>
                          <Link href={`/leaderboard/${encodeURIComponent(row.model_b)}`} className="text-sm font-semibold text-neutral-200 hover:text-amber-400 transition-colors">
                            {getModelLabel(row.model_b)}
                          </Link>
                          <div className="mt-1">
                            <span className={`text-2xl font-bold ${bLeading ? "text-green-400" : "text-neutral-400"}`}>{row.b_wins}</span>
                            <span className="text-xs text-neutral-500 ml-1">wins ({bWinPct}%)</span>
                          </div>
                        </div>
                      </div>
                      {/* Win rate bar */}
                      <div className="h-1 flex">
                        <div className="bg-green-500/40" style={{ width: `${aWinPct}%` }} />
                        <div className="bg-neutral-800 flex-1" />
                        <div className="bg-blue-500/40" style={{ width: `${bWinPct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </>
      )}
    </main>
  );
}

function Empty() {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-12 text-center">
      <p className="text-neutral-500">No match data yet. Play some matches first!</p>
    </div>
  );
}
