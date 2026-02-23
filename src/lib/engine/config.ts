// ============================================================
// Match and stock configuration — all parameters configurable
// ============================================================

export interface MatchConfig {
  /** Number of trading rounds (5-50) */
  rounds: number;
  /** Starting cash per agent in dollars */
  startingCash: number;
  /** Maximum percentage of portfolio in a single position (0-1) */
  maxPositionPct: number;
  /** Probability of a news event each round (0-1) */
  newsFrequency: number;
  /** Delay in ms between rounds (0 = instant) */
  speedMs: number;
  /** Stock universe for this match */
  stocks: StockConfig[];
}

export interface StockConfig {
  name: string;
  ticker: string;
  sector: string;
  /** Sensitivity to market moves (1.0 = moves with market) */
  beta: number;
  /** Volatility level — scales idiosyncratic noise */
  volatility: number;
  /** Starting price (used if startPriceRange is not set) */
  startPrice: number;
  /** If set, starting price is randomized in [min, max] */
  startPriceRange?: [number, number];
  /** If true, price is derived from other stocks (e.g. index) */
  isDerived?: boolean;
}

export const DEFAULT_STOCKS: StockConfig[] = [
  {
    name: "TechCo",
    ticker: "TCH",
    sector: "tech",
    beta: 1.8,
    volatility: 0.04,
    startPrice: 175,
    startPriceRange: [150, 200],
  },
  {
    name: "EnergyX",
    ticker: "ENX",
    sector: "energy",
    beta: 1.5,
    volatility: 0.035,
    startPrice: 80,
    startPriceRange: [60, 100],
  },
  {
    name: "FinanceBank",
    ticker: "FBK",
    sector: "finance",
    beta: 1.2,
    volatility: 0.025,
    startPrice: 95,
    startPriceRange: [80, 110],
  },
  {
    name: "HealthShield",
    ticker: "HSH",
    sector: "healthcare",
    beta: 0.7,
    volatility: 0.015,
    startPrice: 115,
    startPriceRange: [100, 130],
  },
  {
    name: "ConsumerCo",
    ticker: "CSM",
    sector: "consumer",
    beta: 1.0,
    volatility: 0.025,
    startPrice: 65,
    startPriceRange: [50, 80],
  },
  {
    name: "Market Index",
    ticker: "IDX",
    sector: "index",
    beta: 1.0,
    volatility: 0,
    startPrice: 0,
    isDerived: true,
  },
];

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  rounds: 10,
  startingCash: 100_000,
  maxPositionPct: 0.4,
  newsFrequency: 0.3,
  speedMs: 0,
  stocks: DEFAULT_STOCKS,
};

/** Merge partial config over defaults */
export function buildMatchConfig(
  overrides?: Partial<Omit<MatchConfig, "stocks">> & { stocks?: StockConfig[] }
): MatchConfig {
  const config = { ...DEFAULT_MATCH_CONFIG, ...overrides };

  // Clamp rounds to valid range
  config.rounds = Math.max(5, Math.min(50, config.rounds));
  // Clamp position pct
  config.maxPositionPct = Math.max(0.05, Math.min(1, config.maxPositionPct));
  // Clamp news frequency
  config.newsFrequency = Math.max(0, Math.min(1, config.newsFrequency));

  return config;
}
