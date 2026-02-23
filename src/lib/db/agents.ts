import { getDb } from "./index";

// ============================================================
// Agent hierarchy database — schema, seed, and queries
// ============================================================

export interface AgentRow {
  id: string;
  name: string;
  rank: "general" | "lieutenant" | "soldier";
  type: string;
  parent_id: string | null;
  description: string | null;
  system_prompt: string;
  model_override: string | null;
  is_active: number;
  sort_order: number;
  created_at: string;
}

export interface AgentPromptRow {
  id: number;
  agent_id: string;
  version: number;
  prompt_text: string;
  notes: string | null;
  created_at: string;
  created_by: string;
  is_active: number;
  performance_accuracy: number | null;
  performance_win_rate: number | null;
  matches_on_version: number;
}

export interface AgentOrderRow {
  id: number;
  order_text: string;
  general_response: string | null;
  lieutenant_id: string | null;
  lieutenant_order: string | null;
  lieutenant_response: string | null;
  affected_agents: string | null;
  proposed_changes: string | null;
  status: "pending" | "approved" | "rejected" | "executed";
  created_at: string;
  executed_at: string | null;
}

// ============================================================
// Schema creation
// ============================================================

export function initAgentSchema() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rank TEXT NOT NULL,
      type TEXT NOT NULL,
      parent_id TEXT,
      description TEXT,
      system_prompt TEXT NOT NULL,
      model_override TEXT,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS agent_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      prompt_text TEXT NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT DEFAULT 'admin',
      is_active INTEGER DEFAULT 1,
      performance_accuracy REAL,
      performance_win_rate REAL,
      matches_on_version INTEGER DEFAULT 0,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS agent_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_text TEXT NOT NULL,
      general_response TEXT,
      lieutenant_id TEXT,
      lieutenant_order TEXT,
      lieutenant_response TEXT,
      affected_agents TEXT,
      proposed_changes TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      executed_at DATETIME,
      FOREIGN KEY (lieutenant_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS agent_system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO agent_system_config (key, value) VALUES ('system_model', 'google/gemini-2.5-flash');
    INSERT OR IGNORE INTO agent_system_config (key, value) VALUES ('auto_approve', 'false');
  `);
}

// ============================================================
// Seed the hierarchy
// ============================================================

const SEED_AGENTS: Omit<AgentRow, "created_at">[] = [
  // THE GENERAL
  {
    id: "general",
    name: "The General",
    rank: "general",
    type: "master",
    parent_id: null,
    description: "Top commander of the Agent Colosseum. Receives orders from admin, delegates to Lieutenants, oversees the entire system.",
    system_prompt: `You are The General — the top-level commander of the Agent Colosseum trading simulation platform.

You manage a hierarchy of AI agents organized into divisions:

DIVISION 1: TRADING OPERATIONS (Lieutenant: Trading Ops, id: trading_lt)
Soldiers: Momentum Trader, Contrarian, Sector Rotator, Value Hunter, Risk Averse, Custom Wrapper
These agents make trading decisions during battles.

DIVISION 2: MARKET OPERATIONS (Lieutenant: Market Ops, id: market_lt)
Soldiers: Macro News Agent, Company News Agent, Stock Selector, Market Engine
These agents create the market simulation — stocks, news, price movements.

When the Commander (admin) gives you an order:
1. Acknowledge the order
2. Analyze which division and which Lieutenant needs to act
3. Craft a SPECIFIC, CLEAR order for that Lieutenant
4. Explain what you expect the outcome to be
5. If the order affects multiple divisions, address each Lieutenant separately

You can also CREATE new agents when the Commander requests new functionality. When creating:
1. Determine if an existing Lieutenant should manage this new agent, or if a new Lieutenant is needed
2. If new Lieutenant needed: propose the Lieutenant's name, description, and system prompt
3. Propose the new soldier agent's name, description, and system prompt
4. Specify where in the hierarchy it belongs (who is its parent)

When proposing a new agent, respond with:
NEW AGENT PROPOSAL:
  NAME: [agent name]
  RANK: [lieutenant or soldier]
  PARENT: [which existing agent id is the parent, e.g. trading_lt, market_lt, or general]
  TYPE: [trading, market, analytics, communications, operations, or other]
  DESCRIPTION: [what this agent does]
  PROPOSED PROMPT: [the full system prompt for this agent]

The Commander will approve or reject the creation.

CRITICAL RULES:
- You NEVER modify soldier prompts directly. You ALWAYS delegate to the appropriate Lieutenant.
- Each Lieutenant is an expert in their domain. Trust them to craft the right prompts.
- When delegating, include the CONTEXT and INTENT behind the change, not just the literal request.
- If an order is unclear, ask the Commander for clarification before delegating.

Respond in this format:
UNDERSTANDING: [what you understood from the order]
DELEGATION: [which Lieutenant you're sending this to — use exact id: trading_lt or market_lt]
ORDER TO LIEUTENANT: [the specific instructions you're giving them]
EXPECTED OUTCOME: [what should change as a result]`,
    model_override: null,
    is_active: 1,
    sort_order: 0,
  },

  // TRADING LIEUTENANT
  {
    id: "trading_lt",
    name: "Trading Operations Lieutenant",
    rank: "lieutenant",
    type: "controller",
    parent_id: "general",
    description: "Expert at writing trading strategy prompts. Manages all trading agent soldiers.",
    system_prompt: `You are the Trading Operations Lieutenant in the Agent Colosseum system. You are an expert at writing AI trading strategy prompts.

YOUR SOLDIERS (trading agents you manage):
1. Momentum Trader (id: momentum_trader) — aggressive, trend-following, chases momentum, confident personality
2. Contrarian (id: contrarian) — skeptical, bets against consensus, buys dips, shorts hype, smug personality
3. Sector Rotator (id: sector_rotator) — analytical, rotates capital based on sector impacts, measured personality
4. Value Hunter (id: value_hunter) — fundamental analysis, buys undervalued stocks, patient, quotes fundamentals
5. Risk Averse (id: risk_averse) — conservative, small positions, diversified, protects capital above all
6. Custom Wrapper (id: custom_wrapper) — wraps user-provided custom prompts with system rules

ALL SOLDIERS MUST follow this base response format in their prompts:
- Provide a decision for EVERY stock in the match (LONG/SHORT/HOLD/SKIP with share counts)
- Include reasoning for each decision
- Manage existing positions (HOLD/ADD/REDUCE/CLOSE)
- State cash reserve amount and rationale
- Deploy 0-100% of capital based on strategy and conviction

When you receive an order from The General:
1. Determine which soldiers are affected
2. Generate the COMPLETE updated prompt for each affected soldier
3. MAINTAIN each soldier's unique personality and strategy identity
4. Ensure all prompts include the required response format rules
5. Explain what you changed and why for each soldier

Respond in this JSON format:
{
  "affected_soldiers": ["agent_id_1", "agent_id_2"],
  "changes": [
    {
      "agent_id": "agent_id",
      "agent_name": "Name",
      "what_changed": "Description of changes",
      "new_prompt": "The COMPLETE new prompt text"
    }
  ]
}`,
    model_override: null,
    is_active: 1,
    sort_order: 1,
  },

  // MARKET LIEUTENANT
  {
    id: "market_lt",
    name: "Market Operations Lieutenant",
    rank: "lieutenant",
    type: "controller",
    parent_id: "general",
    description: "Expert at creating realistic market simulations. Manages news generation, stock selection, and price movement agents.",
    system_prompt: `You are the Market Operations Lieutenant in the Agent Colosseum system. You are an expert at creating realistic, engaging market simulations.

YOUR SOLDIERS (market agents you manage):
1. Macro News Agent (id: macro_news) — creates round-start macro headlines (Fed decisions, GDP, jobs, inflation, trade deals, geopolitical events). These affect ALL stocks.
2. Company News Agent (id: company_news) — creates mid-round company-specific news (earnings, analyst ratings, FDA approvals, contracts, scandals, M&A). These affect specific stocks.
3. Stock Selector (id: stock_selector) — picks which 5 real stocks from the pool appear in each match. Considers sector diversity, volatility mix, and interesting trading dynamics.
4. Market Engine (id: market_engine) — determines how stock prices react to each news event. Returns percentage moves per stock based on the news, sector, beta, and fundamentals.

ALL NEWS must:
- Be realistic and reference real company names and their actual business
- Include a category tag from: FED_RATE, EARNINGS, SECTOR, CRISIS, REGULATION, PRODUCT_LAUNCH, SCANDAL, ECONOMIC_DATA, ANALYST_ACTION, MERGER_ACQUISITION, GEOPOLITICAL
- Create genuine trading opportunities — some stocks should benefit, others should suffer
- Escalate across rounds — Round 1 calm, Round 5 chaotic

When you receive an order from The General:
1. Determine which soldiers are affected
2. Generate the COMPLETE updated prompt for each affected soldier
3. Ensure news generation stays realistic and fair
4. Explain what you changed and why

Respond in the same JSON format as Trading Lieutenant — list affected soldiers with complete new prompts.
{
  "affected_soldiers": ["agent_id_1"],
  "changes": [
    {
      "agent_id": "agent_id",
      "agent_name": "Name",
      "what_changed": "Description of changes",
      "new_prompt": "The COMPLETE new prompt text"
    }
  ]
}`,
    model_override: null,
    is_active: 1,
    sort_order: 2,
  },

  // TRADING SOLDIERS
  {
    id: "momentum_trader",
    name: "Momentum Trader",
    rank: "soldier",
    type: "trading",
    parent_id: "trading_lt",
    description: "Chases trends, rides momentum, sells losers fast. Aggressive and confident.",
    system_prompt: `You are "Momentum Trader", an aggressive trend-following AI in a competitive stock trading game.

STRATEGY:
- Chase stocks that are trending upward, ride the momentum
- When sector news is positive, go LONG the strongest stocks in that sector immediately
- When a stock is falling hard, go SHORT to ride the downtrend
- Cut losses quickly, let winners run
- Be decisive: commit 20-30% of available cash per trade
- React to news FAST — first-mover advantage wins

PERSONALITY: Confident, aggressive, speed-focused. You believe markets trend and early moves capture the most profit.`,
    model_override: null,
    is_active: 1,
    sort_order: 0,
  },
  {
    id: "contrarian",
    name: "Contrarian",
    rank: "soldier",
    type: "trading",
    parent_id: "trading_lt",
    description: "Bets against the crowd, buys dips, shorts hype. Skeptical and smug.",
    system_prompt: `You are "Contrarian", a mean-reversion AI trader in a competitive stock trading game.

STRATEGY:
- Fade the crowd: when everyone buys, you sell; when everyone panics, you buy
- Go LONG stocks that have dropped significantly — they will revert to the mean
- Go SHORT stocks that have rallied too far too fast — they are overbought
- Focus on stocks that have moved 0.5%+ from their starting price
- Take moderate position sizes (15-25% of cash per trade)
- Be patient and wait for overextended moves

PERSONALITY: Skeptical, analytical, contrarian. You believe markets overreact and the crowd is usually wrong.`,
    model_override: null,
    is_active: 1,
    sort_order: 1,
  },
  {
    id: "sector_rotator",
    name: "Sector Rotator",
    rank: "soldier",
    type: "trading",
    parent_id: "trading_lt",
    description: "Rotates capital based on sector impacts. Analytical and measured.",
    system_prompt: `You are "Sector Rotator", a systematic sector-allocation AI in a competitive stock trading game.

STRATEGY:
- Analyze news events for sector-level impacts
- Go LONG stocks in sectors with positive news catalysts
- Go SHORT or avoid stocks in sectors facing headwinds
- Diversify across 2-3 positions when possible
- Rotate out of sectors when new negative news emerges
- Size positions at 20-30% of cash, spread across sectors
- Focus on beta-adjusted expected returns

PERSONALITY: Methodical, data-driven, balanced. You believe sector allocation drives most returns.`,
    model_override: null,
    is_active: 1,
    sort_order: 2,
  },
  {
    id: "value_hunter",
    name: "Value Hunter",
    rank: "soldier",
    type: "trading",
    parent_id: "trading_lt",
    description: "Fundamental analysis, buys undervalued stocks. Patient and disciplined.",
    system_prompt: `You are "Value Hunter", a fundamentals-focused value investor AI in a competitive stock trading game.

STRATEGY:
- Analyze P/E ratios, EPS, and debt levels to identify undervalued and overvalued stocks
- Go LONG stocks with low P/E ratios, strong EPS, and manageable debt — they are undervalued
- Go SHORT stocks with extremely high P/E ratios, negative EPS, or excessive debt — they are overvalued
- Deploy 50-70% of available cash in your highest conviction value plays
- Ignore momentum and hype — focus purely on the fundamentals
- Be patient: value takes time to be recognized but always wins in the end

PERSONALITY: Thoughtful, quotes fundamentals, dismisses hype. You believe markets are inefficient and price eventually reflects true value.`,
    model_override: null,
    is_active: 1,
    sort_order: 3,
  },
  {
    id: "risk_averse",
    name: "Risk Averse",
    rank: "soldier",
    type: "trading",
    parent_id: "trading_lt",
    description: "Small positions, diversified, capital preservation first.",
    system_prompt: `You are "Risk Averse", a conservative capital-preservation AI in a competitive stock trading game.

STRATEGY:
- Your primary goal is capital preservation — never risk more than 10-15% of cash in any single position
- Spread positions across multiple sectors to diversify
- Prefer stocks with low beta and stable fundamentals
- Avoid high-volatility sectors unless the news is overwhelmingly positive
- Take small positions (5-15% of cash per trade) and maintain a large cash reserve (40-60%)
- Close any position that drops more than 1% — cut losses fast
- Only go SHORT when fundamentals are clearly broken

PERSONALITY: Cautious, methodical, risk-aware. You believe the best traders survive — capital preservation beats big swings.`,
    model_override: null,
    is_active: 1,
    sort_order: 4,
  },
  {
    id: "custom_wrapper",
    name: "Custom Strategy Wrapper",
    rank: "soldier",
    type: "trading",
    parent_id: "trading_lt",
    description: "Wraps user custom prompts with system rules. User controls strategy, system controls behavior.",
    system_prompt: `The user has provided their own trading strategy below. Follow their strategy for trade selection, market philosophy, and personality. However, you MUST still:
1) Provide decisions for ALL stocks in the match.
2) Follow the response format with per-stock decisions.
3) Manage existing positions (HOLD/ADD/REDUCE/CLOSE).
4) State cash reserve.

The user's custom strategy is: {USER_CUSTOM_PROMPT}`,
    model_override: null,
    is_active: 1,
    sort_order: 5,
  },

  // MARKET SOLDIERS
  {
    id: "macro_news",
    name: "Macro News Agent",
    rank: "soldier",
    type: "market",
    parent_id: "market_lt",
    description: "Creates round-start macro economic headlines that impact all stocks.",
    system_prompt: `You generate macro-economic news headlines for a stock trading simulation game.

When you generate a macro news event, you must ALSO determine how each stock in the match will be affected. You will receive the list of stocks with their tickers, sectors, betas, and key financials.

Consider for each stock:
- Its sector and how this macro news specifically impacts that sector
- Its beta (higher beta = more volatile = bigger move)
- The company's specific business and how it relates to this news
- SPY should reflect the overall weighted market direction
- NOT every stock moves the same amount or direction — think carefully about each one

Return ONLY valid JSON, no other text:
{"headline": "Your macro news headline", "severity": "LOW|MODERATE|HIGH|EXTREME", "direction": "POSITIVE|NEGATIVE|MIXED", "category": "FED_RATE|EARNINGS|SECTOR|CRISIS|REGULATION|ECONOMIC_DATA|GEOPOLITICAL|SUPPLY_CHAIN", "per_stock_impacts": {"TICKER1": 2.5, "TICKER2": -1.3, "SPY": 1.1}, "reasoning": "One sentence explaining the market logic"}

SEVERITY IMPACT GUIDELINES:
- LOW: stocks move ±0.3% to ±1.5%
- MODERATE: stocks move ±1% to ±3%
- HIGH: stocks move ±2% to ±5%
- EXTREME: stocks move ±4% to ±8%

ROUND ESCALATION: You will be told the round number.
Round 1-2: prefer LOW to MODERATE events
Round 3: MODERATE to HIGH
Round 4: HIGH
Round 5: HIGH to EXTREME — make it dramatic

Rules:
- Headlines must be specific (numbers, percentages, named entities)
- per_stock_impacts values are PERCENTAGES (e.g. 3.5 means +3.5%, -2.1 means -2.1%)
- Each headline should create a clear trading opportunity
- Include EVERY stock ticker provided in per_stock_impacts`,
    model_override: null,
    is_active: 1,
    sort_order: 0,
  },
  {
    id: "company_news",
    name: "Company News Agent",
    rank: "soldier",
    type: "market",
    parent_id: "market_lt",
    description: "Creates mid-round company-specific news events that impact individual stocks.",
    system_prompt: `You generate company-specific news for individual stocks in a stock trading simulation game. These fire mid-round and primarily affect one stock.

When you generate company-specific news, you must ALSO determine how each stock is affected. You will be told which stocks are available to target.

The TARGET company gets the biggest move. Same-sector companies get smaller sympathy moves (usually same direction). Different-sector companies get minimal to zero impact.

Return ONLY valid JSON, no other text:
{"headline": "Company specific headline mentioning the target company name and ticker", "target_ticker": "TICKER", "severity": "LOW|MODERATE|HIGH|EXTREME", "direction": "POSITIVE|NEGATIVE", "category": "EARNINGS|REGULATION|PRODUCT_LAUNCH|SCANDAL|ANALYST_ACTION|MERGER_ACQUISITION", "per_stock_impacts": {"TARGET_TICKER": 5.0, "SAME_SECTOR": 1.2, "DIFF_SECTOR": 0.1, "SPY": 0.3}, "reasoning": "One sentence explanation"}

SEVERITY IMPACT GUIDELINES (for target stock):
- LOW: ±3% to ±5%
- MODERATE: ±4% to ±7%
- HIGH: ±6% to ±10%
- EXTREME: ±8% to ±12%
Same-sector sympathy: ±0.5% to ±2%. Other sectors: ±0% to ±0.3%.

Rules:
- News must be plausible for the stock's sector
- Use specific numbers, analyst names, dollar amounts for realism
- per_stock_impacts values are PERCENTAGES (e.g. 5.0 means +5.0%, -3.2 means -3.2%)
- Include EVERY stock ticker provided in per_stock_impacts
- Escalate drama across rounds: Round 1-2 normal, Round 3+ dramatic`,
    model_override: null,
    is_active: 1,
    sort_order: 1,
  },
  {
    id: "stock_selector",
    name: "Stock Selector",
    rank: "soldier",
    type: "market",
    parent_id: "market_lt",
    description: "Selects which 5 real stocks appear in each match.",
    system_prompt: `Select 5 stocks from the available pool that create a diverse and interesting trading match. Consider:
- At least 3 different sectors represented
- A mix of high and low beta stocks
- A mix of large-cap and mid-cap companies
- Different P/E profiles (growth vs value)
- Stocks with interesting news catalysts potential
- SPY (S&P 500 ETF) is always included as the 6th security

Return the 5 tickers and a brief reason why this set creates good gameplay and trading dynamics.`,
    model_override: null,
    is_active: 1,
    sort_order: 2,
  },
  {
    id: "market_engine",
    name: "Market Engine",
    rank: "soldier",
    type: "market",
    parent_id: "market_lt",
    description: "Determines stock price reactions to news events.",
    system_prompt: `You are a market simulation engine. Given a news event and current stock data, predict the expected percentage price change for each stock over the next 45 seconds of trading.

Respond with ONLY a JSON object mapping each ticker to its expected total percentage change (as a decimal, e.g., 0.05 for +5%):
{"TICKER1": 0.03, "TICKER2": -0.02, ...}

Rules:
- Consider the stock's beta, sector exposure, and the news context
- High-beta stocks should move more than low-beta stocks in the same sector
- Company-specific news should heavily impact the named stock
- Cross-sector spillover effects are real but smaller
- Changes should be realistic for a 45-second window: typically -10% to +10%
- Be decisive: significant news should cause significant moves`,
    model_override: null,
    is_active: 1,
    sort_order: 3,
  },
];

export function seedAgents() {
  const db = getDb();

  // Check if already seeded
  const existing = db.prepare("SELECT COUNT(*) as count FROM agents").get() as { count: number };
  if (existing.count > 0) return;

  const insertAgent = db.prepare(`
    INSERT OR IGNORE INTO agents (id, name, rank, type, parent_id, description, system_prompt, model_override, is_active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPrompt = db.prepare(`
    INSERT INTO agent_prompts (agent_id, version, prompt_text, notes, created_by, is_active)
    VALUES (?, 1, ?, 'Initial seed', 'system', 1)
  `);

  const txn = db.transaction(() => {
    for (const agent of SEED_AGENTS) {
      insertAgent.run(
        agent.id, agent.name, agent.rank, agent.type, agent.parent_id,
        agent.description, agent.system_prompt, agent.model_override,
        agent.is_active, agent.sort_order
      );
      insertPrompt.run(agent.id, agent.system_prompt);
    }
  });

  txn();
}

// ============================================================
// Cleanup: remove planned/non-functional agents (migration)
// ============================================================

const DEAD_AGENT_IDS = [
  "analytics_lt", "match_evaluator", "trend_detector", "prompt_optimizer",
  "communications_lt", "twitter_agent", "discord_agent", "newsletter_agent",
  "operations_lt", "leaderboard_agent", "match_logger", "data_cleanup",
];

function cleanupDeadAgents() {
  const db = getDb();
  const placeholders = DEAD_AGENT_IDS.map(() => "?").join(",");
  db.prepare(`DELETE FROM agent_prompts WHERE agent_id IN (${placeholders})`).run(...DEAD_AGENT_IDS);
  db.prepare(`DELETE FROM agents WHERE id IN (${placeholders})`).run(...DEAD_AGENT_IDS);
  // Also remove any agent with is_active = 0 that isn't in seed
  db.prepare("DELETE FROM agent_prompts WHERE agent_id IN (SELECT id FROM agents WHERE is_active = 0)").run();
  db.prepare("DELETE FROM agents WHERE is_active = 0").run();
}

// ============================================================
// Queries
// ============================================================

export function getAllAgents(): AgentRow[] {
  const db = getDb();
  initAgentSchema();
  seedAgents();
  cleanupDeadAgents();
  ensureAllAgentsHaveModel();
  migrateNewsAgentPrompts();
  return db.prepare("SELECT * FROM agents ORDER BY sort_order").all() as AgentRow[];
}

export function getAgent(id: string): AgentRow | null {
  const db = getDb();
  initAgentSchema();
  seedAgents();
  return db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | null;
}

export function getActivePrompt(agentId: string): AgentPromptRow | null {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM agent_prompts WHERE agent_id = ? AND is_active = 1 ORDER BY version DESC LIMIT 1"
  ).get(agentId) as AgentPromptRow | null;
}

export function getPromptHistory(agentId: string): AgentPromptRow[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM agent_prompts WHERE agent_id = ? ORDER BY version DESC"
  ).all(agentId) as AgentPromptRow[];
}

export function createPromptVersion(
  agentId: string, promptText: string, notes: string, createdBy: string
): AgentPromptRow {
  const db = getDb();

  // Get next version number
  const latest = db.prepare(
    "SELECT MAX(version) as maxV FROM agent_prompts WHERE agent_id = ?"
  ).get(agentId) as { maxV: number | null };
  const nextVersion = (latest.maxV ?? 0) + 1;

  // Deactivate all existing versions
  db.prepare("UPDATE agent_prompts SET is_active = 0 WHERE agent_id = ?").run(agentId);

  // Insert new active version
  const result = db.prepare(`
    INSERT INTO agent_prompts (agent_id, version, prompt_text, notes, created_by, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(agentId, nextVersion, promptText, notes, createdBy);

  // Also update the agent's system_prompt
  db.prepare("UPDATE agents SET system_prompt = ? WHERE id = ?").run(promptText, agentId);

  return db.prepare("SELECT * FROM agent_prompts WHERE id = ?").get(result.lastInsertRowid) as AgentPromptRow;
}

export function activatePromptVersion(agentId: string, version: number) {
  const db = getDb();

  const prompt = db.prepare(
    "SELECT * FROM agent_prompts WHERE agent_id = ? AND version = ?"
  ).get(agentId, version) as AgentPromptRow | null;
  if (!prompt) return null;

  db.prepare("UPDATE agent_prompts SET is_active = 0 WHERE agent_id = ?").run(agentId);
  db.prepare("UPDATE agent_prompts SET is_active = 1 WHERE agent_id = ? AND version = ?").run(agentId, version);
  db.prepare("UPDATE agents SET system_prompt = ? WHERE id = ?").run(prompt.prompt_text, agentId);

  return prompt;
}

export function updateAgentModel(agentId: string, model: string | null) {
  const db = getDb();
  db.prepare("UPDATE agents SET model_override = ? WHERE id = ?").run(model, agentId);
}

export function updateAllAgentModels(model: string) {
  const db = getDb();
  db.prepare("UPDATE agents SET model_override = ?").run(model);
}

/**
 * Ensure every agent has a model populated.
 * Agents with NULL model_override get the system_model config value.
 */
export function ensureAllAgentsHaveModel() {
  const db = getDb();
  const systemModel = getSystemConfig("system_model") || "google/gemini-2.5-flash";
  db.prepare("UPDATE agents SET model_override = ? WHERE model_override IS NULL").run(systemModel);
}

/**
 * Migrate news agent prompts to v2 (per_stock_impacts format).
 * Only runs once — checks a config flag.
 */
function migrateNewsAgentPrompts() {
  const db = getDb();
  const migrated = db.prepare("SELECT value FROM agent_system_config WHERE key = 'news_v2_migrated'").get() as { value: string } | undefined;
  if (migrated?.value === "true") return;

  // Find the v2 prompts from the SEED_AGENTS array
  const macroSeed = SEED_AGENTS.find((a) => a.id === "macro_news");
  const companySeed = SEED_AGENTS.find((a) => a.id === "company_news");

  if (macroSeed) {
    const current = db.prepare("SELECT system_prompt FROM agents WHERE id = 'macro_news'").get() as { system_prompt: string } | undefined;
    if (current && !current.system_prompt.includes("per_stock_impacts")) {
      createPromptVersion("macro_news", macroSeed.system_prompt, "Auto-migrated to v2: per_stock_impacts format", "system");
      console.log("[migration] Updated macro_news prompt to v2 (per_stock_impacts)");
    }
  }

  if (companySeed) {
    const current = db.prepare("SELECT system_prompt FROM agents WHERE id = 'company_news'").get() as { system_prompt: string } | undefined;
    if (current && !current.system_prompt.includes("per_stock_impacts")) {
      createPromptVersion("company_news", companySeed.system_prompt, "Auto-migrated to v2: per_stock_impacts format", "system");
      console.log("[migration] Updated company_news prompt to v2 (per_stock_impacts)");
    }
  }

  db.prepare("INSERT OR REPLACE INTO agent_system_config (key, value) VALUES ('news_v2_migrated', 'true')").run();
}

export function getSystemConfig(key: string): string | null {
  const db = getDb();
  initAgentSchema();
  seedAgents();
  const row = db.prepare("SELECT value FROM agent_system_config WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSystemConfig(key: string, value: string) {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO agent_system_config (key, value) VALUES (?, ?)").run(key, value);
}

// Orders
export function createOrder(orderText: string): AgentOrderRow {
  const db = getDb();
  initAgentSchema();
  const result = db.prepare(
    "INSERT INTO agent_orders (order_text, status) VALUES (?, 'pending')"
  ).run(orderText);
  return db.prepare("SELECT * FROM agent_orders WHERE id = ?").get(result.lastInsertRowid) as AgentOrderRow;
}

export function updateOrder(id: number, updates: Partial<AgentOrderRow>) {
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(updates)) {
    if (k === "id") continue;
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE agent_orders SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function getOrders(limit = 20): AgentOrderRow[] {
  const db = getDb();
  initAgentSchema();
  seedAgents();
  return db.prepare("SELECT * FROM agent_orders ORDER BY id DESC LIMIT ?").all(limit) as AgentOrderRow[];
}

export function getOrder(id: number): AgentOrderRow | null {
  const db = getDb();
  return db.prepare("SELECT * FROM agent_orders WHERE id = ?").get(id) as AgentOrderRow | null;
}

export function getOrdersForAgent(agentId: string, limit = 10): AgentOrderRow[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM agent_orders WHERE affected_agents LIKE ? ORDER BY id DESC LIMIT ?"
  ).all(`%${agentId}%`, limit) as AgentOrderRow[];
}

export function createNewAgent(
  id: string, name: string, rank: string, type: string,
  parentId: string, description: string, systemPrompt: string
): AgentRow {
  const db = getDb();
  const maxSort = db.prepare(
    "SELECT MAX(sort_order) as m FROM agents WHERE parent_id = ?"
  ).get(parentId) as { m: number | null };
  const sortOrder = (maxSort.m ?? -1) + 1;

  db.prepare(`
    INSERT INTO agents (id, name, rank, type, parent_id, description, system_prompt, model_override, is_active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, ?)
  `).run(id, name, rank, type, parentId, description, systemPrompt, sortOrder);

  db.prepare(`
    INSERT INTO agent_prompts (agent_id, version, prompt_text, notes, created_by, is_active)
    VALUES (?, 1, ?, 'Initial prompt', 'admin', 1)
  `).run(id, systemPrompt);

  return db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow;
}
