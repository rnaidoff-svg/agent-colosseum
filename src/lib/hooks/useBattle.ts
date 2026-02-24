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
  MATCH_DURATION,
  EVENTS_PER_MATCH,
  initBattleStocks,
  applyNewsImpacts,
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
  clampImpacts,
  getSeverityForEvent,
} from "../battle/engine";
import type { NewsSeverity } from "../engine/types";
import { getModelLabel } from "../utils/format";

// ------ Phase type ------

export type BattlePhase = "trading" | "match_retro" | "results";

// Legacy aliases so page.tsx / retro don't break during transition
export type { BattlePhase as LegacyBattlePhase };

// ------ Event data stored for retro ------

export interface MatchEventData {
  eventNumber: number; // 1-5
  eventType: "macro" | "company";
  headline: string;
  severity: string;
  category: string;
  targetTicker: string | null;
  pricesBefore: Record<string, number>;
  pricesAfter: Record<string, number>;
  intendedImpacts: Record<string, number>;
  clampedImpacts: Record<string, number>;
  agentDecisions: {
    agentName: string;
    agentModel: string;
    trades: TradeInfo[];
    reasoning: string;
    portfolioValueAfter: number;
  }[];
}

// ------ Retro data types (kept for compatibility with existing retro) ------

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
  exitPrice?: number;
  pnlFromTrade?: number;
  wasCorrect?: number;
}

// ------ Snapshot types (kept for compatibility) ------

export interface EventSnapshot {
  headline: string;
  category: string;
  timestamp: string;
  intendedImpacts: Record<string, number>;
  pricesBefore: Record<string, number>;
  pricesAfter: Record<string, number>;
  actualImpactPct: Record<string, number>;
  agentDecisions: { agent: string; model: string; actions: string[]; reasoning: string }[];
}

export interface RoundSnapshot {
  round: number;
  pricesAtStart: Record<string, number>;
  events: EventSnapshot[];
  pricesAtEnd: Record<string, number>;
  driftPct: Record<string, number>;
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
  const [phase, setPhase] = useState<BattlePhase>("trading");
  const [matchTimeLeft, setMatchTimeLeft] = useState(MATCH_DURATION);
  const [currentEvent, setCurrentEvent] = useState(0); // 0 = no events fired yet, 1-5 = event number

  // -- Market --
  const [stocks, setStocks] = useState<BattleStock[]>(() => initBattleStocks(profiles));
  const [indexValue, setIndexValue] = useState(() => {
    const s = initBattleStocks(profiles);
    return computeIndex(s);
  });

  // -- News events this match --
  const [allNewsEvents, setAllNewsEvents] = useState<NewsEvent[]>([]);
  const [currentNewsImpacts, setCurrentNewsImpacts] = useState<Record<string, number>>({});
  const usedMacroIndicesRef = useRef<Set<number>>(new Set());
  const usedCompanyTickersRef = useRef<string[]>([]);

  // -- Portfolios --
  const [userPortfolio, setUserPortfolio] = useState<Portfolio>(createPortfolio);
  const [npcs, setNpcs] = useState<NpcAgent[]>(() => createNpcAgents(npcConfigs));

  // -- Agent strategy --
  const [agentStrategy, setAgentStrategy] = useState<AgentStrategyRec | null>(null);
  const [agentAdjustments, setAgentAdjustments] = useState<AgentAdjustment[]>([]);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [strategyExecuted, setStrategyExecuted] = useState(false);

  // -- Autopilot --
  const [autopilot, setAutopilot] = useState(autoAgent);
  const autopilotRef = useRef(autoAgent);
  autopilotRef.current = autopilot;

  // -- Arena chat --
  const [arenaMessages, setArenaMessages] = useState<ArenaChatMessage[]>([]);
  const arenaIdRef = useRef(0);
  const arenaMessagesRef = useRef<ArenaChatMessage[]>([]);
  arenaMessagesRef.current = arenaMessages;

  // -- Event log --
  const [eventLog, setEventLog] = useState<EventEntry[]>([]);
  const eventIdRef = useRef(0);

  // -- Trade tracking --
  const [userTrades, setUserTrades] = useState<TradeInfo[]>([]);

  // -- Match results saved flag --
  const matchResultsSavedRef = useRef(false);

  // -- Event data for retro --
  const [matchEvents, setMatchEvents] = useState<MatchEventData[]>([]);
  const matchEventsRef = useRef<MatchEventData[]>([]);

  // -- Retro data (compatibility with old retro) --
  const [retroRounds, setRetroRounds] = useState<RoundRetroData[]>([]);
  const roundTradesRef = useRef<Map<string, { trades: TradeInfo[]; reasoning: string }>>(new Map());

  // -- Decision logging --
  const decisionsRef = useRef<DecisionRecord[]>([]);

  // -- Round snapshots (compatibility) --
  const [roundSnapshots] = useState<RoundSnapshot[]>([]);

  // -- Used headlines for dedup --
  const usedHeadlinesRef = useRef<string[]>([]);

  // -- Event firing tracking --
  const firedEventsRef = useRef<Set<number>>(new Set());
  const eventFiringRef = useRef(false); // mutex to prevent concurrent event firing

  // -- Refs --
  const stocksRef = useRef(stocks);
  stocksRef.current = stocks;
  const npcsRef = useRef(npcs);
  npcsRef.current = npcs;
  const userPortfolioRef = useRef(userPortfolio);
  userPortfolioRef.current = userPortfolio;
  const matchTimeRef = useRef(matchTimeLeft);
  matchTimeRef.current = matchTimeLeft;
  const currentNewsImpactsRef = useRef(currentNewsImpacts);
  currentNewsImpactsRef.current = currentNewsImpacts;
  const allNewsEventsRef = useRef(allNewsEvents);
  allNewsEventsRef.current = allNewsEvents;
  const standingsRef = useRef<StandingEntry[]>([]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const currentEventRef = useRef(currentEvent);
  currentEventRef.current = currentEvent;
  const agentStrategyRef = useRef(agentStrategy);
  agentStrategyRef.current = agentStrategy;
  const strategyExecutedRef = useRef(strategyExecuted);
  strategyExecutedRef.current = strategyExecuted;
  const userTradesRef = useRef(userTrades);
  userTradesRef.current = userTrades;

  // -- Refs to break circular dependency --
  const doExecuteStrategyRef = useRef<((strategy: AgentStrategyRec) => { executed: number; failed: number; skipped: number; details: string[] }) | null>(null);
  type BatchResult = { executed: number; failed: number; skipped: number; details: string[] };
  type BatchContext = { type: "strategy" | "adjustment"; reasoning: string; label: string };
  const executeTradeBatchRef = useRef<((trades: { action: string; ticker: string; qty: number; reason?: string }[], ctx: BatchContext) => BatchResult) | null>(null);

  // -- Helpers --
  const addEvent = useCallback((type: EventEntry["type"], message: string) => {
    eventIdRef.current++;
    const entry: EventEntry = { id: eventIdRef.current, type, message };
    setEventLog((prev) => [...prev, entry]);
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

  const recordTrade = useCallback((agentName: string, trade: TradeInfo, reasoning?: string) => {
    const existing = roundTradesRef.current.get(agentName) || { trades: [], reasoning: "" };
    existing.trades.push(trade);
    if (reasoning) existing.reasoning = reasoning;
    roundTradesRef.current.set(agentName, existing);
  }, []);

  const recordDecision = useCallback((
    agentName: string, model: string, trade: TradeInfo, reasoning: string
  ) => {
    const latestNews = allNewsEventsRef.current;
    const lastEvent = latestNews.length > 0 ? latestNews[latestNews.length - 1] : null;
    const headline = lastEvent ? lastEvent.headline : "Market open";
    const nType = lastEvent ? (lastEvent.newsType || "unknown") : "unknown";
    const nCategory = lastEvent ? (lastEvent.category || "unknown") : "unknown";

    decisionsRef.current.push({
      agentName, model, round: currentEventRef.current,
      newsHeadline: headline, newsType: nType, newsCategory: nCategory,
      actionTaken: trade.action, ticker: trade.ticker,
      qty: trade.qty, price: trade.price, reasoning,
    });
  }, []);

  // -- Stamp exit prices --
  const stampExitPrices = useCallback(() => {
    const currentStocks = stocksRef.current;
    const priceMap: Record<string, number> = {};
    for (const s of currentStocks) priceMap[s.ticker] = s.price;
    for (const d of decisionsRef.current) {
      if (d.exitPrice === undefined && priceMap[d.ticker] !== undefined) {
        d.exitPrice = priceMap[d.ticker];
      }
    }
  }, []);

  // -- Fetch agent strategy from API --
  const fetchAgentStrategy = useCallback(async (isUpdate: boolean, newsHeadline?: string) => {
    if (!isUpdate) {
      setStrategyLoading(true);
    }

    try {
      const currentStocks = stocksRef.current;
      const stockData = currentStocks.map((s) => ({
        ticker: s.ticker, name: s.name, sector: s.sector, subSector: s.subSector,
        beta: s.beta, peRatio: s.peRatio, eps: s.eps, debtEbitda: s.debtEbitda,
        marketCap: s.marketCap, price: s.price, startPrice: s.startPrice,
        changePct: (s.price - s.startPrice) / s.startPrice,
      }));

      const positionSummary = buildPositionSummary(userPortfolioRef.current, currentStocks);
      const tickers = currentStocks.map((s) => `${s.ticker} (${s.subSector || s.sector})`).join(", ");
      const allNews = allNewsEventsRef.current.map((n) => n.headline).join(" | ");

      let enhancedPrompt = userSystemPrompt;
      if (isUpdate) {
        enhancedPrompt += `\n\nYou are managing a portfolio with $${userPortfolioRef.current.cash.toFixed(0)} cash.
Current positions:\n${positionSummary}
The stocks in this match are: ${tickers}
ALL NEWS THIS MATCH: ${allNews}
NEW NEWS (Event ${currentEventRef.current} of ${EVENTS_PER_MATCH}): ${newsHeadline || "Market update"}
How does this change your strategy? Recommend adjustments using exact tickers.`;
      } else {
        enhancedPrompt += `\n\nYou are managing a portfolio. Current cash: $${userPortfolioRef.current.cash.toFixed(0)}.
Current positions:\n${positionSummary}
The ${currentStocks.length} securities in this match are: ${tickers}
NEWS THIS MATCH: ${allNews || "No news yet"} (Event ${currentEventRef.current} of ${EVENTS_PER_MATCH})
You MUST make a decision on ALL ${currentStocks.length} securities. Deploy 60-80% of available capital across 3-5 positions.`;
      }

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
          newsEvents: allNewsEventsRef.current.map((n) => ({
            headline: n.headline,
            sectorImpacts: n.sectorImpacts,
          })),
          portfolio: {
            cash: userPortfolioRef.current.cash,
            positions: Object.fromEntries(
              Object.entries(userPortfolioRef.current.positions).map(([k, v]) => [
                k, { qty: v.qty, side: v.side, avgCost: v.avgCost },
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
        const adjTrades = (data.trades || []).map((t: Record<string, unknown>) => ({
          action: t.action as string, ticker: t.ticker as string,
          qty: t.qty as number, reason: (t.reason as string) || "",
        }));

        let adjExecuted = false;
        if (autopilotRef.current && phaseRef.current === "trading" && adjTrades.length > 0 && executeTradeBatchRef.current) {
          const result = executeTradeBatchRef.current(adjTrades, {
            type: "adjustment",
            reasoning: data.reasoning || "",
            label: `Auto-Adjustment "${newsHeadline || "Market update"}"`,
          });
          adjExecuted = true;
          if (result.executed > 0) {
            console.log(`[AUTO-AGENT] Auto-executed ${result.executed} adjustment trades`);
          }
        }

        const adjustment: AgentAdjustment = {
          headline: newsHeadline || "Market update",
          reasoning: data.reasoning || data.content || "No response",
          trades: adjTrades,
          executed: adjExecuted,
        };
        setAgentAdjustments((prev) => [...prev, adjustment]);
      } else {
        if (data.trades && data.trades.length > 0) {
          const newStrategy: AgentStrategyRec = {
            trades: data.trades,
            cashReserve: data.cashReserve ?? 0,
            summary: data.summary || data.content || "",
          };

          if (autopilotRef.current && phaseRef.current === "trading" && doExecuteStrategyRef.current) {
            doExecuteStrategyRef.current(newStrategy);
            setAgentStrategy(newStrategy);
            setStrategyExecuted(true);
            agentStrategyRef.current = newStrategy;
            strategyExecutedRef.current = true;
          } else {
            setAgentStrategy(newStrategy);
            setStrategyExecuted(false);
            agentStrategyRef.current = newStrategy;
            strategyExecutedRef.current = false;
          }
        } else if (data.content) {
          const newStrategy: AgentStrategyRec = {
            trades: [],
            cashReserve: userPortfolioRef.current.cash,
            summary: data.content,
          };
          setAgentStrategy(newStrategy);
          const isExec = autopilotRef.current;
          setStrategyExecuted(isExec);
          agentStrategyRef.current = newStrategy;
          strategyExecutedRef.current = isExec;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userModelId, userSystemPrompt, userStrategy, customPrompt, buildPositionSummary, addEvent, recordTrade, userName]);

  // ==========================================================================
  // UNIFIED TRADE EXECUTION
  // ==========================================================================
  const executeOneTrade = useCallback((
    action: "LONG" | "SHORT" | "CLOSE_LONG" | "CLOSE_SHORT" | "CLOSE",
    ticker: string,
    qty: number,
    context: { prefix: string; reasoning: string; trackDecision: boolean },
  ): { ok: boolean; reason: string; trade?: TradeInfo; actualQty: number } => {
    const currentStocks = stocksRef.current;
    const stock = currentStocks.find((s) => s.ticker === ticker);
    if (!stock) return { ok: false, reason: "Unknown stock", actualQty: 0 };

    const cashBefore = userPortfolioRef.current.cash;
    const posBefore = userPortfolioRef.current.positions[ticker];

    let resolvedAction = action;
    if (action === "CLOSE") {
      if (!posBefore) return { ok: false, reason: "No position to close", actualQty: 0 };
      resolvedAction = posBefore.side === "long" ? "CLOSE_LONG" : "CLOSE_SHORT";
    }

    if (resolvedAction === "LONG" || resolvedAction === "SHORT") {
      const maxAffordable = Math.floor(userPortfolioRef.current.cash / stock.price);
      if (qty > maxAffordable) {
        if (maxAffordable <= 0) {
          return { ok: false, reason: `Insufficient cash ($${cashBefore.toFixed(0)}, need $${(qty * stock.price).toFixed(0)})`, actualQty: 0 };
        }
        qty = maxAffordable;
      }

      const result = resolvedAction === "LONG"
        ? executeLong(userPortfolioRef.current, currentStocks, ticker, qty)
        : executeShort(userPortfolioRef.current, currentStocks, ticker, qty);

      if (!result.ok) return { ok: false, reason: result.reason, actualQty: 0 };

      setUserPortfolio(result.portfolio);
      userPortfolioRef.current = result.portfolio;

      const tradeInfo: TradeInfo = { ticker, action: resolvedAction, qty, price: stock.price };
      setUserTrades((prev) => [...prev, tradeInfo]);
      recordTrade(userName, tradeInfo, context.reasoning);
      if (context.trackDecision) {
        recordDecision(userName, userModelId, tradeInfo, context.reasoning);
      }
      addEvent("user_trade", `${context.prefix}${resolvedAction} ${qty}x ${ticker} @ $${stock.price.toFixed(2)}`);

      console.log(`=== ${context.prefix} ${resolvedAction} ${qty}x ${ticker} @ $${stock.price.toFixed(2)} | Cash: $${cashBefore.toFixed(0)} → $${result.portfolio.cash.toFixed(0)} ===`);

      return { ok: true, reason: "", trade: tradeInfo, actualQty: qty };
    } else {
      const existing = userPortfolioRef.current.positions[ticker];
      if (!existing) return { ok: false, reason: "No position to close", actualQty: 0 };
      const closeQty = Math.min(qty, existing.qty);
      const result = closePosition(userPortfolioRef.current, currentStocks, ticker, closeQty);

      if (!result.ok) return { ok: false, reason: result.reason, actualQty: 0 };

      setUserPortfolio(result.portfolio);
      userPortfolioRef.current = result.portfolio;

      const tradeInfo: TradeInfo = { ticker, action: resolvedAction as TradeInfo["action"], qty: closeQty, price: stock.price };
      setUserTrades((prev) => [...prev, tradeInfo]);
      recordTrade(userName, tradeInfo, context.reasoning);
      if (context.trackDecision) {
        recordDecision(userName, userModelId, tradeInfo, context.reasoning);
      }
      addEvent("user_trade", `${context.prefix}Closed ${result.side.toUpperCase()} ${closeQty}x ${ticker} @ $${stock.price.toFixed(2)}`);

      console.log(`=== ${context.prefix} CLOSE ${closeQty}x ${ticker} @ $${stock.price.toFixed(2)} (was ${result.side}) | Cash: $${cashBefore.toFixed(0)} → $${result.portfolio.cash.toFixed(0)} ===`);

      return { ok: true, reason: "", trade: tradeInfo, actualQty: closeQty };
    }
  }, [addEvent, recordTrade, recordDecision, userName, userModelId]);

  const logPortfolioSummary = useCallback((label: string) => {
    const portfolio = userPortfolioRef.current;
    const totalValue = computeTotalValue(portfolio, stocksRef.current);
    console.log(`=== PORTFOLIO AFTER ${label} === Cash: $${portfolio.cash.toFixed(2)} | Total: $${totalValue.toFixed(2)}`);
  }, []);

  const executeTradeBatch = useCallback((
    trades: { action: string; ticker: string; qty: number; reason?: string }[],
    batchContext: { type: "strategy" | "adjustment"; reasoning: string; label: string },
  ): BatchResult => {
    if (!trades || trades.length === 0) return { executed: 0, failed: 0, skipped: 0, details: [] };

    const prefix = batchContext.type === "adjustment"
      ? (autopilotRef.current ? "AUTO-ADJ: " : "ADJ: ")
      : (autopilotRef.current ? "AUTO: " : "");

    console.log(`[TRADE-BATCH] ${batchContext.label}: ${trades.length} trades, cash=$${userPortfolioRef.current.cash.toFixed(0)}`);

    let executed = 0;
    let failed = 0;
    let skipped = 0;
    const details: string[] = [];

    for (const trade of trades) {
      const action = trade.action as "LONG" | "SHORT" | "CLOSE_LONG" | "CLOSE_SHORT" | "CLOSE";
      const result = executeOneTrade(action, trade.ticker, trade.qty, {
        prefix,
        reasoning: trade.reason || batchContext.reasoning,
        trackDecision: true,
      });

      if (result.ok) {
        executed++;
        details.push(`${action} ${result.actualQty}x ${trade.ticker} @ $${result.trade!.price.toFixed(2)}`);
      } else if (result.reason.includes("Insufficient") || result.reason.includes("No position")) {
        skipped++;
        details.push(`${action} ${trade.ticker}: ${result.reason}`);
      } else {
        failed++;
        details.push(`${action} ${trade.ticker}: ${result.reason}`);
      }
    }

    console.log(`[TRADE-BATCH] ${batchContext.label} complete: ${executed} OK, ${failed} failed, ${skipped} skipped`);
    logPortfolioSummary(batchContext.label);

    return { executed, failed, skipped, details };
  }, [executeOneTrade, logPortfolioSummary]);

  const doExecuteStrategy = useCallback((strategy: AgentStrategyRec): BatchResult => {
    if (!strategy || strategy.trades.length === 0) return { executed: 0, failed: 0, skipped: 0, details: [] };
    return executeTradeBatch(strategy.trades, {
      type: "strategy",
      reasoning: strategy.summary,
      label: "Strategy",
    });
  }, [executeTradeBatch]);
  doExecuteStrategyRef.current = doExecuteStrategy;
  executeTradeBatchRef.current = executeTradeBatch;

  const executeStrategy = useCallback((): BatchResult => {
    const strategy = agentStrategyRef.current;
    if (!strategy || strategy.trades.length === 0) return { executed: 0, failed: 0, skipped: 0, details: [] };
    const result = doExecuteStrategy(strategy);
    setStrategyExecuted(true);
    strategyExecutedRef.current = true;
    return result;
  }, [doExecuteStrategy]);

  const executeAdjustment = useCallback((index: number): BatchResult => {
    const adjustments = agentAdjustments;
    if (index < 0 || index >= adjustments.length) return { executed: 0, failed: 0, skipped: 0, details: [] };
    const adj = adjustments[index];
    if (adj.executed || adj.trades.length === 0) return { executed: 0, failed: 0, skipped: 0, details: [] };

    const result = executeTradeBatch(adj.trades, {
      type: "adjustment",
      reasoning: adj.reasoning,
      label: `Adjustment "${adj.headline}"`,
    });

    setAgentAdjustments((prev) =>
      prev.map((a, i) => (i === index ? { ...a, executed: true } : a))
    );

    return result;
  }, [agentAdjustments, executeTradeBatch]);

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
    const allNews = allNewsEventsRef.current.map((n) => n.headline).join(" | ");

    const stockData = currentStocks.map((s) => ({
      ticker: s.ticker, name: s.name, sector: s.sector, subSector: s.subSector,
      beta: s.beta, peRatio: s.peRatio, eps: s.eps, debtEbitda: s.debtEbitda,
      marketCap: s.marketCap, price: s.price, startPrice: s.startPrice,
      changePct: (s.price - s.startPrice) / s.startPrice,
    }));

    const enhancedPrompt = npc.systemPrompt + `\n\nThe ${currentStocks.length} securities in this match: ${tickers}
NEWS THIS MATCH (Event ${currentEventRef.current} of ${EVENTS_PER_MATCH}): ${allNews || "No news"}
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
          newsEvents: allNewsEventsRef.current.map((n) => ({ headline: n.headline, sectorImpacts: n.sectorImpacts })),
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
          console.log(`[NPC-TRADE] ${npc.name} (${modelLabel}): ${actionLabel} ${trade.qty}x ${trade.ticker} @ $${trade.price.toFixed(2)}`);
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

    // Fallback
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

  // -- Arena chat --
  const fireArenaChatRef = useRef<((headline: string) => void) | null>(null);

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
        if (phaseRef.current !== "trading") return;
        fetchArenaChat({ name: npc.name, model: npc.model, strategy: npc.strategy, systemPrompt: npc.systemPrompt }, headline, false);
      }, delay);
    });
    setTimeout(() => {
      if (phaseRef.current !== "trading") return;
      fetchArenaChat({ name: userName, model: userModelId, strategy: userStrategy, systemPrompt: userSystemPrompt }, headline, true);
    }, 1000 + npcList.length * 1500);
  }, [fetchArenaChat, userName, userModelId, userStrategy, userSystemPrompt]);

  fireArenaChatRef.current = fireArenaChats;

  const sendArenaMessage = useCallback((content: string) => {
    addArenaMessage(userName, userModelId, content, true);
  }, [addArenaMessage, userName, userModelId]);

  // -- Manual trade --
  const executeTrade = useCallback(
    (ticker: string, action: "LONG" | "SHORT" | "CLOSE", qty: number): { ok: boolean; reason: string } => {
      const result = executeOneTrade(action, ticker, qty, {
        prefix: "",
        reasoning: "Manual trade",
        trackDecision: false,
      });
      return { ok: result.ok, reason: result.reason };
    },
    [executeOneTrade]
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
          newsEvents: allNewsEventsRef.current.map((n) => ({ headline: n.headline, sectorImpacts: n.sectorImpacts })),
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

  // ==========================================================================
  // NEWS EVENT FIRING — Core of the new 5-event system
  // ==========================================================================

  const callMarketEngine = useCallback(async (
    headline: string,
    currentStocks: BattleStock[],
    sectorImpacts: Record<string, number>
  ): Promise<Record<string, number> | null> => {
    try {
      const res = await fetch("/api/market-engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newsHeadline: headline,
          stocks: currentStocks.map(s => ({
            ticker: s.ticker, name: s.name, sector: s.sector,
            beta: s.beta, price: s.price, startPrice: s.startPrice,
            changePct: (s.price - s.startPrice) / s.startPrice,
          })),
          sectorImpacts,
        }),
      });
      const data = await res.json();
      if (data.targets) {
        const impacts: Record<string, number> = {};
        for (const [ticker, value] of Object.entries(data.targets)) {
          impacts[ticker] = (value as number) * 100;
        }
        return impacts;
      }
    } catch (err) {
      console.error("[market-engine] API error:", err);
    }
    return null;
  }, []);

  const fireNewsEvent = useCallback(async (eventNum: number) => {
    if (eventFiringRef.current) return;
    eventFiringRef.current = true;

    try {
      const currentStocks = stocksRef.current;
      console.log(`\n=== EVENT ${eventNum} of ${EVENTS_PER_MATCH} ===`);

      // 1. Determine event type
      let eventType: "macro" | "company";
      if (eventNum === 1) {
        eventType = "macro";
      } else {
        eventType = Math.random() < 0.4 ? "macro" : "company";
      }

      // 2. Severity
      const severity = getSeverityForEvent(eventNum);

      // 3. Generate news
      let newsEvent: NewsEvent | null = null;

      if (eventType === "macro") {
        // Try AI macro news agent
        try {
          const res = await fetch("/api/macro-news", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stocks: currentStocks.map((s) => ({
                ticker: s.ticker, name: s.name, sector: s.sector, beta: s.beta,
                peRatio: s.peRatio, marketCap: s.marketCap, eps: s.eps, debtEbitda: s.debtEbitda,
              })),
              roundNumber: eventNum,
              usedHeadlines: usedHeadlinesRef.current,
            }),
          });
          const data = await res.json();
          if (!data.fallback && data.headline) {
            console.log(`Event ${eventNum}: Called macro_news agent from registry — headline: "${data.headline}"`);
            usedHeadlinesRef.current = [...usedHeadlinesRef.current, data.headline];
            newsEvent = {
              headline: data.headline,
              sectorImpacts: data.sectorImpacts || {},
              newsType: "macro" as const,
              category: data.category,
              severity: data.severity || severity,
              direction: data.direction === "NEGATIVE" ? -1 : data.direction === "POSITIVE" ? 1 : undefined,
              per_stock_impacts: data.per_stock_impacts,
            };
          }
        } catch (err) {
          console.error("[EVENT] Macro news API error:", err);
        }

        // Fallback
        if (!newsEvent) {
          const result = pickMacroNews(usedMacroIndicesRef.current, eventNum);
          if (result) {
            usedMacroIndicesRef.current.add(result.index);
            newsEvent = result.event;
            console.log(`Event ${eventNum}: Fallback macro — headline: "${newsEvent.headline}"`);
          }
        }
      } else {
        // Company event — AI agent picks target
        // Try AI company news agent
        try {
          const res = await fetch("/api/company-news", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stocks: currentStocks.map((s) => ({
                ticker: s.ticker, name: s.name, sector: s.sector, subSector: s.subSector, beta: s.beta,
                peRatio: s.peRatio, marketCap: s.marketCap, eps: s.eps, debtEbitda: s.debtEbitda,
              })),
              roundNumber: eventNum,
              usedTickers: usedCompanyTickersRef.current,
            }),
          });
          const data = await res.json();
          if (!data.fallback && data.headline) {
            console.log(`Event ${eventNum}: Called company_news agent from registry, target: ${data.tickerAffected} — headline: "${data.headline}"`);
            usedCompanyTickersRef.current = [...usedCompanyTickersRef.current, data.tickerAffected];
            newsEvent = {
              headline: data.headline,
              sectorImpacts: data.sectorImpacts || {},
              newsType: "company_specific" as const,
              category: data.category,
              severity: data.severity || severity,
              direction: data.direction === "NEGATIVE" ? -1 : data.direction === "POSITIVE" ? 1 : undefined,
              target_ticker: data.tickerAffected,
              per_stock_impacts: data.per_stock_impacts,
            };
          }
        } catch (err) {
          console.error("[EVENT] Company news API error:", err);
        }

        // Fallback
        if (!newsEvent) {
          const result = generateCompanyNews(currentStocks, usedCompanyTickersRef.current, eventNum);
          if (result) {
            usedCompanyTickersRef.current = [...usedCompanyTickersRef.current, result.tickerAffected];
            newsEvent = result.event;
            console.log(`Event ${eventNum}: Fallback company, target: ${result.tickerAffected} — headline: "${newsEvent.headline}"`);
          }
        }
      }

      // Ultimate fallback
      if (!newsEvent) {
        newsEvent = {
          headline: "Markets hold steady amid mixed signals",
          sectorImpacts: {},
          newsType: eventType === "company" ? "company_specific" : "macro",
          severity,
        };
        console.log(`Event ${eventNum}: Using ultimate fallback headline`);
      }

      // 4. Call Market Engine AI
      const meImpacts = await callMarketEngine(newsEvent.headline, currentStocks, newsEvent.sectorImpacts);
      if (meImpacts) {
        console.log(`Event ${eventNum}: Called market_engine agent from registry — impacts: ${Object.entries(meImpacts).map(([t, v]) => `${t} ${v >= 0 ? "+" : ""}${v.toFixed(1)}%`).join(", ")}`);
        newsEvent.per_stock_impacts = meImpacts;
      } else if (!newsEvent.per_stock_impacts) {
        // Generate small random impacts as fallback
        const fallbackImpacts: Record<string, number> = {};
        for (const s of currentStocks) {
          fallbackImpacts[s.ticker] = (Math.random() - 0.5) * 1.0;
        }
        newsEvent.per_stock_impacts = fallbackImpacts;
      }

      // 5. Clamp impacts
      const eventSeverity = (newsEvent.severity || severity) as NewsSeverity;
      const rawImpacts = newsEvent.per_stock_impacts || {};
      const clampedImpacts = clampImpacts(rawImpacts, eventSeverity, `Event ${eventNum}`);

      // 6. Snapshot prices before
      const pricesBefore: Record<string, number> = {};
      for (const s of currentStocks) { pricesBefore[s.ticker] = s.price; }

      // 7. Apply clamped impacts
      const { stocks: updatedStocks } = applyNewsImpacts(currentStocks, clampedImpacts);
      stocksRef.current = updatedStocks;
      setStocks(updatedStocks);
      setIndexValue(computeIndex(updatedStocks));

      // Snapshot prices after
      const pricesAfter: Record<string, number> = {};
      for (const s of updatedStocks) { pricesAfter[s.ticker] = s.price; }

      // Console log price changes
      for (const s of updatedStocks) {
        const before = pricesBefore[s.ticker];
        const actualPct = ((s.price - before) / before) * 100;
        if (Math.abs(actualPct) > 0.01) {
          console.log(`  ${s.ticker}: $${before.toFixed(2)} → $${s.price.toFixed(2)} (${actualPct >= 0 ? "+" : ""}${actualPct.toFixed(2)}%)`);
        }
      }

      // Stamp exit prices for prior decisions before new prices take effect
      stampExitPrices();

      // Update news state
      setAllNewsEvents((prev) => [...prev, newsEvent!]);
      allNewsEventsRef.current = [...allNewsEventsRef.current, newsEvent!];
      const merged = { ...currentNewsImpactsRef.current };
      for (const [sector, impact] of Object.entries(newsEvent.sectorImpacts)) {
        merged[sector] = (merged[sector] || 0) + impact;
      }
      setCurrentNewsImpacts(merged);
      currentNewsImpactsRef.current = merged;

      // Add event to log
      const typeLabel = eventType === "macro" ? "MACRO" : "COMPANY";
      addEvent("news", `[Event ${eventNum}] [${typeLabel}] ${newsEvent.headline}`);

      // Update current event number
      setCurrentEvent(eventNum);
      currentEventRef.current = eventNum;

      // Store event data for retro
      const eventData: MatchEventData = {
        eventNumber: eventNum,
        eventType,
        headline: newsEvent.headline,
        severity: eventSeverity,
        category: newsEvent.category || "unknown",
        targetTicker: newsEvent.target_ticker || null,
        pricesBefore,
        pricesAfter,
        intendedImpacts: rawImpacts,
        clampedImpacts,
        agentDecisions: [], // filled after trades
      };

      // 8. Trigger trading for all agents
      // User strategy
      if (eventNum === 1) {
        fetchAgentStrategy(false);
      } else {
        fetchAgentStrategy(true, newsEvent.headline);
      }

      // NPC trades
      const npcList = npcsRef.current;
      npcList.forEach((npc, i) => {
        const delay = 1500 + i * 1000 + Math.floor(Math.random() * 1500);
        setTimeout(() => doNpcTrade(npc.id), delay);
      });

      // Arena chat
      setTimeout(() => fireArenaChatRef.current?.(newsEvent!.headline), 2000);

      // Save event data
      matchEventsRef.current = [...matchEventsRef.current, eventData];
      setMatchEvents([...matchEventsRef.current]);

    } finally {
      eventFiringRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addEvent, callMarketEngine, doNpcTrade, fetchAgentStrategy, stampExitPrices]);

  // ==========================================================================
  // MAIN MATCH TIMER — fires events at correct times, ends match at 0
  // ==========================================================================
  useEffect(() => {
    if (phase !== "trading") return;

    console.log(`[MATCH] === MATCH START === duration=${MATCH_DURATION}s, events=${EVENTS_PER_MATCH}`);
    addEvent("system", "Match started! 5 news events incoming.");

    // Fire Event 1 immediately
    if (!firedEventsRef.current.has(1)) {
      firedEventsRef.current.add(1);
      fireNewsEvent(1);
    }

    const timer = setInterval(() => {
      setMatchTimeLeft((prev) => {
        const next = prev - 1;

        // Check which event should fire based on time remaining
        // Event 1: 100 (already fired)
        // Event 2: 80 remaining
        // Event 3: 60 remaining
        // Event 4: 40 remaining
        // Event 5: 20 remaining
        const eventThresholds: [number, number][] = [
          [80, 2], [60, 3], [40, 4], [20, 5],
        ];
        for (const [threshold, evtNum] of eventThresholds) {
          if (next <= threshold && !firedEventsRef.current.has(evtNum)) {
            firedEventsRef.current.add(evtNum);
            fireNewsEvent(evtNum);
          }
        }

        // Match end
        if (next <= 0) {
          clearInterval(timer);
          console.log(`[MATCH] === MATCH END ===`);
          stampExitPrices();

          // Build retro data for compatibility
          const currentStocks = stocksRef.current;
          const currentNpcs = npcsRef.current;
          const agentTrades: RoundRetroData["agentTrades"] = [];
          const agentPnls: RoundRetroData["agentPnls"] = [];

          const userTradeData = roundTradesRef.current.get(userName) || { trades: [], reasoning: "" };
          agentTrades.push({ name: userName, model: userModelLabel, trades: userTradeData.trades, reasoning: userTradeData.reasoning });
          const userValue = computeTotalValue(userPortfolioRef.current, currentStocks);
          agentPnls.push({ name: userName, model: userModelLabel, strategy: userStrategy, roundPnl: userValue - STARTING_CASH, totalPnl: userValue - STARTING_CASH });

          for (const npc of currentNpcs) {
            const npcTradeData = roundTradesRef.current.get(npc.name) || { trades: [], reasoning: "" };
            agentTrades.push({ name: npc.name, model: getModelLabel(npc.model), trades: npcTradeData.trades, reasoning: npcTradeData.reasoning });
            const npcValue = computeTotalValue(npc.portfolio, currentStocks);
            agentPnls.push({ name: npc.name, model: getModelLabel(npc.model), strategy: npc.strategyLabel, roundPnl: npcValue - STARTING_CASH, totalPnl: npcValue - STARTING_CASH });
          }

          const startPrices: Record<string, number> = {};
          for (const s of currentStocks) { startPrices[s.ticker] = s.startPrice; }

          const retroData: RoundRetroData = {
            round: 1,
            newsEvents: [...allNewsEventsRef.current],
            agentTrades,
            stockPrices: currentStocks.map((s) => ({
              ticker: s.ticker, startPrice: s.startPrice, endPrice: s.price,
              changePct: (s.price - s.startPrice) / s.startPrice,
            })),
            agentPnls,
          };
          setRetroRounds([retroData]);

          addEvent("system", "Match complete!");
          setPhase("match_retro");
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // -- Save match results --
  useEffect(() => {
    if (phase !== "results" || matchResultsSavedRef.current) return;
    matchResultsSavedRef.current = true;

    const currentStandings = standingsRef.current;
    if (currentStandings.length === 0) return;

    const finalStocks = stocksRef.current;
    const enrichedDecisions = decisionsRef.current.map((d) => {
      const stock = finalStocks.find((s) => s.ticker === d.ticker);
      if (!stock) return d;
      const exitPrice = d.exitPrice ?? stock.price;
      let pnlFromTrade: number | undefined;
      let wasCorrect: number | undefined;
      if (d.actionTaken === "LONG") {
        pnlFromTrade = Math.round(((exitPrice - d.price) / d.price) * 10000) / 100;
        wasCorrect = exitPrice > d.price ? 1 : 0;
      } else if (d.actionTaken === "SHORT") {
        pnlFromTrade = Math.round(((d.price - exitPrice) / d.price) * 10000) / 100;
        wasCorrect = exitPrice < d.price ? 1 : 0;
      }
      return { ...d, pnlFromTrade, wasCorrect };
    });

    console.log(`[SAVE] Saving match results: ${currentStandings.length} agents, ${enrichedDecisions.length} decisions`);
    fetch("/api/match-results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numRounds: 1,
        matchType: currentStandings.length === 1 ? "solo" : currentStandings.length === 2 ? "head_to_head" : "battle",
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
    }).then(async (res) => {
      const data = await res.json();
      console.log(`[SAVE] Match results saved successfully: matchId=${data.matchId}`);
    }).catch((err) => console.error("[SAVE] Failed to save match results:", err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // -- Derived values --
  const userTotalValue = computeTotalValue(userPortfolio, stocks);
  const userPnl = Math.round((userTotalValue - STARTING_CASH) * 100) / 100;
  const userPnlPct = Math.round(((userTotalValue - STARTING_CASH) / STARTING_CASH) * 10000) / 10000;
  const standings = computeStandings(userName, userPortfolio, npcs, stocks, userModelLabel, userStrategy, userTrades.length);
  standingsRef.current = standings;
  const { best: bestTrade, worst: worstTrade } = computeBestWorstTrade(userTrades, stocks);

  let openPnl = 0;
  for (const [ticker, pos] of Object.entries(userPortfolio.positions)) {
    const stock = stocks.find((s) => s.ticker === ticker);
    if (!stock) continue;
    openPnl += pos.side === "long"
      ? (stock.price - pos.avgCost) * pos.qty
      : (pos.avgCost - stock.price) * pos.qty;
  }
  openPnl = Math.round(openPnl * 100) / 100;

  const dismissRetro = useCallback(() => {
    setPhase("results");
  }, []);

  return {
    phase,
    round: 1, // always 1 now
    countdown: 0, // no countdown phase
    tradingTimeLeft: matchTimeLeft,
    currentEvent,
    matchTimeLeft,
    stocks,
    indexValue,
    roundNewsEvents: allNewsEvents,
    currentNewsImpacts,
    userPortfolio,
    userTotalValue,
    userPnl,
    userPnlPct,
    openPnl,
    roundPnl: userPnl, // same as total now (single round)
    roundTradeCount: userTrades.length,
    eventLog,
    standings,
    bestTrade,
    worstTrade,
    npcs,
    userModelLabel,
    userStrategy,
    userTrades,
    executeTrade,
    agentStrategy,
    agentAdjustments,
    strategyLoading,
    strategyExecuted,
    executeStrategy,
    executeAdjustment,
    autopilot,
    setAutopilot,
    chatMessages,
    chatLoading,
    sendChatMessage,
    arenaMessages,
    sendArenaMessage,
    retroRounds,
    roundSnapshots,
    matchEvents,
    dismissRetro,
  };
}
