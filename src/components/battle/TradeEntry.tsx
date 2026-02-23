"use client";

import type { TradeRecord } from "@/lib/engine/types";
import { formatCurrency } from "@/lib/utils/format";

interface TradeEntryProps {
  trade: TradeRecord;
  isUser: boolean;
}

const ACTION_COLORS: Record<string, string> = {
  BUY: "bg-green-500/10 text-green-400",
  SELL: "bg-red-500/10 text-red-400",
  SHORT: "bg-purple-500/10 text-purple-400",
  HOLD: "bg-neutral-500/10 text-neutral-400",
};

export function TradeEntry({ trade, isUser }: TradeEntryProps) {
  const rejected = trade.reasoning.startsWith("REJECTED:");

  return (
    <div className={`px-3 py-2 ${rejected ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-2">
        <span
          className={`text-sm font-medium ${
            isUser ? "text-amber-500" : "text-neutral-300"
          }`}
        >
          {trade.agentName}
        </span>
        <span
          className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
            ACTION_COLORS[trade.action] ?? ACTION_COLORS.HOLD
          }`}
        >
          {trade.action}
        </span>
        {rejected && (
          <span className="text-[10px] text-red-400/70 uppercase">
            rejected
          </span>
        )}
      </div>
      <p className="text-xs text-neutral-500 mt-0.5 font-[family-name:var(--font-geist-mono)]">
        {trade.quantity}x {trade.asset} @ ${trade.price.toFixed(2)}
        {trade.total > 0 && <> = {formatCurrency(trade.total)}</>}
      </p>
      {!rejected && trade.reasoning && (
        <p className="text-xs text-neutral-600 mt-0.5 truncate max-w-md">
          {trade.reasoning.slice(0, 120)}
        </p>
      )}
    </div>
  );
}
