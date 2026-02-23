"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { profilesToStockConfigs } from "@/lib/engine/stocks";
import type { StockProfile } from "@/lib/engine/stocks";
import { Button } from "@/components/ui/Button";

// ------ Sector colors ------

const SECTOR_COLORS: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  tech:       { bg: "bg-blue-500/10",   text: "text-blue-400",   border: "border-blue-500/20",   glow: "shadow-blue-500/5" },
  energy:     { bg: "bg-amber-500/10",  text: "text-amber-400",  border: "border-amber-500/20",  glow: "shadow-amber-500/5" },
  finance:    { bg: "bg-green-500/10",  text: "text-green-400",  border: "border-green-500/20",  glow: "shadow-green-500/5" },
  healthcare: { bg: "bg-red-500/10",    text: "text-red-400",    border: "border-red-500/20",    glow: "shadow-red-500/5" },
  consumer:   { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/20", glow: "shadow-purple-500/5" },
  index:      { bg: "bg-cyan-500/10",   text: "text-cyan-400",   border: "border-cyan-500/20",   glow: "shadow-cyan-500/5" },
};

const SECTOR_LABELS: Record<string, string> = {
  tech: "Tech",
  energy: "Energy",
  finance: "Finance",
  healthcare: "Healthcare",
  consumer: "Consumer",
  index: "Index",
};

// ------ Stat row component ------

function Stat({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-neutral-800/50 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</span>
      <span className={`text-sm text-neutral-200 ${mono ? "font-[family-name:var(--font-geist-mono)]" : ""}`}>
        {value}
      </span>
    </div>
  );
}

// ------ Stock card component (PART 2: bigger company name) ------

function StockCard({ stock }: { stock: StockProfile }) {
  const colors = SECTOR_COLORS[stock.sector] ?? SECTOR_COLORS.tech;
  const sectorLabel = SECTOR_LABELS[stock.sector] ?? stock.sector;

  return (
    <div
      className={`relative rounded-xl border ${colors.border} bg-neutral-900 shadow-lg ${colors.glow} overflow-hidden flex flex-col`}
    >
      {/* Top accent line */}
      <div className={`h-0.5 ${colors.bg.replace("/10", "/40")}`} />

      <div className="p-5 flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-[family-name:var(--font-geist-mono)] text-lg font-bold text-neutral-100">
                {stock.ticker}
              </span>
              <span className={`text-[10px] uppercase tracking-wider ${colors.text}`}>
                {stock.capCategory} Cap
              </span>
            </div>
            {/* Company name — BIGGER (PART 2) */}
            <p className="text-base font-semibold text-neutral-200 leading-tight mb-1">{stock.name}</p>
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} inline-block`}
            >
              {sectorLabel}{stock.subSector ? ` · ${stock.subSector}` : ""}
            </span>
          </div>
        </div>

        {/* Price — prominent */}
        <div className="mb-4 text-center py-3 rounded-lg bg-neutral-800/50 border border-neutral-800">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
            Share Price
          </div>
          <div className="text-2xl font-bold font-[family-name:var(--font-geist-mono)] text-neutral-100">
            ${stock.startPrice.toFixed(2)}
          </div>
        </div>

        {/* Stats grid */}
        <div className="flex-1">
          <Stat label="Beta" value={stock.beta.toFixed(2)} />
          <Stat label="Mkt Cap" value={stock.marketCap} />
          <Stat label="EPS" value={`$${stock.eps.toFixed(2)}`} />
          <Stat label="P/E Ratio" value={stock.peRatio.toFixed(1)} />
          <Stat label="Debt/EBITDA" value={`${stock.debtEbitda.toFixed(1)}x`} />
        </div>
      </div>
    </div>
  );
}

// ------ Page content ------

function StocksContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [stocks, setStocks] = useState<StockProfile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Forward all config params
  const configParams = useMemo(() => {
    const p = new URLSearchParams();
    searchParams.forEach((value, key) => {
      p.set(key, value);
    });
    return p;
  }, [searchParams]);

  // Fetch real stocks from API
  useEffect(() => {
    async function fetchStocks() {
      try {
        const res = await fetch("/api/stocks");
        const data = await res.json();
        if (data.stocks && data.stocks.length > 0) {
          // Convert API response to StockProfile format
          const profiles: StockProfile[] = data.stocks.map((s: StockProfile & { isReal?: boolean }) => ({
            name: s.name,
            ticker: s.ticker,
            sector: s.sector,
            subSector: s.subSector || s.sector,
            beta: s.beta,
            volatility: s.volatility,
            startPrice: s.startPrice,
            marketCap: s.marketCap,
            capCategory: s.capCategory,
            eps: s.eps,
            peRatio: s.peRatio,
            debtEbitda: s.debtEbitda,
          }));
          setStocks(profiles);
        } else {
          setError("No stocks returned");
        }
      } catch (err) {
        console.error("Failed to fetch stocks:", err);
        setError("Failed to load stocks");
      } finally {
        setLoading(false);
      }
    }
    fetchStocks();
  }, []);

  // Store stocks in sessionStorage so the battle page can read them
  useEffect(() => {
    if (!stocks) return;
    const configs = profilesToStockConfigs(stocks);
    sessionStorage.setItem("matchStocks", JSON.stringify(configs));
    sessionStorage.setItem("matchStockProfiles", JSON.stringify(stocks));
  }, [stocks]);

  const handleEnterBattle = () => {
    router.push(`/battle?${configParams.toString()}`);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-3 border-amber-500/30 border-t-amber-500 rounded-full animate-spin mx-auto" />
          <div className="text-neutral-400">Fetching live market data...</div>
          <div className="text-xs text-neutral-600">Real prices from Finnhub</div>
        </div>
      </main>
    );
  }

  if (error || !stocks) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-red-400">Failed to load stocks</div>
          <button onClick={() => window.location.reload()} className="text-sm text-amber-500 hover:text-amber-400">
            Try Again
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-4 py-12 max-w-6xl mx-auto">
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold">Today&apos;s Market</h1>
        <p className="mt-2 text-neutral-400">
          Real stocks, real prices. These are the stocks your agents will trade.
        </p>
      </div>

      {/* Stock cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {stocks.map((stock) => (
          <StockCard key={stock.ticker} stock={stock} />
        ))}
      </div>

      {/* Enter Battle */}
      <div className="flex justify-center mt-10">
        <Button size="lg" onClick={handleEnterBattle}>
          Enter Battle &rarr;
        </Button>
      </div>
    </main>
  );
}

export default function StocksPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center text-neutral-500">
          Loading market data...
        </div>
      }
    >
      <StocksContent />
    </Suspense>
  );
}
