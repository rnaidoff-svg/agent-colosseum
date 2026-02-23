"use client";

import type { StockPrice } from "@/lib/engine/types";

interface MarketTickerProps {
  prices: Record<string, StockPrice>;
}

export function MarketTicker({ prices }: MarketTickerProps) {
  const stocks = Object.values(prices);

  return (
    <div className="flex items-center gap-6 overflow-x-auto px-4 py-3 bg-neutral-900 border-b border-neutral-800 font-[family-name:var(--font-geist-mono)] text-sm">
      {stocks.map((s) => {
        const positive = s.changePct >= 0;
        return (
          <div key={s.ticker} className="flex items-center gap-2 shrink-0">
            <span className="text-neutral-400 font-semibold">{s.ticker}</span>
            <span className="text-neutral-100">${s.price.toFixed(2)}</span>
            <span className={positive ? "text-green-400" : "text-red-400"}>
              {positive ? "+" : ""}
              {(s.changePct * 100).toFixed(2)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
