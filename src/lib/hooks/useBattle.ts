"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { StockProfile } from "../engine/stocks";
import type { NewsEvent } from "../engine/types";
import {
  type BattleStock,
  type Portfolio,
  type NpcAgent,
  type AgentStrategyRec,
  type AgentAdjustment,
  type NpcConfig,
  type NpcTradeDecision,
  type EventEntry,
  type TradeInfo,
  type StandingEntry,
  type ArenaChatMessage,
  STARTING_CASH,
  TOTAL_ROUNDS,
  TRADING_DURATION,
  COUNTDOWN_DURATION,
  ROUND_END_DURATION,
  TICK_INTERVAL,
  initBattleStocks,
  tickPrices,
  applyNewsToPrice,
  computeIndex,
  createPortfolio,
  computeTotalValue,
  executeLong,
  executeShort,
  closePosition,
  createNpcAgents,
  generateFallbackNpcTrade,
  executeNpcTrade,
  executeNpcTrades,
  pickMacroNews,
  generateCompanyNews,
  computeStandings,
  computeBestWorstTrade,
  scheduleNpcTrades,
} from "../battle/engine";
import { getModelLabel } from "../utils/format";

// ------ Phase type ------

export type BattlePhase = "pre_round" | "trading" | "round_end" | "match_retro" | "results";

// ------ Retro data types ------

export interface RoundRetroData {
  round: number;
  newsEvents: NewsEvent[];
  agentTrades: { name: string; model: string; trades: TradeInfo[]; reasoning: string }[];
  stockPrices: { ticker: string; startPrice: number; endPrice: number; changePct: number }[];
  agentPnls: { name: string; model: string; strategy: string; roundPnl: number; totalPnl: number }[];
}

export interface NewsReaction {
  headline: string;
  reactions: { name: string; model: string; action: string; resultPct: number }[];
}

export interface DecisionRecord {
  agentName: string;
  model: string;
  round: number;
  newsHeadline: string;
  newsType: string;
  newsCategory: string;
  actionTaken: string;
  ticker: string;
  qty: number;
  price: number;
  reasoning: string;
  pnlFromTrade?: number;
  wasCorrect?: number;
}

// ------ Round Snapshot (for QA/retro) ------

export interface EventSnapshot {
  headline: string;
  category: string;
  timestamp: string;
  intendedImpacts: Record<string, number>; // what Market Engine returned
  pricesAfter: Record<string, number>; // price snapshot after event applied
  actualImpactPct: Record<string, number>; // actual % change from previous snapshot
  agentDecisions: { agent: string; model: string; actions: string[]; reasoning: string }[];
}

export interface RoundSnapshot {
  round: number;
  pricesAtStart: Record<string, number>;
  events: EventSnapshot[];
  pricesAtEnd: Record<string, number>;
  driftPct: Record<string, number>; // unexplained movement after last event
}

// ------ Hook ------

export function useBattle(
  profiles: StockProfile[],
  userName: string,
  userModelId: string,
  userModelLabel: string,
  userStrategy: string,
  userSystemPrompt: string,
  npcConfigs: NpcConfig[],
  autoAgent: boolean,
  customPrompt?: string
) {
  // -- Core state --
  const [phase, setPhase] = useState<BattlePhase>("pre_round");
  const [round, setRound] = useState(1);
  const [countdown, setCountdown] = useState(COUNTDOWN_DURATION);
  const [tradingTimeLeft, setTradingTimeLeft] = useState(TRADING_DURATION);

  // -- Market --
  const [stocks, setStocks] = useState<BattleStock[]>(() => initBattleStocks(profiles));
  const [indexValue, setIndexValue] = useState(() => {
    const s = initBattleStocks(profiles);
    return computeIndex(s);
  });

  // -- Multi-news per round --
  const [roundNewsEvents, setRoundNewsEvents] = useState<NewsEvent[]>([]);
  const [currentNewsImpacts, setCurrentNewsImpacts] = useState<Record<string, number>>({});
  const usedMacroIndicesRef = useRef<Set<number>>(new Set());
  const usedCompanyTickersRef = useRef<string[]>([]);
  const midRoundNewsFiredRef = useRef<Set<number>>(new Set());

  // -- Portfolios --
  const [userPortfolio, setUserPortfolio] = useState<Portfolio>(createPortfolio);
  const [npcs, setNpcs] = useState<NpcAgent[]>(() => createNpcAgents(npcConfigs));

  // -- Agent strategy --
  const [agentStrategy, setAgentStrategy] = useState<AgentStrategyRec | null>(null);
  const [agentAdjustments, setAgentAdjustments] = useState<AgentAdjustment[]>([]);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [strategyExecuted, setStrategyExecuted] = useState(false);

  // -- Autopilot (auto-agent mode from config) --
  const [autopilot, setAutopilot] = useState(autoAgent);
  const autopilotRef = useRef(autoAgent);
  autopilotRef.current = autopilot;

  // -- Arena chat (merged with event log) --
  const [arenaMessages, setArenaMessages] = useState<ArenaChatMessage[]>([]);
  const arenaIdRef = useRef(0);
  const arenaMessagesRef = useRef<ArenaChatMessage[]>([]);
  arenaMessagesRef.current = arenaMessages;

  // -- Event log (separate for internal tracking, but merged into arena chat display) --
  const [eventLog, setEventLog] = useState<EventEntry[]>([]);
  const eventIdRef = useRef(0);

  // -- Trade tracking --
  const [userTrades, setUserTrades] = useState<TradeInfo[]>([]);

  // -- NPC scheduling (multi-trade) --
  const npcScheduleRef = useRef<Record<string, number[]>>({});
  const npcTradeIndexRef = useRef<Record<string, number>>({});
  const firedNpcTradeKeysRef = useRef<Set<string>>(new Set());

  // -- Round P&L tracking --
  const roundStartValueRef = useRef(STARTING_CASH);
  const roundStartTradeIndexRef = useRef(0);

  // -- Match results saved flag --
  const matchResultsSavedRef = useRef(false);

  // -- Retro data --
  const [retroRounds, setRetroRounds] = useState<RoundRetroData[]>([]);
  const roundTradesRef = useRef<Map<string, { trades: TradeInfo[]; reasoning: string }>>(new Map());
  const roundStartPricesRef = useRef<Record<string, number>>({});

  // -- Decision logging --
  const decisionsRef = useRef<DecisionRecord[]>([]);

  // -- Round snapshots (for QA/retro) --
  const [roundSnapshots, setRoundSnapshots] = useState<RoundSnapshot[]>([]);
  const currentSnapshotRef = useRef<RoundSnapshot | null>(null);
  const lastSnapshotPricesRef = useRef<Record<string, number>>({});

  // -- Tick refs (so intervals can access latest state) --
  const stocksRef = useRef(stocks);
  stocksRef.current = stocks;
  const npcsRef = useRef(npcs);
  npcsRef.current = npcs;
  const userPortfolioRef = useRef(userPortfolio);
  userPortfolioRef.current = userPortfolio;
  const tradingTimeRef = useRef(tradingTimeLeft);
  tradingTimeRef.current = tradingTimeLeft;
  const currentNewsImpactsRef = useRef(currentNewsImpacts);
  currentNewsImpactsRef.current = currentNewsImpacts;
  const roundNewsEventsRef = useRef(roundNewsEvents);
  roundNewsEventsRef.current = roundNewsEvents;
  const standingsRef = useRef<StandingEntry[]>([]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const roundRef = useRef(round);
  roundRef.current = round;
  const agentStrategyRef = useRef(agentStrategy);
  agentStrategyRef.current = agentStrategy;
  const strategyExecutedRef = useRef(strategyExecuted);
  strategyExecutedRef.current = strategyExecuted;
  const userTradesRef = useRef(userTrades);
  userTradesRef.current = userTrades;

  // -- Helpers --
  const addEvent = useCallback((type: EventEntry["type"], message: string) => {
    eventIdRef.current++;
    const entry: EventEntry = { id: eventIdRef.current, type, message };
    setEventLog((prev) => [...prev, entry]);
    // Also add to arena chat as system message
    arenaIdRef.current++;
    const chatMsg: ArenaChatMessage = {
      id: arenaIdRef.current,
      agentName: "System",
      agentModel: "",
      message,
      isUser: false,
      isSystem: true,
      systemType: type,
    };
    setArenaMessages((prev) => [...prev, chatMsg]);
  }, []);

  // -- Build position summary for prompts --
  const buildPositionSummary = useCallback((portfolio: Portfolio, currentStocks: BattleStock[]): string => {
    const entries = Object.entries(portfolio.positions);
    if (entries.length === 0) return "No open positions.";
    return entries.map(([ticker, pos]) => {
      const stock = currentStocks.find((s) => s.ticker === ticker);
      const curPrice = stock ? stock.price : pos.avgCost;
      const pnl = pos.side === "long"
        ? (curPrice - pos.avgCost) * pos.qty
        : (pos.avgCost - curPrice) * pos.qty;
      return `${ticker}: ${pos.side.toUpperCase()} ${pos.qty} shares @ $${pos.avgCost.toFixed(2)} (current: $${curPrice.toFixed(2)}, P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)})`;
    }).join("\n");
  }, []);

  // -- Record trade for retro data --
  const recordTrade = useCallback((agentName: string, trade: TradeInfo, reasoning?: string) => {
    const existing = roundTradesRef.current.get(agentName) || { trades: [], reasoning: "" };
    existing.trades.push(trade);
    if (reasoning) existing.reasoning = reasoning;
    roundTradesRef.current.set(agentName, existing);
  }, []);

  // -- Record decision for analytics --
  const recordDecision = useCallback((
    agentName: string, model: string, trade: TradeInfo, reasoning: string
  ) => {
    const latestNews = roundNewsEventsRef.current;
    const lastEvent = latestNews.length > 0 ? latestNews[latestNews.length - 1] : null;
    const headline = lastEvent ? lastEvent.headline : "Market open";
    const nType = lastEvent ? (lastEvent.newsType || "unknown") : "unknown";
    const nCategory = lastEvent ? (lastEvent.category || "unknown") : "unknown";

    decisionsRef.current.push({
      agentName, model, round: roundRef.current,
      newsHeadline: headline, newsType: nType, newsCategory: nCategory,
      actionTaken: trade.action, ticker: trade.ticker,
      qty: trade.qty, price: trade.price, reasoning,
    });
  }, []);

  // -- Snapshot helpers (PART 5) --
  const captureSnapshotEvent = useCallback((event: NewsEvent) => {
    const snap = currentSnapshotRef.current;
    if (!snap) return;

    const currentPrices: Record<string, number> = {};
    for (const s of stocksRef.current) { currentPrices[s.ticker] = s.price; }

    // Compute actual % change from last snapshot prices
    const lastPrices = lastSnapshotPricesRef.current;
    const actualImpactPct: Record<string, number> = {};
    for (const [ticker, price] of Object.entries(currentPrices)) {
      const prev = lastPrices[ticker];
      if (prev && prev > 0) {
        actualImpactPct[ticker] = (price - prev) / prev;
      }
    }

    snap.events.push({
      headline: event.headline,
      category: event.category || "unknown",
      timestamp: new Date().toISOString(),
      intendedImpacts: { ...event.sectorImpacts },
      pricesAfter: currentPrices,
      actualImpactPct,
      agentDecisions: [],
    });
    lastSnapshotPricesRef.current = currentPrices;
  }, []);

  const finalizeSnapshot = useCallback(() => {
    const snap = currentSnapshotRef.current;
    if (!snap) return;

    const endPrices: Record<string, number> = {};
    for (const s of stocksRef.current) { endPrices[s.ticker] = s.price; }
    snap.pricesAtEnd = endPrices;

    // Drift: unexplained movement since last event snapshot
    const lastPrices = lastSnapshotPricesRef.current;
    const driftPct: Record<string, number> = {};
    for (const [ticker, price] of Object.entries(endPrices)) {
      const prev = lastPrices[ticker];
      if (prev && prev > 0) {
        driftPct[ticker] = (price - prev) / prev;
      }
    }
    snap.driftPct = driftPct;

    setRoundSnapshots((prev) => [...prev, snap]);
    currentSnapshotRef.current = null;
  }, []);

  // -- Fetch agent strategy from API --
  const fetchAgentStrategy = useCallback(async (isUpdate: boolean, newsHeadline?: string) => {
    if (!isUpdate) {
      setStrategyLoading(true);
    }

    try {
      const currentStocks = stocksRef.current;
      const stockData = currentStocks.map((s) => ({
        ticker: s.ticker,
        name: s.name,
        sector: s.sector,
        subSector: s.subSector,
        beta: s.beta,
        peRatio: s.peRatio,
        eps: s.eps,
        debtEbitda: s.debtEbitda,
        marketCap: s.marketCap,
        price: s.price,
        startPrice: s.startPrice,
        changePct: (s.price - s.startPrice) / s.startPrice,
      }));

      const positionSummary = buildPositionSummary(userPortfolioRef.current, currentStocks);
      const tickers = currentStocks.map((s) => `${s.ticker} (${s.subSector || s.sector})`).join(", ");
      const allNews = roundNewsEventsRef.current.map((n) => n.headline).join(" | ");

      let enhancedPrompt = userSystemPrompt;
      if (isUpdate) {
        enhancedPrompt += `\n\nYou are managing a portfolio with $${userPortfolioRef.current.cash.toFixed(0)} cash.
Current positions:\n${positionSummary}
The stocks in this match are: ${tickers}
ALL NEWS THIS ROUND: ${allNews}
NEW NEWS: ${newsHeadline || "Market update"}
How does this change your strategy? Recommend adjustments using exact tickers.`;
      } else {
        enhancedPrompt += `\n\nYou are managing a portfolio. Current cash: $${userPortfolioRef.current.cash.toFixed(0)}.
Current positions:\n${positionSummary}
The ${currentStocks.length} securities in this match are: ${tickers}
NEWS THIS ROUND: ${allNews || "No news yet"}
You MUST make a decision on ALL ${currentStocks.length} securities. Deploy 60-80% of available capital across 3-5 positions.`;
      }

      // Map user strategy label to registry-compatible strategy key
      const strategyMap: Record<string, string> = {
        "Momentum": "momentum", "Contrarian": "contrarian",
        "Sector Rotation": "sector_rotation", "Value": "value",
        "Risk Averse": "risk_averse", "Custom": "custom",
      };
      const mappedStrategy = strategyMap[userStrategy] || undefined;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: userModelId,
          systemPrompt: enhancedPrompt,
          userStrategy: mappedStrategy,
          customPrompt: customPrompt || undefined,
          stocks: stockData,
          newsEvents: roundNewsEventsRef.current.map((n) => ({
            headline: n.headline,
            sectorImpacts: n.sectorImpacts,
          })),
          portfolio: {
            cash: userPortfolioRef.current.cash,
            positions: Object.fromEntries(
              Object.entries(userPortfolioRef.current.positions).map(([k, v]) => [
                k,
                { qty: v.qty, side: v.side, avgCost: v.avgCost },
              ])
            ),
          },
          standings: standingsRef.current.map((s) => ({ name: s.name, model: getModelLabel(s.model), pnl: s.pnl, pnlPct: s.pnlPct })),
          totalValue: computeTotalValue(userPortfolioRef.current, stocksRef.current),
          isUpdate,
        }),
      });

      const data = await res.json();

      if (isUpdate) {
        const adjustment: AgentAdjustment = {
          headline: newsHeadline || "Market update",
          reasoning: data.reasoning || data.content || "No response",
          trades: (data.trades || []).map((t: Record<string, unknown>) => ({
            action: t.action as string,
            ticker: t.ticker as string,
            qty: t.qty as number,
            reason: (t.reason as string) || "",
          })),
          executed: false,
        };
        setAgentAdjustments([adjustment]); // Replace old adjustments
      } else {
        if (data.trades && data.trades.length > 0) {
          const newStrategy = {
            trades: data.trades,
            cashReserve: data.cashReserve ?? 0,
            summary: data.summary || data.content || "",
          };
          setAgentStrategy(newStrategy);
          setStrategyExecuted(false);
          agentStrategyRef.current = newStrategy;
          strategyExecutedRef.current = false;
        } else if (data.content) {
          const newStrategy = {
            trades: [],
            cashReserve: userPortfolioRef.current.cash,
            summary: data.content,
          };
          setAgentStrategy(newStrategy);
          setStrategyExecuted(false);
          agentStrategyRef.current = newStrategy;
          strategyExecutedRef.current = false;
        }
      }
    } catch (err) {
      console.error("Agent strategy fetch error:", err);
      if (!isUpdate) {
        setAgentStrategy({
          trades: [],
          cashReserve: userPortfolioRef.current.cash,
          summary: "Could not connect to AI model. Trade manually based on the news.",
        });
        setStrategyExecuted(false);
      }
    } finally {
      if (!isUpdate) {
        setStrategyLoading(false);
      }
    }
  }, [userModelId, userSystemPrompt, userStrategy, customPrompt, buildPositionSummary]);

  // -- Execute strategy helper (used by both manual and autopilot) --
  const doExecuteStrategy = useCallback((strategy: AgentStrategyRec): { executed: number; failed: number; skipped: number; details: string[] } => {
    if (!strategy || strategy.trades.length === 0) return { executed: 0, failed: 0, skipped: 0, details: [] };

    const currentStocks = stocksRef.current;
    let executed = 0;
    let failed = 0;
    let skipped = 0;
    const details: string[] = [];

    for (const trade of strategy.trades) {
      const stock = currentStocks.find((s) => s.ticker === trade.ticker);
      if (!stock) { failed++; details.push(`${trade.ticker}: unknown stock`); continue; }

      if (trade.action === "LONG") {
        let qty = trade.qty;
        const maxAffordable = Math.floor(userPortfolioRef.current.cash / stock.price);
        if (qty > maxAffordable) {
          if (maxAffordable <= 0) { skipped++; details.push(`${trade.action} ${trade.ticker}: insufficient cash`); continue; }
          qty = maxAffordable;
        }
        const result = executeLong(userPortfolioRef.current, currentStocks, trade.ticker, qty);
        if (result.ok) {
          setUserPortfolio(result.portfolio);
          userPortfolioRef.current = result.portfolio;
          const tradeInfo: TradeInfo = { ticker: trade.ticker, action: "LONG", qty, price: stock.price };
          setUserTrades((prev) => [...prev, tradeInfo]);
          recordTrade(userName, tradeInfo, strategy.summary);
          recordDecision(userName, userModelId, tradeInfo, trade.reason || strategy.summary);
          addEvent("user_trade", `${autopilotRef.current ? "AUTO: " : ""}LONG ${qty}x ${trade.ticker} @ $${stock.price.toFixed(2)}`);
          executed++;
          details.push(`LONG ${qty}x ${trade.ticker} @ $${stock.price.toFixed(2)}`);
        } else {
          failed++;
          details.push(`${trade.action} ${trade.ticker}: ${result.reason}`);
        }
      } else if (trade.action === "SHORT") {
        let qty = trade.qty;
        const maxAffordable = Math.floor(userPortfolioRef.current.cash / stock.price);
        if (qty > maxAffordable) {
          if (maxAffordable <= 0) { skipped++; details.push(`${trade.action} ${trade.ticker}: insufficient margin`); continue; }
          qty = maxAffordable;
        }
        const result = executeShort(userPortfolioRef.current, currentStocks, trade.ticker, qty);
        if (result.ok) {
          setUserPortfolio(result.portfolio);
          userPortfolioRef.current = result.portfolio;
          const tradeInfo: TradeInfo = { ticker: trade.ticker, action: "SHORT", qty, price: stock.price };
          setUserTrades((prev) => [...prev, tradeInfo]);
          recordTrade(userName, tradeInfo, strategy.summary);
          recordDecision(userName, userModelId, tradeInfo, trade.reason || strategy.summary);
          addEvent("user_trade", `${autopilotRef.current ? "AUTO: " : ""}SHORT ${qty}x ${trade.ticker} @ $${stock.price.toFixed(2)}`);
          executed++;
          details.push(`SHORT ${qty}x ${trade.ticker} @ $${stock.price.toFixed(2)}`);
        } else {
          failed++;
          details.push(`${trade.action} ${trade.ticker}: ${result.reason}`);
        }
      }
    }

    return { executed, failed, skipped, details };
  }, [addEvent, recordTrade, recordDecision, userName, userModelId]);

  // -- Execute strategy (all trades at once) --
  const executeStrategy = useCallback((): { executed: number; failed: number; skipped: number; details: string[] } => {
    const strategy = agentStrategyRef.current;
    if (!strategy || strategy.trades.length === 0) return { executed: 0, failed: 0, skipped: 0, details: [] };
    const result = doExecuteStrategy(strategy);
    setStrategyExecuted(true);
    strategyExecutedRef.current = true;
    return result;
  }, [doExecuteStrategy]);

  // -- Execute adjustment (latest only) --
  const executeAdjustment = useCallback((index: number): { executed: number; failed: number; skipped: number; details: string[] } => {
    const adjustments = agentAdjustments;
    if (index < 0 || index >= adjustments.length) return { executed: 0, failed: 0, skipped: 0, details: [] };
    const adj = adjustments[index];
    if (adj.executed || adj.trades.length === 0) return { executed: 0, failed: 0, skipped: 0, details: [] };

    const currentStocks = stocksRef.current;
    let executed = 0;
    let failed = 0;
    const skipped = 0;
    const details: string[] = [];

    for (const trade of adj.trades) {
      const stock = currentStocks.find((s) => s.ticker === trade.ticker);
      if (!stock) { failed++; continue; }

      if (trade.action === "LONG") {
        const result = executeLong(userPortfolioRef.current, currentStocks, trade.ticker, trade.qty);
        if (result.ok) {
          setUserPortfolio(result.portfolio);
          userPortfolioRef.current = result.portfolio;
          const tradeInfo: TradeInfo = { ticker: trade.ticker, action: "LONG", qty: trade.qty, price: stock.price };
          setUserTrades((prev) => [...prev, tradeInfo]);
          recordTrade(userName, tradeInfo, adj.reasoning);
          addEvent("user_trade", `${autopilotRef.current ? "AUTO: " : ""}LONG ${trade.qty}x ${trade.ticker} @ $${stock.price.toFixed(2)}`);
          executed++;
        } else { failed++; }
      } else if (trade.action === "SHORT") {
        const result = executeShort(userPortfolioRef.current, currentStocks, trade.ticker, trade.qty);
        if (result.ok) {
          setUserPortfolio(result.portfolio);
          userPortfolioRef.current = result.portfolio;
          const tradeInfo: TradeInfo = { ticker: trade.ticker, action: "SHORT", qty: trade.qty, price: stock.price };
          setUserTrades((prev) => [...prev, tradeInfo]);
          recordTrade(userName, tradeInfo, adj.reasoning);
          addEvent("user_trade", `${autopilotRef.current ? "AUTO: " : ""}SHORT ${trade.qty}x ${trade.ticker} @ $${stock.price.toFixed(2)}`);
          executed++;
        } else { failed++; }
      } else if (trade.action === "CLOSE_LONG" || trade.action === "CLOSE_SHORT") {
        const result = closePosition(userPortfolioRef.current, currentStocks, trade.ticker, trade.qty);
        if (result.ok) {
          setUserPortfolio(result.portfolio);
          userPortfolioRef.current = result.portfolio;
          const tradeInfo: TradeInfo = { ticker: trade.ticker, action: trade.action, qty: trade.qty, price: stock.price };
          setUserTrades((prev) => [...prev, tradeInfo]);
          recordTrade(userName, tradeInfo, adj.reasoning);
          addEvent("user_trade", `${autopilotRef.current ? "AUTO: " : ""}Closed ${result.side.toUpperCase()} ${trade.qty}x ${trade.ticker} @ $${stock.price.toFixed(2)}`);
          executed++;
        } else { failed++; }
      }
    }

    setAgentAdjustments((prev) =>
      prev.map((a, i) => (i === index ? { ...a, executed: true } : a))
    );

    return { executed, failed, skipped, details };
  }, [agentAdjustments, addEvent, recordTrade, userName]);

  // -- Autopilot: auto-execute when strategy arrives --
  useEffect(() => {
    if (!autopilot) return;
    if (!agentStrategy || agentStrategy.trades.length === 0) return;
    if (strategyExecuted) return;
    if (phaseRef.current !== "trading") return;

    const result = doExecuteStrategy(agentStrategy);
    setStrategyExecuted(true);
    strategyExecutedRef.current = true;
    if (result.executed > 0) {
      console.log(`[AUTO-AGENT] Auto-executed ${result.executed} trades`);
    }
  }, [autopilot, agentStrategy, strategyExecuted, doExecuteStrategy]);

  // -- Autopilot: auto-execute adjustments --
  useEffect(() => {
    if (!autopilot) return;
    if (agentAdjustments.length === 0) return;
    if (phaseRef.current !== "trading") return;

    const lastAdj = agentAdjustments[agentAdjustments.length - 1];
    if (lastAdj.executed || lastAdj.trades.length === 0) return;

    executeAdjustment(agentAdjustments.length - 1);
  }, [autopilot, agentAdjustments, executeAdjustment]);

  // -- NPC API trade call --
  const fetchNpcTrade = useCallback(async (npc: NpcAgent) => {
    const currentStocks = stocksRef.current;
    const tickers = currentStocks.map((s) => `${s.ticker} (${s.subSector || s.sector})`).join(", ");
    const positionSummary = buildPositionSummary(npc.portfolio, currentStocks);
    const allNews = roundNewsEventsRef.current.map((n) => n.headline).join(" | ");

    const stockData = currentStocks.map((s) => ({
      ticker: s.ticker, name: s.name, sector: s.sector, subSector: s.subSector,
      beta: s.beta, peRatio: s.peRatio, eps: s.eps, debtEbitda: s.debtEbitda,
      marketCap: s.marketCap, price: s.price, startPrice: s.startPrice,
      changePct: (s.price - s.startPrice) / s.startPrice,
    }));

    const enhancedPrompt = npc.systemPrompt + `\n\nThe ${currentStocks.length} securities in this match: ${tickers}
NEWS THIS ROUND: ${allNews || "No news"}
Your cash: $${npc.portfolio.cash.toFixed(0)}
Your positions:\n${positionSummary}
You MUST decide on ALL ${currentStocks.length} securities. Deploy 60-80% of capital across 3-5 positions. Be aggressive.`;

    try {
      const res = await fetch("/api/npc-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: { name: npc.name, model: npc.model, strategy: npc.strategy, systemPrompt: enhancedPrompt, registryId: npc.registryId },
          stocks: stockData,
          newsEvents: roundNewsEventsRef.current.map((n) => ({ headline: n.headline, sectorImpacts: n.sectorImpacts })),
          portfolio: {
            cash: npc.portfolio.cash,
            positions: Object.fromEntries(
              Object.entries(npc.portfolio.positions).map(([k, v]) => [k, { qty: v.qty, side: v.side, avgCost: v.avgCost }])
            ),
          },
          standings: standingsRef.current.map((s) => ({ name: s.name, model: getModelLabel(s.model), pnl: s.pnl, pnlPct: s.pnlPct })),
          totalValue: computeTotalValue(npc.portfolio, stocksRef.current),
        }),
      });
      const data = await res.json();
      if (data.trades && data.trades.length > 0) {
        return { trades: data.trades as NpcTradeDecision[], reasoning: data.reasoning || "" };
      }
    } catch (err) {
      console.error(`NPC trade fetch error for ${npc.name}:`, err);
    }
    return null;
  }, [buildPositionSummary]);

  // -- Execute NPC trades (API or fallback) --
  const doNpcTrade = useCallback(async (npcId: string) => {
    const currentNpcs = npcsRef.current;
    const npc = currentNpcs.find((n) => n.id === npcId);
    if (!npc) return;
    if (phaseRef.current !== "trading") return;

    const currentStocks = stocksRef.current;
    const modelLabel = getModelLabel(npc.model);

    const apiResult = await fetchNpcTrade(npc);

    if (apiResult && apiResult.trades.length > 0) {
      const { npc: updatedNpc, executedTrades } = executeNpcTrades(npc, apiResult.trades, currentStocks);
      if (executedTrades.length > 0) {
        const updatedNpcs = npcsRef.current.map((n) => (n.id === npcId ? updatedNpc : n));
        npcsRef.current = updatedNpcs;
        setNpcs(updatedNpcs);

        for (const trade of executedTrades) {
          recordTrade(npc.name, trade, apiResult.reasoning);
          recordDecision(npc.name, npc.model, trade, apiResult.reasoning);
          const actionLabel = trade.action === "LONG" ? "went LONG" : trade.action === "SHORT" ? "went SHORT" : "closed";
          arenaIdRef.current++;
          setArenaMessages((prev) => [...prev, {
            id: arenaIdRef.current, agentName: npc.name, agentModel: modelLabel,
            message: `${actionLabel} ${trade.qty} shares ${trade.ticker} @ $${trade.price.toFixed(2)}`,
            isUser: false, isSystem: true, systemType: "npc_trade" as const,
          }]);
        }
        return;
      }
    }

    // Fallback to deterministic logic
    const fallbackTrade = generateFallbackNpcTrade(npc, currentStocks, currentNewsImpactsRef.current);
    if (fallbackTrade) {
      const updatedNpc = executeNpcTrade(npc, fallbackTrade, currentStocks);
      if (updatedNpc.tradeCount > npc.tradeCount) {
        const updatedNpcs = npcsRef.current.map((n) => (n.id === npcId ? updatedNpc : n));
        npcsRef.current = updatedNpcs;
        setNpcs(updatedNpcs);
        recordTrade(npc.name, fallbackTrade, "fallback deterministic");
        recordDecision(npc.name, npc.model, fallbackTrade, "fallback deterministic");

        const actionLabel = fallbackTrade.action === "LONG" ? "went LONG" : fallbackTrade.action === "SHORT" ? "went SHORT" : "closed";
        arenaIdRef.current++;
        setArenaMessages((prev) => [...prev, {
          id: arenaIdRef.current, agentName: npc.name, agentModel: modelLabel,
          message: `${actionLabel} ${fallbackTrade.qty} shares ${fallbackTrade.ticker} @ $${fallbackTrade.price.toFixed(2)}`,
          isUser: false, isSystem: true, systemType: "npc_trade" as const,
        }]);
      }
    }
  }, [fetchNpcTrade, recordTrade, recordDecision]);

  // -- Arena chat ref --
  const fireArenaChatRef = useRef<((headline: string) => void) | null>(null);

  // -- Apply a mid-round news event (shared helper) --
  const applyMidRoundEvent = useCallback((event: NewsEvent) => {
    setRoundNewsEvents((prev) => [...prev, event]);
    roundNewsEventsRef.current = [...roundNewsEventsRef.current, event];

    const merged = { ...currentNewsImpactsRef.current };
    for (const [sector, impact] of Object.entries(event.sectorImpacts)) {
      merged[sector] = (merged[sector] || 0) + impact;
    }
    setCurrentNewsImpacts(merged);
    currentNewsImpactsRef.current = merged;

    addEvent("news", event.headline);

    // Apply price impact immediately via deterministic model
    const { stocks: updatedStocks } = applyNewsToPrice(stocksRef.current, event);
    stocksRef.current = updatedStocks;
    setStocks(updatedStocks);
    setIndexValue(computeIndex(updatedStocks));

    captureSnapshotEvent(event);

    // NPC reactive trades
    const npcList = npcsRef.current;
    npcList.forEach((npc) => {
      const delay = 2000 + Math.floor(Math.random() * 3000);
      setTimeout(() => doNpcTrade(npc.id), delay);
    });

    fetchAgentStrategy(true, event.headline);
    setTimeout(() => fireArenaChatRef.current?.(event.headline), 1500);
  }, [addEvent, captureSnapshotEvent, doNpcTrade, fetchAgentStrategy]);

  // -- Fetch company news from registry agent --
  const fetchCompanyNewsFromRegistry = useCallback(async (): Promise<{ headline: string; sectorImpacts: Record<string, number>; tickerAffected: string; category: string } | null> => {
    try {
      const currentStocks = stocksRef.current;
      const res = await fetch("/api/company-news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stocks: currentStocks.map((s) => ({ ticker: s.ticker, name: s.name, sector: s.sector, subSector: s.subSector, beta: s.beta })),
          roundNumber: roundRef.current,
          usedTickers: usedCompanyTickersRef.current,
        }),
      });
      const data = await res.json();
      if (!data.fallback && data.headline) {
        return { headline: data.headline, sectorImpacts: data.sectorImpacts, tickerAffected: data.tickerAffected, category: data.category };
      }
    } catch (err) {
      console.error("[useBattle] Company news API error:", err);
    }
    return null;
  }, []);

  // -- Fire mid-round news event — try AI company news agent first, fallback to hardcoded --
  const fireMidRoundNews = useCallback((isCompany: boolean) => {
    if (!isCompany) return;

    (async () => {
      // Try AI company news agent
      const aiResult = await fetchCompanyNewsFromRegistry();
      if (aiResult) {
        usedCompanyTickersRef.current = [...usedCompanyTickersRef.current, aiResult.tickerAffected];
        const event: NewsEvent = {
          headline: aiResult.headline,
          sectorImpacts: aiResult.sectorImpacts,
          newsType: "company_specific" as const,
          category: aiResult.category as NewsEvent["category"],
        };
        applyMidRoundEvent(event);
        return;
      }

      // Fallback to hardcoded with round-based escalation
      console.log("[useBattle] Falling back to hardcoded behavior for Company News Agent");
      const result = generateCompanyNews(stocksRef.current, usedCompanyTickersRef.current, roundRef.current);
      if (!result) return;
      usedCompanyTickersRef.current = [...usedCompanyTickersRef.current, result.tickerAffected];
      applyMidRoundEvent(result.event);
    })();
  }, [applyMidRoundEvent, fetchCompanyNewsFromRegistry]);

  // -- User trade execution --
  const executeTrade = useCallback(
    (ticker: string, action: "LONG" | "SHORT" | "CLOSE", qty: number): { ok: boolean; reason: string } => {
      const currentStocks = stocksRef.current;
      const stock = currentStocks.find((s) => s.ticker === ticker);
      if (!stock) return { ok: false, reason: "Unknown stock" };

      if (action === "LONG") {
        const result = executeLong(userPortfolioRef.current, currentStocks, ticker, qty);
        if (result.ok) {
          setUserPortfolio(result.portfolio);
          userPortfolioRef.current = result.portfolio;
          const tradeInfo: TradeInfo = { ticker, action: "LONG", qty, price: stock.price };
          setUserTrades((prev) => [...prev, tradeInfo]);
          recordTrade(userName, tradeInfo);
          addEvent("user_trade", `LONG ${qty}x ${ticker} @ $${stock.price.toFixed(2)}`);
        }
        return { ok: result.ok, reason: result.reason };
      } else if (action === "SHORT") {
        const result = executeShort(userPortfolioRef.current, currentStocks, ticker, qty);
        if (result.ok) {
          setUserPortfolio(result.portfolio);
          userPortfolioRef.current = result.portfolio;
          const tradeInfo: TradeInfo = { ticker, action: "SHORT", qty, price: stock.price };
          setUserTrades((prev) => [...prev, tradeInfo]);
          recordTrade(userName, tradeInfo);
          addEvent("user_trade", `SHORT ${qty}x ${ticker} @ $${stock.price.toFixed(2)}`);
        }
        return { ok: result.ok, reason: result.reason };
      } else {
        const result = closePosition(userPortfolioRef.current, currentStocks, ticker, qty);
        if (result.ok) {
          setUserPortfolio(result.portfolio);
          userPortfolioRef.current = result.portfolio;
          const closeAction = result.side === "long" ? "CLOSE_LONG" : "CLOSE_SHORT";
          const tradeInfo: TradeInfo = { ticker, action: closeAction as TradeInfo["action"], qty, price: stock.price };
          setUserTrades((prev) => [...prev, tradeInfo]);
          recordTrade(userName, tradeInfo);
          addEvent("user_trade", `Closed ${result.side.toUpperCase()} ${qty}x ${ticker} @ $${stock.price.toFixed(2)}`);
        }
        return { ok: result.ok, reason: result.reason };
      }
    },
    [addEvent, recordTrade, userName]
  );

  // -- Chat --
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  const sendChatMessage = useCallback(async (content: string) => {
    const newMessages = [...chatMessages, { role: "user" as const, content }];
    setChatMessages(newMessages);
    setChatLoading(true);

    try {
      const currentStocks = stocksRef.current;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: userModelId,
          systemPrompt: userSystemPrompt,
          stocks: currentStocks.map((s) => ({
            ticker: s.ticker, name: s.name, sector: s.sector, subSector: s.subSector,
            beta: s.beta, peRatio: s.peRatio, eps: s.eps, debtEbitda: s.debtEbitda,
            marketCap: s.marketCap, price: s.price, startPrice: s.startPrice,
            changePct: (s.price - s.startPrice) / s.startPrice,
          })),
          newsEvents: roundNewsEventsRef.current.map((n) => ({ headline: n.headline, sectorImpacts: n.sectorImpacts })),
          portfolio: {
            cash: userPortfolioRef.current.cash,
            positions: Object.fromEntries(
              Object.entries(userPortfolioRef.current.positions).map(([k, v]) => [k, { qty: v.qty, side: v.side, avgCost: v.avgCost }])
            ),
          },
          standings: standingsRef.current.map((s) => ({ name: s.name, model: getModelLabel(s.model), pnl: s.pnl, pnlPct: s.pnlPct })),
          totalValue: computeTotalValue(userPortfolioRef.current, stocksRef.current),
          isUpdate: false,
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      setChatMessages((prev) => [...prev, { role: "assistant", content: data.content }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: "assistant", content: "Sorry, couldn't connect. Try again." }]);
    } finally {
      setChatLoading(false);
    }
  }, [chatMessages, userModelId, userSystemPrompt]);

  // -- Arena chat helpers --
  const addArenaMessage = useCallback((agentName: string, agentModel: string, message: string, isUser: boolean) => {
    arenaIdRef.current++;
    const msg: ArenaChatMessage = { id: arenaIdRef.current, agentName, agentModel, message, isUser };
    setArenaMessages((prev) => [...prev, msg]);
  }, []);

  const fetchArenaChat = useCallback(async (
    agent: { name: string; model: string; strategy: string; systemPrompt: string },
    headline: string,
    isUser: boolean
  ) => {
    try {
      const res = await fetch("/api/arena-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent,
          newsHeadline: headline,
          recentMessages: arenaMessagesRef.current.filter((m) => !m.isSystem).slice(-6).map((m) => ({ name: m.agentName, message: m.message })),
          stocks: stocksRef.current.map((s) => ({
            ticker: s.ticker, sector: s.sector, price: s.price,
            changePct: (s.price - s.startPrice) / s.startPrice,
          })),
          standings: standingsRef.current.map((s) => ({ name: s.name, pnl: s.pnl })),
        }),
      });
      const data = await res.json();
      if (data.message) {
        addArenaMessage(agent.name, agent.model, data.message, isUser);
      }
    } catch (err) {
      console.error(`Arena chat error for ${agent.name}:`, err);
    }
  }, [addArenaMessage]);

  const fireArenaChats = useCallback((headline: string) => {
    const npcList = npcsRef.current;
    npcList.forEach((npc, i) => {
      const delay = 1000 + i * 1500;
      setTimeout(() => {
        if (phaseRef.current !== "trading" && phaseRef.current !== "pre_round") return;
        fetchArenaChat({ name: npc.name, model: npc.model, strategy: npc.strategy, systemPrompt: npc.systemPrompt }, headline, false);
      }, delay);
    });
    setTimeout(() => {
      if (phaseRef.current !== "trading" && phaseRef.current !== "pre_round") return;
      fetchArenaChat({ name: userName, model: userModelId, strategy: userStrategy, systemPrompt: userSystemPrompt }, headline, true);
    }, 1000 + npcList.length * 1500);
  }, [fetchArenaChat, userName, userModelId, userStrategy, userSystemPrompt]);

  fireArenaChatRef.current = fireArenaChats;

  const sendArenaMessage = useCallback((content: string) => {
    addArenaMessage(userName, userModelId, content, true);
  }, [addArenaMessage, userName, userModelId]);

  // -- Capture round retro data --
  const captureRoundRetro = useCallback(() => {
    // Finalize round snapshot before capturing retro
    finalizeSnapshot();

    const currentStocks = stocksRef.current;
    const currentNpcs = npcsRef.current;

    const stockPrices = currentStocks.map((s) => ({
      ticker: s.ticker,
      startPrice: roundStartPricesRef.current[s.ticker] || s.startPrice,
      endPrice: s.price,
      changePct: ((s.price - (roundStartPricesRef.current[s.ticker] || s.startPrice)) / (roundStartPricesRef.current[s.ticker] || s.startPrice)),
    }));

    const agentTrades: RoundRetroData["agentTrades"] = [];
    const agentPnls: RoundRetroData["agentPnls"] = [];

    // User
    const userTradeData = roundTradesRef.current.get(userName) || { trades: [], reasoning: "" };
    agentTrades.push({ name: userName, model: userModelLabel, trades: userTradeData.trades, reasoning: userTradeData.reasoning });
    const userValue = computeTotalValue(userPortfolioRef.current, currentStocks);
    agentPnls.push({ name: userName, model: userModelLabel, strategy: userStrategy, roundPnl: userValue - roundStartValueRef.current, totalPnl: userValue - STARTING_CASH });

    // NPCs
    for (const npc of currentNpcs) {
      const npcTradeData = roundTradesRef.current.get(npc.name) || { trades: [], reasoning: "" };
      agentTrades.push({ name: npc.name, model: getModelLabel(npc.model), trades: npcTradeData.trades, reasoning: npcTradeData.reasoning });
      const npcValue = computeTotalValue(npc.portfolio, currentStocks);
      agentPnls.push({ name: npc.name, model: getModelLabel(npc.model), strategy: npc.strategyLabel, roundPnl: npcValue - STARTING_CASH, totalPnl: npcValue - STARTING_CASH });
    }

    const retroData: RoundRetroData = {
      round: roundRef.current,
      newsEvents: [...roundNewsEventsRef.current],
      agentTrades,
      stockPrices,
      agentPnls,
    };

    setRetroRounds((prev) => [...prev, retroData]);
    roundTradesRef.current = new Map();
  }, [userName, userModelLabel, userStrategy, finalizeSnapshot]);

  // -- Used headlines ref for AI news deduplication --
  const usedHeadlinesRef = useRef<string[]>([]);

  // -- Fetch macro news from registry agent --
  const fetchMacroNewsFromRegistry = useCallback(async (): Promise<{ headline: string; sectorImpacts: Record<string, number>; category: string } | null> => {
    try {
      const currentStocks = stocksRef.current;
      const res = await fetch("/api/macro-news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stocks: currentStocks.map((s) => ({ ticker: s.ticker, name: s.name, sector: s.sector, beta: s.beta })),
          roundNumber: roundRef.current,
          usedHeadlines: usedHeadlinesRef.current,
        }),
      });
      const data = await res.json();
      if (!data.fallback && data.headline) {
        usedHeadlinesRef.current = [...usedHeadlinesRef.current, data.headline];
        return { headline: data.headline, sectorImpacts: data.sectorImpacts, category: data.category };
      }
    } catch (err) {
      console.error("[useBattle] Macro news API error:", err);
    }
    return null;
  }, []);

  // -- Phase: pre_round --
  useEffect(() => {
    if (phase !== "pre_round") return;

    roundStartValueRef.current = computeTotalValue(userPortfolioRef.current, stocksRef.current);
    roundStartTradeIndexRef.current = userTradesRef.current.length;

    // Record round start prices for retro
    const priceSnap: Record<string, number> = {};
    for (const s of stocksRef.current) { priceSnap[s.ticker] = s.price; }
    roundStartPricesRef.current = priceSnap;
    roundTradesRef.current = new Map();

    // Initialize round snapshot
    currentSnapshotRef.current = {
      round,
      pricesAtStart: { ...priceSnap },
      events: [],
      pricesAtEnd: {},
      driftPct: {},
    };
    lastSnapshotPricesRef.current = { ...priceSnap };

    midRoundNewsFiredRef.current = new Set();
    firedNpcTradeKeysRef.current = new Set();
    usedCompanyTickersRef.current = [];

    setAgentStrategy(null);
    setAgentAdjustments([]);
    setStrategyExecuted(false);

    // Generate macro news during countdown (prices stay FROZEN — applied at trading open)
    (async () => {
      const aiNews = await fetchMacroNewsFromRegistry();
      if (aiNews) {
        const event: NewsEvent = {
          headline: aiNews.headline,
          sectorImpacts: aiNews.sectorImpacts,
          newsType: "macro" as const,
          category: aiNews.category as NewsEvent["category"],
        };
        setRoundNewsEvents([event]);
        setCurrentNewsImpacts(event.sectorImpacts);
        currentNewsImpactsRef.current = event.sectorImpacts;
        roundNewsEventsRef.current = [event];
        addEvent("news", event.headline);
        captureSnapshotEvent(event);
        // NOTE: No price application here — prices frozen during countdown
      } else {
        // Fallback to hardcoded macro news with round-based escalation
        console.log("[useBattle] Falling back to hardcoded behavior for Macro News Agent");
        const newsResult = pickMacroNews(usedMacroIndicesRef.current, round);
        if (newsResult) {
          const nextIndices = new Set(Array.from(usedMacroIndicesRef.current));
          nextIndices.add(newsResult.index);
          usedMacroIndicesRef.current = nextIndices;
          setRoundNewsEvents([newsResult.event]);
          setCurrentNewsImpacts(newsResult.event.sectorImpacts);
          currentNewsImpactsRef.current = newsResult.event.sectorImpacts;
          roundNewsEventsRef.current = [newsResult.event];
          addEvent("news", newsResult.event.headline);
          captureSnapshotEvent(newsResult.event);
          // NOTE: No price application here — prices frozen during countdown
        } else {
          setRoundNewsEvents([]);
          setCurrentNewsImpacts({});
          currentNewsImpactsRef.current = {};
        }
      }
    })();

    npcScheduleRef.current = scheduleNpcTrades(npcsRef.current);
    const tradeIdx: Record<string, number> = {};
    for (const npc of npcsRef.current) { tradeIdx[npc.id] = 0; }
    npcTradeIndexRef.current = tradeIdx;

    setCountdown(COUNTDOWN_DURATION);
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setTradingTimeLeft(TRADING_DURATION);
          setPhase("trading");
          addEvent("system", `Round ${round} \u2014 Trading is open!`);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round]);

  // -- Phase: trading --
  useEffect(() => {
    if (phase !== "trading") return;

    // Apply macro news to prices at trading open (prices were frozen during countdown)
    const macroEvents = roundNewsEventsRef.current;
    if (macroEvents.length > 0) {
      const macroEvent = macroEvents[0];
      console.log(`[TRADING] Round ${roundRef.current} — Applying macro news: "${macroEvent.headline}"`);
      const { stocks: updatedStocks } = applyNewsToPrice(stocksRef.current, macroEvent);
      stocksRef.current = updatedStocks;
      setStocks(updatedStocks);
      setIndexValue(computeIndex(updatedStocks));
    }

    fetchAgentStrategy(false);

    if (roundNewsEventsRef.current.length > 0) {
      setTimeout(() => fireArenaChats(roundNewsEventsRef.current[0].headline), 3000);
    }

    const npcList = npcsRef.current;
    const initialTimers: ReturnType<typeof setTimeout>[] = [];
    npcList.forEach((npc, i) => {
      const delay = 2000 + i * 1500 + Math.floor(Math.random() * 2000);
      const timer = setTimeout(() => doNpcTrade(npc.id), delay);
      initialTimers.push(timer);
    });

    const timerInterval = setInterval(() => {
      setTradingTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerInterval);
          return 0;
        }

        const elapsed = TRADING_DURATION - (prev - 1);
        const newsTimes = [15, 30];
        for (const t of newsTimes) {
          if (elapsed >= t && elapsed < t + 2 && !midRoundNewsFiredRef.current.has(t)) {
            midRoundNewsFiredRef.current.add(t);
            fireMidRoundNews(true);
          }
        }

        return prev - 1;
      });
    }, 1000);

    // Tick interval: drift-only random walk between news events
    const tickInterval = setInterval(() => {
      if (phaseRef.current !== "trading") return;
      const updatedStocks = tickPrices(stocksRef.current);
      stocksRef.current = updatedStocks;
      setStocks(updatedStocks);
      setIndexValue(computeIndex(updatedStocks));
    }, TICK_INTERVAL * 1000);

    const endCheck = setInterval(() => {
      if (tradingTimeRef.current <= 0) {
        clearInterval(endCheck);
        clearInterval(timerInterval);
        clearInterval(tickInterval);
        addEvent("system", `Round ${roundRef.current} complete \u2014 Trading paused.`);
        captureRoundRetro();
        setPhase("round_end");
        setCountdown(ROUND_END_DURATION);
      }
    }, 200);

    return () => {
      clearInterval(timerInterval);
      clearInterval(tickInterval);
      clearInterval(endCheck);
      initialTimers.forEach((t) => clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // -- Phase: round_end --
  useEffect(() => {
    if (phase !== "round_end") return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          if (round >= TOTAL_ROUNDS) {
            setPhase("match_retro");
          } else {
            setRound((r) => r + 1);
            setPhase("pre_round");
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [phase, round]);

  // -- Save match results (on results phase) --
  useEffect(() => {
    if (phase !== "results" || matchResultsSavedRef.current) return;
    matchResultsSavedRef.current = true;

    const currentStandings = standingsRef.current;
    if (currentStandings.length === 0) return;

    // Calculate P&L and was_correct for each decision based on final stock prices
    const finalStocks = stocksRef.current;
    const enrichedDecisions = decisionsRef.current.map((d) => {
      const stock = finalStocks.find((s) => s.ticker === d.ticker);
      if (!stock) return d;
      const finalPrice = stock.price;
      let pnlFromTrade: number | undefined;
      let wasCorrect: number | undefined;
      if (d.actionTaken === "LONG") {
        pnlFromTrade = Math.round(((finalPrice - d.price) / d.price) * 10000) / 100; // percent
        wasCorrect = finalPrice > d.price ? 1 : 0;
      } else if (d.actionTaken === "SHORT") {
        pnlFromTrade = Math.round(((d.price - finalPrice) / d.price) * 10000) / 100;
        wasCorrect = finalPrice < d.price ? 1 : 0;
      }
      return { ...d, pnlFromTrade, wasCorrect };
    });

    fetch("/api/match-results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numRounds: TOTAL_ROUNDS,
        stockTickers: finalStocks.map((s) => s.ticker),
        agents: currentStandings.map((s, i) => ({
          name: s.name,
          model: s.model,
          strategy: s.strategy,
          finalPnlPct: s.pnlPct,
          finalRank: i + 1,
          numTrades: s.totalTrades,
          isUser: s.isUser,
          customPrompt: s.isUser && customPrompt ? customPrompt : undefined,
        })),
        decisions: enrichedDecisions,
      }),
    }).catch((err) => console.error("Failed to save match results:", err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // -- Derived values --
  const userTotalValue = computeTotalValue(userPortfolio, stocks);
  const userPnl = Math.round((userTotalValue - STARTING_CASH) * 100) / 100;
  const userPnlPct = Math.round(((userTotalValue - STARTING_CASH) / STARTING_CASH) * 10000) / 10000;
  const roundPnl = Math.round((userTotalValue - roundStartValueRef.current) * 100) / 100;
  const roundTradeCount = userTrades.length - roundStartTradeIndexRef.current;
  const standings = computeStandings(userName, userPortfolio, npcs, stocks, userModelLabel, userStrategy, userTrades.length);
  standingsRef.current = standings;
  const { best: bestTrade, worst: worstTrade } = computeBestWorstTrade(userTrades, stocks);

  // Compute open P&L
  let openPnl = 0;
  for (const [ticker, pos] of Object.entries(userPortfolio.positions)) {
    const stock = stocks.find((s) => s.ticker === ticker);
    if (!stock) continue;
    openPnl += pos.side === "long"
      ? (stock.price - pos.avgCost) * pos.qty
      : (pos.avgCost - stock.price) * pos.qty;
  }
  openPnl = Math.round(openPnl * 100) / 100;

  // -- Dismiss retro (move to final results) --
  const dismissRetro = useCallback(() => {
    setPhase("results");
  }, []);

  return {
    phase,
    round,
    countdown,
    tradingTimeLeft,
    stocks,
    indexValue,
    roundNewsEvents,
    currentNewsImpacts,
    userPortfolio,
    userTotalValue,
    userPnl,
    userPnlPct,
    openPnl,
    roundPnl,
    roundTradeCount,
    eventLog,
    standings,
    bestTrade,
    worstTrade,
    npcs,
    userModelLabel,
    userStrategy,
    userTrades,
    executeTrade,
    // Agent strategy
    agentStrategy,
    agentAdjustments,
    strategyLoading,
    strategyExecuted,
    executeStrategy,
    executeAdjustment,
    // Autopilot
    autopilot,
    setAutopilot,
    // Chat
    chatMessages,
    chatLoading,
    sendChatMessage,
    // Arena chat (merged with events)
    arenaMessages,
    sendArenaMessage,
    // Retro
    retroRounds,
    roundSnapshots,
    dismissRetro,
  };
}
