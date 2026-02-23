"use client";

import type { NewsEvent } from "@/lib/engine/types";

interface NewsEntryProps {
  news: NewsEvent;
}

export function NewsEntry({ news }: NewsEntryProps) {
  const impacts = Object.entries(news.sectorImpacts);

  return (
    <div className="px-3 py-2">
      <p className="text-sm text-neutral-300">{news.headline}</p>
      {impacts.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {impacts.map(([sector, impact]) => {
            const positive = impact >= 0;
            return (
              <span
                key={sector}
                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  positive
                    ? "bg-green-500/10 text-green-400"
                    : "bg-red-500/10 text-red-400"
                }`}
              >
                {sector} {positive ? "+" : ""}
                {(impact * 100).toFixed(1)}%
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
