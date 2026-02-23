export { buildMatchConfig, DEFAULT_MATCH_CONFIG, DEFAULT_STOCKS } from "./config";
export type { MatchConfig, StockConfig } from "./config";
export { initMarket, generateRound } from "./market";
export { runMatch } from "./game";
export type { AgentDecisionFn, RunMatchOptions } from "./game";
export { generateMatchStocks, profilesToStockConfigs } from "./stocks";
export type { StockProfile } from "./stocks";
export * from "./types";
