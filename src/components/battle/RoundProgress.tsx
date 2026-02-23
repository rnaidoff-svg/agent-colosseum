"use client";

import { ProgressBar } from "../ui/ProgressBar";

interface RoundProgressProps {
  current: number;
  total: number;
}

export function RoundProgress({ current, total }: RoundProgressProps) {
  return (
    <div className="px-4 py-3 bg-neutral-900/50 border-b border-neutral-800">
      <div className="flex items-center justify-between mb-1.5 text-sm">
        <span className="text-neutral-400">
          Round <span className="text-neutral-100 font-semibold">{current}</span> of{" "}
          <span className="text-neutral-100">{total}</span>
        </span>
        {current >= total && (
          <span className="text-amber-500 font-semibold text-xs uppercase tracking-wider">
            Match Complete
          </span>
        )}
      </div>
      <ProgressBar value={current} max={total} />
    </div>
  );
}
