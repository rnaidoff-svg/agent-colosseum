import { NextRequest, NextResponse } from "next/server";
import { getEffectivePrompt, getEffectiveModel } from "@/lib/agents/prompt-composer";
import { getActivePrompt } from "@/lib/db/agents";
import { parseAIResponse } from "@/lib/utils/parseAIResponse";

export const dynamic = "force-dynamic";

// ------ Curated stock pool ------

interface CuratedStock {
  symbol: string;
  sector: string;
  subSector: string;
}

// Mag 7 stocks — exactly 1 will be picked per match
const MAG7_POOL: CuratedStock[] = [
  { symbol: "AAPL", sector: "tech", subSector: "Consumer Electronics" },
  { symbol: "MSFT", sector: "tech", subSector: "Cloud Computing" },
  { symbol: "GOOGL", sector: "tech", subSector: "AI/ML" },
  { symbol: "NVDA", sector: "tech", subSector: "Semiconductors" },
  { symbol: "META", sector: "tech", subSector: "Social Media" },
  { symbol: "AMZN", sector: "tech", subSector: "E-Commerce" },
  { symbol: "TSLA", sector: "tech", subSector: "Electric Vehicles" },
];

// S&P 500 stocks (non-Mag7) — 3 random picks per match
const SP500_POOL: CuratedStock[] = [
  // Tech (non-Mag7)
  { symbol: "AMD", sector: "tech", subSector: "Semiconductors" },
  { symbol: "CRM", sector: "tech", subSector: "Enterprise Software" },
  { symbol: "INTC", sector: "tech", subSector: "Semiconductors" },
  { symbol: "ORCL", sector: "tech", subSector: "Enterprise Software" },
  // Energy
  { symbol: "XOM", sector: "energy", subSector: "Oil & Gas" },
  { symbol: "CVX", sector: "energy", subSector: "Oil & Gas" },
  { symbol: "COP", sector: "energy", subSector: "Oil & Gas" },
  { symbol: "SLB", sector: "energy", subSector: "Oilfield Services" },
  { symbol: "OXY", sector: "energy", subSector: "Oil & Gas" },
  { symbol: "NEE", sector: "energy", subSector: "Renewables" },
  // Finance
  { symbol: "JPM", sector: "finance", subSector: "Banking" },
  { symbol: "BAC", sector: "finance", subSector: "Banking" },
  { symbol: "GS", sector: "finance", subSector: "Investment Banking" },
  { symbol: "MS", sector: "finance", subSector: "Investment Banking" },
  { symbol: "V", sector: "finance", subSector: "Fintech" },
  { symbol: "MA", sector: "finance", subSector: "Fintech" },
  { symbol: "BRK.B", sector: "finance", subSector: "Conglomerate" },
  // Healthcare
  { symbol: "JNJ", sector: "healthcare", subSector: "Pharmaceuticals" },
  { symbol: "UNH", sector: "healthcare", subSector: "Health Insurance" },
  { symbol: "PFE", sector: "healthcare", subSector: "Pharmaceuticals" },
  { symbol: "ABBV", sector: "healthcare", subSector: "Biotech" },
  { symbol: "LLY", sector: "healthcare", subSector: "Pharmaceuticals" },
  { symbol: "MRK", sector: "healthcare", subSector: "Pharmaceuticals" },
  // Consumer
  { symbol: "WMT", sector: "consumer", subSector: "Retail" },
  { symbol: "COST", sector: "consumer", subSector: "Retail" },
  { symbol: "NKE", sector: "consumer", subSector: "Apparel" },
  { symbol: "SBUX", sector: "consumer", subSector: "Food & Beverage" },
  { symbol: "MCD", sector: "consumer", subSector: "Food & Beverage" },
  { symbol: "DIS", sector: "consumer", subSector: "Entertainment" },
  { symbol: "PG", sector: "consumer", subSector: "Consumer Goods" },
  // Industrial / Other S&P 500
  { symbol: "BA", sector: "tech", subSector: "Aerospace" },
  { symbol: "CAT", sector: "energy", subSector: "Industrial Equipment" },
  { symbol: "DE", sector: "consumer", subSector: "Agriculture Equipment" },
  { symbol: "HON", sector: "tech", subSector: "Industrial Tech" },
  { symbol: "UPS", sector: "consumer", subSector: "Logistics" },
];

// Ultra volatile small cap stocks — 1 random pick per match
const SMALLCAP_POOL: CuratedStock[] = [
  { symbol: "MARA", sector: "finance", subSector: "Crypto Mining" },
  { symbol: "RIOT", sector: "finance", subSector: "Crypto Mining" },
  { symbol: "SMCI", sector: "tech", subSector: "Server Hardware" },
  { symbol: "SOUN", sector: "tech", subSector: "Voice AI" },
  { symbol: "IONQ", sector: "tech", subSector: "Quantum Computing" },
  { symbol: "AFRM", sector: "finance", subSector: "Buy Now Pay Later" },
  { symbol: "UPST", sector: "finance", subSector: "AI Lending" },
  { symbol: "PLUG", sector: "energy", subSector: "Hydrogen Fuel Cells" },
  { symbol: "RIVN", sector: "tech", subSector: "Electric Vehicles" },
  { symbol: "LCID", sector: "tech", subSector: "Electric Vehicles" },
  { symbol: "SOFI", sector: "finance", subSector: "Digital Banking" },
  { symbol: "RKLB", sector: "tech", subSector: "Space Launch" },
  { symbol: "DNA", sector: "healthcare", subSector: "Synthetic Biology" },
  { symbol: "OPEN", sector: "tech", subSector: "PropTech" },
  { symbol: "CLOV", sector: "healthcare", subSector: "Health Insurance Tech" },
];

// Combined pool for AI reference (all stocks the AI can see)
const STOCK_POOL: CuratedStock[] = [...MAG7_POOL, ...SP500_POOL, ...SMALLCAP_POOL];

// Full S&P 500 pool for 2-stock selection (1 random pick + SPY)
const FULL_SP500_POOL: CuratedStock[] = [...MAG7_POOL, ...SP500_POOL];

// ------ Types ------

interface FinnhubQuote {
  c: number;  // current price
  h: number;  // high
  l: number;  // low
  o: number;  // open
  pc: number; // previous close
}

interface FinnhubProfile {
  name: string;
  ticker: string;
  finnhubIndustry: string;
  marketCapitalization: number; // in millions
  country: string;
}

interface FinnhubMetric {
  metric: {
    peBasicExclExtraTTM?: number;
    epsBasicExclExtraItemsTTM?: number;
    "52WeekHigh"?: number;
    "52WeekLow"?: number;
    beta?: number;
    totalDebt?: number;
    ebitda?: number;
    "totalDebt/totalEquityAnnual"?: number;
    "netDebtToTotalDebt"?: number;
  };
}

interface StockResult {
  ticker: string;
  name: string;
  sector: string;
  subSector: string;
  startPrice: number;
  beta: number;
  volatility: number;
  marketCap: string;
  capCategory: "Small" | "Mid" | "Large";
  eps: number;
  peRatio: number;
  debtEbitda: number;
  isReal: boolean;
}

// ------ Helpers ------

function formatMarketCap(millions: number): string {
  if (millions >= 1000) return `$${(millions / 1000).toFixed(1)}B`;
  if (millions > 0) return `$${Math.round(millions)}M`;
  return "$0M";
}

function capCategory(millions: number): "Small" | "Mid" | "Large" {
  if (millions >= 10000) return "Large";  // $10B+
  if (millions >= 2000) return "Mid";     // $2B+
  return "Small";
}

// ------ Session cache ------
let cachedStocks: StockResult[] | null = null;
let cachedAt = 0;
const CACHE_TTL = 30 * 1000; // 30 seconds — short so each match gets fresh picks

// ------ Finnhub fetch helpers ------

async function fetchFinnhub<T>(path: string, apiKey: string): Promise<T | null> {
  try {
    const url = `https://finnhub.io/api/v1${path}${path.includes("?") ? "&" : "?"}token=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchStockData(symbol: string, curated: CuratedStock, apiKey: string): Promise<StockResult | null> {
  const [quote, profile, metrics] = await Promise.all([
    fetchFinnhub<FinnhubQuote>(`/quote?symbol=${symbol}`, apiKey),
    fetchFinnhub<FinnhubProfile>(`/stock/profile2?symbol=${symbol}`, apiKey),
    fetchFinnhub<FinnhubMetric>(`/stock/metric?symbol=${symbol}&metric=all`, apiKey),
  ]);

  if (!quote || !quote.c || quote.c <= 0) return null;

  const price = Math.round(quote.c * 100) / 100;
  const name = profile?.name || symbol;
  const mktCapM = profile?.marketCapitalization || 0;
  const beta = metrics?.metric?.beta ?? (1.0 + (Math.random() - 0.5) * 0.6);
  const eps = metrics?.metric?.epsBasicExclExtraItemsTTM ?? Math.round(price * 0.04 * 100) / 100;
  const pe = metrics?.metric?.peBasicExclExtraTTM ?? (eps > 0 ? Math.round((price / eps) * 10) / 10 : 25);

  // Debt/EBITDA — estimate if not available
  let debtEbitda = 2.0;
  if (metrics?.metric?.totalDebt && metrics?.metric?.ebitda && metrics.metric.ebitda > 0) {
    debtEbitda = Math.round((metrics.metric.totalDebt / metrics.metric.ebitda) * 10) / 10;
  }

  // Volatility from beta
  const volatility = Math.round((Math.abs(beta) * 0.015 + 0.005) * 1000) / 1000;

  return {
    ticker: symbol,
    name,
    sector: curated.sector,
    subSector: curated.subSector,
    startPrice: price,
    beta: Math.round(beta * 100) / 100,
    volatility,
    marketCap: formatMarketCap(mktCapM),
    capCategory: capCategory(mktCapM),
    eps: Math.round(eps * 100) / 100,
    peRatio: Math.round(Math.abs(pe) * 10) / 10,
    debtEbitda: Math.max(0, Math.round(debtEbitda * 10) / 10),
    isReal: true,
  };
}

// ------ Fake stock fallback ------

function generateFakeStock(sector: string, subSector: string, usedTickers: Set<string>): StockResult {
  const prefixes: Record<string, string[]> = {
    tech: ["Apex", "Nova", "Quantum", "Cipher", "Nexus"],
    energy: ["Titan", "Atlas", "Forge", "Summit", "Meridian"],
    finance: ["Citadel", "Harbor", "Fortress", "Pinnacle", "Vanguard"],
    healthcare: ["Vital", "Genesis", "Aether", "Clarity", "Evergreen"],
    consumer: ["Bloom", "Spark", "Ember", "Craft", "Haven"],
  };
  const suffixes: Record<string, string[]> = {
    tech: ["Systems", "Labs", "AI", "Cloud"],
    energy: ["Energy", "Power", "Resources"],
    finance: ["Financial", "Capital", "Group"],
    healthcare: ["Therapeutics", "Pharma", "Biotech"],
    consumer: ["Brands", "Retail", "Co"],
  };

  const pref = (prefixes[sector] || prefixes.tech)[Math.floor(Math.random() * 5)];
  const suf = (suffixes[sector] || suffixes.tech)[Math.floor(Math.random() * 3)];
  const name = `${pref} ${suf}`;

  let ticker = name.replace(/[^A-Z]/gi, "").toUpperCase().slice(0, 4);
  while (usedTickers.has(ticker)) ticker = ticker.slice(0, 3) + String.fromCharCode(65 + Math.floor(Math.random() * 26));
  usedTickers.add(ticker);

  const price = Math.round((20 + Math.random() * 480) * 100) / 100;
  const beta = Math.round((0.5 + Math.random() * 1.5) * 100) / 100;

  return {
    ticker, name, sector, subSector,
    startPrice: price,
    beta,
    volatility: Math.round((beta * 0.015 + 0.005) * 1000) / 1000,
    marketCap: formatMarketCap(2000 + Math.random() * 200000),
    capCategory: Math.random() > 0.5 ? "Large" : "Mid",
    eps: Math.round(price * (0.03 + Math.random() * 0.05) * 100) / 100,
    peRatio: Math.round((10 + Math.random() * 30) * 10) / 10,
    debtEbitda: Math.round((0.5 + Math.random() * 4) * 10) / 10,
    isReal: false,
  };
}

// ------ Main route ------

async function fetchSPY(apiKey: string): Promise<StockResult | null> {
  const quote = await fetchFinnhub<FinnhubQuote>("/quote?symbol=SPY", apiKey);
  if (!quote || !quote.c || quote.c <= 0) return null;
  return {
    ticker: "SPY",
    name: "S&P 500 ETF",
    sector: "index",
    subSector: "Market Index",
    startPrice: Math.round(quote.c * 100) / 100,
    beta: 1.0,
    volatility: 0.012,
    marketCap: "$500B+",
    capCategory: "Large",
    eps: Math.round(quote.c * 0.04 * 100) / 100,
    peRatio: 22.0,
    debtEbitda: 0,
    isReal: true,
  };
}

export async function GET(request: NextRequest) {
  // Cache bypass: ?fresh=1 or no-cache header
  const url = new URL(request.url);
  const wantFresh = url.searchParams.get("fresh") === "1";

  // Return cached if fresh (and no bypass)
  if (!wantFresh && cachedStocks && Date.now() - cachedAt < CACHE_TTL) {
    console.log(`[stocks] Returning cached stocks (age: ${Math.round((Date.now() - cachedAt) / 1000)}s)`);
    return NextResponse.json({ stocks: cachedStocks });
  }

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    // No API key — generate 1 fake stock + fake SPY
    console.warn("[stocks] No FINNHUB_API_KEY set, generating fake stocks");
    const usedTickers = new Set<string>();
    const sectors = ["tech", "energy", "finance", "healthcare", "consumer"];
    const fakes: StockResult[] = [];
    const sector = sectors[Math.floor(Math.random() * sectors.length)];
    fakes.push(generateFakeStock(sector, sector, usedTickers));
    // Add fake SPY
    fakes.push({
      ticker: "SPY", name: "S&P 500 ETF", sector: "index", subSector: "Market Index",
      startPrice: 580.50, beta: 1.0, volatility: 0.012, marketCap: "$500B+",
      capCategory: "Large", eps: 23.22, peRatio: 22.0, debtEbitda: 0, isReal: false,
    });
    cachedStocks = fakes;
    cachedAt = Date.now();
    return NextResponse.json({ stocks: fakes });
  }

  // --- Stock Selection: 1 Mag7 + 3 random S&P500 + 1 volatile small cap ---
  // Try AI Stock Selector agent, fallback to deterministic random
  let selected: CuratedStock[] = [];
  try {
    const orApiKey = process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    if (orApiKey) {
      const { composed: selectorPrompt } = getEffectivePrompt("stock_selector");
      const selectorModel = getEffectiveModel("stock_selector");
      const activeVersion = getActivePrompt("stock_selector");
      const version = activeVersion?.version ?? 1;

      console.log(`[stocks] Using Stock Selector Agent v${version}, model: ${selectorModel}`);

      const randomSeed = Math.floor(Math.random() * 100000);
      const sp500List = FULL_SP500_POOL.map((s) => `${s.symbol} (${s.sector}/${s.subSector})`).join(", ");

      const userMsg = `Random seed: ${randomSeed} — you MUST use this to vary your picks. Never pick the same stock twice.

MANDATORY RULES — follow exactly:
1. Pick exactly 1 stock from the S&P 500 pool: ${sp500List}
2. SPY is added automatically as the 2nd security — do NOT include it.

Pick a stock that will create interesting trading dynamics with diverse news catalysts.

Respond with ONLY a JSON array of exactly 1 ticker string, e.g.: ["NVDA"]`;

      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${orApiKey}`,
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "Agent Colosseum - Stock Selector",
        },
        body: JSON.stringify({ model: selectorModel, messages: [
          { role: "system", content: selectorPrompt },
          { role: "user", content: userMsg },
        ], max_tokens: 128, temperature: 1.0 }),
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          const tickers = parseAIResponse(content, { type: "array" });
          if (tickers && Array.isArray(tickers)) {
            const poolMap = new Map(STOCK_POOL.map((s) => [s.symbol, s]));
            const aiSelected = tickers.map((t: string) => poolMap.get(t.toUpperCase())).filter(Boolean) as CuratedStock[];
            if (aiSelected.length >= 1) {
              selected = aiSelected.slice(0, 1);
              console.log(`[stocks] Stock Selector Agent picked: ${selected.map((s) => s.symbol).join(", ")}`);
            }
          }
        }
      }
    }
  } catch (err) {
    console.log("[stocks] Falling back to random selection:", err);
  }

  // Fallback: deterministic random — 1 random S&P 500 stock
  if (selected.length === 0) {
    const pick = FULL_SP500_POOL[Math.floor(Math.random() * FULL_SP500_POOL.length)];
    selected = [pick];
    console.log(`[stocks] Random selection fallback: ${selected.map((s) => s.symbol).join(", ")}`);
  }

  // Fetch real data for each (with small delay between to respect rate limits)
  const results: StockResult[] = [];
  const usedTickers = new Set<string>();

  for (const curated of selected) {
    const data = await fetchStockData(curated.symbol, curated, apiKey);
    if (data) {
      results.push(data);
      usedTickers.add(data.ticker);
    } else {
      // Fallback: generate fake stock for this sector
      console.warn(`[stocks] Finnhub fetch failed for ${curated.symbol}, using fallback`);
      results.push(generateFakeStock(curated.sector, curated.subSector, usedTickers));
    }
    // Small delay to avoid rate limits (30 calls/sec for free tier)
    await new Promise((r) => setTimeout(r, 120));
  }

  // Always add SPY as 2nd stock
  const spy = await fetchSPY(apiKey);
  if (spy) {
    results.push(spy);
  } else {
    console.warn("[stocks] SPY fetch failed, using fallback price");
    results.push({
      ticker: "SPY", name: "S&P 500 ETF", sector: "index", subSector: "Market Index",
      startPrice: 580.50, beta: 1.0, volatility: 0.012, marketCap: "$500B+",
      capCategory: "Large", eps: 23.22, peRatio: 22.0, debtEbitda: 0, isReal: false,
    });
  }

  cachedStocks = results;
  cachedAt = Date.now();

  return NextResponse.json({ stocks: results });
}
