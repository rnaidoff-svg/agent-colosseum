"use client";

import { useEffect, useRef } from "react";
import type { RoundSnapshot } from "@/lib/engine/types";
import { NewsEntry } from "./NewsEntry";
import { TradeEntry } from "./TradeEntry";

interface LiveFeedProps {
  rounds: RoundSnapshot[];
  userAgentId: string;
}

export function LiveFeed({ rounds, userAgentId }: LiveFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [rounds.length]);

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 px-4 py-3 border-b border-neutral-800">
        Live Feed
      </h2>
      <div className="flex-1 overflow-y-auto divide-y divide-neutral-800/30">
        {rounds.length === 0 && (
          <div className="p-4 text-sm text-neutral-600 text-center">
            Waiting for first round...
          </div>
        )}
        {rounds.map((round) => (
          <div key={round.round}>
            {/* Round divider */}
            <div className="sticky top-0 z-10 bg-neutral-950/90 backdrop-blur px-3 py-1.5 text-xs font-semibold text-amber-500/70 uppercase tracking-wider border-b border-neutral-800/50">
              Round {round.round}
            </div>

            {/* News */}
            {round.news.map((n, i) => (
              <NewsEntry key={`news-${round.round}-${i}`} news={n} />
            ))}

            {/* Trades */}
            {round.trades.map((t, i) => (
              <TradeEntry
                key={`trade-${round.round}-${i}`}
                trade={t}
                isUser={t.agentId === userAgentId}
              />
            ))}

            {round.trades.length === 0 && round.news.length === 0 && (
              <div className="px-3 py-2 text-xs text-neutral-600">
                No activity this round.
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
