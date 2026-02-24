"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { StockProfile } from "@/lib/engine/stocks";
import { generateMatchStocks } from "@/lib/engine/stocks";
import { useBattle, type BattlePhase, type RoundRetroData, type RoundSnapshot, type RecentNpcTrade } from "@/lib/hooks/useBattle";
import {
  type BattleStock,
  type Portfolio,
  type PortfolioPosition,
  type NpcAgent,
  type AgentStrategyRec,
  type AgentAdjustment,
  type ArenaChatMessage,
  type NpcConfig,
  type StandingEntry,
  type TradeInfo,
  TOTAL_ROUNDS,
  STARTING_CASH,
  computeStockImpacts,
  computeTotalValue,
} from "@/lib/battle/engine";
import { STRATEGY_TEMPLATES } from "@/lib/constants/strategyTemplates";
import { formatCurrency, formatCompactCurrency, formatPct, getModelLabel } from "@/lib/utils/format";
import type { NewsEvent } from "@/lib/engine/types";

// (scroll helpers moved inline — using scrollIntoView pattern)

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
// Helper: Clean agent text — strip JSON, markdown, limit length
// ============================================================

function cleanAgentText(text: string): string {
  if (!text) return "Strategy loaded.";
  let cleaned = text;
  // Remove markdown code fences (```json ... ``` or ``` ... ```)
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
  // Remove JSON objects containing trades/actions/skips keys
  cleaned = cleaned.replace(/\{[\s\S]*?("trades"|"actions"|"skips"|"reasoning"|"summary"|"cashReserve")[\s\S]*?\}/g, "");
  // Remove JSON arrays [...] that look like trade arrays
  cleaned = cleaned.replace(/\[[\s\S]*?\{[\s\S]*?("action"|"ticker"|"qty")[\s\S]*?\}[\s\S]*?\]/g, "");
  // Strip markdown formatting
  cleaned = cleaned.replace(/#{1,6}\s+/g, "");       // headers
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, "$1"); // bold
  cleaned = cleaned.replace(/\*([^*]+)\*/g, "$1");     // italic
  cleaned = cleaned.replace(/__([^_]+)__/g, "$1");     // underline
  cleaned = cleaned.replace(/`([^`]+)`/g, "$1");       // inline code
  cleaned = cleaned.replace(/^[-*]\s+/gm, "");         // bullet points
  cleaned = cleaned.replace(/^\d+\.\s+/gm, "");        // numbered lists
  // Clean up whitespace
  cleaned = cleaned.replace(/\n{2,}/g, " ").replace(/\s{2,}/g, " ").trim();
  // Limit to ~3 sentences (split on sentence boundaries)
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length > 3) {
    cleaned = sentences.slice(0, 3).join("").trim();
  }
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
// NPC Position Card — compact card for one participant
// ============================================================

function NpcPositionCard({ name, model, portfolio, stocks, isUser, recentTrade }: {
  name: string; model: string; portfolio: Portfolio; stocks: BattleStock[];
  isUser?: boolean; recentTrade?: RecentNpcTrade;
}) {
  const totalValue = computeTotalValue(portfolio, stocks);
  const pnl = totalValue - STARTING_CASH;
  const pnlPct = (pnl / STARTING_CASH) * 100;
  const positions = Object.entries(portfolio.positions);
  const hasFlash = !!recentTrade;

  return (
    <div className={`rounded-lg border bg-neutral-900 p-2 transition-all ${
      isUser ? "border-amber-500/30" : hasFlash ? "border-cyan-500/30 animate-trade-flash" : "border-neutral-800"
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`text-[11px] font-semibold truncate ${isUser ? "text-amber-400" : "text-neutral-200"}`}>{name}</span>
          {isUser && <span className="text-[7px] uppercase font-bold text-amber-500">YOU</span>}
        </div>
        <span className={`text-[10px] font-bold font-[family-name:var(--font-geist-mono)] ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
          {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
        </span>
      </div>
      <div className="text-[8px] text-neutral-600 truncate mb-1.5">{getModelLabel(model)}</div>

      {/* Positions */}
      {positions.length > 0 ? (
        <div className="space-y-0.5">
          {positions.map(([ticker, pos]) => {
            const stock = stocks.find(s => s.ticker === ticker);
            const curPrice = stock ? stock.price : pos.avgCost;
            const posPnl = pos.side === "long"
              ? (curPrice - pos.avgCost) * pos.qty
              : (pos.avgCost - curPrice) * pos.qty;
            return (
              <div key={ticker} className="flex items-center justify-between text-[10px] font-[family-name:var(--font-geist-mono)]">
                <span className="text-neutral-400">
                  <span className={pos.side === "long" ? "text-green-500" : "text-red-500"}>{pos.side === "long" ? "L" : "S"}</span>
                  {" "}{pos.qty} {ticker}
                </span>
                <span className={posPnl >= 0 ? "text-green-400/80" : "text-red-400/80"}>
                  {posPnl >= 0 ? "+" : ""}{formatCompactCurrency(posPnl)}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-[9px] text-neutral-700">No positions</div>
      )}

      {/* Cash */}
      <div className="text-[9px] text-neutral-600 mt-1 font-[family-name:var(--font-geist-mono)]">
        Cash: {formatCompactCurrency(portfolio.cash)}
      </div>

      {/* Trade flash banner */}
      {hasFlash && (
        <div className="mt-1 px-1.5 py-0.5 rounded bg-cyan-500/10 text-[9px] text-cyan-400 font-semibold truncate">
          {recentTrade.trade.action === "LONG" ? "LONG" : recentTrade.trade.action === "SHORT" ? "SHORT" : "CLOSED"}{" "}
          {recentTrade.trade.qty}x {recentTrade.trade.ticker}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Participants Panel — grid of all participants
// ============================================================

function ParticipantsPanel({ userPortfolio, npcs, stocks, userName, userModel, recentNpcTrades }: {
  userPortfolio: Portfolio; npcs: NpcAgent[]; stocks: BattleStock[];
  userName: string; userModel: string; recentNpcTrades: Record<string, RecentNpcTrade>;
}) {
  return (
    <div>
      <div className="mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">All Participants</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
        <NpcPositionCard name={userName} model={userModel} portfolio={userPortfolio} stocks={stocks} isUser />
        {npcs.map(npc => (
          <NpcPositionCard key={npc.id} name={npc.name} model={npc.model} portfolio={npc.portfolio} stocks={stocks}
            recentTrade={recentNpcTrades[npc.id]} />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Token Usage Panel — sidebar panel showing per-agent token consumption
// ============================================================

function TokenUsagePanel({ tokenUsage }: {
  tokenUsage: Record<string, { name: string; type: "trading" | "market"; tokens: number; calls: number }>;
}) {
  const entries = Object.entries(tokenUsage).sort((a, b) => b[1].tokens - a[1].tokens);
  if (entries.length === 0) return null;
  const totalTokens = entries.reduce((sum, [, v]) => sum + v.tokens, 0);

  return (
    <div className="border-b border-neutral-800 px-3 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Token Usage</h2>
        <span className="text-[9px] text-neutral-600 font-[family-name:var(--font-geist-mono)]">
          {totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}K` : totalTokens}
        </span>
      </div>
      <div className="space-y-0.5">
        {entries.map(([key, val]) => (
          <div key={key} className="flex items-center justify-between text-[10px]">
            <span className="text-neutral-400 truncate mr-2">{val.name}</span>
            <span className="text-neutral-600 font-[family-name:var(--font-geist-mono)] shrink-0">
              {val.tokens >= 1000 ? `${(val.tokens / 1000).toFixed(1)}K` : val.tokens}
              <span className="text-neutral-700 ml-0.5">({val.calls})</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// PART 4: MY AGENT Panel — simplified (no activity log)
// ============================================================

function MyAgentPanel({
  strategy, adjustments, loading, strategyExecuted, autopilot, modelLabel,
  onExecute, onExecuteAdjustment, onToggleAutopilot,
  chatMessages, chatLoading, onSendChat,
}: {
  strategy: AgentStrategyRec | null; adjustments: AgentAdjustment[]; loading: boolean;
  strategyExecuted: boolean; autopilot: boolean; modelLabel: string;
  onExecute: () => { executed: number; failed: number; skipped: number; details: string[] };
  onExecuteAdjustment: (index: number) => { executed: number; failed: number; skipped: number; details: string[] };
  onToggleAutopilot: () => void;
  chatMessages: { role: "user" | "assistant"; content: string }[]; chatLoading: boolean; onSendChat: (msg: string) => void;
}) {
  const [chatInput, setChatInput] = useState("");
  const [autoExecFlash, setAutoExecFlash] = useState(false);
  const agentEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    agentEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length, strategy, adjustments.length]);

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

      {/* Strategy + proposed trades */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2 min-h-0" style={{ maxHeight: "400px" }}>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-amber-400 py-2">
            <div className="w-3 h-3 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
            Analyzing market...
          </div>
        )}

        {/* Current strategy summary */}
        {strategy && (
          <div className="border-b border-neutral-800/30 pb-2">
            <p className="text-[13px] leading-relaxed text-neutral-300 mb-1.5">{cleanAgentText(strategy.summary || "")}</p>
            {strategy.trades.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-1">
                {strategy.trades.map((t, j) => (
                  <span key={j} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold font-[family-name:var(--font-geist-mono)] ${
                    t.action === "LONG" ? "bg-green-500/15 text-green-400" : t.action === "SHORT" ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400"
                  }`}>{t.action} {t.qty}x {t.ticker}</span>
                ))}
              </div>
            )}
            {strategyExecuted && (
              <div className="text-[10px] font-semibold uppercase tracking-wider text-green-400/70">
                {autopilot ? "AUTO-EXECUTED \u2713" : "EXECUTED \u2713"}
              </div>
            )}
          </div>
        )}

        {/* Latest adjustment */}
        {latestAdj && (
          <div className="border-b border-neutral-800/30 pb-2">
            <p className="text-[13px] leading-relaxed text-neutral-300 mb-1.5">{cleanAgentText(latestAdj.reasoning)}</p>
            {latestAdj.trades.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-1">
                {latestAdj.trades.map((t, j) => (
                  <span key={j} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold font-[family-name:var(--font-geist-mono)] ${
                    t.action === "LONG" ? "bg-green-500/15 text-green-400" : t.action === "SHORT" ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400"
                  }`}>{t.action} {t.qty}x {t.ticker}</span>
                ))}
              </div>
            )}
            {latestAdj.executed && (
              <div className="text-[10px] font-semibold uppercase tracking-wider text-green-400/70">
                {autopilot ? "AUTO-ADJUSTED \u2713" : "EXECUTED \u2713"}
              </div>
            )}
          </div>
        )}

        {/* Manual execute buttons */}
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
                <p className="mt-0.5">{m.role === "assistant" ? cleanAgentText(m.content) : m.content}</p>
              </div>
            ))}
            {chatLoading && <div className="text-xs text-neutral-500 animate-pulse">Thinking...</div>}
          </div>
        )}
        <div ref={agentEndRef} />
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
// PART 5: Arena Chat + Trade Log — 80/20 split, persistent across rounds
// ============================================================

// Dynamic NPC color assignment — cycles through palette by agent index
const NPC_COLOR_PALETTE = [
  "text-green-400", "text-red-400", "text-blue-400", "text-purple-400",
  "text-cyan-400", "text-pink-400", "text-orange-400", "text-teal-400",
];

function getNpcColor(name: string, allNames: string[]): string {
  const idx = allNames.indexOf(name);
  return NPC_COLOR_PALETTE[idx >= 0 ? idx % NPC_COLOR_PALETTE.length : 0];
}

function ArenaChatPanel({ messages, onSendMessage, npcNames }: { messages: ArenaChatMessage[]; onSendMessage: (content: string) => void; npcNames: string[] }) {
  const [input, setInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Only show chat messages (personality + news + system announcements), not trade messages
  const chatMessages = messages.filter((m) => !m.isSystem || m.systemType === "news" || m.systemType === "system");

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length]);

  const handleSend = () => { const msg = input.trim(); if (!msg) return; setInput(""); onSendMessage(msg); };

  let lastChatRound = 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-3 py-1.5 border-b border-neutral-800 shrink-0">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-cyan-500">Arena Chat</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-1.5 space-y-0.5 min-h-0">
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
            const color = m.systemType === "news" ? "text-amber-500/80" : "text-neutral-500";
            return (
              <div key={m.id}>
                {separator}
                <div className={`text-[11px] leading-relaxed ${color}`}>
                  {m.message}
                </div>
              </div>
            );
          }
          return (
            <div key={m.id}>
              {separator}
              <div className="text-[14px] leading-relaxed">
                <span className={`font-semibold ${m.isUser ? "text-amber-400" : getNpcColor(m.agentName, npcNames)}`}>{m.agentName}</span>
                <span className="text-neutral-600">: </span>
                <span className="text-neutral-300">{m.message}</span>
              </div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>
      <div className="px-3 py-1 border-t border-neutral-800/50 shrink-0">
        <div className="flex gap-1.5">
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()} placeholder="Chat..."
            className="flex-1 h-6 rounded border border-neutral-700 bg-neutral-800 px-2 text-[11px] text-neutral-100 placeholder:text-neutral-600 focus:border-cyan-500 focus:outline-none" />
          <button onClick={handleSend} disabled={!input.trim()}
            className="h-6 px-2 rounded text-[10px] font-semibold bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 disabled:opacity-40">Send</button>
        </div>
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

function MatchRetroScreen({ retroRounds, standings, roundSnapshots, onContinue }: {
  retroRounds: RoundRetroData[]; standings: StandingEntry[]; roundSnapshots: RoundSnapshot[]; onContinue: () => void;
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

                {/* Price Impact Verification */}
                {(() => {
                  const snap = roundSnapshots.find(s => s.round === rd.round);
                  if (!snap || snap.events.length === 0) return null;
                  return (
                    <div className="px-5 py-3 border-t border-neutral-800/50">
                      <h4 className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-2">Price Impact Verification</h4>
                      {snap.events.map((evt, ei) => (
                        <div key={ei} className="mb-3 last:mb-0">
                          <div className="text-xs font-medium text-neutral-400 mb-1">{evt.headline}</div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                            {Object.keys(evt.pricesAfter).map((ticker) => {
                              const actual = evt.actualImpactPct[ticker];
                              if (actual === undefined) return null;
                              const actualPct = actual * 100;
                              // Use intendedImpacts from snapshot (already set to per_stock_impacts or sectorImpacts)
                              const intendedRaw = evt.intendedImpacts[ticker] ?? null;
                              // per_stock_impacts are already in % (e.g. 3.5 means +3.5%)
                              const intendedPct = intendedRaw != null ? intendedRaw * (Math.abs(intendedRaw) > 1 ? 1 : 100) : null;
                              const drift = intendedPct != null ? Math.abs(actualPct - intendedPct) : 0;
                              // Color coding: green ✓ within 0.5%, yellow ⚠ 0.5-2%, red ✗ >2%
                              const colorClass = intendedPct == null ? "bg-neutral-800/50"
                                : drift <= 0.5 ? "bg-green-500/10 border border-green-500/20"
                                : drift <= 2 ? "bg-yellow-500/10 border border-yellow-500/20"
                                : "bg-red-500/10 border border-red-500/20";
                              const icon = intendedPct == null ? ""
                                : drift <= 0.5 ? "\u2713"
                                : drift <= 2 ? "\u26A0"
                                : "\u2717";
                              const iconColor = drift <= 0.5 ? "text-green-400" : drift <= 2 ? "text-yellow-400" : "text-red-400";
                              return (
                                <div key={ticker} className={`text-[10px] font-[family-name:var(--font-geist-mono)] px-2 py-1 rounded ${colorClass}`}>
                                  <span className="text-neutral-400">{ticker}</span>
                                  {intendedPct != null && (
                                    <span className="text-neutral-500"> I:{intendedPct >= 0 ? "+" : ""}{intendedPct.toFixed(1)}%</span>
                                  )}
                                  <span className={actualPct >= 0 ? "text-green-400" : "text-red-400"}> A:{actualPct >= 0 ? "+" : ""}{actualPct.toFixed(2)}%</span>
                                  {icon && <span className={`${iconColor} ml-1`}>{icon}</span>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
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

  // Build NPC configs from URL — new format includes name + registryId per NPC
  const npcCountParam = searchParams.get("npcCount");

  const [npcConfigs] = useState<NpcConfig[]>(() => {
    const configs: NpcConfig[] = [];
    for (let i = 1; i <= 10; i++) {
      const model = searchParams.get(`npc${i}Model`);
      if (!model) break;
      const name = searchParams.get(`npc${i}Name`) || undefined;
      const registryId = searchParams.get(`npc${i}Id`) || undefined;
      configs.push({ index: i - 1, model, name, registryId });
    }
    // Legacy fallback: if no NPCs found and no npcCount (old URLs)
    if (configs.length === 0 && npcCountParam === null) {
      const defaults = [
        { name: "Momentum Trader", id: "momentum_trader", model: "google/gemini-2.5-flash" },
        { name: "Contrarian", id: "contrarian", model: "openai/gpt-4o-mini" },
        { name: "Blitz Trader", id: "scalper", model: "deepseek/deepseek-chat" },
        { name: "News Sniper", id: "news_sniper", model: "x-ai/grok-3-mini" },
      ];
      defaults.forEach((d, idx) => {
        configs.push({ index: idx, model: d.model, name: d.name, registryId: d.id });
      });
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

          <ParticipantsPanel
            userPortfolio={battle.userPortfolio} npcs={battle.npcs} stocks={battle.stocks}
            userName={agentName} userModel={userModelId} recentNpcTrades={battle.recentNpcTrades}
          />

          <MyAgentPanel
            strategy={battle.agentStrategy} adjustments={battle.agentAdjustments}
            loading={battle.strategyLoading} strategyExecuted={battle.strategyExecuted}
            autopilot={battle.autopilot} modelLabel={userModelLabel}
            onExecute={battle.executeStrategy} onExecuteAdjustment={battle.executeAdjustment}
            onToggleAutopilot={() => battle.setAutopilot(!battle.autopilot)}
            chatMessages={battle.chatMessages} chatLoading={battle.chatLoading}
            onSendChat={battle.sendChatMessage}
          />
        </div>

        {/* Right sidebar */}
        <div className="w-72 flex flex-col min-h-0 overflow-hidden bg-neutral-900 border-l border-neutral-800">
          <LeaderboardPanel standings={battle.standings} />
          <TokenUsagePanel tokenUsage={battle.tokenUsage} />
          <ArenaChatPanel messages={battle.arenaMessages} onSendMessage={battle.sendArenaMessage}
            npcNames={npcConfigs.map(c => c.name || `NPC ${c.index + 1}`)} />
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
        <MatchRetroScreen retroRounds={battle.retroRounds} standings={battle.standings} roundSnapshots={battle.roundSnapshots} onContinue={battle.dismissRetro} />
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
