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
  type EventScheduleEntry,
  STARTING_CASH,
  TRADING_DURATION,
  INITIAL_COUNTDOWN,
  TICK_INTERVAL,
  PRICE_REACTION_DELAY,
  NUM_EVENTS,
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
  buildEventSchedule,
} from "../battle/engine";
import { getModelLabel } from "../utils/format";

// ------ NPC trade flash type ------

export interface RecentNpcTrade {
  npcId: string;
  npcName: string;
  trade: TradeInfo;
  timestamp: number;
}

// ------ Phase type ------

export type BattlePhase = "countdown" | "trading" | "match_retro" | "results";

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
  eventIndex: number;  // which event (0-4) triggered this trade
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

// ------ Round Snapshot (for QA/retro) ------

export interface EventSnapshot {
  headline: string;
  category: string;
  timestamp: string;
  intendedImpacts: Record<string, number>; // per_stock_impacts from AI (or sectorImpacts fallback)
  pricesBefore: Record<string, number>; // price snapshot BEFORE event applied
  pricesAfter: Record<string, number>; // price snapshot AFTER event applied
  actualImpactPct: Record<string, number>; // actual % change (after vs before)
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
  const [phase, setPhase] = useState<BattlePhase>("countdown");
  const round = 1; // single session — always round 1
  const [countdown, setCountdown] = useState(INITIAL_COUNTDOWN);
  const [tradingTimeLeft, setTradingTimeLeft] = useState(TRADING_DURATION);

  // -- Event schedule state --
  const [currentEventIndex, setCurrentEventIndex] = useState(-1); // -1 before first event, 0-4 during
  const [pendingPriceImpact, setPendingPriceImpact] = useState<{
    eventIndex: number; event: NewsEvent; countdown: number;
  } | null>(null);
  const [nextEventCountdown, setNextEventCountdown] = useState<number | null>(null);
  const prefetchedEventsRef = useRef<Map<number, {
    event: NewsEvent | null; marketEngineImpacts: Record<string, number> | null;
    status: "fetching" | "ready" | "applied";
  }>>(new Map());
  const eventScheduleRef = useRef<EventScheduleEntry[]>(buildEventSchedule());
  const firedEventsRef = useRef<Set<number>>(new Set());
  const firedPriceImpactsRef = useRef<Set<number>>(new Set());
  const firedPrefetchesRef = useRef<Set<number>>(new Set());

  // -- Market --
  const [stocks, setStocks] = useState<BattleStock[]>(() => initBattleStocks(profiles));
  const [indexValue, setIndexValue] = useState(() => {
    const s = initBattleStocks(profiles);
    return computeIndex(s);
  });

  // -- News events for session --
  const [roundNewsEvents, setRoundNewsEvents] = useState<NewsEvent[]>([]);
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

  // -- NPC trade flash (for ParticipantsPanel) --
  const [recentNpcTrades, setRecentNpcTrades] = useState<Record<string, RecentNpcTrade>>({});

  // -- Token usage tracking --
  const [tokenUsage, setTokenUsage] = useState<Record<string, {
    name: string; type: "trading" | "market"; tokens: number; calls: number;
  }>>({});

  const addTokens = useCallback((agentId: string, name: string, type: "trading" | "market", tokens: number) => {
    if (!tokens || tokens <= 0) return;
    setTokenUsage(prev => ({
      ...prev,
      [agentId]: {
        name, type,
        tokens: (prev[agentId]?.tokens || 0) + tokens,
        calls: (prev[agentId]?.calls || 0) + 1,
      }
    }));
  }, []);

  // -- NPC scheduling removed — NPCs now trade reactively per event --

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
  const currentEventIndexRef = useRef(-1); // tracks which event (0-4) is active for decision tagging

  // -- Enriched decisions (exposed to UI for retro screen) --
  const [enrichedDecisions, setEnrichedDecisions] = useState<DecisionRecord[]>([]);
  // -- Successful trades map (agent name → count of correct trades) --
  const [successfulTradesMap, setSuccessfulTradesMap] = useState<Map<string, number>>(new Map());

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
  const roundRef = useRef(1); // always 1 — single session
  const agentStrategyRef = useRef(agentStrategy);
  agentStrategyRef.current = agentStrategy;
  const strategyExecutedRef = useRef(strategyExecuted);
  strategyExecutedRef.current = strategyExecuted;
  const userTradesRef = useRef(userTrades);
  userTradesRef.current = userTrades;

  // -- Refs to break circular dependency: fetchAgentStrategy defined before executeTradeBatch/doExecuteStrategy --
  const doExecuteStrategyRef = useRef<((strategy: AgentStrategyRec) => { executed: number; failed: number; skipped: number; details: string[] }) | null>(null);
  type BatchResult = { executed: number; failed: number; skipped: number; details: string[] };
  type BatchContext = { type: "strategy" | "adjustment"; reasoning: string; label: string };
  const executeTradeBatchRef = useRef<((trades: { action: string; ticker: string; qty: number; reason?: string }[], ctx: BatchContext) => BatchResult) | null>(null);

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
      eventIndex: currentEventIndexRef.current,
      newsHeadline: headline, newsType: nType, newsCategory: nCategory,
      actionTaken: trade.action, ticker: trade.ticker,
      qty: trade.qty, price: trade.price, reasoning,
    });
  }, []);

  // -- Snapshot helpers (PART 5) --
  const captureSnapshotEvent = useCallback((
    event: NewsEvent,
    beforePrices: Record<string, number>,
    afterPrices: Record<string, number>,
  ) => {
    const snap = currentSnapshotRef.current;
    if (!snap) return;

    // Compute actual % change: after vs before
    const actualImpactPct: Record<string, number> = {};
    for (const [ticker, price] of Object.entries(afterPrices)) {
      const prev = beforePrices[ticker];
      if (prev && prev > 0) {
        actualImpactPct[ticker] = (price - prev) / prev;
      }
    }

    // Use per_stock_impacts for intended (preferred), fall back to sectorImpacts
    const intendedImpacts: Record<string, number> = event.per_stock_impacts
      ? { ...event.per_stock_impacts }
      : { ...event.sectorImpacts };

    snap.events.push({
      headline: event.headline,
      category: event.category || "unknown",
      timestamp: new Date().toISOString(),
      intendedImpacts,
      pricesBefore: { ...beforePrices },
      pricesAfter: { ...afterPrices },
      actualImpactPct,
      agentDecisions: [],
    });
    lastSnapshotPricesRef.current = { ...afterPrices };
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
      const allNewsEvents = roundNewsEventsRef.current;
      const priorNews = isUpdate ? allNewsEvents.slice(0, -1).map((n) => n.headline).join(" | ") : allNewsEvents.map((n) => n.headline).join(" | ");

      let enhancedPrompt = userSystemPrompt;
      if (isUpdate) {
        enhancedPrompt += `\n\nYou are managing a portfolio with $${userPortfolioRef.current.cash.toFixed(0)} cash.
Current positions:\n${positionSummary}
The stocks in this match are: ${tickers}
${priorNews ? `PRIOR NEWS (already priced in): ${priorNews}` : ""}
>>> NEW EVENT JUST DROPPED: ${newsHeadline || "Market update"} <<<
Stock prices have NOT moved yet in response to this event. They will move in ~10 seconds.
React to this NEW event. How does it change your strategy? Recommend adjustments using exact tickers.`;
      } else {
        enhancedPrompt += `\n\nYou are managing a portfolio. Current cash: $${userPortfolioRef.current.cash.toFixed(0)}.
Current positions:\n${positionSummary}
The ${currentStocks.length} securities in this match are: ${tickers}
NEWS THIS ROUND: ${priorNews || "No news yet"}
You MUST make a decision on ALL ${currentStocks.length} securities. Deploy 60-80% of capital. Only 2 securities — take concentrated positions.`;
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
          newsEvents: allNewsEvents.map((n) => ({
            headline: n.headline,
            sectorImpacts: n.sectorImpacts,
          })),
          latestEvent: isUpdate && newsHeadline ? {
            headline: newsHeadline,
            eventIndex: currentEventIndexRef.current,
            newsType: allNewsEvents.length > 0 ? (allNewsEvents[allNewsEvents.length - 1].newsType || "unknown") : "unknown",
          } : undefined,
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
        const adjTrades = (data.trades || []).map((t: Record<string, unknown>) => ({
          action: t.action as string,
          ticker: t.ticker as string,
          qty: t.qty as number,
          reason: (t.reason as string) || "",
        }));

        // If autopilot, execute adjustment trades immediately using unified batch executor
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
        setAgentAdjustments([adjustment]); // Replace old adjustments
      } else {
        if (data.trades && data.trades.length > 0) {
          const newStrategy: AgentStrategyRec = {
            trades: data.trades,
            cashReserve: data.cashReserve ?? 0,
            summary: data.summary || data.content || "",
          };

          // If autopilot, execute strategy immediately using unified batch executor
          // This ensures strategyExecuted=true in the same render batch, so no PENDING flash
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
          // No trades to execute, mark as executed if autopilot
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
  // UNIFIED TRADE EXECUTION — Single function used by ALL trade paths:
  //   manual (user clicks LONG/SHORT), auto-execute (strategy), auto-adjust
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

    // Normalize CLOSE → CLOSE_LONG / CLOSE_SHORT based on existing position
    let resolvedAction = action;
    if (action === "CLOSE") {
      if (!posBefore) return { ok: false, reason: "No position to close", actualQty: 0 };
      resolvedAction = posBefore.side === "long" ? "CLOSE_LONG" : "CLOSE_SHORT";
    }

    if (resolvedAction === "LONG" || resolvedAction === "SHORT") {
      // Cash clamping — reduce qty if insufficient cash
      const maxAffordable = Math.floor(userPortfolioRef.current.cash / stock.price);
      if (qty > maxAffordable) {
        if (maxAffordable <= 0) {
          console.log(`=== ${context.prefix} ${resolvedAction} ${qty}x ${ticker} @ $${stock.price.toFixed(2)} ===`);
          console.log(`  Cash: $${cashBefore.toFixed(0)} — INSUFFICIENT, need $${(qty * stock.price).toFixed(0)}`);
          return { ok: false, reason: `Insufficient cash ($${cashBefore.toFixed(0)}, need $${(qty * stock.price).toFixed(0)})`, actualQty: 0 };
        }
        console.log(`=== ${context.prefix} ${resolvedAction} ${qty}x ${ticker} @ $${stock.price.toFixed(2)} ===`);
        console.log(`  Cash: $${cashBefore.toFixed(0)} — reducing ${qty} → ${maxAffordable} shares`);
        qty = maxAffordable;
      }

      const result = resolvedAction === "LONG"
        ? executeLong(userPortfolioRef.current, currentStocks, ticker, qty)
        : executeShort(userPortfolioRef.current, currentStocks, ticker, qty);

      if (!result.ok) {
        console.log(`=== ${context.prefix} ${resolvedAction} ${qty}x ${ticker} FAILED: ${result.reason} ===`);
        return { ok: false, reason: result.reason, actualQty: 0 };
      }

      // Update portfolio state
      setUserPortfolio(result.portfolio);
      userPortfolioRef.current = result.portfolio;

      const tradeInfo: TradeInfo = { ticker, action: resolvedAction, qty, price: stock.price };
      setUserTrades((prev) => [...prev, tradeInfo]);
      recordTrade(userName, tradeInfo, context.reasoning);
      if (context.trackDecision) {
        recordDecision(userName, userModelId, tradeInfo, context.reasoning);
      }
      addEvent("user_trade", `${context.prefix}${resolvedAction} ${qty}x ${ticker} @ $${stock.price.toFixed(2)}`);

      // Detailed logging
      const posAfter = result.portfolio.positions[ticker];
      console.log(`=== ${context.prefix} ${resolvedAction} ${qty}x ${ticker} @ $${stock.price.toFixed(2)} ===`);
      if (posBefore) {
        console.log(`  Existing position: ${ticker} ${posBefore.side.toUpperCase()} ${posBefore.qty}x @ $${posBefore.avgCost.toFixed(2)}`);
      }
      if (posAfter && posBefore && posBefore.side === posAfter.side && posAfter.qty > posBefore.qty) {
        console.log(`  ACCUMULATED: ${ticker} now ${posAfter.qty}x @ avg $${posAfter.avgCost.toFixed(2)}`);
      }
      console.log(`  Cash: $${cashBefore.toFixed(0)} → $${result.portfolio.cash.toFixed(0)}`);

      return { ok: true, reason: "", trade: tradeInfo, actualQty: qty };

    } else {
      // CLOSE_LONG or CLOSE_SHORT
      const existing = userPortfolioRef.current.positions[ticker];
      if (!existing) {
        console.log(`=== ${context.prefix} ${resolvedAction} ${ticker} — no open position ===`);
        return { ok: false, reason: "No position to close", actualQty: 0 };
      }
      const closeQty = Math.min(qty, existing.qty);
      const result = closePosition(userPortfolioRef.current, currentStocks, ticker, closeQty);

      if (!result.ok) {
        console.log(`=== ${context.prefix} ${resolvedAction} ${closeQty}x ${ticker} FAILED: ${result.reason} ===`);
        return { ok: false, reason: result.reason, actualQty: 0 };
      }

      setUserPortfolio(result.portfolio);
      userPortfolioRef.current = result.portfolio;

      const tradeInfo: TradeInfo = { ticker, action: resolvedAction as TradeInfo["action"], qty: closeQty, price: stock.price };
      setUserTrades((prev) => [...prev, tradeInfo]);
      recordTrade(userName, tradeInfo, context.reasoning);
      if (context.trackDecision) {
        recordDecision(userName, userModelId, tradeInfo, context.reasoning);
      }
      addEvent("user_trade", `${context.prefix}Closed ${result.side.toUpperCase()} ${closeQty}x ${ticker} @ $${stock.price.toFixed(2)}`);

      console.log(`=== ${context.prefix} CLOSE ${closeQty}x ${ticker} @ $${stock.price.toFixed(2)} (was ${result.side}) ===`);
      console.log(`  Cash: $${cashBefore.toFixed(0)} → $${result.portfolio.cash.toFixed(0)}`);

      return { ok: true, reason: "", trade: tradeInfo, actualQty: closeQty };
    }
  }, [addEvent, recordTrade, recordDecision, userName, userModelId]);

  // -- Log portfolio summary after a batch of trades --
  const logPortfolioSummary = useCallback((label: string) => {
    const currentStocks = stocksRef.current;
    const portfolio = userPortfolioRef.current;
    const positions = Object.entries(portfolio.positions);
    const totalValue = computeTotalValue(portfolio, currentStocks);
    console.log(`=== PORTFOLIO AFTER ${label} ===`);
    for (const [ticker, pos] of positions) {
      const stock = currentStocks.find(s => s.ticker === ticker);
      const curPrice = stock ? stock.price : pos.avgCost;
      const pnl = pos.side === "long"
        ? (curPrice - pos.avgCost) * pos.qty
        : (pos.avgCost - curPrice) * pos.qty;
      console.log(`  ${ticker}: ${pos.side.toUpperCase()} ${pos.qty}x @ $${pos.avgCost.toFixed(2)} | Current: $${curPrice.toFixed(2)} | P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`);
    }
    if (positions.length === 0) console.log("  No open positions");
    console.log(`  Cash: $${portfolio.cash.toFixed(2)} | Total: $${totalValue.toFixed(2)}`);
  }, []);

  // -- Execute a batch of trades (strategy or adjustment) --
  const executeTradeBatch = useCallback((
    trades: { action: string; ticker: string; qty: number; reason?: string }[],
    batchContext: { type: "strategy" | "adjustment"; reasoning: string; label: string },
  ): { executed: number; failed: number; skipped: number; details: string[] } => {
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

    console.log(`[TRADE-BATCH] ${batchContext.label} complete: ${executed} OK, ${failed} failed, ${skipped} skipped | cash=$${userPortfolioRef.current.cash.toFixed(0)}`);
    logPortfolioSummary(batchContext.label);

    return { executed, failed, skipped, details };
  }, [executeOneTrade, logPortfolioSummary]);

  // -- Execute strategy helper (used by both manual button and autopilot) --
  const doExecuteStrategy = useCallback((strategy: AgentStrategyRec): { executed: number; failed: number; skipped: number; details: string[] } => {
    if (!strategy || strategy.trades.length === 0) return { executed: 0, failed: 0, skipped: 0, details: [] };
    return executeTradeBatch(strategy.trades, {
      type: "strategy",
      reasoning: strategy.summary,
      label: "Strategy",
    });
  }, [executeTradeBatch]);
  doExecuteStrategyRef.current = doExecuteStrategy;
  executeTradeBatchRef.current = executeTradeBatch;

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

    // Determine the latest event (the one traders should react to)
    const allNewsEvents = roundNewsEventsRef.current;
    const latestEvent = allNewsEvents.length > 0 ? allNewsEvents[allNewsEvents.length - 1] : null;
    const priorNews = allNewsEvents.slice(0, -1).map((n) => n.headline).join(" | ");

    const stockData = currentStocks.map((s) => ({
      ticker: s.ticker, name: s.name, sector: s.sector, subSector: s.subSector,
      beta: s.beta, peRatio: s.peRatio, eps: s.eps, debtEbitda: s.debtEbitda,
      marketCap: s.marketCap, price: s.price, startPrice: s.startPrice,
      changePct: (s.price - s.startPrice) / s.startPrice,
    }));

    const enhancedPrompt = npc.systemPrompt + `\n\nThe ${currentStocks.length} securities in this match: ${tickers}
${priorNews ? `PRIOR NEWS (already priced in): ${priorNews}` : ""}
Your cash: $${npc.portfolio.cash.toFixed(0)}
Your positions:\n${positionSummary}
You MUST decide on ALL ${currentStocks.length} securities. Deploy 60-80% of capital. Only 2 securities — take concentrated positions. Be aggressive.`;

    try {
      const res = await fetch("/api/npc-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: { name: npc.name, model: npc.model, strategy: npc.strategy, systemPrompt: enhancedPrompt, registryId: npc.registryId },
          stocks: stockData,
          newsEvents: allNewsEvents.map((n) => ({ headline: n.headline, sectorImpacts: n.sectorImpacts })),
          latestEvent: latestEvent ? {
            headline: latestEvent.headline,
            eventIndex: currentEventIndexRef.current,
            newsType: latestEvent.newsType || "unknown",
            targetTicker: latestEvent.target_ticker || null,
          } : null,
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
        return { trades: data.trades as NpcTradeDecision[], reasoning: data.reasoning || "", usage: data.usage };
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
          console.log(`[NPC-TRADE] ${npc.name} (${modelLabel}): ${actionLabel} ${trade.qty}x ${trade.ticker} @ $${trade.price.toFixed(2)} | cash=$${updatedNpc.portfolio.cash.toFixed(0)}`);
          arenaIdRef.current++;
          setArenaMessages((prev) => [...prev, {
            id: arenaIdRef.current, agentName: npc.name, agentModel: modelLabel,
            message: `${actionLabel} ${trade.qty} shares ${trade.ticker} @ $${trade.price.toFixed(2)}`,
            isUser: false, isSystem: true, systemType: "npc_trade" as const,
          }]);
        }
        // Record recent trade for flash display
        const lastTrade = executedTrades[executedTrades.length - 1];
        const now = Date.now();
        setRecentNpcTrades(prev => ({ ...prev, [npcId]: { npcId, npcName: npc.name, trade: lastTrade, timestamp: now } }));
        setTimeout(() => {
          setRecentNpcTrades(prev => {
            const entry = prev[npcId];
            if (entry && entry.timestamp === now) { const next = { ...prev }; delete next[npcId]; return next; }
            return prev;
          });
        }, 5000);
        // Token tracking
        const tokenKey = npc.strategy.toLowerCase().replace(/\s+/g, "_");
        if (apiResult.usage?.total_tokens) {
          addTokens(tokenKey, npc.name, "trading", apiResult.usage.total_tokens);
        }
        return;
      }
    }

    // Fallback to deterministic logic
    console.log(`[NPC-TRADE] ${npc.name}: API returned no trades, using fallback`);
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
        console.log(`[NPC-TRADE] ${npc.name} (${modelLabel}) FALLBACK: ${actionLabel} ${fallbackTrade.qty}x ${fallbackTrade.ticker} @ $${fallbackTrade.price.toFixed(2)} | cash=$${updatedNpc.portfolio.cash.toFixed(0)}`);
        arenaIdRef.current++;
        setArenaMessages((prev) => [...prev, {
          id: arenaIdRef.current, agentName: npc.name, agentModel: modelLabel,
          message: `${actionLabel} ${fallbackTrade.qty} shares ${fallbackTrade.ticker} @ $${fallbackTrade.price.toFixed(2)}`,
          isUser: false, isSystem: true, systemType: "npc_trade" as const,
        }]);
        // Record recent trade for flash display
        const now = Date.now();
        setRecentNpcTrades(prev => ({ ...prev, [npcId]: { npcId, npcName: npc.name, trade: fallbackTrade, timestamp: now } }));
        setTimeout(() => {
          setRecentNpcTrades(prev => {
            const entry = prev[npcId];
            if (entry && entry.timestamp === now) { const next = { ...prev }; delete next[npcId]; return next; }
            return prev;
          });
        }, 5000);
      }
    }
  }, [fetchNpcTrade, recordTrade, recordDecision, addTokens]);

  // -- Arena chat ref --
  const fireArenaChatRef = useRef<((headline: string) => void) | null>(null);

  // -- Stamp exit prices on decisions that don't have one yet --
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

  // -- Display event: add news to UI, trigger NPC trades + agent update (no price change yet) --
  const displayEvent = useCallback((eventIndex: number, event: NewsEvent) => {
    setCurrentEventIndex(eventIndex);
    currentEventIndexRef.current = eventIndex;

    setRoundNewsEvents((prev) => [...prev, event]);
    roundNewsEventsRef.current = [...roundNewsEventsRef.current, event];

    const merged = { ...currentNewsImpactsRef.current };
    for (const [sector, impact] of Object.entries(event.sectorImpacts)) {
      merged[sector] = (merged[sector] || 0) + impact;
    }
    setCurrentNewsImpacts(merged);
    currentNewsImpactsRef.current = merged;

    addEvent("news", event.headline);

    // Start pending price impact countdown (10s lag for traders to process)
    setPendingPriceImpact({ eventIndex, event, countdown: PRICE_REACTION_DELAY });

    // NPC reactive trades (3-8s delay, BEFORE prices move at 10s)
    const npcList = npcsRef.current;
    npcList.forEach((npc) => {
      const delay = 3000 + Math.floor(Math.random() * 5000);
      setTimeout(() => doNpcTrade(npc.id), delay);
    });

    fetchAgentStrategy(eventIndex === 0 ? false : true, event.headline);
    setTimeout(() => fireArenaChatRef.current?.(event.headline), 1500);
  }, [addEvent, doNpcTrade, fetchAgentStrategy]);

  // -- Apply price impact: called 5s after event display --
  const applyPriceImpact = useCallback((eventIndex: number) => {
    const cached = prefetchedEventsRef.current.get(eventIndex);
    if (!cached || !cached.event) return;
    const event = cached.event;

    // Stamp exit prices for all prior decisions before applying new prices
    stampExitPrices();

    // Apply price impact
    const beforePrices: Record<string, number> = {};
    for (const s of stocksRef.current) { beforePrices[s.ticker] = s.price; }

    const { stocks: updatedStocks } = applyNewsToPrice(stocksRef.current, event);
    stocksRef.current = updatedStocks;
    setStocks(updatedStocks);
    setIndexValue(computeIndex(updatedStocks));

    // Console price verification
    const eventLabel = event.newsType === "macro" ? "MACRO" : "COMPANY";
    const targetLabel = event.target_ticker ? ` (target: ${event.target_ticker})` : "";
    console.log(`=== E${eventIndex + 1} ${eventLabel}: '${event.headline}'${targetLabel} ===`);
    for (const s of updatedStocks) {
      const before = beforePrices[s.ticker] ?? s.startPrice;
      const actualPct = ((s.price - before) / before) * 100;
      const perStock = event.per_stock_impacts;
      const intended = perStock?.[s.ticker];
      const intendedPct = intended != null ? intended * (Math.abs(intended) > 1 ? 1 : 100) : null;
      const match = intendedPct != null ? (Math.abs(actualPct - intendedPct) < 0.5 ? "\u2713" : "\u26A0") : "?";
      console.log(`  ${s.ticker}: $${before.toFixed(2)} \u2192 $${s.price.toFixed(2)} (intended: ${intendedPct != null ? (intendedPct >= 0 ? "+" : "") + intendedPct.toFixed(1) + "%" : "N/A"}, actual: ${actualPct >= 0 ? "+" : ""}${actualPct.toFixed(2)}%) ${match}`);
    }

    // Capture snapshot
    const afterPrices: Record<string, number> = {};
    for (const s of updatedStocks) { afterPrices[s.ticker] = s.price; }
    captureSnapshotEvent(event, beforePrices, afterPrices);

    // Clear pending price impact
    setPendingPriceImpact(null);

    // Mark as applied
    cached.status = "applied";
  }, [captureSnapshotEvent, stampExitPrices]);

  // -- Fetch company news from registry agent --
  const fetchCompanyNewsFromRegistry = useCallback(async (eventIndex: number): Promise<{
    headline: string; sectorImpacts: Record<string, number>; tickerAffected: string; category: string;
    severity?: string; direction?: string; per_stock_impacts?: Record<string, number>; reasoning?: string;
  } | null> => {
    try {
      const currentStocks = stocksRef.current;
      const res = await fetch("/api/company-news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stocks: currentStocks.map((s) => ({
            ticker: s.ticker, name: s.name, sector: s.sector, subSector: s.subSector, beta: s.beta,
            peRatio: s.peRatio, marketCap: s.marketCap, eps: s.eps, debtEbitda: s.debtEbitda,
          })),
          roundNumber: eventIndex + 1,
          usedTickers: usedCompanyTickersRef.current,
        }),
      });
      const data = await res.json();
      if (data.usage?.total_tokens) {
        addTokens("company_news", "Company News", "market", data.usage.total_tokens);
      }
      if (!data.fallback && data.headline) {
        return {
          headline: data.headline,
          sectorImpacts: data.sectorImpacts || {},
          tickerAffected: data.tickerAffected,
          category: data.category,
          severity: data.severity,
          direction: data.direction,
          per_stock_impacts: data.per_stock_impacts,
          reasoning: data.reasoning,
        };
      }
    } catch (err) {
      console.error("[useBattle] Company news API error:", err);
    }
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addTokens]);

  // -- Call Market Engine AI to determine stock price impacts for a news event --
  const callMarketEngine = useCallback(async (
    headline: string,
    stocks: BattleStock[],
    sectorImpacts: Record<string, number>
  ): Promise<Record<string, number> | null> => {
    try {
      const res = await fetch("/api/market-engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newsHeadline: headline,
          stocks: stocks.map(s => ({
            ticker: s.ticker, name: s.name, sector: s.sector,
            beta: s.beta, price: s.price, startPrice: s.startPrice,
            changePct: (s.price - s.startPrice) / s.startPrice,
          })),
          sectorImpacts,
        }),
      });
      const data = await res.json();
      if (data.usage?.total_tokens) {
        addTokens("market_engine", "Market Engine", "market", data.usage.total_tokens);
      }
      if (data.targets) {
        // Market Engine returns decimals (0.05 = +5%), convert to percentages for per_stock_impacts
        const impacts: Record<string, number> = {};
        for (const [ticker, value] of Object.entries(data.targets)) {
          impacts[ticker] = (value as number) * 100;
        }
        console.log(`[market-engine] AI price impacts: ${Object.entries(impacts).map(([t, v]) => `${t} ${v >= 0 ? "+" : ""}${v.toFixed(1)}%`).join(", ")}`);
        return impacts;
      }
      console.log("[market-engine] No targets returned, using news agent fallback");
    } catch (err) {
      console.error("[market-engine] API error, using news agent fallback:", err);
    }
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addTokens]);

  // -- Used headlines ref for AI news deduplication --
  const usedHeadlinesRef = useRef<string[]>([]);

  // -- Fetch macro news from registry agent --
  const fetchMacroNewsFromRegistry = useCallback(async (eventIndex: number): Promise<{
    headline: string; sectorImpacts: Record<string, number>; category: string;
    severity?: string; direction?: string; per_stock_impacts?: Record<string, number>; reasoning?: string;
  } | null> => {
    try {
      const currentStocks = stocksRef.current;
      const res = await fetch("/api/macro-news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stocks: currentStocks.map((s) => ({
            ticker: s.ticker, name: s.name, sector: s.sector, beta: s.beta,
            peRatio: s.peRatio, marketCap: s.marketCap, eps: s.eps, debtEbitda: s.debtEbitda,
          })),
          roundNumber: eventIndex + 1,
          usedHeadlines: usedHeadlinesRef.current,
        }),
      });
      const data = await res.json();
      if (data.usage?.total_tokens) {
        addTokens("macro_news", "Macro News", "market", data.usage.total_tokens);
      }
      if (!data.fallback && data.headline) {
        usedHeadlinesRef.current = [...usedHeadlinesRef.current, data.headline];
        return {
          headline: data.headline,
          sectorImpacts: data.sectorImpacts || {},
          category: data.category,
          severity: data.severity,
          direction: data.direction,
          per_stock_impacts: data.per_stock_impacts,
          reasoning: data.reasoning,
        };
      }
    } catch (err) {
      console.error("[useBattle] Macro news API error:", err);
    }
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addTokens]);

  // -- Prefetch event: async fetch news + market engine impacts, store in cache --
  const prefetchEvent = useCallback(async (eventIndex: number) => {
    const schedule = eventScheduleRef.current;
    const entry = schedule[eventIndex];
    if (!entry) return;

    // Already fetching or ready?
    if (prefetchedEventsRef.current.has(eventIndex)) return;
    prefetchedEventsRef.current.set(eventIndex, { event: null, marketEngineImpacts: null, status: "fetching" });

    console.log(`[PREFETCH] Starting prefetch for E${eventIndex + 1} (${entry.type})`);

    let event: NewsEvent | null = null;

    if (entry.type === "macro") {
      // Try AI macro news agent first
      const aiNews = await fetchMacroNewsFromRegistry(eventIndex);
      if (aiNews) {
        event = {
          headline: aiNews.headline,
          sectorImpacts: aiNews.sectorImpacts,
          newsType: "macro" as const,
          category: aiNews.category as NewsEvent["category"],
          severity: (aiNews.severity as NewsEvent["severity"]) || undefined,
          direction: aiNews.direction === "NEGATIVE" ? -1 : aiNews.direction === "POSITIVE" ? 1 : undefined,
          per_stock_impacts: aiNews.per_stock_impacts,
        };
      } else {
        // Fallback to hardcoded macro
        console.log(`[PREFETCH] E${eventIndex + 1}: Falling back to hardcoded macro news`);
        const result = pickMacroNews(usedMacroIndicesRef.current, eventIndex);
        if (result) {
          usedMacroIndicesRef.current = new Set([...Array.from(usedMacroIndicesRef.current), result.index]);
          event = result.event;
        }
      }
    } else {
      // Company news
      const aiResult = await fetchCompanyNewsFromRegistry(eventIndex);
      if (aiResult) {
        usedCompanyTickersRef.current = [...usedCompanyTickersRef.current, aiResult.tickerAffected];
        event = {
          headline: aiResult.headline,
          sectorImpacts: aiResult.sectorImpacts,
          newsType: "company_specific" as const,
          category: aiResult.category as NewsEvent["category"],
          severity: (aiResult.severity as NewsEvent["severity"]) || undefined,
          direction: aiResult.direction === "NEGATIVE" ? -1 : aiResult.direction === "POSITIVE" ? 1 : undefined,
          target_ticker: aiResult.tickerAffected,
          per_stock_impacts: aiResult.per_stock_impacts,
        };
      } else {
        // Fallback to hardcoded company
        console.log(`[PREFETCH] E${eventIndex + 1}: Falling back to hardcoded company news`);
        const result = generateCompanyNews(stocksRef.current, usedCompanyTickersRef.current, eventIndex);
        if (result) {
          usedCompanyTickersRef.current = [...usedCompanyTickersRef.current, result.tickerAffected];
          event = result.event;
        }
      }
    }

    if (!event) {
      console.warn(`[PREFETCH] E${eventIndex + 1}: No event generated`);
      prefetchedEventsRef.current.set(eventIndex, { event: null, marketEngineImpacts: null, status: "ready" });
      return;
    }

    // Call Market Engine AI for price impacts
    const meTargets = await callMarketEngine(event.headline, stocksRef.current, event.sectorImpacts);
    if (meTargets) {
      console.log(`[PREFETCH] E${eventIndex + 1}: Market Engine AI impacts ready`);
      event.per_stock_impacts = meTargets;
    }

    prefetchedEventsRef.current.set(eventIndex, { event, marketEngineImpacts: meTargets, status: "ready" });
    console.log(`[PREFETCH] E${eventIndex + 1} ready: "${event.headline}"`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callMarketEngine, fetchCompanyNewsFromRegistry, fetchMacroNewsFromRegistry]);

  // -- User trade execution (manual) --
  // Manual trade: user clicks LONG/SHORT/CLOSE on stock card — uses same executeOneTrade
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
      // Token tracking for user agent
      if (data.usage?.total_tokens) {
        addTokens("user_agent", userName, "trading", data.usage.total_tokens);
      }
    } catch {
      setChatMessages((prev) => [...prev, { role: "assistant", content: "Sorry, couldn't connect. Try again." }]);
    } finally {
      setChatLoading(false);
    }
  }, [chatMessages, userModelId, userSystemPrompt, addTokens, userName]);

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
      // Token tracking for arena chat
      if (data.usage?.total_tokens) {
        const tokenKey = agent.strategy.toLowerCase().replace(/\s+/g, "_");
        addTokens(tokenKey, agent.name, "trading", data.usage.total_tokens);
      }
    } catch (err) {
      console.error(`Arena chat error for ${agent.name}:`, err);
    }
  }, [addArenaMessage, addTokens]);

  const fireArenaChats = useCallback((headline: string) => {
    const npcList = npcsRef.current;
    npcList.forEach((npc, i) => {
      const delay = 1000 + i * 1500;
      setTimeout(() => {
        if (phaseRef.current !== "trading" && phaseRef.current !== "countdown") return;
        fetchArenaChat({ name: npc.name, model: npc.model, strategy: npc.strategy, systemPrompt: npc.systemPrompt }, headline, false);
      }, delay);
    });
    setTimeout(() => {
      if (phaseRef.current !== "trading" && phaseRef.current !== "countdown") return;
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
    const userRoundPnl = userValue - roundStartValueRef.current;
    const userTotalPnl = userValue - STARTING_CASH;
    agentPnls.push({ name: userName, model: userModelLabel, strategy: userStrategy, roundPnl: userRoundPnl, totalPnl: userTotalPnl });

    // NPCs
    for (const npc of currentNpcs) {
      const npcTradeData = roundTradesRef.current.get(npc.name) || { trades: [], reasoning: "" };
      agentTrades.push({ name: npc.name, model: getModelLabel(npc.model), trades: npcTradeData.trades, reasoning: npcTradeData.reasoning });
      const npcValue = computeTotalValue(npc.portfolio, currentStocks);
      agentPnls.push({ name: npc.name, model: getModelLabel(npc.model), strategy: npc.strategyLabel, roundPnl: npcValue - STARTING_CASH, totalPnl: npcValue - STARTING_CASH });
    }

    // Console P&L summary at session end
    console.log(`[P&L] === SESSION END === User: P&L=${userRoundPnl >= 0 ? "+" : ""}$${userRoundPnl.toFixed(0)}, totalP&L=${userTotalPnl >= 0 ? "+" : ""}$${userTotalPnl.toFixed(0)}, value=$${userValue.toFixed(0)}, cash=$${userPortfolioRef.current.cash.toFixed(0)}`);
    console.log(`[P&L]   Open positions: ${Object.entries(userPortfolioRef.current.positions).map(([t, p]) => {
      const s = currentStocks.find(st => st.ticker === t);
      const pnl = s ? (p.side === "long" ? (s.price - p.avgCost) * p.qty : (p.avgCost - s.price) * p.qty) : 0;
      return `${t} ${p.side.toUpperCase()} ${p.qty}@${p.avgCost.toFixed(2)} (P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)})`;
    }).join(", ") || "none"}`);
    for (const npc of currentNpcs) {
      const npcVal = computeTotalValue(npc.portfolio, currentStocks);
      console.log(`[P&L]   ${npc.name}: totalP&L=${(npcVal - STARTING_CASH) >= 0 ? "+" : ""}$${(npcVal - STARTING_CASH).toFixed(0)}, value=$${npcVal.toFixed(0)}, trades=${npc.tradeCount}`);
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

    // PART 4: Log round snapshot for QA debugging
    // The snapshot was finalized above, so check the latest in state
    setRoundSnapshots((prev) => {
      const latest = prev[prev.length - 1];
      if (latest) {
        console.log(`[SNAPSHOT] Round ${latest.round}: ${latest.events.length} events captured`);
        for (const evt of latest.events) {
          console.log(`  Event: "${evt.headline}" (${evt.category})`);
          for (const [ticker, pct] of Object.entries(evt.actualImpactPct)) {
            const intendedSector = evt.intendedImpacts;
            console.log(`    ${ticker}: actual ${(pct * 100).toFixed(2)}% | intended sectors: ${JSON.stringify(intendedSector)}`);
          }
        }
        if (Object.keys(latest.driftPct).length > 0) {
          const driftEntries = Object.entries(latest.driftPct).filter(([, v]) => Math.abs(v) > 0.001);
          if (driftEntries.length > 0) {
            console.log(`  Drift (unexplained): ${driftEntries.map(([t, v]) => `${t}: ${(v * 100).toFixed(2)}%`).join(", ")}`);
          }
        }
      }
      return prev;
    });
  }, [userName, userModelLabel, userStrategy, finalizeSnapshot]);

  // -- Phase: countdown (10s before trading) --
  useEffect(() => {
    if (phase !== "countdown") return;

    // Initialize all session state
    setRoundNewsEvents([]);
    roundNewsEventsRef.current = [];
    setCurrentNewsImpacts({});
    currentNewsImpactsRef.current = {};
    setCurrentEventIndex(-1);
    setPendingPriceImpact(null);
    setNextEventCountdown(null);
    prefetchedEventsRef.current = new Map();
    firedEventsRef.current = new Set();
    firedPriceImpactsRef.current = new Set();
    firedPrefetchesRef.current = new Set();

    roundStartValueRef.current = computeTotalValue(userPortfolioRef.current, stocksRef.current);
    roundStartTradeIndexRef.current = userTradesRef.current.length;

    // Record start prices for retro
    const priceSnap: Record<string, number> = {};
    for (const s of stocksRef.current) { priceSnap[s.ticker] = s.price; }
    roundStartPricesRef.current = priceSnap;
    roundTradesRef.current = new Map();

    // Initialize session snapshot
    currentSnapshotRef.current = {
      round: 1,
      pricesAtStart: { ...priceSnap },
      events: [],
      pricesAtEnd: {},
      driftPct: {},
    };
    lastSnapshotPricesRef.current = { ...priceSnap };

    usedCompanyTickersRef.current = [];
    setAgentStrategy(null);
    setAgentAdjustments([]);
    setStrategyExecuted(false);

    // Prefetch Event 1 during countdown
    prefetchEvent(0);

    console.log(`[SESSION] === COUNTDOWN === ${INITIAL_COUNTDOWN}s before trading`);

    setCountdown(INITIAL_COUNTDOWN);
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setTradingTimeLeft(TRADING_DURATION);
          setPhase("trading");
          addEvent("system", "Trading is open!");
          console.log(`[SESSION] === TRADING OPEN === duration=${TRADING_DURATION}s, ${NUM_EVENTS} events`);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // -- Phase: trading — single continuous session with event schedule --
  useEffect(() => {
    if (phase !== "trading") return;

    const schedule = eventScheduleRef.current;

    // Main 1-second timer loop — drives the entire event schedule
    const timerInterval = setInterval(() => {
      setTradingTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerInterval);
          return 0;
        }

        const newTimeLeft = prev - 1;
        const elapsed = TRADING_DURATION - newTimeLeft;

        // --- Prefetch check ---
        for (const entry of schedule) {
          if (elapsed >= entry.prefetchTime && !firedPrefetchesRef.current.has(entry.index)) {
            firedPrefetchesRef.current.add(entry.index);
            prefetchEvent(entry.index);
          }
        }

        // --- Display check ---
        for (const entry of schedule) {
          if (elapsed >= entry.time && !firedEventsRef.current.has(entry.index)) {
            const cached = prefetchedEventsRef.current.get(entry.index);
            if (cached && cached.status === "ready" && cached.event) {
              firedEventsRef.current.add(entry.index);
              displayEvent(entry.index, cached.event);
            } else if (!cached || cached.status !== "fetching") {
              // Event wasn't prefetched yet (maybe first event), trigger now
              if (!firedPrefetchesRef.current.has(entry.index)) {
                firedPrefetchesRef.current.add(entry.index);
                prefetchEvent(entry.index);
              }
            }
            // If still fetching, we'll catch it next tick
          }
        }

        // --- Price impact check ---
        for (const entry of schedule) {
          if (elapsed >= entry.priceImpactTime && !firedPriceImpactsRef.current.has(entry.index)) {
            const cached = prefetchedEventsRef.current.get(entry.index);
            if (cached && cached.status === "ready" && cached.event && firedEventsRef.current.has(entry.index)) {
              firedPriceImpactsRef.current.add(entry.index);
              applyPriceImpact(entry.index);
            }
          }
        }

        // --- UI countdown updates ---
        // Next event countdown
        let nextEvtCountdown: number | null = null;
        for (const entry of schedule) {
          if (!firedEventsRef.current.has(entry.index)) {
            const remaining = entry.time - elapsed;
            if (remaining > 0 && remaining <= 10) {
              nextEvtCountdown = remaining;
            }
            break; // only show the next upcoming event
          }
        }
        setNextEventCountdown(nextEvtCountdown);

        // Decrement pending price impact countdown
        setPendingPriceImpact((current) => {
          if (!current) return null;
          const newCountdown = current.countdown - 1;
          if (newCountdown <= 0) return null; // will be cleared by applyPriceImpact
          return { ...current, countdown: newCountdown };
        });

        return newTimeLeft;
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

    // End check
    const endCheck = setInterval(() => {
      if (tradingTimeRef.current <= 0) {
        clearInterval(endCheck);
        clearInterval(timerInterval);
        clearInterval(tickInterval);
        console.log(`[SESSION] === TRADING END === ${NUM_EVENTS} events completed`);
        addEvent("system", "Match complete \u2014 Trading closed.");
        stampExitPrices();
        captureRoundRetro();

        // Enrich decisions with P&L and correctness for retro screen
        const finalStocksForRetro = stocksRef.current;
        const enriched = decisionsRef.current.map((d) => {
          const stock = finalStocksForRetro.find((s) => s.ticker === d.ticker);
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
          return { ...d, exitPrice, pnlFromTrade, wasCorrect };
        });
        setEnrichedDecisions(enriched);

        // Compute per-agent successful trades
        const stMap = new Map<string, number>();
        for (const d of enriched) {
          if (d.wasCorrect === 1) stMap.set(d.agentName, (stMap.get(d.agentName) || 0) + 1);
        }
        setSuccessfulTradesMap(stMap);

        setPhase("match_retro");
      }
    }, 200);

    return () => {
      clearInterval(timerInterval);
      clearInterval(tickInterval);
      clearInterval(endCheck);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // -- Phase: round_end removed — single continuous session goes directly to match_retro --

  // -- Save match results (on results phase) --
  useEffect(() => {
    if (phase !== "results" || matchResultsSavedRef.current) return;
    matchResultsSavedRef.current = true;

    const currentStandings = standingsRef.current;
    if (currentStandings.length === 0) return;

    // Calculate P&L and was_correct for each decision based on exit price (next event) or final price
    const finalStocks = stocksRef.current;
    const enrichedDecisions = decisionsRef.current.map((d) => {
      const stock = finalStocks.find((s) => s.ticker === d.ticker);
      if (!stock) return d;
      // Use exitPrice (set at next news event or round end), fall back to final price
      const exitPrice = d.exitPrice ?? stock.price;
      let pnlFromTrade: number | undefined;
      let wasCorrect: number | undefined;
      if (d.actionTaken === "LONG") {
        pnlFromTrade = Math.round(((exitPrice - d.price) / d.price) * 10000) / 100; // percent
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
  const roundPnl = Math.round((userTotalValue - roundStartValueRef.current) * 100) / 100;
  const roundTradeCount = userTrades.length - roundStartTradeIndexRef.current;
  const standings = computeStandings(userName, userPortfolio, npcs, stocks, userModelLabel, userStrategy, userTrades.length, successfulTradesMap);
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
    // NPC trade flashes + token usage
    recentNpcTrades,
    tokenUsage,
    // Scorecard
    successfulTradesMap,
    // Retro
    retroRounds,
    roundSnapshots,
    enrichedDecisions,
    dismissRetro,
    // Event schedule state
    currentEventIndex,
    pendingPriceImpact,
    nextEventCountdown,
  };
}
