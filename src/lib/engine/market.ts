// ============================================================
// Market simulator — generates synthetic price movements
// Designed so output format works identically with real data
// ============================================================

import { MatchConfig, StockConfig } from "./config";
import { NewsEvent, StockPrice } from "./types";

// ------ News event catalog ------

interface NewsTemplate {
  headline: string;
  /** sector → percentage impact (e.g. 0.03 = +3%) */
  sectorImpacts: Record<string, number>;
}

export const NEWS_CATALOG: NewsTemplate[] = [
  {
    headline: "Fed signals interest rate cut ahead of schedule",
    sectorImpacts: { finance: 0.03, tech: 0.02, energy: 0.01, consumer: 0.01, healthcare: 0.005 },
  },
  {
    headline: "Fed raises rates by 50 basis points, citing persistent inflation",
    sectorImpacts: { finance: -0.03, tech: -0.025, consumer: -0.015, energy: -0.01, healthcare: -0.005 },
  },
  {
    headline: "Major oil supply disruption in Middle East",
    sectorImpacts: { energy: 0.05, consumer: -0.02, tech: -0.01 },
  },
  {
    headline: "Tech giant reports massive earnings miss",
    sectorImpacts: { tech: -0.04, index: -0.01 },
  },
  {
    headline: "New healthcare regulation bill advances in Congress",
    sectorImpacts: { healthcare: -0.03, finance: -0.005 },
  },
  {
    headline: "Consumer confidence index surges to 5-year high",
    sectorImpacts: { consumer: 0.03, finance: 0.01, tech: 0.005 },
  },
  {
    headline: "Breakthrough AI chip announced, tech stocks rally",
    sectorImpacts: { tech: 0.045, consumer: 0.01 },
  },
  {
    headline: "Global banking crisis fears emerge from European markets",
    sectorImpacts: { finance: -0.04, tech: -0.02, consumer: -0.015, energy: -0.01, healthcare: -0.01 },
  },
  {
    headline: "Oil prices plummet on oversupply concerns",
    sectorImpacts: { energy: -0.045, consumer: 0.015, tech: 0.005 },
  },
  {
    headline: "FDA fast-tracks approval for revolutionary cancer treatment",
    sectorImpacts: { healthcare: 0.04, tech: 0.01 },
  },
  {
    headline: "Major retail chain announces expansion into 12 new markets",
    sectorImpacts: { consumer: 0.025, finance: 0.01 },
  },
  {
    headline: "Cybersecurity breach hits major financial institutions",
    sectorImpacts: { finance: -0.035, tech: 0.02 },
  },
  {
    headline: "Green energy subsidies bill passes Senate",
    sectorImpacts: { energy: 0.03, tech: 0.015, consumer: 0.005 },
  },
  {
    headline: "Trade war escalation: new tariffs on tech imports",
    sectorImpacts: { tech: -0.035, consumer: -0.02, energy: -0.01 },
  },
  {
    headline: "Unemployment drops to historic low",
    sectorImpacts: { consumer: 0.02, finance: 0.015, tech: 0.01, healthcare: 0.005, energy: 0.005 },
  },
  {
    headline: "Major pharmaceutical merger announced",
    sectorImpacts: { healthcare: 0.03, finance: 0.01 },
  },
  {
    headline: "Housing market shows signs of sharp correction",
    sectorImpacts: { finance: -0.025, consumer: -0.02, tech: -0.005 },
  },
  {
    headline: "Electric vehicle sales surge past expectations",
    sectorImpacts: { tech: 0.02, energy: -0.02, consumer: 0.015 },
  },
  {
    headline: "Supply chain disruptions worsen globally",
    sectorImpacts: { consumer: -0.03, tech: -0.02, energy: 0.015, healthcare: -0.01 },
  },
  {
    headline: "Central bank digital currency pilot launches successfully",
    sectorImpacts: { finance: 0.025, tech: 0.02 },
  },
];

// ------ Helpers ------

/** Box-Muller transform for normally distributed random numbers */
function gaussianRandom(mean = 0, stdDev = 1): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// ------ Market state ------

export interface MarketSimState {
  prices: Record<string, StockPrice>;
  /** Track which news events have been used to avoid repeats */
  usedNewsIndices: Set<number>;
}

/** Initialize market state with starting prices */
export function initMarket(config: MatchConfig): MarketSimState {
  const prices: Record<string, StockPrice> = {};

  // Initialize individual stocks first
  for (const stock of config.stocks) {
    if (stock.isDerived) continue;

    const startPrice = stock.startPriceRange
      ? Math.round(randomInRange(stock.startPriceRange[0], stock.startPriceRange[1]) * 100) / 100
      : stock.startPrice;

    prices[stock.ticker] = {
      ticker: stock.ticker,
      name: stock.name,
      sector: stock.sector,
      price: startPrice,
      change: 0,
      changePct: 0,
      history: [startPrice],
    };
  }

  // Initialize derived stocks (index)
  for (const stock of config.stocks) {
    if (!stock.isDerived) continue;

    const indexPrice = computeIndexPrice(prices, config.stocks);
    prices[stock.ticker] = {
      ticker: stock.ticker,
      name: stock.name,
      sector: stock.sector,
      price: indexPrice,
      change: 0,
      changePct: 0,
      history: [indexPrice],
    };
  }

  return { prices, usedNewsIndices: new Set() };
}

/** Compute index as equal-weighted average of non-derived stocks */
function computeIndexPrice(
  prices: Record<string, StockPrice>,
  stocks: StockConfig[]
): number {
  const nonDerived = stocks.filter((s) => !s.isDerived);
  const sum = nonDerived.reduce((acc, s) => acc + prices[s.ticker].price, 0);
  return Math.round((sum / nonDerived.length) * 100) / 100;
}

// ------ Core simulation ------

export interface RoundMarketResult {
  prices: Record<string, StockPrice>;
  news: NewsEvent[];
}

/** Generate one round of market movement */
export function generateRound(
  roundNumber: number,
  prevState: MarketSimState,
  config: MatchConfig
): { result: RoundMarketResult; nextState: MarketSimState } {
  const newPrices: Record<string, StockPrice> = {};

  // 1. Determine news events for this round
  const news: NewsEvent[] = [];
  const usedNewsIndices = new Set(prevState.usedNewsIndices);

  if (Math.random() < config.newsFrequency) {
    // Pick a random unused news event
    const availableIndices = NEWS_CATALOG
      .map((_, i) => i)
      .filter((i) => !usedNewsIndices.has(i));

    if (availableIndices.length > 0) {
      const idx = availableIndices[Math.floor(Math.random() * availableIndices.length)];
      usedNewsIndices.add(idx);
      const template = NEWS_CATALOG[idx];
      news.push({
        headline: template.headline,
        sectorImpacts: { ...template.sectorImpacts },
      });
    }
  }

  // 2. Generate base market move (mean-reverting random walk)
  const baseMove = gaussianRandom(0, 0.01); // ~1% std dev

  // 3. Calculate news impact per sector
  const sectorNewsImpact: Record<string, number> = {};
  for (const event of news) {
    for (const [sector, impact] of Object.entries(event.sectorImpacts)) {
      sectorNewsImpact[sector] = (sectorNewsImpact[sector] || 0) + impact;
    }
  }

  // 4. Move each non-derived stock
  for (const stock of config.stocks) {
    if (stock.isDerived) continue;

    const prev = prevState.prices[stock.ticker];
    const betaMove = stock.beta * baseMove;
    const idiosyncratic = gaussianRandom(0, stock.volatility);
    const newsImpact = sectorNewsImpact[stock.sector] || 0;

    const totalMove = betaMove + idiosyncratic + newsImpact;
    const newPrice = Math.max(0.01, Math.round(prev.price * (1 + totalMove) * 100) / 100);
    const change = Math.round((newPrice - prev.price) * 100) / 100;
    const changePct = Math.round((change / prev.price) * 10000) / 10000;

    newPrices[stock.ticker] = {
      ticker: stock.ticker,
      name: stock.name,
      sector: stock.sector,
      price: newPrice,
      change,
      changePct,
      history: [...prev.history, newPrice],
    };
  }

  // 5. Compute derived stocks (index)
  for (const stock of config.stocks) {
    if (!stock.isDerived) continue;

    const prev = prevState.prices[stock.ticker];
    const indexPrice = computeIndexPrice(newPrices, config.stocks);
    const change = Math.round((indexPrice - prev.price) * 100) / 100;
    const changePct = prev.price > 0
      ? Math.round((change / prev.price) * 10000) / 10000
      : 0;

    newPrices[stock.ticker] = {
      ticker: stock.ticker,
      name: stock.name,
      sector: stock.sector,
      price: indexPrice,
      change,
      changePct,
      history: [...prev.history, indexPrice],
    };
  }

  return {
    result: { prices: newPrices, news },
    nextState: { prices: newPrices, usedNewsIndices },
  };
}
