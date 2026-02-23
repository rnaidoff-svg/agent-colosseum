"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/history", label: "History" },
  { href: "/profile", label: "Profile" },
  { href: "/agents", label: "Agents" },
  { href: "/admin/agents", label: "Command Center" },
];

export function Nav() {
  const pathname = usePathname();

  // On battle page: render a minimal subtle nav
  const isBattle = pathname === "/battle";

  return (
    <nav className={`sticky top-0 z-50 border-b bg-[#0a0a0a]/90 backdrop-blur-sm ${
      isBattle ? "border-neutral-800/50 h-8" : "border-neutral-800 h-12"
    }`}>
      <div className={`mx-auto flex items-center justify-between px-4 h-full ${isBattle ? "max-w-full" : "max-w-5xl"}`}>
        <Link href="/" className={`font-bold text-amber-500 tracking-wide ${isBattle ? "text-xs" : "text-sm"}`}>
          AC
        </Link>
        <div className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md transition-colors ${
                  isBattle
                    ? `px-2 py-0.5 text-[10px] ${isActive ? "text-amber-500/70" : "text-neutral-600 hover:text-neutral-400"}`
                    : `px-3 py-1.5 text-sm ${isActive ? "text-amber-500 bg-amber-500/10 font-medium" : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"}`
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
