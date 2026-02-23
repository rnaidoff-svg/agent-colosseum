// ============================================================
// Battle engine — real-time interactive trading game logic
// Pure functions, no React dependencies
// ============================================================

import type { StockProfile } from "../engine/stocks";
import type { NewsEvent, NewsCategory, NewsSeverity } from "../engine/types";
import { NEWS_CATALOG } from "../engine/market";

// ------ Types ------

export interface BattleStock {
  ticker: string;
  name: string;
  sector: string;
  subSector: string;
  beta: number;
  volatility: number;
  price: number;
  startPrice: number;
  prevTickPrice: number;
  marketCap: string;
  peRatio: number;
  capCategory: string;
  eps: number;
  debtEbitda: number;
}

export interface PortfolioPosition {
  qty: number;
  avgCost: number;
  side: "long" | "short";
}

export interface Portfolio {
  cash: number;
  positions: Record<string, PortfolioPosition>;
}

export interface NpcAgent {
  id: string;
  name: string;
  model: string;
  strategyLabel: string;
  strategy: string;
  registryId: string; // agent ID in the registry DB (e.g. 'momentum_trader')
  portfolio: Portfolio;
  tradeCount: number;
  maxTradesPerRound: number;
  systemPrompt: string;
}

export interface TradeInfo {
  ticker: string;
  action: "LONG" | "SHORT" | "CLOSE_LONG" | "CLOSE_SHORT";
  qty: number;
  price: number;
}

export interface EventEntry {
  id: number;
  type: "news" | "user_trade" | "npc_trade" | "system";
  message: string;
}

export interface StandingEntry {
  name: string;
  totalValue: number;
  pnl: number;
  pnlPct: number;
  isUser: boolean;
  model: string;
  strategy: string;
  totalTrades: number;
}

export interface AgentStrategyRec {
  trades: {
    action: "LONG" | "SHORT";
    ticker: string;
    qty: number;
    dollarAmt: number;
    reason: string;
  }[];
  cashReserve: number;
  summary: string;
}

export interface NpcTradeDecision {
  action: "LONG" | "SHORT" | "CLOSE_LONG" | "CLOSE_SHORT";
  ticker: string;
  qty: number;
}

export interface AgentAdjustment {
  headline: string;
  reasoning: string;
  trades: {
    action: "LONG" | "SHORT" | "CLOSE_LONG" | "CLOSE_SHORT";
    ticker: string;
    qty: number;
    reason: string;
  }[];
  executed: boolean;
}

export interface ArenaChatMessage {
  id: number;
  agentName: string;
  agentModel: string;
  message: string;
  isUser: boolean;
  isSystem?: boolean;
  systemType?: "news" | "user_trade" | "npc_trade" | "system";
}

export interface NpcConfig {
  index: number;
  model: string;
  name?: string;       // from URL params (dynamic)
  registryId?: string; // from URL params (dynamic)
}

// ------ Constants ------

export const STARTING_CASH = 100_000;
export const TOTAL_ROUNDS = 3;
export const TRADING_DURATION = 60; // seconds
export const COUNTDOWN_DURATION = 10; // seconds
export const ROUND_END_DURATION = 4; // seconds
export const TICK_INTERVAL = 2; // seconds

// ------ Severity ranges (base_impact_pct magnitude) ------

const SEVERITY_RANGES: Record<NewsSeverity, [number, number]> = {
  LOW:      [0.001, 0.005],   // 0.1% – 0.5%
  MODERATE: [0.005, 0.015],   // 0.5% – 1.5%
  HIGH:     [0.015, 0.03],    // 1.5% – 3.0%
  EXTREME:  [0.03, 0.05],     // 3.0% – 5.0%
};

// ------ Sector correlation matrix ------
// Maps macro news keyword → sector → modifier (-1.0 to +1.0)
// Positive = stock goes UP on this news, negative = goes DOWN

const SECTOR_MODIFIERS: Record<string, Record<string, number>> = {
  fed_rate_cut:       { finance: 0.9, tech: 0.7, consumer: 0.5, energy: 0.3, healthcare: 0.2 },
  trade_war:          { tech: -1.0, consumer: -0.7, energy: -0.4, finance: -0.3, healthcare: -0.1 },
  inflation_surge:    { finance: -0.7, tech: -0.6, consumer: -0.5, energy: 0.4, healthcare: -0.2 },
  bank_crisis:        { finance: -1.0, tech: -0.3, consumer: -0.2, energy: -0.1, healthcare: 0.0 },
  jobs_boom:          { consumer: 0.8, finance: 0.6, tech: 0.4, healthcare: 0.3, energy: 0.3 },
  oil_spike:          { energy: 1.0, consumer: -0.6, tech: -0.3, finance: -0.2, healthcare: -0.1 },
  gdp_growth:         { finance: 0.6, consumer: 0.5, tech: 0.4, energy: 0.4, healthcare: 0.3 },
  tech_antitrust:     { tech: -1.0, finance: -0.2, consumer: 0.3, healthcare: 0.1, energy: 0.0 },
  supply_chain_ease:  { consumer: 0.8, tech: 0.5, healthcare: 0.3, finance: 0.2, energy: -0.4 },
  yield_inversion:    { finance: -0.8, consumer: -0.6, tech: -0.5, healthcare: 0.2, energy: -0.3 },
  infrastructure_bill:{ energy: 0.8, tech: 0.5, finance: 0.4, consumer: 0.3, healthcare: 0.1 },
  dollar_weakens:     { energy: 0.5, tech: 0.4, consumer: -0.3, finance: -0.5, healthcare: 0.1 },
};

// ------ News escalation by round ------

export function getSeverityForRound(round: number): NewsSeverity {
  if (round <= 1) return pickRandom(["LOW", "MODERATE"] as NewsSeverity[]);
  if (round === 2) return pickRandom(["MODERATE", "HIGH"] as NewsSeverity[]);
  return pickRandom(["HIGH", "EXTREME"] as NewsSeverity[]);
}

function getImpactFromSeverity(severity: NewsSeverity): number {
  const [min, max] = SEVERITY_RANGES[severity];
  return min + Math.random() * (max - min);
}

// Company news scale factor per round (escalation)
const COMPANY_ROUND_SCALE = [0.8, 1.0, 1.5];

// ------ Helpers ------

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ------ Stock initialization ------

export function initBattleStocks(profiles: StockProfile[]): BattleStock[] {
  return profiles.map((p) => ({
    ticker: p.ticker,
    name: p.name,
    sector: p.sector,
    subSector: p.subSector || "",
    beta: p.beta,
    volatility: p.volatility,
    price: p.startPrice,
    startPrice: p.startPrice,
    prevTickPrice: p.startPrice,
    marketCap: p.marketCap,
    peRatio: p.peRatio,
    capCategory: p.capCategory,
    eps: p.eps,
    debtEbitda: p.debtEbitda,
  }));
}

// ------ Price ticking ------

/**
 * tickPrices — drift-only random walk between news events.
 * Tiny ±0.05% random noise per tick. No news-driven movement here.
 * All meaningful price changes come from applyNewsImpacts().
 */
export function tickPrices(stocks: BattleStock[]): BattleStock[] {
  return stocks.map((stock) => {
    const drift = (Math.random() - 0.5) * 0.001; // ±0.05%
    const newPrice = Math.max(0.01, Math.round(stock.price * (1 + drift) * 100) / 100);
    return { ...stock, prevTickPrice: stock.price, price: newPrice };
  });
}

/**
 * applyNewsImpacts — applies AI-determined per-stock percentage impacts.
 * This is the ONLY function that modifies prices when news fires.
 * Instant. Deterministic math. No AI call here.
 *
 * @param stocks - current stock array
 * @param perStockImpacts - ticker → percentage (e.g. 3.5 means +3.5%, -2.1 means -2.1%)
 * @param eventLabel - for console logging
 * @returns updated stocks + actual impact record
 */
export function applyNewsImpacts(
  stocks: BattleStock[],
  perStockImpacts: Record<string, number>
): { stocks: BattleStock[]; impacts: Record<string, number> } {
  const impacts: Record<string, number> = {};

  const updatedStocks = stocks.map((stock) => {
    const impactPct = perStockImpacts[stock.ticker] || 0;
    const noise = (Math.random() - 0.5) * 0.003; // ±0.15% realism noise
    const changePct = (impactPct / 100) + noise;
    const newPrice = Math.max(0.01, Math.round(stock.price * (1 + changePct) * 100) / 100);
    const actualPct = (newPrice - stock.price) / stock.price;
    impacts[stock.ticker] = actualPct;

    console.log(
      `  ${stock.ticker}: $${stock.price.toFixed(2)} → $${newPrice.toFixed(2)} ` +
      `(${impactPct >= 0 ? "+" : ""}${impactPct.toFixed(2)}%)`
    );

    return { ...stock, prevTickPrice: stock.price, price: newPrice };
  });

  return { stocks: updatedStocks, impacts };
}

/**
 * applyNewsToPrice — LEGACY fallback for events without per_stock_impacts.
 * Uses sector modifiers × beta math from CHUNK 20.
 */
export function applyNewsToPrice(
  stocks: BattleStock[],
  event: NewsEvent
): { stocks: BattleStock[]; impacts: Record<string, number> } {
  // If event has per_stock_impacts, use the new path
  if (event.per_stock_impacts && Object.keys(event.per_stock_impacts).length > 0) {
    const label = event.newsType === "company_specific"
      ? `COMPANY EVENT: '${event.headline}' (target: ${event.target_ticker})`
      : `MACRO EVENT: '${event.headline}'`;
    console.log(`=== ${label} ===`);
    console.log(`  AI impacts: ${Object.entries(event.per_stock_impacts).map(([t, v]) => `${t} ${v >= 0 ? "+" : ""}${v.toFixed(1)}%`).join(", ")}`);
    return applyNewsImpacts(stocks, event.per_stock_impacts);
  }

  // Fallback: old sector-modifier math
  const impacts: Record<string, number> = {};

  if (event.newsType === "company_specific" && event.target_ticker) {
    const primaryPct = event.primary_impact_pct || 0;
    const targetSector = stocks.find((s) => s.ticker === event.target_ticker)?.sector;

    const updatedStocks = stocks.map((stock) => {
      let movePct: number;
      if (stock.ticker === event.target_ticker) {
        movePct = primaryPct + (Math.random() - 0.5) * 0.002;
      } else if (targetSector && stock.sector === targetSector) {
        movePct = primaryPct * 0.3 * stock.beta + (Math.random() - 0.5) * 0.001;
      } else {
        movePct = (Math.random() - 0.5) * 0.001;
      }
      const newPrice = Math.max(0.01, Math.round(stock.price * (1 + movePct) * 100) / 100);
      impacts[stock.ticker] = (newPrice - stock.price) / stock.price;
      console.log(`[PRICE-FALLBACK] ${stock.ticker}: $${stock.price.toFixed(2)} → $${newPrice.toFixed(2)} (${(movePct * 100).toFixed(3)}%)`);
      return { ...stock, prevTickPrice: stock.price, price: newPrice };
    });
    return { stocks: updatedStocks, impacts };
  } else {
    const keyword = event.sector_keyword || "gdp_growth";
    const modifiers = SECTOR_MODIFIERS[keyword] || {};
    const basePct = event.base_impact_pct || 0.01;

    const updatedStocks = stocks.map((stock) => {
      const sectorMod = modifiers[stock.sector] ?? 0.1;
      const noise = (Math.random() - 0.5) * 0.002;
      const movePct = basePct * sectorMod * stock.beta + noise;
      const newPrice = Math.max(0.01, Math.round(stock.price * (1 + movePct) * 100) / 100);
      impacts[stock.ticker] = (newPrice - stock.price) / stock.price;
      console.log(`[PRICE-FALLBACK] ${stock.ticker}: $${stock.price.toFixed(2)} → $${newPrice.toFixed(2)} (${(movePct * 100).toFixed(3)}%)`);
      return { ...stock, prevTickPrice: stock.price, price: newPrice };
    });
    return { stocks: updatedStocks, impacts };
  }
}

export function computeIndex(stocks: BattleStock[]): number {
  const sum = stocks.reduce((acc, s) => acc + s.price, 0);
  return Math.round((sum / stocks.length) * 100) / 100;
}

// ------ News impact merging ------

export function mergeNewsImpacts(events: NewsEvent[]): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const event of events) {
    for (const [sector, impact] of Object.entries(event.sectorImpacts)) {
      merged[sector] = (merged[sector] || 0) + impact;
    }
  }
  return merged;
}

// ------ Per-stock impact computation (for display badges) ------

export function computeStockImpacts(
  event: NewsEvent,
  stocks: BattleStock[]
): { ticker: string; expectedMovePct: number }[] {
  // If we have structured data, compute deterministic impacts
  if (event.newsType === "company_specific" && event.target_ticker && event.primary_impact_pct !== undefined) {
    const targetSector = stocks.find((s) => s.ticker === event.target_ticker)?.sector;
    return stocks
      .map((stock) => {
        let pct: number;
        if (stock.ticker === event.target_ticker) {
          pct = event.primary_impact_pct!;
        } else if (targetSector && stock.sector === targetSector) {
          pct = event.primary_impact_pct! * 0.3 * stock.beta;
        } else {
          pct = 0;
        }
        return { ticker: stock.ticker, expectedMovePct: pct };
      })
      .filter((s) => Math.abs(s.expectedMovePct) > 0.001)
      .sort((a, b) => Math.abs(b.expectedMovePct) - Math.abs(a.expectedMovePct));
  }

  if (event.sector_keyword && event.base_impact_pct !== undefined) {
    const modifiers = SECTOR_MODIFIERS[event.sector_keyword] || {};
    return stocks
      .map((stock) => {
        const sectorMod = modifiers[stock.sector] ?? 0;
        const pct = event.base_impact_pct! * sectorMod * stock.beta;
        return { ticker: stock.ticker, expectedMovePct: pct };
      })
      .filter((s) => Math.abs(s.expectedMovePct) > 0.001)
      .sort((a, b) => Math.abs(b.expectedMovePct) - Math.abs(a.expectedMovePct));
  }

  // Fallback: old behavior using raw sectorImpacts
  return stocks
    .map((stock) => {
      const sectorImpact = event.sectorImpacts[stock.sector] || 0;
      const expectedMovePct = sectorImpact * stock.beta;
      return { ticker: stock.ticker, expectedMovePct };
    })
    .filter((s) => Math.abs(s.expectedMovePct) > 0.001)
    .sort((a, b) => Math.abs(b.expectedMovePct) - Math.abs(a.expectedMovePct));
}

/** Compute actual stock impacts from a pre/post price comparison */
export function computeActualStockImpacts(
  preBefore: Record<string, number>,
  stocks: BattleStock[]
): { ticker: string; expectedMovePct: number }[] {
  return stocks
    .map((stock) => {
      const before = preBefore[stock.ticker];
      if (!before || before <= 0) return { ticker: stock.ticker, expectedMovePct: 0 };
      return { ticker: stock.ticker, expectedMovePct: (stock.price - before) / before };
    })
    .filter((s) => Math.abs(s.expectedMovePct) > 0.0001)
    .sort((a, b) => Math.abs(b.expectedMovePct) - Math.abs(a.expectedMovePct));
}

// ------ Portfolio ------

export function createPortfolio(): Portfolio {
  return { cash: STARTING_CASH, positions: {} };
}

export function computeTotalValue(
  portfolio: Portfolio,
  stocks: BattleStock[]
): number {
  let total = portfolio.cash;
  for (const [ticker, pos] of Object.entries(portfolio.positions)) {
    const stock = stocks.find((s) => s.ticker === ticker);
    if (stock) {
      if (pos.side === "long") {
        total += pos.qty * stock.price;
      } else {
        // Short position value: margin deposited + unrealized P&L
        total += pos.qty * (2 * pos.avgCost - stock.price);
      }
    }
  }
  return Math.round(total * 100) / 100;
}

// ------ Trade execution: LONG ------

export function executeLong(
  portfolio: Portfolio,
  stocks: BattleStock[],
  ticker: string,
  qty: number
): { ok: boolean; portfolio: Portfolio; reason: string } {
  const stock = stocks.find((s) => s.ticker === ticker);
  if (!stock) return { ok: false, portfolio, reason: "Unknown stock" };
  if (qty <= 0) return { ok: false, portfolio, reason: "Quantity must be positive" };

  const cost = qty * stock.price;
  if (cost > portfolio.cash) {
    return { ok: false, portfolio, reason: `Insufficient cash (need $${cost.toFixed(0)}, have $${portfolio.cash.toFixed(0)})` };
  }

  const newPositions = { ...portfolio.positions };
  const existing = portfolio.positions[ticker];
  if (existing && existing.side === "long") {
    const totalQty = existing.qty + qty;
    const totalCost = existing.avgCost * existing.qty + cost;
    newPositions[ticker] = { qty: totalQty, avgCost: Math.round((totalCost / totalQty) * 100) / 100, side: "long" };
  } else {
    newPositions[ticker] = { qty, avgCost: stock.price, side: "long" };
  }

  return {
    ok: true,
    portfolio: { cash: Math.round((portfolio.cash - cost) * 100) / 100, positions: newPositions },
    reason: "",
  };
}

// ------ Trade execution: SHORT ------

export function executeShort(
  portfolio: Portfolio,
  stocks: BattleStock[],
  ticker: string,
  qty: number
): { ok: boolean; portfolio: Portfolio; reason: string } {
  const stock = stocks.find((s) => s.ticker === ticker);
  if (!stock) return { ok: false, portfolio, reason: "Unknown stock" };
  if (qty <= 0) return { ok: false, portfolio, reason: "Quantity must be positive" };

  const margin = qty * stock.price;
  if (margin > portfolio.cash) {
    return { ok: false, portfolio, reason: `Insufficient cash for margin (need $${margin.toFixed(0)}, have $${portfolio.cash.toFixed(0)})` };
  }

  const newPositions = { ...portfolio.positions };
  const existing = portfolio.positions[ticker];
  if (existing && existing.side === "short") {
    const totalQty = existing.qty + qty;
    const totalMargin = existing.avgCost * existing.qty + margin;
    newPositions[ticker] = { qty: totalQty, avgCost: Math.round((totalMargin / totalQty) * 100) / 100, side: "short" };
  } else {
    newPositions[ticker] = { qty, avgCost: stock.price, side: "short" };
  }

  return {
    ok: true,
    portfolio: { cash: Math.round((portfolio.cash - margin) * 100) / 100, positions: newPositions },
    reason: "",
  };
}

// ------ Trade execution: CLOSE ------

export function closePosition(
  portfolio: Portfolio,
  stocks: BattleStock[],
  ticker: string,
  qty: number
): { ok: boolean; portfolio: Portfolio; reason: string; side: "long" | "short" } {
  const stock = stocks.find((s) => s.ticker === ticker);
  if (!stock) return { ok: false, portfolio, reason: "Unknown stock", side: "long" };
  if (qty <= 0) return { ok: false, portfolio, reason: "Quantity must be positive", side: "long" };

  const existing = portfolio.positions[ticker];
  if (!existing || existing.qty < qty) {
    return { ok: false, portfolio, reason: `Only hold ${existing?.qty ?? 0} shares`, side: existing?.side ?? "long" };
  }

  const newPositions = { ...portfolio.positions };
  let cashReturn: number;

  if (existing.side === "long") {
    cashReturn = qty * stock.price;
  } else {
    cashReturn = qty * (2 * existing.avgCost - stock.price);
    cashReturn = Math.max(0, cashReturn);
  }

  if (existing.qty === qty) {
    delete newPositions[ticker];
  } else {
    newPositions[ticker] = { ...existing, qty: existing.qty - qty };
  }

  return {
    ok: true,
    portfolio: { cash: Math.round((portfolio.cash + cashReturn) * 100) / 100, positions: newPositions },
    reason: "",
    side: existing.side,
  };
}

// ------ NPC agents ------

// Fallback prompts used when registry lookup fails
const FALLBACK_NPC_PROMPT = `You are a competitive AI trader. Make trading decisions based on news events and market conditions. Provide decisions for every stock. Return clean JSON only.`;

// Legacy NPC definitions for backwards compatibility with old URL formats (index-based)
const LEGACY_NPC_DEFS = [
  { id: "npc-alpha", name: "Momentum Trader", strategy: "momentum_trader", strategyLabel: "Momentum", maxTrades: 3, registryId: "momentum_trader" },
  { id: "npc-beta", name: "Contrarian", strategy: "contrarian", strategyLabel: "Contrarian", maxTrades: 2, registryId: "contrarian" },
  { id: "npc-gamma", name: "Blitz Trader", strategy: "scalper", strategyLabel: "Blitz Trader", maxTrades: 3, registryId: "scalper" },
  { id: "npc-delta", name: "News Sniper", strategy: "news_sniper", strategyLabel: "News Sniper", maxTrades: 2, registryId: "news_sniper" },
  { id: "npc-epsilon", name: "YOLO Trader", strategy: "yolo_trader", strategyLabel: "YOLO", maxTrades: 2, registryId: "yolo_trader" },
];

export function createNpcAgents(configs: NpcConfig[]): NpcAgent[] {
  return configs.map((config, idx) => {
    // If config has name/registryId from URL (new dynamic flow), use those
    if (config.name && config.registryId) {
      return {
        id: `npc-${idx}`,
        name: config.name,
        model: config.model,
        strategyLabel: config.name,
        strategy: config.registryId,
        registryId: config.registryId,
        portfolio: createPortfolio(),
        tradeCount: 0,
        maxTradesPerRound: 3,
        systemPrompt: FALLBACK_NPC_PROMPT,
      };
    }
    // Legacy: use index to look up from LEGACY_NPC_DEFS
    const def = LEGACY_NPC_DEFS[config.index] || LEGACY_NPC_DEFS[0];
    return {
      id: def.id,
      name: def.name,
      model: config.model,
      strategyLabel: def.strategyLabel,
      strategy: def.strategy,
      registryId: def.registryId,
      portfolio: createPortfolio(),
      tradeCount: 0,
      maxTradesPerRound: def.maxTrades,
      systemPrompt: FALLBACK_NPC_PROMPT,
    };
  });
}

// Fallback deterministic trade logic (used when API fails)
export function generateFallbackNpcTrade(
  npc: NpcAgent,
  stocks: BattleStock[],
  newsImpacts: Record<string, number>
): TradeInfo | null {
  const { strategy, portfolio } = npc;

  if (strategy === "momentum" || strategy === "momentum_trader") {
    let bestUp: BattleStock | null = null;
    let bestUpPct = 0;
    let bestDown: BattleStock | null = null;
    let bestDownPct = 0;

    for (const s of stocks) {
      const changePct = (s.price - s.startPrice) / s.startPrice;
      if (changePct > bestUpPct) { bestUpPct = changePct; bestUp = s; }
      if (changePct < -bestDownPct) { bestDownPct = -changePct; bestDown = s; }
    }

    if (bestUp && bestUpPct > 0.005 && !portfolio.positions[bestUp.ticker]) {
      const spend = portfolio.cash * 0.3;
      const qty = Math.floor(spend / bestUp.price);
      if (qty > 0) return { ticker: bestUp.ticker, action: "LONG", qty, price: bestUp.price };
    }

    if (bestDown && bestDownPct > 0.005 && !portfolio.positions[bestDown.ticker]) {
      const margin = portfolio.cash * 0.25;
      const qty = Math.floor(margin / bestDown.price);
      if (qty > 0) return { ticker: bestDown.ticker, action: "SHORT", qty, price: bestDown.price };
    }

    if (portfolio.cash > 1000) {
      let bestTicker = "";
      let bestImpact = -Infinity;
      for (const s of stocks) {
        const impact = newsImpacts[s.sector] || 0;
        if (impact > bestImpact && !portfolio.positions[s.ticker]) { bestImpact = impact; bestTicker = s.ticker; }
      }
      if (bestTicker) {
        const stock = stocks.find((s) => s.ticker === bestTicker)!;
        const spend = portfolio.cash * 0.25;
        const qty = Math.floor(spend / stock.price);
        if (qty > 0) return { ticker: bestTicker, action: "LONG", qty, price: stock.price };
      }
    }
    return null;
  }

  if (strategy === "contrarian") {
    let biggestDip: BattleStock | null = null;
    let biggestDipPct = 0;
    let biggestRally: BattleStock | null = null;
    let biggestRallyPct = 0;

    for (const s of stocks) {
      const changePct = (s.price - s.startPrice) / s.startPrice;
      if (changePct < -biggestDipPct) { biggestDipPct = -changePct; biggestDip = s; }
      if (changePct > biggestRallyPct) { biggestRallyPct = changePct; biggestRally = s; }
    }

    if (biggestDip && biggestDipPct > 0.003 && !portfolio.positions[biggestDip.ticker]) {
      const spend = portfolio.cash * 0.3;
      const qty = Math.floor(spend / biggestDip.price);
      if (qty > 0) return { ticker: biggestDip.ticker, action: "LONG", qty, price: biggestDip.price };
    }

    if (biggestRally && biggestRallyPct > 0.005 && !portfolio.positions[biggestRally.ticker]) {
      const margin = portfolio.cash * 0.2;
      const qty = Math.floor(margin / biggestRally.price);
      if (qty > 0) return { ticker: biggestRally.ticker, action: "SHORT", qty, price: biggestRally.price };
    }

    if (portfolio.cash > 1000) {
      const target = stocks.filter((s) => !portfolio.positions[s.ticker]);
      if (target.length > 0) {
        const pick = target[Math.floor(Math.random() * target.length)];
        const spend = portfolio.cash * 0.15;
        const qty = Math.floor(spend / pick.price);
        if (qty > 0) return { ticker: pick.ticker, action: "LONG", qty, price: pick.price };
      }
    }
    return null;
  }

  if (strategy === "value" || strategy === "value_hunter") {
    // Value strategy: buy low P/E, short high P/E
    let bestValue: BattleStock | null = null;
    let bestValueScore = -Infinity;
    let worstValue: BattleStock | null = null;
    let worstValueScore = Infinity;

    for (const s of stocks) {
      // Value score: low P/E + high EPS + low debt = good value
      const score = (1 / Math.max(s.peRatio, 1)) * 100 + s.eps - s.debtEbitda;
      if (score > bestValueScore && !portfolio.positions[s.ticker]) { bestValueScore = score; bestValue = s; }
      if (score < worstValueScore && !portfolio.positions[s.ticker]) { worstValueScore = score; worstValue = s; }
    }

    if (bestValue && portfolio.cash > 1000) {
      const spend = portfolio.cash * 0.5;
      const qty = Math.floor(spend / bestValue.price);
      if (qty > 0) return { ticker: bestValue.ticker, action: "LONG", qty, price: bestValue.price };
    }

    if (worstValue && portfolio.cash > 1000) {
      const margin = portfolio.cash * 0.3;
      const qty = Math.floor(margin / worstValue.price);
      if (qty > 0) return { ticker: worstValue.ticker, action: "SHORT", qty, price: worstValue.price };
    }
    return null;
  }

  // Default fallback: sector-based logic (used for scalper, news_sniper, yolo_trader, sector_rotation, etc.)
  const sectorImpacts: { sector: string; impact: number }[] = [];
  for (const s of stocks) {
    const impact = newsImpacts[s.sector] || 0;
    sectorImpacts.push({ sector: s.sector, impact });
  }
  sectorImpacts.sort((a, b) => b.impact - a.impact);

  const topPositive = sectorImpacts.find((si) => si.impact > 0);
  if (topPositive) {
    const stock = stocks.find((s) => s.sector === topPositive.sector && !portfolio.positions[s.ticker]);
    if (stock) {
      const spend = portfolio.cash * 0.3;
      const qty = Math.floor(spend / stock.price);
      if (qty > 0) return { ticker: stock.ticker, action: "LONG", qty, price: stock.price };
    }
  }

  const topNegative = sectorImpacts.find((si) => si.impact < -0.005);
  if (topNegative) {
    const stock = stocks.find((s) => s.sector === topNegative.sector && !portfolio.positions[s.ticker]);
    if (stock) {
      const margin = portfolio.cash * 0.2;
      const qty = Math.floor(margin / stock.price);
      if (qty > 0) return { ticker: stock.ticker, action: "SHORT", qty, price: stock.price };
    }
  }

  if (portfolio.cash > 1000) {
    const available = stocks.filter((s) => !portfolio.positions[s.ticker]);
    if (available.length > 0) {
      const pick = available[Math.floor(Math.random() * available.length)];
      const spend = portfolio.cash * 0.2;
      const qty = Math.floor(spend / pick.price);
      if (qty > 0) return { ticker: pick.ticker, action: "LONG", qty, price: pick.price };
    }
  }

  return null;
}

export function executeNpcTrade(npc: NpcAgent, trade: TradeInfo, stocks: BattleStock[]): NpcAgent {
  let result: { ok: boolean; portfolio: Portfolio };

  if (trade.action === "LONG") {
    result = executeLong(npc.portfolio, stocks, trade.ticker, trade.qty);
  } else if (trade.action === "SHORT") {
    result = executeShort(npc.portfolio, stocks, trade.ticker, trade.qty);
  } else {
    const closeResult = closePosition(npc.portfolio, stocks, trade.ticker, trade.qty);
    result = closeResult;
  }

  if (result.ok) {
    return { ...npc, portfolio: result.portfolio, tradeCount: npc.tradeCount + 1 };
  }
  return npc;
}

// Execute multiple NPC trades from API response
export function executeNpcTrades(
  npc: NpcAgent,
  trades: NpcTradeDecision[],
  stocks: BattleStock[]
): { npc: NpcAgent; executedTrades: TradeInfo[] } {
  let currentNpc = npc;
  const executedTrades: TradeInfo[] = [];

  for (const decision of trades) {
    const stock = stocks.find((s) => s.ticker === decision.ticker);
    if (!stock) continue;

    const trade: TradeInfo = {
      ticker: decision.ticker,
      action: decision.action,
      qty: decision.qty,
      price: stock.price,
    };

    const updatedNpc = executeNpcTrade(currentNpc, trade, stocks);
    if (updatedNpc.tradeCount > currentNpc.tradeCount) {
      currentNpc = updatedNpc;
      executedTrades.push(trade);
    }
  }

  return { npc: currentNpc, executedTrades };
}

// ------ News: Macro catalog ------

interface MacroNewsEntry {
  headline: string;
  category: NewsCategory;
  sector_keyword: string;
  direction: 1 | -1;
  /** Kept for NPC fallback trade context */
  sectorImpacts: Record<string, number>;
}

const MACRO_NEWS_CATALOG: MacroNewsEntry[] = [
  { headline: "Fed cuts rates by 50bps in surprise move", category: "fed_rate",
    sector_keyword: "fed_rate_cut", direction: 1,
    sectorImpacts: { finance: 0.07, tech: 0.05, consumer: 0.04, energy: 0.02, healthcare: 0.02 } },
  { headline: "US-China trade deal collapses, new tariffs announced", category: "crisis",
    sector_keyword: "trade_war", direction: -1,
    sectorImpacts: { tech: -0.08, consumer: -0.05, energy: -0.03, finance: -0.02, healthcare: -0.01 } },
  { headline: "Surprise inflation surge to 6.2% rattles markets", category: "economic_data",
    sector_keyword: "inflation_surge", direction: -1,
    sectorImpacts: { finance: -0.06, tech: -0.05, consumer: -0.04, energy: 0.03, healthcare: -0.02 } },
  { headline: "Major bank announces $2B in unexpected losses", category: "crisis",
    sector_keyword: "bank_crisis", direction: -1,
    sectorImpacts: { finance: -0.09, tech: -0.03, consumer: -0.02, energy: -0.01 } },
  { headline: "Jobs report smashes expectations: +400K nonfarm payrolls", category: "economic_data",
    sector_keyword: "jobs_boom", direction: 1,
    sectorImpacts: { consumer: 0.06, finance: 0.04, tech: 0.03, healthcare: 0.02, energy: 0.02 } },
  { headline: "Oil prices spike 12% on Middle East military escalation", category: "crisis",
    sector_keyword: "oil_spike", direction: -1,
    sectorImpacts: { energy: 0.10, consumer: -0.05, tech: -0.03, finance: -0.02 } },
  { headline: "GDP growth exceeds forecasts at 4.1% annualized", category: "economic_data",
    sector_keyword: "gdp_growth", direction: 1,
    sectorImpacts: { finance: 0.05, consumer: 0.04, tech: 0.03, energy: 0.03, healthcare: 0.02 } },
  { headline: "Tech antitrust ruling shakes markets: breakup ordered", category: "regulation",
    sector_keyword: "tech_antitrust", direction: -1,
    sectorImpacts: { tech: -0.10, finance: -0.02, consumer: 0.02, healthcare: 0.01 } },
  { headline: "Global supply chain crisis eases, shipping costs plunge 40%", category: "economic_data",
    sector_keyword: "supply_chain_ease", direction: 1,
    sectorImpacts: { consumer: 0.07, tech: 0.04, energy: -0.04, healthcare: 0.02 } },
  { headline: "Unexpected Treasury yield inversion signals recession fears", category: "fed_rate",
    sector_keyword: "yield_inversion", direction: -1,
    sectorImpacts: { finance: -0.07, tech: -0.04, consumer: -0.05, healthcare: 0.02, energy: -0.02 } },
  { headline: "Congress passes massive infrastructure spending bill", category: "economic_data",
    sector_keyword: "infrastructure_bill", direction: 1,
    sectorImpacts: { energy: 0.07, tech: 0.04, finance: 0.03, consumer: 0.02 } },
  { headline: "Dollar weakens sharply against major currencies", category: "economic_data",
    sector_keyword: "dollar_weakens", direction: -1,
    sectorImpacts: { energy: 0.04, tech: 0.03, consumer: -0.02, finance: -0.04 } },
];

// ------ News: Company-specific templates ------

interface CompanyNewsTemplate {
  template: string;
  /** Base primary impact on target stock (can be +/-). Scaled by round. */
  impact: number;
  category: NewsCategory;
}

const COMPANY_NEWS_TEMPLATES: CompanyNewsTemplate[] = [
  { template: "{TICKER} wins major $500M government contract in {SUBSECTOR}", impact: 0.08, category: "product_launch" },
  { template: "{TICKER} CEO resigns unexpectedly amid board dispute", impact: -0.07, category: "scandal" },
  { template: "{SUBSECTOR} faces new regulatory scrutiny from DOJ", impact: -0.06, category: "regulation" },
  { template: "{TICKER} beats earnings by 40%, {SUBSECTOR} outlook raised", impact: 0.09, category: "earnings" },
  { template: "Analyst upgrades {TICKER} to strong buy, {SUBSECTOR} leader", impact: 0.06, category: "earnings" },
  { template: "{TICKER} announces surprise $2B acquisition in {SUBSECTOR}", impact: -0.04, category: "product_launch" },
  { template: "{TICKER} products recalled over safety concerns", impact: -0.08, category: "scandal" },
  { template: "{TICKER} announces 3-for-1 stock split", impact: 0.05, category: "earnings" },
  { template: "Short seller publishes damaging report on {TICKER}", impact: -0.07, category: "scandal" },
  { template: "{TICKER} secures breakthrough {SUBSECTOR} patent", impact: 0.07, category: "product_launch" },
  { template: "Insider buying detected: {TICKER} executives load up on shares", impact: 0.05, category: "earnings" },
  { template: "{TICKER} warns of {SUBSECTOR} supply chain disruption", impact: -0.06, category: "crisis" },
  { template: "FDA approves breakthrough {SUBSECTOR} treatment from {TICKER}", impact: 0.09, category: "regulation" },
  { template: "{TICKER} named top {SUBSECTOR} innovator by industry analysts", impact: 0.05, category: "sector_news" },
];

export function pickMacroNews(usedIndices: Set<number>, round: number = 1): { event: NewsEvent; index: number } | null {
  const available = MACRO_NEWS_CATALOG
    .map((_, i) => i)
    .filter((i) => !usedIndices.has(i));

  if (available.length === 0) return null;

  const idx = available[Math.floor(Math.random() * available.length)];
  const entry = MACRO_NEWS_CATALOG[idx];

  // Escalation: severity and impact magnitude scale with round
  const severity = getSeverityForRound(round);
  const base_impact_pct = getImpactFromSeverity(severity);

  console.log(`[NEWS] Macro: "${entry.headline}" | Round ${round} | Severity: ${severity} | Base impact: ${(base_impact_pct * 100).toFixed(2)}% | Keyword: ${entry.sector_keyword}`);

  return {
    event: {
      headline: entry.headline,
      sectorImpacts: { ...entry.sectorImpacts },
      newsType: "macro" as const,
      category: entry.category,
      severity,
      direction: entry.direction,
      base_impact_pct,
      sector_keyword: entry.sector_keyword,
    },
    index: idx,
  };
}

export function generateCompanyNews(
  stocks: BattleStock[],
  usedTickers: string[],
  round: number = 1
): { event: NewsEvent; tickerAffected: string } | null {
  const availableStocks = stocks.filter((s) => !usedTickers.includes(s.ticker));
  if (availableStocks.length === 0) return null;

  const stock = pickRandom(availableStocks);
  const template = pickRandom(COMPANY_NEWS_TEMPLATES);

  const sectorLabel = stock.sector.charAt(0).toUpperCase() + stock.sector.slice(1);
  const subSectorLabel = stock.subSector || sectorLabel;
  const headline = template.template
    .replace(/\{TICKER\}/g, stock.ticker)
    .replace(/\{SECTOR\}/g, sectorLabel)
    .replace(/\{SUBSECTOR\}/g, subSectorLabel);

  // Scale impact by round (escalation)
  const roundScale = COMPANY_ROUND_SCALE[Math.min(round - 1, COMPANY_ROUND_SCALE.length - 1)];
  const primary_impact_pct = template.impact * roundScale;

  // Sector impacts kept for NPC fallback context
  const sectorImpacts: Record<string, number> = {
    [stock.sector]: primary_impact_pct,
  };

  const severity: NewsSeverity = Math.abs(primary_impact_pct) >= 0.08 ? "HIGH"
    : Math.abs(primary_impact_pct) >= 0.04 ? "MODERATE" : "LOW";

  console.log(
    `[NEWS] Company: "${headline}" | Target: ${stock.ticker} | Round ${round} | ` +
    `Primary impact: ${(primary_impact_pct * 100).toFixed(2)}% | Scale: ${roundScale}x`
  );

  return {
    event: {
      headline,
      sectorImpacts,
      newsType: "company_specific" as const,
      category: template.category,
      severity,
      direction: primary_impact_pct >= 0 ? 1 : -1,
      target_ticker: stock.ticker,
      primary_impact_pct,
    },
    tickerAffected: stock.ticker,
  };
}

// Keep the old pickNewsEvent for backward compatibility during transition
export function pickNewsEvent(usedIndices: number[]): { event: NewsEvent; index: number } | null {
  const used = new Set(usedIndices);
  const available = NEWS_CATALOG
    .map((_, i) => i)
    .filter((i) => !used.has(i));

  if (available.length === 0) return null;

  const idx = available[Math.floor(Math.random() * available.length)];
  const template = NEWS_CATALOG[idx];
  return {
    event: { headline: template.headline, sectorImpacts: { ...template.sectorImpacts } },
    index: idx,
  };
}

// ------ Standings ------

export function computeStandings(
  userName: string,
  userPortfolio: Portfolio,
  npcs: NpcAgent[],
  stocks: BattleStock[],
  userModel: string,
  userStrategy: string,
  userTotalTrades: number
): StandingEntry[] {
  const entries: StandingEntry[] = [];

  const userValue = computeTotalValue(userPortfolio, stocks);
  entries.push({
    name: userName,
    totalValue: userValue,
    pnl: Math.round((userValue - STARTING_CASH) * 100) / 100,
    pnlPct: Math.round(((userValue - STARTING_CASH) / STARTING_CASH) * 10000) / 10000,
    isUser: true,
    model: userModel,
    strategy: userStrategy,
    totalTrades: userTotalTrades,
  });

  for (const npc of npcs) {
    const npcValue = computeTotalValue(npc.portfolio, stocks);
    entries.push({
      name: npc.name,
      totalValue: npcValue,
      pnl: Math.round((npcValue - STARTING_CASH) * 100) / 100,
      pnlPct: Math.round(((npcValue - STARTING_CASH) / STARTING_CASH) * 10000) / 10000,
      isUser: false,
      model: npc.model,
      strategy: npc.strategyLabel,
      totalTrades: npc.tradeCount,
    });
  }

  entries.sort((a, b) => b.pnlPct - a.pnlPct);
  return entries;
}

// ------ User trade helpers ------

export function computeBestWorstTrade(
  userTrades: TradeInfo[],
  stocks: BattleStock[]
): { best: TradeInfo | null; worst: TradeInfo | null } {
  let best: TradeInfo | null = null;
  let bestPnl = -Infinity;
  let worst: TradeInfo | null = null;
  let worstPnl = Infinity;

  for (const trade of userTrades) {
    const stock = stocks.find((s) => s.ticker === trade.ticker);
    if (!stock) continue;

    let pnl: number;
    if (trade.action === "LONG") {
      pnl = (stock.price - trade.price) * trade.qty;
    } else if (trade.action === "SHORT") {
      pnl = (trade.price - stock.price) * trade.qty;
    } else {
      continue;
    }

    if (pnl > bestPnl) { bestPnl = pnl; best = trade; }
    if (pnl < worstPnl) { worstPnl = pnl; worst = trade; }
  }

  return { best, worst };
}

// ------ NPC trade scheduling ------

export function scheduleNpcTrades(npcs: NpcAgent[]): Record<string, number[]> {
  const schedule: Record<string, number[]> = {};

  for (const npc of npcs) {
    const numTrades = 1 + Math.floor(Math.random() * npc.maxTradesPerRound);
    const times: number[] = [];
    for (let i = 0; i < numTrades; i++) {
      const windowStart = (TRADING_DURATION / numTrades) * i + 3;
      const windowEnd = (TRADING_DURATION / numTrades) * (i + 1) - 2;
      times.push(Math.floor(windowStart + Math.random() * Math.max(1, windowEnd - windowStart)));
    }
    times.sort((a, b) => a - b);
    schedule[npc.id] = times;
  }

  return schedule;
}
