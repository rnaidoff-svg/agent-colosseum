"use client";

import { Card } from "../ui/Card";

interface StrategyCardProps {
  name: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}

export function StrategyCard({ name, description, selected, onClick }: StrategyCardProps) {
  return (
    <Card
      selected={selected}
      onClick={onClick}
      className="p-4 cursor-pointer hover:border-amber-500/50 transition-colors"
    >
      <h3 className="font-semibold text-sm">{name}</h3>
      <p className="mt-1 text-xs text-neutral-400">{description}</p>
    </Card>
  );
}
