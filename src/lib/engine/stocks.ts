// ============================================================
// Dynamic stock generator — creates random stock profiles
// for each match with realistic financial characteristics
// ============================================================

import type { StockConfig } from "./config";

// ------ Stock profile (extends engine StockConfig with display data) ------

export interface StockProfile extends StockConfig {
  /** Market capitalization label e.g. "$4.2B" or "$850M" */
  marketCap: string;
  /** Market cap category */
  capCategory: "Small" | "Mid" | "Large";
  /** Earnings per share */
  eps: number;
  /** Price-to-earnings ratio */
  peRatio: number;
  /** Debt-to-EBITDA ratio */
  debtEbitda: number;
  /** Sub-sector within the main sector */
  subSector: string;
}

// ------ Sector configuration ------

type Sector = "tech" | "energy" | "finance" | "healthcare" | "consumer";

const SECTORS: Sector[] = ["tech", "energy", "finance", "healthcare", "consumer"];

const SUB_SECTORS: Record<Sector, string[]> = {
  tech: ["Cloud Computing", "Semiconductors", "AI/ML", "Cybersecurity", "SaaS", "Social Media"],
  energy: ["Oil & Gas", "Renewables", "Nuclear", "Utilities", "Mining"],
  finance: ["Banking", "Insurance", "Fintech", "Asset Management", "REITs"],
  healthcare: ["Biotech", "Pharmaceuticals", "Medical Devices", "Health Insurance", "Digital Health"],
  consumer: ["E-Commerce", "Retail", "Food & Beverage", "Luxury Goods", "Entertainment"],
};

interface SectorParams {
  betaRange: [number, number];
  peRange: [number, number];
  debtRange: [number, number];
  epsMultiplier: [number, number]; // fraction of price
}

const SECTOR_PARAMS: Record<Sector, SectorParams> = {
  tech: {
    betaRange: [1.4, 2.0],
    peRange: [20, 45],
    debtRange: [0.5, 2.5],
    epsMultiplier: [0.02, 0.06],
  },
  energy: {
    betaRange: [1.2, 1.8],
    peRange: [8, 20],
    debtRange: [2.0, 5.0],
    epsMultiplier: [0.04, 0.10],
  },
  finance: {
    betaRange: [0.9, 1.4],
    peRange: [10, 22],
    debtRange: [3.0, 6.0],
    epsMultiplier: [0.04, 0.08],
  },
  healthcare: {
    betaRange: [0.5, 0.9],
    peRange: [15, 35],
    debtRange: [0.5, 3.0],
    epsMultiplier: [0.03, 0.07],
  },
  consumer: {
    betaRange: [0.7, 1.2],
    peRange: [12, 28],
    debtRange: [1.0, 4.0],
    epsMultiplier: [0.03, 0.08],
  },
};

// ------ Name generation pools ------

const NAME_PREFIXES: Record<Sector, string[]> = {
  tech: [
    "Apex", "Nova", "Quantum", "Cipher", "Nexus", "Vertex", "Pulse", "Arc",
    "Synth", "Lumen", "Ion", "Helix", "Omni", "Flux", "Zeta", "Byte",
    "Core", "Grid", "Nano", "Proto",
  ],
  energy: [
    "Titan", "Atlas", "Forge", "Summit", "Meridian", "Terra", "Solaris",
    "Dynamo", "Volt", "Ember", "Crest", "Beacon", "Stratos", "Granite",
    "Borealis", "Pinnacle", "Horizon", "Cobalt", "Canyon", "Sterling",
  ],
  finance: [
    "Citadel", "Harbor", "Fortress", "Pinnacle", "Summit", "Crown",
    "Keystone", "Bastion", "Vanguard", "Sentinel", "Anchor", "Compass",
    "Fidelity", "Legacy", "Prestige", "Sovereign", "Trident", "Shield",
    "Granite", "Capital",
  ],
  healthcare: [
    "Vital", "Genesis", "Aether", "Clarity", "Evergreen", "Revive",
    "Zenith", "Celeste", "Vivid", "Radiant", "Harmony", "Serenity",
    "Elixir", "Meridian", "Cascade", "Pinnacle", "Aurora", "Lumina",
    "Cura", "Vesta",
  ],
  consumer: [
    "Bloom", "Spark", "Ember", "Craft", "Haven", "Vivid", "Noble",
    "Prism", "Lark", "Coast", "Willow", "Crest", "Fable", "Orbit",
    "Maple", "Echo", "Tide", "Slate", "Luna", "Arrow",
  ],
};

const NAME_SUFFIXES: Record<Sector, string[]> = {
  tech: [
    "Systems", "Dynamics", "Labs", "Technologies", "AI", "Robotics",
    "Networks", "Digital", "Cloud", "Software", "Micro", "Logic",
  ],
  energy: [
    "Energy", "Power", "Resources", "Petroleum", "Fuels", "Renewables",
    "Utilities", "Mining", "Corp", "Industries",
  ],
  finance: [
    "Financial", "Capital", "Group", "Bancorp", "Holdings", "Trust",
    "Partners", "Investments", "Securities", "Bank",
  ],
  healthcare: [
    "Therapeutics", "Pharma", "Biotech", "Health", "Medical", "Sciences",
    "Genomics", "Diagnostics", "BioPharma", "Life Sciences",
  ],
  consumer: [
    "Brands", "Retail", "Goods", "Co", "Markets", "Direct",
    "Lifestyle", "Group", "Commerce", "Supply",
  ],
};

// ------ Helpers ------

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateTicker(name: string): string {
  // Take consonants from the name, uppercase, 3-4 chars
  const consonants = name.replace(/[^bcdfghjklmnpqrstvwxyz]/gi, "").toUpperCase();
  const len = Math.random() > 0.5 ? 4 : 3;

  if (consonants.length >= len) {
    return consonants.slice(0, len);
  }
  // Fallback: first letters of words
  const words = name.split(/\s+/);
  let ticker = words.map((w) => w[0]).join("").toUpperCase();
  while (ticker.length < 3) ticker += String.fromCharCode(65 + randInt(0, 25));
  return ticker.slice(0, len);
}

function formatMarketCap(valueInBillions: number): string {
  if (valueInBillions >= 1) {
    return `$${valueInBillions.toFixed(1)}B`;
  }
  return `$${Math.round(valueInBillions * 1000)}M`;
}

// ------ Main generator ------

export function generateMatchStocks(): StockProfile[] {
  const usedTickers = new Set<string>();
  const usedNames = new Set<string>();
  const stocks: StockProfile[] = [];

  for (let i = 0; i < 1; i++) {
    // Pick a random sector — truly random, could repeat
    const sector = pick(SECTORS);
    const params = SECTOR_PARAMS[sector];
    const subSector = pick(SUB_SECTORS[sector]);

    // Generate unique company name
    let companyName = "";
    let attempts = 0;
    do {
      companyName = `${pick(NAME_PREFIXES[sector])} ${pick(NAME_SUFFIXES[sector])}`;
      attempts++;
    } while (usedNames.has(companyName) && attempts < 20);
    usedNames.add(companyName);

    // Generate unique ticker
    let ticker = generateTicker(companyName);
    let tickerAttempts = 0;
    while (usedTickers.has(ticker) && tickerAttempts < 20) {
      ticker = ticker.slice(0, -1) + String.fromCharCode(65 + randInt(0, 25));
      tickerAttempts++;
    }
    usedTickers.add(ticker);

    // Core financial params
    const beta = Math.round(rand(params.betaRange[0], params.betaRange[1]) * 100) / 100;
    const volatility = Math.round((beta * 0.015 + rand(0.005, 0.015)) * 1000) / 1000;
    const startPrice = Math.round(rand(20, 500) * 100) / 100;

    // Market cap
    const capRoll = Math.random();
    let capCategory: "Small" | "Mid" | "Large";
    let capBillions: number;
    if (capRoll < 0.3) {
      capCategory = "Small";
      capBillions = rand(0.2, 2);
    } else if (capRoll < 0.7) {
      capCategory = "Mid";
      capBillions = rand(2, 20);
    } else {
      capCategory = "Large";
      capBillions = rand(20, 500);
    }

    // EPS derived from price and sector
    const epsMultiplier = rand(params.epsMultiplier[0], params.epsMultiplier[1]);
    const eps = Math.round(startPrice * epsMultiplier * 100) / 100;

    // PE ratio — realistic for sector
    const peRatio = Math.round(rand(params.peRange[0], params.peRange[1]) * 10) / 10;

    // Debt/EBITDA
    const debtEbitda = Math.round(rand(params.debtRange[0], params.debtRange[1]) * 10) / 10;

    stocks.push({
      name: companyName,
      ticker,
      sector,
      subSector,
      beta,
      volatility,
      startPrice,
      marketCap: formatMarketCap(capBillions),
      capCategory,
      eps,
      peRatio,
      debtEbitda,
    });
  }

  // Add fake SPY as 2nd stock
  stocks.push({
    name: "S&P 500 ETF",
    ticker: "SPY",
    sector: "index",
    subSector: "Market Index",
    beta: 1.0,
    volatility: 0.012,
    startPrice: 580.50,
    marketCap: "$500B+",
    capCategory: "Large",
    eps: 23.22,
    peRatio: 22.0,
    debtEbitda: 0,
  });

  return stocks;
}

/** Convert StockProfile[] to StockConfig[] (for the engine) */
export function profilesToStockConfigs(profiles: StockProfile[]): StockConfig[] {
  return profiles.map((p) => ({
    name: p.name,
    ticker: p.ticker,
    sector: p.sector,
    beta: p.beta,
    volatility: p.volatility,
    startPrice: p.startPrice,
  }));
}
