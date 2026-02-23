// ============================================================
// Core arena types — designed to be generic across arena types
// (trading, negotiation, etc.)
// ============================================================

/** Identifies which arena type a match belongs to */
export type ArenaType = "trading" | "negotiation";

// ------ Agent types ------

export interface AgentConfig {
  id: string;
  name: string;
  /** Model ID on OpenRouter (e.g. "openai/gpt-4o", "anthropic/claude-3.5-sonnet") */
  model: string;
  /** System prompt that defines the agent's strategy / personality */
  systemPrompt: string;
  /** Temperature for LLM calls (0-2) */
  temperature?: number;
  /** "llm" = calls OpenRouter, "mock" = deterministic test agent */
  provider: "llm" | "mock";
}

export type ActionType = "BUY" | "SELL" | "SHORT" | "HOLD";

export interface AgentAction {
  action: ActionType;
  /** Ticker symbol */
  asset: string;
  /** Number of shares (ignored for HOLD) */
  quantity: number;
}

export interface AgentDecision {
  actions: AgentAction[];
  reasoning: string;
}

// ------ Portfolio types ------

export interface PortfolioPosition {
  ticker: string;
  quantity: number;
  /** Average cost basis per share */
  avgCost: number;
  /** Positive = long, negative = short */
  side: "long" | "short";
}

export interface AgentPortfolio {
  cash: number;
  positions: Record<string, PortfolioPosition>;
  /** Realized P&L from closed trades */
  realizedPnl: number;
}

export interface AgentState {
  agentId: string;
  agentName: string;
  portfolio: AgentPortfolio;
  /** Current total portfolio value (cash + positions at market price) */
  totalValue: number;
  /** P&L percentage from starting cash */
  pnlPct: number;
}

// ------ Market types ------

export interface StockPrice {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  changePct: number;
  /** Full price history up to current round */
  history: number[];
}

export type NewsCategory =
  | "fed_rate"
  | "earnings"
  | "sector_news"
  | "crisis"
  | "regulation"
  | "product_launch"
  | "scandal"
  | "economic_data"
  | "analyst_action"
  | "merger_acquisition"
  | "geopolitical";

export type NewsSeverity = "EXTREME" | "HIGH" | "MODERATE" | "LOW";

export interface NewsEvent {
  headline: string;
  /** Impact per sector: sector name → percentage move (kept for NPC context) */
  sectorImpacts: Record<string, number>;
  /** Type: macro or company_specific */
  newsType?: "macro" | "company_specific";
  /** Category for analytics */
  category?: NewsCategory;
  /** Severity level for deterministic pricing */
  severity?: NewsSeverity;
  /** Overall direction: 1 = bullish, -1 = bearish */
  direction?: 1 | -1;
  /** Base impact percentage magnitude (always positive) */
  base_impact_pct?: number;
  /** Key into SECTOR_MODIFIERS for macro news */
  sector_keyword?: string;
  /** Target stock ticker for company-specific news */
  target_ticker?: string;
  /** Direct % impact on target stock for company news (can be +/-) */
  primary_impact_pct?: number;
}

export interface MarketState {
  round: number;
  totalRounds: number;
  prices: Record<string, StockPrice>;
  news: NewsEvent[];
  /** Ordered from first to last place */
  standings: AgentState[];
}

// ------ Round tracking ------

export interface TradeRecord {
  agentId: string;
  agentName: string;
  round: number;
  action: ActionType;
  asset: string;
  quantity: number;
  price: number;
  total: number;
  reasoning: string;
}

export interface RoundSnapshot {
  round: number;
  prices: Record<string, StockPrice>;
  news: NewsEvent[];
  trades: TradeRecord[];
  standings: AgentState[];
}

// ------ Match result ------

export interface MatchResult {
  arenaType: ArenaType;
  config: unknown;
  rounds: RoundSnapshot[];
  finalStandings: AgentState[];
  /** Agent ID → all their trades */
  tradesByAgent: Record<string, TradeRecord[]>;
  /** Total duration in ms */
  durationMs: number;
}
