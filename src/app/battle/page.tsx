"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { StockProfile } from "@/lib/engine/stocks";
import { generateMatchStocks } from "@/lib/engine/stocks";
import { useBattle, type BattlePhase, type RoundRetroData } from "@/lib/hooks/useBattle";
import {
  type BattleStock,
  type Portfolio,
  type PortfolioPosition,
  type AgentStrategyRec,
  type AgentAdjustment,
  type ArenaChatMessage,
  type NpcConfig,
  type StandingEntry,
  type TradeInfo,
  TOTAL_ROUNDS,
  STARTING_CASH,
  computeStockImpacts,
} from "@/lib/battle/engine";
import { STRATEGY_TEMPLATES } from "@/lib/constants/strategyTemplates";
import { formatCurrency, formatPct, getModelLabel } from "@/lib/utils/format";
import type { NewsEvent } from "@/lib/engine/types";

// ============================================================
// Sector colors
// ============================================================

const SECTOR_COLORS: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  tech:       { bg: "bg-blue-500/8",   text: "text-blue-400",   border: "border-blue-500/20",   badge: "bg-blue-500/15 text-blue-400" },
  energy:     { bg: "bg-amber-500/8",  text: "text-amber-400",  border: "border-amber-500/20",  badge: "bg-amber-500/15 text-amber-400" },
  finance:    { bg: "bg-green-500/8",  text: "text-green-400",  border: "border-green-500/20",  badge: "bg-green-500/15 text-green-400" },
  healthcare: { bg: "bg-red-500/8",    text: "text-red-400",    border: "border-red-500/20",    badge: "bg-red-500/15 text-red-400" },
  consumer:   { bg: "bg-purple-500/8", text: "text-purple-400", border: "border-purple-500/20", badge: "bg-purple-500/15 text-purple-400" },
  index:      { bg: "bg-cyan-500/8",   text: "text-cyan-400",   border: "border-cyan-500/20",   badge: "bg-cyan-500/15 text-cyan-400" },
};

const SECTOR_LABEL: Record<string, string> = {
  tech: "Tech", energy: "Energy", finance: "Finance", healthcare: "Healthcare", consumer: "Consumer", index: "Index",
};

// ============================================================
// Helper: Strip JSON from agent text
// ============================================================

function stripJsonFromText(text: string): string {
  let cleaned = text.replace(/```json\s*[\s\S]*?```/g, "").trim();
  cleaned = cleaned.replace(/\{[\s\S]*?"trades"[\s\S]*?\}/g, "").trim();
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned || "Strategy loaded.";
}

// ============================================================
// Top Bar
// ============================================================

function TopBar({
  round, phase, countdown, tradingTimeLeft, userCash, openPnl, userTotalValue, onExit,
}: {
  round: number; phase: BattlePhase; countdown: number; tradingTimeLeft: number;
  userCash: number; openPnl: number; userTotalValue: number; onExit: () => void;
}) {
  const timeDisplay = phase === "trading"
    ? `${Math.floor(tradingTimeLeft / 60)}:${String(tradingTimeLeft % 60).padStart(2, "0")}`
    : phase === "pre_round" ? `Starting in ${countdown}s`
    : phase === "round_end" ? "Round over" : "Match over";

  const urgent = phase === "trading" && tradingTimeLeft <= 10;
  const totalReturn = ((userTotalValue - STARTING_CASH) / STARTING_CASH);

  return (
    <div className="flex items-center justify-between px-5 py-2 bg-neutral-900 border-b border-neutral-800">
      <div className="flex items-center gap-3">
        <button onClick={onExit}
          className="text-xs font-medium text-neutral-500 hover:text-red-400 transition-colors px-2 py-1 rounded border border-neutral-700 hover:border-red-500/40">EXIT</button>
        <div className="text-sm">
          <span className="text-neutral-500">R</span>
          <span className="text-neutral-100 font-bold">{round}</span>
          <span className="text-neutral-500">/{TOTAL_ROUNDS}</span>
        </div>
        <div className={`font-[family-name:var(--font-geist-mono)] text-sm font-semibold px-3 py-1 rounded-md ${
          urgent ? "bg-red-500/15 text-red-400 animate-pulse" : "bg-neutral-800 text-neutral-300"
        }`}>{timeDisplay}</div>
      </div>
      <div className="flex items-center gap-4 text-xs font-[family-name:var(--font-geist-mono)]">
        <div><span className="text-neutral-500">Cash: </span><span className="text-neutral-200">{formatCurrency(userCash)}</span></div>
        <div className="h-3 w-px bg-neutral-700" />
        <div><span className="text-neutral-500">Open P&L: </span>
          <span className={openPnl >= 0 ? "text-green-400" : "text-red-400"}>{openPnl >= 0 ? "+" : ""}{formatCurrency(openPnl)}</span></div>
        <div className="h-3 w-px bg-neutral-700" />
        <div><span className="text-neutral-500">Value: </span><span className="text-neutral-100 font-semibold">{formatCurrency(userTotalValue)}</span></div>
        <div className="h-3 w-px bg-neutral-700" />
        <div><span className="text-neutral-500">Return: </span>
          <span className={`font-semibold ${totalReturn >= 0 ? "text-green-400" : "text-red-400"}`}>{totalReturn >= 0 ? "+" : ""}{(totalReturn * 100).toFixed(2)}%</span></div>
      </div>
    </div>
  );
}

// ============================================================
// PART 3: News Banner — persistent, macro + company, colored
// ============================================================

function NewsBanner({ newsEvents, stocks, phase }: { newsEvents: NewsEvent[]; stocks: BattleStock[]; phase: BattlePhase }) {
  if (phase !== "trading" || newsEvents.length === 0) return null;

  const macroEvents = newsEvents.filter(e => e.newsType === "macro" || (!e.newsType && newsEvents.indexOf(e) === 0));
  const companyEvents = newsEvents.filter(e => e.newsType === "company_specific");
  const latestCompany = companyEvents.length > 0 ? companyEvents[companyEvents.length - 1] : null;
  const latestImpacts = latestCompany ? computeStockImpacts(latestCompany, stocks) : [];

  // Determine if latest company news is positive or negative overall
  const companyPositive = latestCompany
    ? Object.values(latestCompany.sectorImpacts).reduce((s, v) => s + v, 0) >= 0
    : true;

  return (
    <div className="border-b border-neutral-800">
      {/* Macro banner — gold, persistent */}
      {macroEvents.length > 0 && (
        <div className="bg-gradient-to-r from-yellow-500/15 to-amber-500/10 border-b border-yellow-500/20 px-5 py-2.5">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-yellow-500 shrink-0">MACRO</span>
            <span className="text-base font-bold text-yellow-300 flex-1">{macroEvents[macroEvents.length - 1].headline}</span>
          </div>
        </div>
      )}
      {/* Company news — amber/green/red, below macro */}
      {latestCompany && (
        <div className={`px-5 py-2 ${
          companyPositive
            ? "bg-gradient-to-r from-green-500/10 to-green-500/5 border-b border-green-500/15"
            : "bg-gradient-to-r from-red-500/10 to-red-500/5 border-b border-red-500/15"
        }`}>
          <div className="flex items-center gap-3">
            <span className={`text-[10px] font-bold uppercase tracking-wider shrink-0 ${companyPositive ? "text-green-500" : "text-red-500"}`}>
              {companyPositive ? "BULLISH" : "BEARISH"}
            </span>
            <span className={`text-sm font-semibold flex-1 ${companyPositive ? "text-green-300" : "text-red-300"}`}>
              {latestCompany.headline}
            </span>
            <div className="flex gap-1 shrink-0">
              {latestImpacts.slice(0, 5).map((si) => (
                <span key={si.ticker} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full font-[family-name:var(--font-geist-mono)] ${
                  si.expectedMovePct > 0 ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                }`}>{si.ticker} {si.expectedMovePct > 0 ? "+" : ""}{(si.expectedMovePct * 100).toFixed(1)}%</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Stock Card — PART 2: 18px bold company name
// ============================================================

function StockCard({
  stock, position, canTrade, onTrade, autopilot,
}: {
  stock: BattleStock; position: PortfolioPosition | undefined; canTrade: boolean;
  onTrade: (ticker: string, action: "LONG" | "SHORT" | "CLOSE", qty: number) => { ok: boolean; reason: string };
  autopilot?: boolean;
}) {
  const [tradeMode, setTradeMode] = useState<"LONG" | "SHORT" | "CLOSE" | null>(null);
  const [qtyInput, setQtyInput] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const colors = SECTOR_COLORS[stock.sector] ?? SECTOR_COLORS.tech;
  const changePct = ((stock.price - stock.startPrice) / stock.startPrice) * 100;
  const positive = changePct >= 0;
  const tickUp = stock.price > stock.prevTickPrice;
  const tickDown = stock.price < stock.prevTickPrice;
  const bigMove = Math.abs((stock.price - stock.prevTickPrice) / stock.prevTickPrice) > 0.01;
  const flashClass = tickUp ? "animate-flash-green" : tickDown ? "animate-flash-red" : "";
  const pulseClass = bigMove ? "ring-1 ring-amber-500/30" : "";

  useEffect(() => { if (tradeMode && inputRef.current) inputRef.current.focus(); }, [tradeMode]);

  const handleConfirm = () => {
    const qty = parseInt(qtyInput);
    if (!qty || qty <= 0) { setError("Enter a valid quantity"); return; }
    const result = onTrade(stock.ticker, tradeMode!, qty);
    if (result.ok) { setTradeMode(null); setQtyInput(""); setError(""); }
    else { setError(result.reason); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleConfirm();
    if (e.key === "Escape") { setTradeMode(null); setQtyInput(""); setError(""); }
  };

  return (
    <div className={`rounded-xl border ${colors.border} bg-neutral-900 overflow-hidden ${flashClass} ${pulseClass}`}>
      <div className={`h-0.5 ${colors.bg.replace("/8", "/40")}`} />
      <div className="p-3">
        {/* Ticker + position badge */}
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex items-center gap-2">
            <span className="font-[family-name:var(--font-geist-mono)] text-sm font-bold text-neutral-100">{stock.ticker}</span>
            <span className={`text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${colors.badge}`}>
              {SECTOR_LABEL[stock.sector] ?? stock.sector}
            </span>
          </div>
          {position && (
            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${
              position.side === "long" ? "text-green-400 bg-green-500/10" : "text-red-400 bg-red-500/10"
            }`}>{position.side.toUpperCase()} {position.qty} @ ${position.avgCost.toFixed(0)}</span>
          )}
        </div>
        {/* PART 2: Company name — 18px bold */}
        <p className="text-lg font-bold text-neutral-200 truncate mb-1">{stock.name}</p>
        <div className="flex items-baseline gap-2 mb-1.5">
          <span className="text-xl font-bold font-[family-name:var(--font-geist-mono)] text-neutral-100">${stock.price.toFixed(2)}</span>
          <span className={`text-xs font-[family-name:var(--font-geist-mono)] font-medium ${positive ? "text-green-400" : "text-red-400"}`}>
            {positive ? "\u25B2" : "\u25BC"} {positive ? "+" : ""}{changePct.toFixed(2)}%
          </span>
        </div>
        {/* PART 2: Stats row — ensure contrast */}
        <div className="flex items-center gap-1.5 mb-1.5 text-[10px] text-neutral-400 font-[family-name:var(--font-geist-mono)] flex-wrap">
          <span>{"\u03B2"}{stock.beta.toFixed(1)}</span><span className="text-neutral-600">|</span>
          <span>{stock.marketCap}</span><span className="text-neutral-600">|</span>
          <span>P/E {stock.peRatio.toFixed(0)}</span><span className="text-neutral-600">|</span>
          <span>EPS ${stock.eps.toFixed(1)}</span><span className="text-neutral-600">|</span>
          <span>D/E {stock.debtEbitda.toFixed(1)}</span>
        </div>
        {canTrade && !tradeMode && !autopilot && (
          <div className="flex gap-1.5">
            <button onClick={() => { setTradeMode("LONG"); setQtyInput("25"); setError(""); }}
              className="flex-1 py-1 rounded-md text-[10px] font-semibold bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors">LONG</button>
            <button onClick={() => { setTradeMode("SHORT"); setQtyInput("25"); setError(""); }}
              className="flex-1 py-1 rounded-md text-[10px] font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors">SHORT</button>
            {position && (
              <button onClick={() => { setTradeMode("CLOSE"); setQtyInput(String(position.qty)); setError(""); }}
                className="flex-1 py-1 rounded-md text-[10px] font-semibold bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors">CLOSE</button>
            )}
          </div>
        )}
        {canTrade && autopilot && !tradeMode && (
          <div className="text-[9px] text-neutral-600 text-center py-1 flex items-center justify-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            Auto-Agent is trading for you
          </div>
        )}
        {canTrade && tradeMode && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-semibold ${tradeMode === "LONG" ? "text-green-400" : tradeMode === "SHORT" ? "text-red-400" : "text-amber-400"}`}>{tradeMode}</span>
              <input ref={inputRef} type="number" value={qtyInput} onChange={(e) => { setQtyInput(e.target.value); setError(""); }}
                onKeyDown={handleKeyDown} placeholder="Qty"
                className="flex-1 h-6 rounded border border-neutral-700 bg-neutral-800 px-2 text-[10px] text-neutral-100 font-[family-name:var(--font-geist-mono)] focus:border-amber-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              <button onClick={handleConfirm} className="h-6 px-2 rounded text-[10px] font-semibold bg-amber-500 text-black hover:bg-amber-400">OK</button>
              <button onClick={() => { setTradeMode(null); setQtyInput(""); setError(""); }} className="h-6 px-1.5 text-[10px] text-neutral-500 hover:text-neutral-300">&times;</button>
            </div>
            <div className="flex gap-1">
              {[10, 25, 50, 100].map((q) => (
                <button key={q} onClick={() => setQtyInput(String(q))}
                  className={`flex-1 py-0.5 rounded text-[9px] font-medium ${qtyInput === String(q) ? "bg-amber-500/20 text-amber-400" : "bg-neutral-800 text-neutral-500 hover:text-neutral-300"}`}>{q}</button>
              ))}
            </div>
            {qtyInput && parseInt(qtyInput) > 0 && (
              <div className="text-[9px] text-neutral-500 font-[family-name:var(--font-geist-mono)]">Total: ${(parseInt(qtyInput) * stock.price).toFixed(2)}</div>
            )}
            {error && <div className="text-[9px] text-red-400">{error}</div>}
          </div>
        )}
        {!canTrade && <div className="text-[9px] text-neutral-600 text-center py-1">Trading paused</div>}
      </div>
    </div>
  );
}

// ============================================================
// Positions Table
// ============================================================

function PositionsTable({ portfolio, stocks }: { portfolio: Portfolio; stocks: BattleStock[] }) {
  const positions = Object.entries(portfolio.positions);
  if (positions.length === 0) return null;

  let totalMktVal = 0; let totalPnl = 0; let totalCost = 0;
  const rows = positions.map(([ticker, pos]) => {
    const stock = stocks.find((s) => s.ticker === ticker);
    if (!stock) return null;
    const mktVal = pos.qty * stock.price;
    const pnl = pos.side === "long" ? (stock.price - pos.avgCost) * pos.qty : (pos.avgCost - stock.price) * pos.qty;
    const pnlPct = pos.side === "long" ? (stock.price - pos.avgCost) / pos.avgCost : (pos.avgCost - stock.price) / pos.avgCost;
    const cost = pos.qty * pos.avgCost;
    totalMktVal += mktVal; totalPnl += pnl; totalCost += cost;
    return { ticker, pos, stock, mktVal, pnl, pnlPct, cost };
  }).filter(Boolean) as { ticker: string; pos: PortfolioPosition; stock: BattleStock; mktVal: number; pnl: number; pnlPct: number; cost: number }[];

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-neutral-800">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Your Positions</span>
      </div>
      <table className="w-full text-[11px]">
        <thead><tr className="text-neutral-500 text-left border-b border-neutral-800/50">
          <th className="px-3 py-1.5 font-medium">Stock</th><th className="px-2 py-1.5 font-medium">Side</th>
          <th className="px-2 py-1.5 font-medium text-right">Shares</th><th className="px-2 py-1.5 font-medium text-right">Entry</th>
          <th className="px-2 py-1.5 font-medium text-right">Current</th><th className="px-2 py-1.5 font-medium text-right">Mkt Value</th>
          <th className="px-2 py-1.5 font-medium text-right">P&L</th><th className="px-2 py-1.5 font-medium text-right">P&L %</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ticker} className="border-b border-neutral-800/30 hover:bg-neutral-800/20">
              <td className="px-3 py-1.5 font-[family-name:var(--font-geist-mono)] font-semibold text-neutral-200">{r.ticker}</td>
              <td className="px-2 py-1.5"><span className={`text-[9px] font-semibold px-1 py-0.5 rounded ${r.pos.side === "long" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>{r.pos.side.toUpperCase()}</span></td>
              <td className="px-2 py-1.5 text-right text-neutral-300 font-[family-name:var(--font-geist-mono)]">{r.pos.qty}</td>
              <td className="px-2 py-1.5 text-right text-neutral-400 font-[family-name:var(--font-geist-mono)]">${r.pos.avgCost.toFixed(2)}</td>
              <td className="px-2 py-1.5 text-right text-neutral-200 font-[family-name:var(--font-geist-mono)]">${r.stock.price.toFixed(2)}</td>
              <td className="px-2 py-1.5 text-right text-neutral-300 font-[family-name:var(--font-geist-mono)]">{formatCurrency(r.mktVal)}</td>
              <td className={`px-2 py-1.5 text-right font-[family-name:var(--font-geist-mono)] font-semibold ${r.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>{r.pnl >= 0 ? "+" : ""}{formatCurrency(r.pnl)}</td>
              <td className={`px-2 py-1.5 text-right font-[family-name:var(--font-geist-mono)] ${r.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>{r.pnlPct >= 0 ? "+" : ""}{(r.pnlPct * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t border-neutral-700/50">
          <td className="px-3 py-1.5 font-semibold text-neutral-400" colSpan={5}>Total</td>
          <td className="px-2 py-1.5 text-right font-[family-name:var(--font-geist-mono)] text-neutral-300 font-semibold">{formatCurrency(totalMktVal)}</td>
          <td className={`px-2 py-1.5 text-right font-[family-name:var(--font-geist-mono)] font-bold ${totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>{totalPnl >= 0 ? "+" : ""}{formatCurrency(totalPnl)}</td>
          <td className="px-2 py-1.5"></td>
        </tr></tfoot>
      </table>
      <div className="flex items-center gap-4 px-3 py-1.5 border-t border-neutral-800 text-[10px] text-neutral-500 font-[family-name:var(--font-geist-mono)]">
        <span>Cash: {formatCurrency(portfolio.cash)}</span>
        <span>Invested: {formatCurrency(totalCost)}</span>
        <span>Total: <span className="text-neutral-300 font-semibold">{formatCurrency(portfolio.cash + totalMktVal)}</span></span>
      </div>
    </div>
  );
}

// ============================================================
// PART 4: MY AGENT Panel — persistent activity log across all rounds
// ============================================================

interface ActivityLogEntry {
  id: number;
  round: number;
  timeLeft: number;
  newsHeadline: string | null;
  reasoning: string;
  trades: { action: string; ticker: string; qty: number }[];
  status: "executed" | "auto-executed" | "auto-adjusted" | "auto-hold" | "hold" | "pending";
}

function MyAgentPanel({
  strategy, adjustments, loading, strategyExecuted, autopilot, modelLabel,
  onExecute, onExecuteAdjustment, onToggleAutopilot,
  chatMessages, chatLoading, onSendChat,
  activityLog,
}: {
  strategy: AgentStrategyRec | null; adjustments: AgentAdjustment[]; loading: boolean;
  strategyExecuted: boolean; autopilot: boolean; modelLabel: string;
  round: number; tradingTimeLeft: number;
  onExecute: () => { executed: number; failed: number; skipped: number; details: string[] };
  onExecuteAdjustment: (index: number) => { executed: number; failed: number; skipped: number; details: string[] };
  onToggleAutopilot: () => void;
  chatMessages: { role: "user" | "assistant"; content: string }[]; chatLoading: boolean; onSendChat: (msg: string) => void;
  activityLog: ActivityLogEntry[];
}) {
  const [chatInput, setChatInput] = useState("");
  const [autoExecFlash, setAutoExecFlash] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activityLog.length, chatMessages.length]);

  useEffect(() => {
    if (autopilot && strategyExecuted) {
      setAutoExecFlash(true);
      const t = setTimeout(() => setAutoExecFlash(false), 2000);
      return () => clearTimeout(t);
    }
  }, [autopilot, strategyExecuted]);

  const handleExecute = () => { onExecute(); };

  const handleSend = () => { const msg = chatInput.trim(); if (!msg || chatLoading) return; setChatInput(""); onSendChat(msg); };

  const latestAdj = adjustments.length > 0 ? adjustments[adjustments.length - 1] : null;

  return (
    <div className={`rounded-xl border bg-neutral-900 overflow-hidden flex flex-col transition-all ${autoExecFlash ? "border-green-500/50 shadow-lg shadow-green-500/10" : "border-neutral-800"}`}>
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-neutral-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-500">My Agent</h2>
          <span className="text-[10px] text-neutral-600 font-[family-name:var(--font-geist-mono)]">{modelLabel}</span>
        </div>
        <button onClick={onToggleAutopilot}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-semibold transition-colors ${
            autopilot ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-neutral-800 text-neutral-500 border border-neutral-700 hover:text-neutral-300"
          }`}>
          {autopilot && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
          AUTO-AGENT {autopilot ? "ON" : "OFF"}
        </button>
      </div>

      {/* Activity log — persistent, scrollable, spans all rounds */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-2 min-h-0" style={{ maxHeight: "400px" }}>
        {loading && activityLog.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-amber-400 py-2">
            <div className="w-3 h-3 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
            Analyzing market...
          </div>
        )}

        {activityLog.map((entry) => (
          <div key={entry.id} className="border-b border-neutral-800/30 pb-2 last:border-0">
            {/* Round + time + news */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold text-neutral-500 font-[family-name:var(--font-geist-mono)]">
                R{entry.round} {"\u00B7"} {Math.floor(entry.timeLeft / 60)}:{String(entry.timeLeft % 60).padStart(2, "0")}
              </span>
              {entry.newsHeadline && (
                <span className="text-[10px] text-amber-400/80 truncate flex-1">| {entry.newsHeadline}</span>
              )}
            </div>
            {/* Reasoning — PART 2: 15px readable */}
            <p className="text-[13px] leading-relaxed text-neutral-300 mb-1.5">{stripJsonFromText(entry.reasoning)}</p>
            {/* Trade cards */}
            {entry.trades.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mb-1">
                {entry.trades.map((t, j) => (
                  <span key={j} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold font-[family-name:var(--font-geist-mono)] ${
                    t.action === "LONG" ? "bg-green-500/15 text-green-400" : t.action === "SHORT" ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400"
                  }`}>{t.action} {t.qty}x {t.ticker}</span>
                ))}
              </div>
            ) : null}
            {/* Status */}
            <div className={`text-[10px] font-semibold uppercase tracking-wider ${
              entry.status.includes("auto") ? "text-green-400/70" : entry.status === "executed" ? "text-green-400/70" : entry.status === "pending" ? "text-amber-400/70" : "text-neutral-500"
            }`}>
              {entry.status === "auto-executed" ? "AUTO-EXECUTED \u2713" :
               entry.status === "auto-adjusted" ? "AUTO-ADJUSTED \u2713" :
               entry.status === "auto-hold" ? "AUTO-HOLD \u2713" :
               entry.status === "executed" ? "EXECUTED \u2713" :
               entry.status === "hold" ? "HOLD \u2713" :
               "PENDING"}
            </div>
          </div>
        ))}

        {/* Pending strategy that hasn't been logged yet */}
        {loading && activityLog.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-amber-400 py-1">
            <div className="w-2.5 h-2.5 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
            Analyzing new situation...
          </div>
        )}

        {/* Manual execute button for latest unexxecuted strategy */}
        {!autopilot && strategy && strategy.trades.length > 0 && !strategyExecuted && !loading && (
          <button onClick={handleExecute}
            className="w-full py-2 rounded-lg text-xs font-bold bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors border border-green-500/20">
            EXECUTE STRATEGY
          </button>
        )}
        {!autopilot && latestAdj && !latestAdj.executed && latestAdj.trades.length > 0 && (
          <button onClick={() => onExecuteAdjustment(adjustments.length - 1)}
            className="w-full py-1.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/20">
            EXECUTE ADJUSTMENT
          </button>
        )}

        {/* Chat messages */}
        {chatMessages.length > 0 && (
          <div className="space-y-1.5 border-t border-neutral-800/50 pt-2 mt-2">
            {chatMessages.map((m, i) => (
              <div key={i} className={`text-[13px] leading-relaxed ${m.role === "user" ? "text-blue-400" : "text-neutral-300"}`}>
                <span className="font-semibold text-[10px] uppercase tracking-wider opacity-60">{m.role === "user" ? "You" : "Agent"}</span>
                <p className="mt-0.5">{m.role === "assistant" ? stripJsonFromText(m.content) : m.content}</p>
              </div>
            ))}
            {chatLoading && <div className="text-xs text-neutral-500 animate-pulse">Thinking...</div>}
          </div>
        )}
      </div>

      {/* Chat input — always at bottom */}
      <div className="px-4 py-2 border-t border-neutral-800 shrink-0">
        <div className="flex gap-1.5">
          <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()} placeholder="Ask your agent..."
            className="flex-1 h-7 rounded border border-neutral-700 bg-neutral-800 px-3 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-amber-500 focus:outline-none" />
          <button onClick={handleSend} disabled={chatLoading || !chatInput.trim()}
            className="h-7 px-3 rounded text-xs font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-40">Send</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Leaderboard Panel (sidebar — PART 2: 14px names)
// ============================================================

function LeaderboardPanel({ standings }: { standings: StandingEntry[] }) {
  return (
    <div className="border-b border-neutral-800 px-3 py-2">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">Leaderboard</h2>
      <div className="space-y-1">
        {standings.map((s, i) => (
          <div key={s.name} className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] ${
            s.isUser ? "bg-amber-500/5 border border-amber-500/20" : ""
          }`}>
            <span className="text-neutral-500 font-[family-name:var(--font-geist-mono)] w-3 text-[10px]">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <span className={`text-[13px] font-medium truncate ${s.isUser ? "text-amber-400" : "text-neutral-300"}`}>{s.name}</span>
                {s.isUser && <span className="text-[7px] uppercase font-bold text-amber-500">YOU</span>}
              </div>
              <div className="text-[9px] text-neutral-600 truncate">{getModelLabel(s.model)}</div>
            </div>
            <span className={`font-[family-name:var(--font-geist-mono)] font-medium text-[11px] ${s.pnlPct >= 0 ? "text-green-400" : "text-red-400"}`}>
              {formatPct(s.pnlPct)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// PART 5: Arena Chat + Trade Log — split view, persistent across rounds
// ============================================================

const NPC_COLORS: Record<string, string> = {
  "Momentum Trader": "text-green-400", "Contrarian": "text-red-400", "Sector Rotator": "text-blue-400", "Value Hunter": "text-purple-400",
};

function ArenaChatPanel({ messages, onSendMessage }: { messages: ArenaChatMessage[]; onSendMessage: (content: string) => void; round: number }) {
  const [input, setInput] = useState("");
  const [tradeLogCollapsed, setTradeLogCollapsed] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const tradeScrollRef = useRef<HTMLDivElement>(null);

  // Split messages: chat = personality + news + system announcements; trades = npc_trade + user_trade
  const chatMessages = messages.filter((m) => !m.isSystem || m.systemType === "news" || m.systemType === "system");
  const tradeMessages = messages.filter((m) => m.isSystem && (m.systemType === "npc_trade" || m.systemType === "user_trade"));

  useEffect(() => { if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight; }, [chatMessages.length]);
  useEffect(() => { if (tradeScrollRef.current) tradeScrollRef.current.scrollTop = tradeScrollRef.current.scrollHeight; }, [tradeMessages.length]);

  const handleSend = () => { const msg = input.trim(); if (!msg) return; setInput(""); onSendMessage(msg); };

  // Track round separators for chat
  let lastChatRound = 0;
  let lastTradeRound = 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ARENA CHAT — 60% */}
      <div className="flex flex-col" style={{ flex: tradeLogCollapsed ? "1 1 auto" : "0 0 60%" }}>
        <div className="px-3 py-1.5 border-b border-neutral-800">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-cyan-500">Arena Chat</h2>
        </div>
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-3 py-1.5 space-y-0.5 min-h-0">
          {chatMessages.length === 0 && <span className="text-xs text-neutral-600">Waiting for action...</span>}
          {chatMessages.map((m) => {
            let separator = null;
            if (m.isSystem && m.systemType === "system" && m.message.includes("Trading is open")) {
              const roundMatch = m.message.match(/Round (\d+)/);
              const msgRound = roundMatch ? parseInt(roundMatch[1]) : 0;
              if (msgRound > lastChatRound) {
                lastChatRound = msgRound;
                separator = (
                  <div key={`csep-${msgRound}`} className="flex items-center gap-2 py-1.5 my-1">
                    <div className="flex-1 h-px bg-neutral-700/50" />
                    <span className="text-[9px] font-bold text-neutral-600 uppercase tracking-wider">Round {msgRound}</span>
                    <div className="flex-1 h-px bg-neutral-700/50" />
                  </div>
                );
              }
            }

            if (m.isSystem) {
              const icon = m.systemType === "news" ? "\uD83D\uDCF0" : "\u26A1";
              const color = m.systemType === "news" ? "text-amber-500/80" : "text-neutral-500";
              return (
                <div key={m.id}>
                  {separator}
                  <div className={`text-[11px] leading-relaxed ${color}`}>
                    <span className="mr-1">{icon}</span>{m.message}
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id}>
                {separator}
                <div className="text-[13px] leading-relaxed">
                  <span className={`font-semibold ${m.isUser ? "text-amber-400" : (NPC_COLORS[m.agentName] || "text-cyan-400")}`}>{m.agentName}</span>
                  {m.agentModel && !m.isUser && <span className="text-[8px] text-neutral-600 font-[family-name:var(--font-geist-mono)] ml-1">{m.agentModel}</span>}
                  <span className="text-neutral-600">: </span>
                  <span className="text-neutral-300">{m.message}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-3 py-1 border-t border-neutral-800/50">
          <div className="flex gap-1.5">
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()} placeholder="Chat..."
              className="flex-1 h-6 rounded border border-neutral-700 bg-neutral-800 px-2 text-[11px] text-neutral-100 placeholder:text-neutral-600 focus:border-cyan-500 focus:outline-none" />
            <button onClick={handleSend} disabled={!input.trim()}
              className="h-6 px-2 rounded text-[10px] font-semibold bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 disabled:opacity-40">Send</button>
          </div>
        </div>
      </div>

      {/* TRADE LOG — 40% (collapsible) */}
      <div className={`flex flex-col border-t border-neutral-800 ${tradeLogCollapsed ? "" : "flex-[0_0_40%]"}`}>
        <button onClick={() => setTradeLogCollapsed(!tradeLogCollapsed)}
          className="px-3 py-1.5 flex items-center justify-between hover:bg-neutral-800/30 transition-colors shrink-0">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Trade Log <span className="text-neutral-600 ml-1">({tradeMessages.length})</span>
          </h2>
          <span className="text-neutral-600 text-[10px]">{tradeLogCollapsed ? "\u25BC" : "\u25B2"}</span>
        </button>
        {!tradeLogCollapsed && (
          <div ref={tradeScrollRef} className="flex-1 overflow-y-auto px-3 py-1 space-y-0.5 min-h-0">
            {tradeMessages.length === 0 && <span className="text-[10px] text-neutral-600">No trades yet...</span>}
            {tradeMessages.map((m) => {
              let separator = null;
              // Insert round separators based on preceding system messages
              const msgIdx = messages.indexOf(m);
              for (let i = msgIdx - 1; i >= 0; i--) {
                const prev = messages[i];
                if (prev.isSystem && prev.systemType === "system" && prev.message.includes("Trading is open")) {
                  const roundMatch = prev.message.match(/Round (\d+)/);
                  const msgRound = roundMatch ? parseInt(roundMatch[1]) : 0;
                  if (msgRound > lastTradeRound) {
                    lastTradeRound = msgRound;
                    separator = (
                      <div key={`tsep-${msgRound}`} className="flex items-center gap-2 py-1 my-0.5">
                        <div className="flex-1 h-px bg-neutral-800/50" />
                        <span className="text-[8px] font-bold text-neutral-700 uppercase tracking-wider">R{msgRound}</span>
                        <div className="flex-1 h-px bg-neutral-800/50" />
                      </div>
                    );
                  }
                  break;
                }
              }

              const icon = m.systemType === "user_trade" ? "\uD83D\uDC64" : "\uD83E\uDD16";
              const color = m.systemType === "user_trade" ? "text-blue-400/70" : "text-neutral-500";
              return (
                <div key={m.id}>
                  {separator}
                  <div className={`text-[11px] leading-snug ${color}`}>
                    <span className="mr-0.5">{icon}</span>
                    {m.systemType === "npc_trade" && (
                      <><span className="font-medium text-neutral-400">{m.agentName}</span>
                      {m.agentModel && <span className="text-[8px] text-neutral-700 font-[family-name:var(--font-geist-mono)] mx-0.5">{m.agentModel}</span>}
                      <span className="text-neutral-600">: </span></>
                    )}
                    <span className="text-neutral-500">{m.message}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Overlays
// ============================================================

function NewsFlashOverlay({ round, countdown, headline, stocks }: {
  round: number; countdown: number; headline: string | null; stocks?: BattleStock[];
}) {
  return (
    <div className="fixed inset-0 z-40">
      {/* Dimmed stock cards in background */}
      {stocks && stocks.length > 0 && (
        <div className="absolute inset-0 p-4 pt-16 overflow-hidden opacity-20 blur-[1px] pointer-events-none">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 max-w-4xl mx-auto">
            {stocks.map((stock) => {
              const colors = SECTOR_COLORS[stock.sector] ?? SECTOR_COLORS.tech;
              const changePct = ((stock.price - stock.startPrice) / stock.startPrice) * 100;
              const positive = changePct >= 0;
              return (
                <div key={stock.ticker} className={`rounded-xl border ${colors.border} bg-neutral-900 p-3`}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-[family-name:var(--font-geist-mono)] text-sm font-bold text-neutral-100">{stock.ticker}</span>
                    <span className={`text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${colors.badge}`}>
                      {SECTOR_LABEL[stock.sector] ?? stock.sector}
                    </span>
                  </div>
                  <p className="text-lg font-bold text-neutral-200 truncate mb-1">{stock.name}</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-bold font-[family-name:var(--font-geist-mono)] text-neutral-100">${stock.price.toFixed(2)}</span>
                    <span className={`text-xs font-[family-name:var(--font-geist-mono)] font-medium ${positive ? "text-green-400" : "text-red-400"}`}>
                      {positive ? "\u25B2" : "\u25BC"} {positive ? "+" : ""}{changePct.toFixed(2)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Overlay content */}
      <div className="absolute inset-0 flex items-center justify-center bg-black/60">
        <div className="max-w-xl w-full mx-4 text-center space-y-6">
          {headline ? (
            <div className="space-y-4">
              <div className="text-xs uppercase tracking-[0.3em] text-red-500 font-bold animate-pulse">Breaking News</div>
              <h2 className="text-xl font-bold text-neutral-100 leading-relaxed px-4">{headline}</h2>
            </div>
          ) : (
            <div><p className="text-neutral-400 text-lg">{round === 1 ? "Battle begins soon" : `Round ${round} starting`}</p></div>
          )}
          <div className="space-y-2">
            <p className="text-neutral-500 text-sm">Trading opens in</p>
            <div className="text-7xl font-bold font-[family-name:var(--font-geist-mono)] text-amber-500">{countdown}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RoundSummaryOverlay({ round, standings, roundPnl, roundTradeCount }: {
  round: number; standings: StandingEntry[]; roundPnl: number; roundTradeCount: number;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <h2 className="text-lg font-bold text-center mb-1">Round {round} Complete</h2>
        <p className="text-xs text-neutral-500 text-center mb-4">{round < TOTAL_ROUNDS ? "Next round starting soon..." : "Final round complete!"}</p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg bg-neutral-800/50 p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Trades</div>
            <div className="text-lg font-bold text-neutral-100">{roundTradeCount}</div>
          </div>
          <div className="rounded-lg bg-neutral-800/50 p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Round P&L</div>
            <div className={`text-lg font-bold font-[family-name:var(--font-geist-mono)] ${roundPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
              {roundPnl >= 0 ? "+" : ""}{formatCurrency(roundPnl)}</div>
          </div>
        </div>
        <div className="space-y-1.5">
          {standings.map((s, i) => (
            <div key={s.name} className={`flex items-center justify-between px-3 py-1.5 rounded-lg ${
              s.isUser ? "bg-amber-500/5 border border-amber-500/20" : "bg-neutral-800/50"
            }`}>
              <div className="flex items-center gap-2">
                <span className="text-neutral-500 text-xs font-[family-name:var(--font-geist-mono)] w-4">{i + 1}</span>
                <span className={`text-sm font-medium ${s.isUser ? "text-amber-500" : "text-neutral-300"}`}>{s.name}</span>
              </div>
              <span className={`text-sm font-[family-name:var(--font-geist-mono)] font-medium ${s.pnlPct >= 0 ? "text-green-400" : "text-red-400"}`}>{formatPct(s.pnlPct)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PART 6: Match Retro — renamed tabs, trading analysis with results
// ============================================================

function MatchRetroScreen({ retroRounds, standings, onContinue }: {
  retroRounds: RoundRetroData[]; standings: StandingEntry[]; onContinue: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"comparison" | "analysis">("comparison");

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Match Retrospective</h1>
            <p className="text-sm text-neutral-500 mt-1">Analysis of {TOTAL_ROUNDS} rounds</p>
          </div>
          <button onClick={onContinue}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 transition-all">
            View Results &rarr;
          </button>
        </div>

        <div className="flex bg-neutral-900 rounded-lg border border-neutral-800 p-0.5 mb-6 w-fit">
          {([["comparison", "Agent Comparison"], ["analysis", "Trading Analysis"]] as [string, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setActiveTab(key as typeof activeTab)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === key ? "bg-amber-500/20 text-amber-500" : "text-neutral-400 hover:text-neutral-200"
              }`}>{label}</button>
          ))}
        </div>

        {/* Agent Comparison — ALL 3 rounds */}
        {activeTab === "comparison" && (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-neutral-800 text-neutral-500 text-left">
                  <th className="px-4 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium">Strategy</th>
                  {Array.from({ length: TOTAL_ROUNDS }, (_, i) => (
                    <th key={i} className="px-3 py-2 font-medium text-right">R{i + 1}</th>
                  ))}
                  <th className="px-3 py-2 font-medium text-right">Total</th>
                  <th className="px-3 py-2 font-medium text-right">Rank</th>
                </tr></thead>
                <tbody>
                  {standings.map((s, rank) => (
                    <tr key={s.name} className={`border-b border-neutral-800/30 ${s.isUser ? "bg-amber-500/5" : ""}`}>
                      <td className="px-4 py-2 font-medium text-neutral-200">{s.name}</td>
                      <td className="px-3 py-2 text-neutral-500">{getModelLabel(s.model)}</td>
                      <td className="px-3 py-2 text-neutral-500">{s.strategy}</td>
                      {Array.from({ length: TOTAL_ROUNDS }, (_, i) => {
                        const rd = retroRounds.find(r => r.round === i + 1);
                        const pnl = rd?.agentPnls.find((p) => p.name === s.name)?.roundPnl ?? 0;
                        return (
                          <td key={i} className={`px-3 py-2 text-right font-[family-name:var(--font-geist-mono)] ${rd ? (pnl >= 0 ? "text-green-400" : "text-red-400") : "text-neutral-700"}`}>
                            {rd ? `${pnl >= 0 ? "+" : ""}${formatCurrency(pnl)}` : "-"}
                          </td>
                        );
                      })}
                      <td className={`px-3 py-2 text-right font-[family-name:var(--font-geist-mono)] font-semibold ${s.pnlPct >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {formatPct(s.pnlPct)}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-neutral-300">{rank + 1}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* PART 7: Trading Analysis — grouped by ROUND, all news + agent actions per round */}
        {activeTab === "analysis" && (
          <div className="space-y-6">
            {retroRounds.map((rd) => (
              <div key={rd.round} className="rounded-xl border border-neutral-800 bg-neutral-900/50 overflow-hidden">
                {/* Round header with stock performance */}
                <div className="px-5 py-3 border-b border-neutral-800 bg-neutral-800/30">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-bold text-neutral-200">Round {rd.round}</h3>
                    <div className="flex gap-1.5">
                      {rd.stockPrices.map(sp => (
                        <span key={sp.ticker} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded font-[family-name:var(--font-geist-mono)] ${
                          sp.changePct >= 0 ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                        }`}>{sp.ticker} {sp.changePct >= 0 ? "+" : ""}{(sp.changePct * 100).toFixed(1)}%</span>
                      ))}
                    </div>
                  </div>
                  {/* All news events this round */}
                  <div className="space-y-1.5">
                    {rd.newsEvents.map((ne, nei) => {
                      const isPositive = ne.sectorImpacts
                        ? Object.values(ne.sectorImpacts).reduce((s, v) => s + v, 0) >= 0
                        : true;
                      return (
                        <div key={nei} className="flex items-start gap-2">
                          <span className={`text-[8px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${
                            ne.newsType === "macro" ? "bg-yellow-500/15 text-yellow-400" : "bg-amber-500/15 text-amber-400"
                          }`}>{ne.newsType || "news"}</span>
                          <span className={`text-sm font-medium ${isPositive ? "text-green-300" : "text-red-300"}`}>{ne.headline}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Agent actions breakdown */}
                <div className="px-5 py-3 space-y-3">
                  {rd.agentTrades.map((at) => {
                    const pnl = rd.agentPnls.find((p) => p.name === at.name)?.roundPnl ?? 0;
                    const correct = pnl >= 0;
                    return (
                      <div key={at.name} className="border-b border-neutral-800/20 last:border-0 pb-2.5 last:pb-0">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-neutral-200">{at.name}</span>
                            <span className="text-[10px] text-neutral-600">{at.model}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-[family-name:var(--font-geist-mono)] font-semibold ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {pnl >= 0 ? "+" : ""}{formatCurrency(pnl)}
                            </span>
                            <span className="text-sm">
                              {correct ? <span className="text-green-400">{"\u2713"}</span> : <span className="text-red-400">{"\u2717"}</span>}
                            </span>
                          </div>
                        </div>
                        {at.trades.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {at.trades.map((t, j) => (
                              <span key={j} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-[family-name:var(--font-geist-mono)] font-semibold ${
                                t.action === "LONG" ? "bg-green-500/10 text-green-400" : t.action === "SHORT" ? "bg-red-500/10 text-red-400" : "bg-neutral-800 text-neutral-400"
                              }`}>{t.action} {t.qty}x {t.ticker} @ ${t.price.toFixed(2)}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[10px] text-neutral-600 italic">Held positions</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Results Screen
// ============================================================

const MEDALS = ["\uD83C\uDFC6", "\uD83E\uDD48", "\uD83E\uDD49"];

function ResultsScreen({ standings, bestTrade, worstTrade, onPlayAgain, onReconfigure }: {
  standings: StandingEntry[]; bestTrade: TradeInfo | null; worstTrade: TradeInfo | null;
  onPlayAgain: () => void; onReconfigure: () => void;
}) {
  const userEntry = standings.find((s) => s.isUser);
  const userRank = standings.findIndex((s) => s.isUser);
  const winner = standings[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-8 max-w-lg w-full mx-4 my-8 shadow-2xl">
        <h2 className="text-2xl font-bold text-center mb-1">Match Complete</h2>
        <p className="text-sm text-neutral-400 text-center mb-2">{TOTAL_ROUNDS} rounds</p>
        {winner && (
          <div className={`text-center mb-6 p-4 rounded-xl ${winner.isUser ? "bg-amber-500/10 border border-amber-500/30" : ""}`}>
            <div className="text-4xl mb-1">{MEDALS[0]}</div>
            <p className="text-lg font-bold text-amber-400">{winner.name}</p>
            <p className="text-xs text-neutral-500">{getModelLabel(winner.model)} &middot; {winner.strategy}</p>
            <p className={`text-sm font-[family-name:var(--font-geist-mono)] font-bold mt-1 ${winner.pnlPct >= 0 ? "text-green-400" : "text-red-400"}`}>{formatPct(winner.pnlPct)}</p>
          </div>
        )}
        <div className="space-y-2 mb-6">
          {standings.map((s, i) => (
            <div key={s.name} className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border ${s.isUser ? "border-amber-500/50 bg-amber-500/5" : "border-neutral-800 bg-neutral-800/30"}`}>
              <span className="text-lg w-8 text-center">{i < 3 ? MEDALS[i] : <span className="text-neutral-500 text-sm font-[family-name:var(--font-geist-mono)]">{i + 1}</span>}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${s.isUser ? "text-amber-500" : "text-neutral-200"}`}>{s.name}</span>
                  {s.isUser && <span className="text-[10px] uppercase font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">You</span>}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-neutral-500">{getModelLabel(s.model)}</span>
                  <span className="text-[11px] text-neutral-600">&middot;</span>
                  <span className="text-[11px] text-neutral-500">{s.strategy}</span>
                  <span className="text-[11px] text-neutral-600">&middot;</span>
                  <span className="text-[11px] text-neutral-500">{s.totalTrades} trades</span>
                </div>
              </div>
              <span className={`font-[family-name:var(--font-geist-mono)] font-semibold ${s.pnlPct >= 0 ? "text-green-400" : "text-red-400"}`}>{formatPct(s.pnlPct)}</span>
            </div>
          ))}
        </div>
        {userEntry && (
          <p className="text-center text-sm text-neutral-400 mb-4">
            You finished <span className="text-amber-500 font-semibold">{userRank + 1}{userRank === 0 ? "st" : userRank === 1 ? "nd" : userRank === 2 ? "rd" : "th"}</span> with {formatPct(userEntry.pnlPct)} return
          </p>
        )}
        {(bestTrade || worstTrade) && (
          <div className="grid grid-cols-2 gap-3 mb-6">
            {bestTrade && (
              <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-3">
                <div className="text-[10px] uppercase tracking-wider text-green-500/60 mb-1">Best Trade</div>
                <div className="text-sm text-green-400 font-medium">{bestTrade.action} {bestTrade.qty}x {bestTrade.ticker}</div>
                <div className="text-xs text-neutral-500 font-[family-name:var(--font-geist-mono)]">@ ${bestTrade.price.toFixed(2)}</div>
              </div>
            )}
            {worstTrade && (
              <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3">
                <div className="text-[10px] uppercase tracking-wider text-red-500/60 mb-1">Worst Trade</div>
                <div className="text-sm text-red-400 font-medium">{worstTrade.action} {worstTrade.qty}x {worstTrade.ticker}</div>
                <div className="text-xs text-neutral-500 font-[family-name:var(--font-geist-mono)]">@ ${worstTrade.price.toFixed(2)}</div>
              </div>
            )}
          </div>
        )}
        <div className="flex gap-3 justify-center">
          <button onClick={onReconfigure} className="px-5 py-2.5 rounded-lg text-sm font-medium border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-neutral-200 transition-colors">Reconfigure</button>
          <button onClick={onPlayAgain} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 transition-all shadow-lg shadow-amber-500/20">Play Again</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Battle Content
// ============================================================

function BattleContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const agentName = searchParams.get("name") || "My Agent";
  const modelParam = searchParams.get("model") || "google/gemini-2.5-flash";
  const templateId = searchParams.get("template") || "momentum";
  const customPrompt = searchParams.get("prompt") || "";
  const autoAgentParam = searchParams.get("autoAgent") === "1";

  // Build NPC configs from URL — only enabled NPCs are present
  const DEFAULT_NPC_MODELS = ["google/gemini-2.5-flash", "deepseek/deepseek-chat", "openai/gpt-4o-mini", "anthropic/claude-sonnet-4-20250514"];
  const npcCountParam = searchParams.get("npcCount");

  const [npcConfigs] = useState<NpcConfig[]>(() => {
    const configs: NpcConfig[] = [];
    for (let i = 0; i < 4; i++) {
      const model = searchParams.get(`npc${i + 1}Model`);
      if (model) {
        configs.push({ index: i, model });
      }
    }
    // If no NPC models in URL and no npcCount param (legacy URLs), use all 4 defaults
    if (configs.length === 0 && npcCountParam === null) {
      for (let i = 0; i < 4; i++) {
        configs.push({ index: i, model: DEFAULT_NPC_MODELS[i] });
      }
    }
    return configs;
  });

  const template = STRATEGY_TEMPLATES.find((t) => t.id === templateId) ?? STRATEGY_TEMPLATES[0];
  const userStrategy = template.name;
  const userModelId = modelParam;
  const userModelLabel = getModelLabel(modelParam);
  const userSystemPrompt = templateId === "custom" && customPrompt ? customPrompt : template.systemPrompt;

  const [profiles] = useState<StockProfile[]>(() => {
    if (typeof window === "undefined") return generateMatchStocks();
    try {
      const stored = sessionStorage.getItem("matchStockProfiles");
      if (stored) return JSON.parse(stored) as StockProfile[];
    } catch { /* fall through */ }
    return generateMatchStocks();
  });

  const battle = useBattle(profiles, agentName, userModelId, userModelLabel, userStrategy, userSystemPrompt, npcConfigs, autoAgentParam, templateId === "custom" ? customPrompt : undefined);

  // PART 4: Build activity log from strategy + adjustments, persistent across rounds
  const activityLogRef = useRef<ActivityLogEntry[]>([]);
  const activityIdRef = useRef(0);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const lastStrategyRef = useRef<string | null>(null);
  const lastAdjCountRef = useRef(0);

  // Track new strategy entries
  useEffect(() => {
    if (!battle.agentStrategy) return;
    const key = `${battle.round}-strategy-${battle.agentStrategy.summary?.slice(0, 50)}`;
    if (key === lastStrategyRef.current) return;
    lastStrategyRef.current = key;

    const latestNews = battle.roundNewsEvents.length > 0 ? battle.roundNewsEvents[0].headline : null;
    activityIdRef.current++;
    const entry: ActivityLogEntry = {
      id: activityIdRef.current,
      round: battle.round,
      timeLeft: battle.tradingTimeLeft,
      newsHeadline: latestNews,
      reasoning: battle.agentStrategy.summary || "Analyzing...",
      trades: battle.agentStrategy.trades.map(t => ({ action: t.action, ticker: t.ticker, qty: t.qty })),
      status: battle.strategyExecuted
        ? (battle.autopilot ? "auto-executed" : "executed")
        : battle.agentStrategy.trades.length === 0
        ? (battle.autopilot ? "auto-hold" : "hold")
        : "pending",
    };
    activityLogRef.current = [...activityLogRef.current, entry];
    setActivityLog([...activityLogRef.current]);
  }, [battle.agentStrategy, battle.round, battle.roundNewsEvents, battle.tradingTimeLeft, battle.strategyExecuted, battle.autopilot]);

  // Track adjustments
  useEffect(() => {
    if (battle.agentAdjustments.length <= lastAdjCountRef.current) return;
    const newAdjs = battle.agentAdjustments.slice(lastAdjCountRef.current);
    lastAdjCountRef.current = battle.agentAdjustments.length;

    for (const adj of newAdjs) {
      activityIdRef.current++;
      const entry: ActivityLogEntry = {
        id: activityIdRef.current,
        round: battle.round,
        timeLeft: battle.tradingTimeLeft,
        newsHeadline: adj.headline,
        reasoning: adj.reasoning,
        trades: adj.trades.map(t => ({ action: t.action, ticker: t.ticker, qty: t.qty })),
        status: adj.executed
          ? (battle.autopilot ? "auto-adjusted" : "executed")
          : adj.trades.length === 0
          ? (battle.autopilot ? "auto-hold" : "hold")
          : "pending",
      };
      activityLogRef.current = [...activityLogRef.current, entry];
    }
    setActivityLog([...activityLogRef.current]);
  }, [battle.agentAdjustments, battle.round, battle.tradingTimeLeft, battle.autopilot]);

  // Update pending entries to executed when strategyExecuted changes
  useEffect(() => {
    if (!battle.strategyExecuted) return;
    const updated = activityLogRef.current.map(e =>
      e.status === "pending" && e.round === battle.round
        ? { ...e, status: (battle.autopilot ? "auto-executed" : "executed") as ActivityLogEntry["status"] }
        : e
    );
    activityLogRef.current = updated;
    setActivityLog([...updated]);
  }, [battle.strategyExecuted, battle.round, battle.autopilot]);

  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const handleExit = () => setShowExitConfirm(true);
  const handleConfirmExit = () => router.push("/");
  const handleCancelExit = () => setShowExitConfirm(false);
  const handlePlayAgain = () => window.location.reload();
  const handleReconfigure = () => router.push("/configure");

  const canTrade = battle.phase === "trading";

  return (
    <div className="h-[calc(100vh-2rem)] flex flex-col overflow-hidden bg-[#0a0a0a] relative">
      <TopBar round={battle.round} phase={battle.phase} countdown={battle.countdown} tradingTimeLeft={battle.tradingTimeLeft}
        userCash={battle.userPortfolio.cash} openPnl={battle.openPnl} userTotalValue={battle.userTotalValue} onExit={handleExit} />

      {/* PART 3: News Banner — persistent macro + company */}
      <NewsBanner newsEvents={battle.roundNewsEvents} stocks={battle.stocks} phase={battle.phase} />

      {/* Main area */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left/Center: stocks + positions + MY AGENT */}
        <div className="flex-1 p-3 overflow-y-auto space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
            {battle.stocks.map((stock) => (
              <StockCard key={stock.ticker} stock={stock}
                position={battle.userPortfolio.positions[stock.ticker]}
                canTrade={canTrade} onTrade={battle.executeTrade} autopilot={battle.autopilot} />
            ))}
          </div>

          <PositionsTable portfolio={battle.userPortfolio} stocks={battle.stocks} />

          <MyAgentPanel
            strategy={battle.agentStrategy} adjustments={battle.agentAdjustments}
            loading={battle.strategyLoading} strategyExecuted={battle.strategyExecuted}
            autopilot={battle.autopilot} modelLabel={userModelLabel}
            round={battle.round} tradingTimeLeft={battle.tradingTimeLeft}
            onExecute={battle.executeStrategy} onExecuteAdjustment={battle.executeAdjustment}
            onToggleAutopilot={() => battle.setAutopilot(!battle.autopilot)}
            chatMessages={battle.chatMessages} chatLoading={battle.chatLoading}
            onSendChat={battle.sendChatMessage}
            activityLog={activityLog}
          />
        </div>

        {/* Right sidebar */}
        <div className="w-72 flex flex-col min-h-0 overflow-hidden bg-neutral-900 border-l border-neutral-800">
          <LeaderboardPanel standings={battle.standings} />
          <ArenaChatPanel messages={battle.arenaMessages} onSendMessage={battle.sendArenaMessage} round={battle.round} />
        </div>
      </div>

      {/* Overlays */}
      {battle.phase === "pre_round" && battle.countdown > 0 && (
        <NewsFlashOverlay round={battle.round} countdown={battle.countdown}
          headline={battle.roundNewsEvents[0]?.headline ?? null} stocks={battle.stocks} />
      )}

      {battle.phase === "round_end" && (
        <RoundSummaryOverlay round={battle.round} standings={battle.standings}
          roundPnl={battle.roundPnl} roundTradeCount={battle.roundTradeCount} />
      )}

      {battle.phase === "match_retro" && (
        <MatchRetroScreen retroRounds={battle.retroRounds} standings={battle.standings} onContinue={battle.dismissRetro} />
      )}

      {battle.phase === "results" && (
        <ResultsScreen standings={battle.standings} bestTrade={battle.bestTrade} worstTrade={battle.worstTrade}
          onPlayAgain={handlePlayAgain} onReconfigure={handleReconfigure} />
      )}

      {showExitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-xs w-full mx-4 shadow-2xl text-center">
            <h3 className="text-lg font-bold mb-2">Abort match?</h3>
            <p className="text-sm text-neutral-400 mb-6">Your progress will be lost.</p>
            <div className="flex gap-3 justify-center">
              <button onClick={handleCancelExit} className="px-5 py-2 rounded-lg text-sm font-medium border border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700">Cancel</button>
              <button onClick={handleConfirmExit} className="px-5 py-2 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-400">Exit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Page wrapper
// ============================================================

export default function BattlePage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center bg-[#0a0a0a] text-neutral-500">Preparing the trading floor...</div>}>
      <BattleContent />
    </Suspense>
  );
}
