"use client";

import { HTMLAttributes, forwardRef } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ selected, className = "", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`rounded-xl bg-neutral-900 border ${
          selected
            ? "border-amber-500 ring-1 ring-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.25)]"
            : "border-neutral-800"
        } ${className}`}
        {...props}
      />
    );
  }
);

Card.displayName = "Card";
export { Card };
