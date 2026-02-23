// ============================================================
// Game engine — orchestrates a full match
// Generic send-state / get-actions / resolve pattern
// ============================================================

import { MatchConfig, buildMatchConfig } from "./config";
import { initMarket, generateRound, MarketSimState } from "./market";
import {
  AgentConfig,
  AgentAction,
  AgentDecision,
  AgentPortfolio,
  AgentState,
  MarketState,
  MatchResult,
  RoundSnapshot,
  StockPrice,
  TradeRecord,
} from "./types";

// ------ Agent decision function type ------

/**
 * A function that takes the current market state + agent's own state
 * and returns the agent's decision. This is the interface between
 * the engine and any agent implementation (LLM, mock, external API).
 */
export type AgentDecisionFn = (
  agentConfig: AgentConfig,
  marketState: MarketState,
  agentState: AgentState
) => Promise<AgentDecision>;

// ------ Portfolio helpers ------

function createInitialPortfolio(startingCash: number): AgentPortfolio {
  return {
    cash: startingCash,
    positions: {},
    realizedPnl: 0,
  };
}

function calculateTotalValue(
  portfolio: AgentPortfolio,
  prices: Record<string, StockPrice>
): number {
  let total = portfolio.cash;
  for (const [ticker, pos] of Object.entries(portfolio.positions)) {
    const price = prices[ticker]?.price ?? 0;
    if (pos.side === "long") {
      total += pos.quantity * price;
    } else {
      // Short: profit = (avgCost - currentPrice) * quantity
      // Value contributed = margin held (avgCost * qty) + unrealized P&L
      total += pos.quantity * (2 * pos.avgCost - price);
    }
  }
  return Math.round(total * 100) / 100;
}

function buildAgentState(
  agentId: string,
  agentName: string,
  portfolio: AgentPortfolio,
  prices: Record<string, StockPrice>,
  startingCash: number
): AgentState {
  const totalValue = calculateTotalValue(portfolio, prices);
  return {
    agentId,
    agentName,
    portfolio: { ...portfolio, positions: { ...portfolio.positions } },
    totalValue,
    pnlPct: Math.round(((totalValue - startingCash) / startingCash) * 10000) / 10000,
  };
}

// ------ Trade validation & execution ------

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

function validateAction(
  action: AgentAction,
  portfolio: AgentPortfolio,
  prices: Record<string, StockPrice>,
  config: MatchConfig
): ValidationResult {
  const price = prices[action.asset]?.price;
  if (price === undefined) {
    return { valid: false, reason: `Unknown asset: ${action.asset}` };
  }

  if (action.action === "HOLD") return { valid: true };

  if (action.quantity <= 0) {
    return { valid: false, reason: `Quantity must be positive` };
  }

  // Don't allow trading the index directly
  const stockCfg = config.stocks.find((s) => s.ticker === action.asset);
  if (stockCfg?.isDerived) {
    return { valid: false, reason: `Cannot trade derived instrument: ${action.asset}` };
  }

  const totalValue = calculateTotalValue(portfolio, prices);
  const tradeValue = action.quantity * price;

  if (action.action === "BUY") {
    if (tradeValue > portfolio.cash) {
      return { valid: false, reason: `Insufficient cash: need $${tradeValue.toFixed(2)}, have $${portfolio.cash.toFixed(2)}` };
    }
    // Check max position constraint
    const existingPos = portfolio.positions[action.asset];
    const existingValue = existingPos && existingPos.side === "long"
      ? existingPos.quantity * price
      : 0;
    if ((existingValue + tradeValue) / totalValue > config.maxPositionPct) {
      return { valid: false, reason: `Would exceed max position of ${config.maxPositionPct * 100}%` };
    }
  }

  if (action.action === "SELL") {
    const pos = portfolio.positions[action.asset];
    if (!pos || pos.side !== "long" || pos.quantity < action.quantity) {
      const have = pos?.side === "long" ? pos.quantity : 0;
      return { valid: false, reason: `Cannot sell ${action.quantity} ${action.asset}: only hold ${have}` };
    }
  }

  if (action.action === "SHORT") {
    // Short requires margin (cash to cover)
    if (tradeValue > portfolio.cash) {
      return { valid: false, reason: `Insufficient cash for short margin` };
    }
    const existingPos = portfolio.positions[action.asset];
    const existingValue = existingPos && existingPos.side === "short"
      ? existingPos.quantity * price
      : 0;
    if ((existingValue + tradeValue) / totalValue > config.maxPositionPct) {
      return { valid: false, reason: `Would exceed max position of ${config.maxPositionPct * 100}%` };
    }
  }

  return { valid: true };
}

function executeAction(
  action: AgentAction,
  portfolio: AgentPortfolio,
  prices: Record<string, StockPrice>
): AgentPortfolio {
  const updated = {
    ...portfolio,
    positions: { ...portfolio.positions },
  };

  const price = prices[action.asset].price;

  if (action.action === "HOLD") return updated;

  if (action.action === "BUY") {
    const cost = action.quantity * price;
    updated.cash -= cost;
    const existing = updated.positions[action.asset];

    if (existing && existing.side === "long") {
      const totalQty = existing.quantity + action.quantity;
      const totalCost = existing.avgCost * existing.quantity + cost;
      updated.positions[action.asset] = {
        ...existing,
        quantity: totalQty,
        avgCost: Math.round((totalCost / totalQty) * 100) / 100,
      };
    } else {
      updated.positions[action.asset] = {
        ticker: action.asset,
        quantity: action.quantity,
        avgCost: price,
        side: "long",
      };
    }
  }

  if (action.action === "SELL") {
    const existing = updated.positions[action.asset];
    const proceeds = action.quantity * price;
    updated.cash += proceeds;

    const pnl = (price - existing.avgCost) * action.quantity;
    updated.realizedPnl += pnl;

    if (existing.quantity === action.quantity) {
      delete updated.positions[action.asset];
    } else {
      updated.positions[action.asset] = {
        ...existing,
        quantity: existing.quantity - action.quantity,
      };
    }
  }

  if (action.action === "SHORT") {
    // Reserve cash as margin, create short position
    const margin = action.quantity * price;
    updated.cash -= margin;

    const existing = updated.positions[action.asset];
    if (existing && existing.side === "short") {
      const totalQty = existing.quantity + action.quantity;
      const totalCost = existing.avgCost * existing.quantity + margin;
      updated.positions[action.asset] = {
        ...existing,
        quantity: totalQty,
        avgCost: Math.round((totalCost / totalQty) * 100) / 100,
      };
    } else {
      updated.positions[action.asset] = {
        ticker: action.asset,
        quantity: action.quantity,
        avgCost: price,
        side: "short",
      };
    }
  }

  // Round cash to avoid floating point drift
  updated.cash = Math.round(updated.cash * 100) / 100;

  return updated;
}

// ------ Main match runner ------

export interface RunMatchOptions {
  agents: AgentConfig[];
  config?: Partial<MatchConfig>;
  decisionFn: AgentDecisionFn;
  /** Called after each round completes (for live updates) */
  onRound?: (snapshot: RoundSnapshot) => void;
}

export async function runMatch(options: RunMatchOptions): Promise<MatchResult> {
  const startTime = Date.now();
  const config = buildMatchConfig(options.config);
  const { agents, decisionFn, onRound } = options;

  // Initialize
  let marketState: MarketSimState = initMarket(config);
  const portfolios: Record<string, AgentPortfolio> = {};
  const allTrades: TradeRecord[] = [];
  const rounds: RoundSnapshot[] = [];

  for (const agent of agents) {
    portfolios[agent.id] = createInitialPortfolio(config.startingCash);
  }

  // Run each round
  for (let round = 1; round <= config.rounds; round++) {
    // 1. Generate market for this round
    const { result: marketResult, nextState } = generateRound(round, marketState, config);
    marketState = nextState;

    // 2. Build standings from previous round's portfolios
    const standings = agents
      .map((a) =>
        buildAgentState(a.id, a.name, portfolios[a.id], marketResult.prices, config.startingCash)
      )
      .sort((a, b) => b.pnlPct - a.pnlPct);

    // 3. Build market state to send to agents
    const stateForAgents: MarketState = {
      round,
      totalRounds: config.rounds,
      prices: marketResult.prices,
      news: marketResult.news,
      standings,
    };

    // 4. Get decisions from all agents simultaneously
    const decisions = await Promise.all(
      agents.map(async (agent) => {
        const agentState = buildAgentState(
          agent.id,
          agent.name,
          portfolios[agent.id],
          marketResult.prices,
          config.startingCash
        );
        try {
          return await decisionFn(agent, stateForAgents, agentState);
        } catch {
          return { actions: [], reasoning: "Error getting decision — holding." };
        }
      })
    );

    // 5. Validate and execute trades
    const roundTrades: TradeRecord[] = [];

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const decision = decisions[i];

      for (const action of decision.actions) {
        if (action.action === "HOLD") continue;

        const validation = validateAction(action, portfolios[agent.id], marketResult.prices, config);
        if (!validation.valid) {
          roundTrades.push({
            agentId: agent.id,
            agentName: agent.name,
            round,
            action: action.action,
            asset: action.asset,
            quantity: action.quantity,
            price: marketResult.prices[action.asset]?.price ?? 0,
            total: 0,
            reasoning: `REJECTED: ${validation.reason}. Original reasoning: ${decision.reasoning}`,
          });
          continue;
        }

        const price = marketResult.prices[action.asset].price;
        portfolios[agent.id] = executeAction(action, portfolios[agent.id], marketResult.prices);

        roundTrades.push({
          agentId: agent.id,
          agentName: agent.name,
          round,
          action: action.action,
          asset: action.asset,
          quantity: action.quantity,
          price,
          total: Math.round(action.quantity * price * 100) / 100,
          reasoning: decision.reasoning,
        });
      }
    }

    allTrades.push(...roundTrades);

    // 6. Build round snapshot
    const postStandings = agents
      .map((a) =>
        buildAgentState(a.id, a.name, portfolios[a.id], marketResult.prices, config.startingCash)
      )
      .sort((a, b) => b.pnlPct - a.pnlPct);

    const snapshot: RoundSnapshot = {
      round,
      prices: marketResult.prices,
      news: marketResult.news,
      trades: roundTrades,
      standings: postStandings,
    };

    rounds.push(snapshot);
    onRound?.(snapshot);

    // 7. Optional delay for live viewing
    if (config.speedMs > 0 && round < config.rounds) {
      await new Promise((r) => setTimeout(r, config.speedMs));
    }
  }

  // Build final result
  const finalStandings = agents
    .map((a) =>
      buildAgentState(a.id, a.name, portfolios[a.id], marketState.prices, config.startingCash)
    )
    .sort((a, b) => b.pnlPct - a.pnlPct);

  const tradesByAgent: Record<string, TradeRecord[]> = {};
  for (const agent of agents) {
    tradesByAgent[agent.id] = allTrades.filter((t) => t.agentId === agent.id);
  }

  return {
    arenaType: "trading",
    config,
    rounds,
    finalStandings,
    tradesByAgent,
    durationMs: Date.now() - startTime,
  };
}
