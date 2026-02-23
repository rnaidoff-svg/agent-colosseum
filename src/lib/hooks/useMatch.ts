"use client";

import { useState, useCallback, useRef } from "react";
import { runMatch } from "../engine/game";
import { createDecisionFn } from "../agents/runner";
import type { AgentConfig, RoundSnapshot, MatchResult } from "../engine/types";
import type { MatchConfig } from "../engine/config";

export type MatchPhase = "idle" | "running" | "finished";

interface MatchState {
  phase: MatchPhase;
  rounds: RoundSnapshot[];
  currentRound: number;
  totalRounds: number;
  result: MatchResult | null;
}

export function useMatch() {
  const [state, setState] = useState<MatchState>({
    phase: "idle",
    rounds: [],
    currentRound: 0,
    totalRounds: 0,
    result: null,
  });

  const runningRef = useRef(false);

  const startMatch = useCallback(
    async (agents: AgentConfig[], configOverrides?: Partial<MatchConfig>) => {
      if (runningRef.current) return;
      runningRef.current = true;

      const totalRounds = configOverrides?.rounds ?? 3;

      setState({
        phase: "running",
        rounds: [],
        currentRound: 0,
        totalRounds,
        result: null,
      });

      const decisionFn = createDecisionFn();

      const result = await runMatch({
        agents,
        config: { ...configOverrides, speedMs: 1500 },
        decisionFn,
        onRound: (snapshot: RoundSnapshot) => {
          setState((prev) => ({
            ...prev,
            rounds: [...prev.rounds, snapshot],
            currentRound: snapshot.round,
          }));
        },
      });

      setState((prev) => ({
        ...prev,
        phase: "finished",
        result,
      }));

      runningRef.current = false;
    },
    []
  );

  const reset = useCallback(() => {
    setState({
      phase: "idle",
      rounds: [],
      currentRound: 0,
      totalRounds: 0,
      result: null,
    });
    runningRef.current = false;
  }, []);

  return {
    ...state,
    latestRound: state.rounds[state.rounds.length - 1] ?? null,
    startMatch,
    reset,
  };
}
