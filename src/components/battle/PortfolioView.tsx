"use client";

import type { AgentState, StockPrice } from "@/lib/engine/types";
import { formatCurrency, formatPct, formatPnl } from "@/lib/utils/format";

interface PortfolioViewProps {
  agent: AgentState | null;
  prices: Record<string, StockPrice>;
}

export function PortfolioView({ agent, prices }: PortfolioViewProps) {
  if (!agent) {
    return (
      <div className="flex flex-col h-full">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 px-4 py-3 border-b border-neutral-800">
          Your Portfolio
        </h2>
        <div className="flex-1 flex items-center justify-center text-sm text-neutral-600">
          Waiting for match...
        </div>
      </div>
    );
  }

  const positions = Object.values(agent.portfolio.positions);
  const pnlPositive = agent.pnlPct >= 0;

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 px-4 py-3 border-b border-neutral-800">
        Your Portfolio
      </h2>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">
              Cash
            </div>
            <div className="text-sm font-[family-name:var(--font-geist-mono)] text-neutral-200">
              {formatCurrency(agent.portfolio.cash)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">
              Total Value
            </div>
            <div className="text-sm font-[family-name:var(--font-geist-mono)] text-neutral-200">
              {formatCurrency(agent.totalValue)}
            </div>
          </div>
          <div className="col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">
              P&L
            </div>
            <div
              className={`text-lg font-[family-name:var(--font-geist-mono)] font-semibold ${
                pnlPositive ? "text-green-400" : "text-red-400"
              }`}
            >
              {formatPnl(agent.totalValue - 100_000)} ({formatPct(agent.pnlPct)})
            </div>
          </div>
        </div>

        {/* Positions */}
        {positions.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">
              Positions
            </div>
            <div className="space-y-2">
              {positions.map((pos) => {
                const currentPrice = prices[pos.ticker]?.price ?? 0;
                const value = pos.quantity * currentPrice;
                const unrealized =
                  pos.side === "long"
                    ? (currentPrice - pos.avgCost) * pos.quantity
                    : (pos.avgCost - currentPrice) * pos.quantity;
                const unrealizedPositive = unrealized >= 0;

                return (
                  <div
                    key={pos.ticker}
                    className="flex items-center justify-between text-sm border border-neutral-800 rounded-lg px-3 py-2"
                  >
                    <div>
                      <span className="font-medium text-neutral-200">
                        {pos.ticker}
                      </span>
                      <span className="text-neutral-500 text-xs ml-2">
                        {pos.side === "short" ? "SHORT" : "LONG"} {pos.quantity}x
                      </span>
                    </div>
                    <div className="text-right font-[family-name:var(--font-geist-mono)]">
                      <div className="text-neutral-300 text-xs">
                        {formatCurrency(value)}
                      </div>
                      <div
                        className={`text-xs ${
                          unrealizedPositive ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {formatPnl(unrealized)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {positions.length === 0 && (
          <div className="text-sm text-neutral-600">No open positions.</div>
        )}
      </div>
    </div>
  );
}
