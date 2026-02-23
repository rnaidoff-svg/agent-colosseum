"use client";

import type { MatchResult } from "@/lib/engine/types";
import { formatCurrency, formatPct } from "@/lib/utils/format";
import { Button } from "../ui/Button";

interface ResultsOverlayProps {
  result: MatchResult;
  userAgentId: string;
  onPlayAgain: () => void;
  onReconfigure: () => void;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export function ResultsOverlay({
  result,
  userAgentId,
  onPlayAgain,
  onReconfigure,
}: ResultsOverlayProps) {
  const userRank = result.finalStandings.findIndex(
    (s) => s.agentId === userAgentId
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 rounded-2xl bg-neutral-900 border border-neutral-800 p-8 shadow-2xl">
        <h2 className="text-2xl font-bold text-center mb-1">Match Complete</h2>
        <p className="text-center text-neutral-400 text-sm mb-6">
          {result.rounds.length} rounds &middot;{" "}
          {(result.durationMs / 1000).toFixed(1)}s
        </p>

        {/* Rankings */}
        <div className="space-y-3 mb-8">
          {result.finalStandings.map((agent, i) => {
            const isUser = agent.agentId === userAgentId;
            const positive = agent.pnlPct >= 0;

            return (
              <div
                key={agent.agentId}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                  isUser
                    ? "border-amber-500/50 bg-amber-500/5"
                    : "border-neutral-800 bg-neutral-800/30"
                }`}
              >
                <span className="text-xl w-8 text-center">
                  {i < 3 ? MEDALS[i] : <span className="text-neutral-500 text-sm font-mono">{i + 1}</span>}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-medium ${
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
                  className={`font-[family-name:var(--font-geist-mono)] font-semibold ${
                    positive ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {formatPct(agent.pnlPct)}
                </span>
              </div>
            );
          })}
        </div>

        {/* User summary */}
        <p className="text-center text-sm text-neutral-400 mb-6">
          You finished in{" "}
          <span className="text-amber-500 font-semibold">
            {userRank + 1}
            {userRank === 0 ? "st" : userRank === 1 ? "nd" : userRank === 2 ? "rd" : "th"}
          </span>{" "}
          place
        </p>

        {/* Actions */}
        <div className="flex gap-3 justify-center">
          <Button variant="secondary" onClick={onReconfigure}>
            Reconfigure
          </Button>
          <Button onClick={onPlayAgain}>Play Again</Button>
        </div>
      </div>
    </div>
  );
}
