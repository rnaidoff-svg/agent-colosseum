"use client";

import type { AgentState } from "@/lib/engine/types";
import { formatCurrency, formatPct } from "@/lib/utils/format";

interface LeaderboardProps {
  standings: AgentState[];
  userAgentId: string;
}

export function Leaderboard({ standings, userAgentId }: LeaderboardProps) {
  return (
    <div className="flex flex-col h-full">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 px-4 py-3 border-b border-neutral-800">
        Leaderboard
      </h2>
      <div className="flex-1 overflow-y-auto">
        {standings.map((agent, i) => {
          const isUser = agent.agentId === userAgentId;
          const positive = agent.pnlPct >= 0;
          return (
            <div
              key={agent.agentId}
              className={`flex items-center gap-3 px-4 py-3 border-b border-neutral-800/50 ${
                isUser ? "bg-amber-500/5" : ""
              }`}
            >
              <span className="text-neutral-500 font-mono text-sm w-5 text-right">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-medium truncate ${
                      isUser ? "text-amber-500" : "text-neutral-200"
                    }`}
                  >
                    {agent.agentName}
                  </span>
                  {isUser && (
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
                      You
                    </span>
                  )}
                </div>
                <span className="text-xs text-neutral-500 font-[family-name:var(--font-geist-mono)]">
                  {formatCurrency(agent.totalValue)}
                </span>
              </div>
              <span
                className={`text-sm font-[family-name:var(--font-geist-mono)] font-medium ${
                  positive ? "text-green-400" : "text-red-400"
                }`}
              >
                {formatPct(agent.pnlPct)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
