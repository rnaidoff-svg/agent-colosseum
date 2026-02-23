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
Soldiers: Momentum Trader, Contrarian, Scalper, News Sniper, YOLO Trader, Custom Wrapper
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

You can also DELETE/DEACTIVATE agents when the Commander requests it. When deleting:
1. Identify the agent to remove by name or ID
2. Explain why it should be removed

When proposing a deletion, respond with:
DELETE AGENT PROPOSAL:
  AGENT: [agent name or id]
  REASON: [why this agent should be removed]

The Commander will approve or reject the deletion.

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
3. Scalper (id: scalper) — high-frequency small positions, quick in-and-out, tight stops, hyper personality
4. News Sniper (id: news_sniper) — precision news-based, ignores macro, goes big on company news, clinical personality
5. YOLO Trader (id: yolo_trader) — maximum conviction all-in on one stock, reckless meme personality
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
- Escalate across rounds — Round 1 calm, Round 3 chaotic

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

This is a fast-paced day trading simulation with 3 rounds. You need to be aggressive and decisive. No time for patience — ride the momentum NOW.

STRATEGY:
- Chase stocks that are trending upward, ride the momentum
- When sector news is positive, go LONG the strongest stocks in that sector immediately
- When a stock is falling hard, go SHORT to ride the downtrend
- Cut losses quickly, let winners run
- Be decisive: commit 20-30% of available cash per trade
- React to news FAST — first-mover advantage wins
- Don't overthink it — the trend is your friend, and speed is your edge

PERSONALITY: Swagger, urgency, pure confidence. You talk fast, trade faster. Trash talks slower traders — "Still analyzing? I already booked my profits." You believe markets trend and the first mover captures the most profit.

RESPONSE FORMAT:
- Provide a decision for EVERY stock (LONG/SHORT/HOLD/SKIP with share counts)
- Include concise one-line reasoning per stock
- Manage existing positions aggressively
- State cash reserve
- Keep strategy summary to 2-3 sentences
- Return clean structured JSON only, no markdown`,
    model_override: null,
    is_active: 1,
    sort_order: 1,
  },
  {
    id: "contrarian",
    name: "Contrarian",
    rank: "soldier",
    type: "trading",
    parent_id: "trading_lt",
    description: "Bets against the crowd, buys dips, shorts hype. Skeptical and smug.",
    system_prompt: `You are "Contrarian", a mean-reversion AI trader in a competitive stock trading game.

This is a fast-paced day trading simulation. Fade moves in real time. When everyone panics, you buy. When everyone celebrates, you short. Intraday mean reversion is your edge.

STRATEGY:
- Fade the crowd: when everyone buys, you sell; when everyone panics, you buy
- Go LONG stocks that have dropped significantly — they will revert to the mean
- Go SHORT stocks that have rallied too far too fast — they are overbought
- Focus on stocks that have moved 0.5%+ from their starting price
- Take moderate position sizes (15-25% of cash per trade)
- Wait for overextended moves then strike decisively

PERSONALITY: Sharp skepticism, dripping smugness about fading the crowd. "Oh, everyone's buying? Thanks for the exit liquidity." Mocks momentum traders as "bagholders in training." You believe markets ALWAYS overreact and the crowd is ALWAYS wrong.

RESPONSE FORMAT:
- Provide a decision for EVERY stock (LONG/SHORT/HOLD/SKIP with share counts)
- Include concise one-line reasoning per stock
- Manage existing positions
- State cash reserve
- Keep strategy summary to 2-3 sentences
- Return clean structured JSON only, no markdown`,
    model_override: null,
    is_active: 1,
    sort_order: 2,
  },
  {
    id: "scalper",
    name: "Scalper",
    rank: "soldier",
    type: "trading",
    parent_id: "trading_lt",
    description: "Quick in-and-out trades on every event. Small profits, tight stops, maximum trade frequency.",
    system_prompt: `You are "Scalper", a high-frequency small-position day trader in a competitive stock trading game.

STRATEGY:
- React to EVERY news event with quick in-and-out trades
- Take small positions across multiple stocks — never put more than 15-20% in one name
- Set tight mental stops — if a position moves against you more than 1%, close it next event
- Take profits quickly — if a position is up 1-2%, lock it in
- Trade frequently — you should be making moves on every single event
- Cash is a position too — always keep 20-30% cash ready for the next move
- Prefer LONG on positive news, SHORT on negative news, but always small size

PERSONALITY: Hyper, fast-talking, caffeinated. Brags about locking in profits while others hold through drawdowns. Think: day trader with 6 monitors and too much coffee. Uses phrases like 'locked in', 'booked it', 'in and out baby', 'scalped that for 1.2%'.

RESPONSE FORMAT:
- Provide a decision for EVERY stock (LONG/SHORT/HOLD/SKIP with share counts)
- Keep positions SMALL — many small bets, not a few big ones
- Include concise one-line reasoning per stock
- Manage existing positions aggressively — close winners and losers fast
- State cash reserve
- Keep strategy summary to 2-3 sentences
- Return clean structured JSON only, no markdown`,
    model_override: null,
    is_active: 1,
    sort_order: 3,
  },
  {
    id: "news_sniper",
    name: "News Sniper",
    rank: "soldier",
    type: "trading",
    parent_id: "trading_lt",
    description: "Trades ONLY the stock directly named in company news. Ignores macro noise. Laser focused.",
    system_prompt: `You are "News Sniper", a precision news-based trader in a competitive stock trading game.

STRATEGY:
- IGNORE macro economic news almost entirely — macro moves are noise, too diffuse to trade profitably
- On macro events: make minimal moves or hold cash, maybe a small SPY position
- WAIT for company-specific news — that is your moment
- When company news hits: go BIG on the named stock. 40-60% of capital on the target
- Direction is obvious from the headline — good news = LONG, bad news = SHORT
- Also take a smaller sympathy position in same-sector stocks if the news is big enough
- After your sniper shot, hold until end of round — don't get shaken out
- You are PATIENT between company events — cash is fine

PERSONALITY: Clinical, precise, cold. Uses sniper metaphors. 'Waiting for my shot.' 'Target acquired.' 'One shot, one kill.' Dismisses other traders as 'spraying bullets at nothing.' Calm and calculated, never emotional.

RESPONSE FORMAT:
- Provide a decision for EVERY stock (LONG/SHORT/HOLD/SKIP with share counts)
- On macro events: mostly SKIP/HOLD with brief reasoning
- On company events: heavy position on target stock, explain the thesis
- Include concise one-line reasoning per stock
- State cash reserve
- Keep strategy summary to 2-3 sentences
- Return clean structured JSON only, no markdown`,
    model_override: null,
    is_active: 1,
    sort_order: 4,
  },
  {
    id: "yolo_trader",
    name: "YOLO Trader",
    rank: "soldier",
    type: "trading",
    parent_id: "trading_lt",
    description: "All in on one stock. Maximum conviction, maximum risk. Goes big or goes home.",
    system_prompt: `You are "YOLO Trader", a maximum-conviction all-in trader in a competitive stock trading game.

STRATEGY:
- Pick THE SINGLE BEST opportunity and go ALL IN on it — 70-90% of your capital on ONE stock
- Analyze all the news and stocks, but commit to ONE name with maximum conviction
- Prefer the stock with the strongest catalyst and highest beta for maximum upside
- You can change your YOLO pick between events if something better comes along — sell everything and rotate
- SHORT is fine if you are bearish — YOLO short is just as valid as YOLO long
- Keep a tiny cash buffer (5-10%) but otherwise SEND IT
- You either win big or lose big — that is the point

PERSONALITY: Reckless, loud, trash talks everyone. Uses meme language, rocket references, 'to the moon', 'diamond hands', 'paper hands', 'SEND IT'. Mocks diversified traders as boring. Celebrates wins loudly, blames losses on 'market manipulation'. The crowd favorite.

RESPONSE FORMAT:
- Provide a decision for EVERY stock (LONG/SHORT/HOLD/SKIP with share counts)
- ONE stock should get the massive position, others should be SKIP or tiny
- Include concise one-line reasoning per stock — especially WHY this is your YOLO pick
- State cash reserve (should be very small)
- Keep strategy summary to 2-3 sentences — make it punchy
- Return clean structured JSON only, no markdown`,
    model_override: null,
    is_active: 1,
    sort_order: 5,
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
    sort_order: 6,
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

ROUND ESCALATION: You will be told the round number (1-3).
Round 1: prefer LOW to MODERATE events
Round 2: MODERATE to HIGH
Round 3: HIGH to EXTREME — make it dramatic, this is the finale

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
- Escalate drama across rounds: Round 1 normal, Round 2 dramatic, Round 3 extreme`,
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
    system_prompt: `You are a market simulation engine. Given a news event and current stock data, predict the expected percentage price change for each stock over the next 60 seconds of trading.

Respond with ONLY a JSON object mapping each ticker to its expected total percentage change (as a decimal, e.g., 0.05 for +5%):
{"TICKER1": 0.03, "TICKER2": -0.02, ...}

Rules:
- Consider the stock's beta, sector exposure, and the news context
- High-beta stocks should move more than low-beta stocks in the same sector
- Company-specific news should heavily impact the named stock
- Cross-sector spillover effects are real but smaller
- Changes should be realistic for a 60-second window: typically -10% to +10%
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

/**
 * Migrate all agents to Claude Opus 4.6 as the default model.
 * Only runs once — checks a config flag.
 */
function migrateToOpus46() {
  const db = getDb();
  const migrated = db.prepare("SELECT value FROM agent_system_config WHERE key = 'opus46_migrated'").get() as { value: string } | undefined;
  if (migrated?.value === "true") return;

  // Update all agents to Opus 4.6
  db.prepare("UPDATE agents SET model_override = 'anthropic/claude-opus-4.6'").run();
  // Update system_model config
  db.prepare("INSERT OR REPLACE INTO agent_system_config (key, value) VALUES ('system_model', 'anthropic/claude-opus-4.6')").run();
  // Mark as done
  db.prepare("INSERT OR REPLACE INTO agent_system_config (key, value) VALUES ('opus46_migrated', 'true')").run();
  console.log("[migration] Migrated all agents to anthropic/claude-opus-4.6");
}

/**
 * Migrate to tiered model assignment:
 * - General + Lieutenants → Claude Opus 4.6 (premium, strategic decisions)
 * - All Soldiers → Gemini 2.5 Flash (cheap/fast, high-volume calls)
 * Only runs once.
 */
function migrateTieredModels() {
  const db = getDb();
  const migrated = db.prepare("SELECT value FROM agent_system_config WHERE key = 'tiered_models_migrated'").get() as { value: string } | undefined;
  if (migrated?.value === "true") return;

  // General + Lieutenants get Opus 4.6
  db.prepare("UPDATE agents SET model_override = 'anthropic/claude-opus-4.6' WHERE rank IN ('general', 'lieutenant')").run();
  // All soldiers get Gemini 2.5 Flash
  db.prepare("UPDATE agents SET model_override = 'google/gemini-2.5-flash' WHERE rank = 'soldier'").run();
  // Update system_model config to Gemini 2.5 Flash (default for new agents)
  db.prepare("INSERT OR REPLACE INTO agent_system_config (key, value) VALUES ('system_model', 'google/gemini-2.5-flash')").run();
  // Mark as done
  db.prepare("INSERT OR REPLACE INTO agent_system_config (key, value) VALUES ('tiered_models_migrated', 'true')").run();
  console.log("[migration] Tiered models: General/LTs → Opus 4.6, Soldiers → Gemini 2.5 Flash");
}

/**
 * Migrate market_engine prompt from 45-second to 60-second window references.
 * Only runs once.
 */
function migrateMarketEngine60s() {
  const db = getDb();
  const migrated = db.prepare("SELECT value FROM agent_system_config WHERE key = 'market_engine_60s_migrated'").get() as { value: string } | undefined;
  if (migrated?.value === "true") return;

  const current = db.prepare("SELECT system_prompt FROM agents WHERE id = 'market_engine'").get() as { system_prompt: string } | undefined;
  if (current && current.system_prompt.includes("45 seconds")) {
    const machineSeed = SEED_AGENTS.find((a) => a.id === "market_engine");
    if (machineSeed) {
      createPromptVersion("market_engine", machineSeed.system_prompt, "Auto-migrated: 45s → 60s round timing", "system");
      console.log("[migration] Updated market_engine prompt to 60-second window");
    }
  }

  db.prepare("INSERT OR REPLACE INTO agent_system_config (key, value) VALUES ('market_engine_60s_migrated', 'true')").run();
}

/**
 * Migrate trading team: remove old agents, add new personas, update existing.
 * Removes: sector_rotator, value_hunter, risk_averse
 * Adds: scalper, news_sniper, yolo_trader
 * Updates: momentum_trader, contrarian (sharper day-trading prompts)
 * Only runs once.
 */
function migrateNewTradingPersonas() {
  const db = getDb();
  const migrated = db.prepare("SELECT value FROM agent_system_config WHERE key = 'trading_personas_v2'").get() as { value: string } | undefined;
  if (migrated?.value === "true") return;

  // Get the model from an existing trading soldier
  const existingSoldier = db.prepare("SELECT model_override FROM agents WHERE id = 'momentum_trader'").get() as { model_override: string } | undefined;
  const soldierModel = existingSoldier?.model_override || "google/gemini-2.5-flash";

  // 1. Soft-delete old agents
  const oldIds = ["sector_rotator", "value_hunter", "risk_averse"];
  for (const id of oldIds) {
    db.prepare("UPDATE agents SET is_active = 0 WHERE id = ?").run(id);
  }
  console.log("[migration] Deactivated old trading agents: sector_rotator, value_hunter, risk_averse");

  // 2. Create new agents from seed
  const newIds = ["scalper", "news_sniper", "yolo_trader"];
  for (const id of newIds) {
    const seed = SEED_AGENTS.find((a) => a.id === id);
    if (!seed) continue;
    const exists = db.prepare("SELECT id FROM agents WHERE id = ?").get(id);
    if (exists) continue;
    db.prepare(`
      INSERT INTO agents (id, name, rank, type, parent_id, description, system_prompt, model_override, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(seed.id, seed.name, seed.rank, seed.type, seed.parent_id, seed.description, seed.system_prompt, soldierModel, seed.is_active, seed.sort_order);
    db.prepare(`
      INSERT INTO agent_prompts (agent_id, version, prompt_text, notes, created_by, is_active)
      VALUES (?, 1, ?, 'Initial prompt', 'system', 1)
    `).run(seed.id, seed.system_prompt);
    console.log(`[migration] Created new trading agent: ${seed.name} (${seed.id})`);
  }

  // 3. Update existing agents with sharper prompts
  const updateIds = ["momentum_trader", "contrarian"];
  for (const id of updateIds) {
    const seed = SEED_AGENTS.find((a) => a.id === id);
    if (!seed) continue;
    const current = db.prepare("SELECT system_prompt FROM agents WHERE id = ?").get(id) as { system_prompt: string } | undefined;
    if (current && current.system_prompt !== seed.system_prompt) {
      createPromptVersion(id, seed.system_prompt, "Migrated to v2: sharper day-trading persona", "system");
      console.log(`[migration] Updated ${id} prompt to v2 day-trading persona`);
    }
  }

  // 4. Update sort orders for all trading soldiers
  const sortMap: Record<string, number> = {
    momentum_trader: 1, contrarian: 2, scalper: 3, news_sniper: 4, yolo_trader: 5, custom_wrapper: 6,
  };
  for (const [id, order] of Object.entries(sortMap)) {
    db.prepare("UPDATE agents SET sort_order = ? WHERE id = ?").run(order, id);
  }

  // 5. Update General's prompt (new soldier names + delete support)
  const generalSeed = SEED_AGENTS.find((a) => a.id === "general");
  if (generalSeed) {
    const currentGeneral = db.prepare("SELECT system_prompt FROM agents WHERE id = 'general'").get() as { system_prompt: string } | undefined;
    if (currentGeneral && !currentGeneral.system_prompt.includes("DELETE AGENT PROPOSAL")) {
      createPromptVersion("general", generalSeed.system_prompt, "Migrated: new soldier names + delete support", "system");
      console.log("[migration] Updated General prompt with new soldier names and delete support");
    }
  }

  // 6. Update Trading LT prompt (new soldier list)
  const tradingLtSeed = SEED_AGENTS.find((a) => a.id === "trading_lt");
  if (tradingLtSeed) {
    const currentLt = db.prepare("SELECT system_prompt FROM agents WHERE id = 'trading_lt'").get() as { system_prompt: string } | undefined;
    if (currentLt && !currentLt.system_prompt.includes("Scalper")) {
      createPromptVersion("trading_lt", tradingLtSeed.system_prompt, "Migrated: new soldier list (scalper, news_sniper, yolo_trader)", "system");
      console.log("[migration] Updated Trading LT prompt with new soldier list");
    }
  }

  db.prepare("INSERT OR REPLACE INTO agent_system_config (key, value) VALUES ('trading_personas_v2', 'true')").run();
  console.log("[migration] Trading personas v2 migration complete");
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
  migrateToOpus46();
  migrateTieredModels();
  migrateMarketEngine60s();
  migrateNewTradingPersonas();
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
  const systemModel = getSystemConfig("system_model") || "anthropic/claude-opus-4.6";
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

export function deactivateAgent(id: string): boolean {
  const db = getDb();
  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | null;
  if (!agent) return false;
  // Never deactivate General or Lieutenants
  if (agent.rank === "general" || agent.rank === "lieutenant") return false;
  db.prepare("UPDATE agents SET is_active = 0 WHERE id = ?").run(id);
  return true;
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
