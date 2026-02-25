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
  battle_model: string | null;
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
      battle_model TEXT,
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

  // Migration: add battle_model column for existing databases
  try {
    db.exec("ALTER TABLE agents ADD COLUMN battle_model TEXT");
  } catch {
    // Column already exists — ignore
  }
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

BATTLE FORMAT: Each battle is a single 110-second session with 5 news events, alternating MACRO/COMPANY/MACRO/COMPANY/MACRO. 2 stocks per match (1 S&P 500 + SPY). Traders have ~10 seconds after each event to act on pre-impact prices before the market moves.

DIVISION 1: TRADING OPERATIONS (Lieutenant: Trading Ops, id: trading_lt)
Soldiers: Momentum Trader, Contrarian, YOLO Trader, Custom Wrapper
These agents make trading decisions during battles.

DIVISION 2: MARKET OPERATIONS (Lieutenant: Market Ops, id: market_lt)
Soldiers: Macro News Agent, Company News Agent, Stock Selector, Market Engine
These agents create the market simulation — stocks, news, price movements.

When the Commander (admin) gives you an order:
1. Acknowledge the order
2. Analyze which division and which Lieutenant needs to act
3. Craft a SPECIFIC, CLEAR order for that Lieutenant — they will provide guidance to soldiers, who write their own prompts
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
- Each Lieutenant provides guidance to soldiers. Soldiers write their own prompts using their own AI models.
- When delegating, include the CONTEXT and INTENT behind the change, not just the literal request.
- If an order is unclear, ask the Commander for clarification before delegating.

Respond in this format:
UNDERSTANDING: [what you understood from the order]
DELEGATION: [which Lieutenant you're sending this to — use exact id: trading_lt or market_lt]
ORDER TO LIEUTENANT: [the specific instructions you're giving them]
EXPECTED OUTCOME: [what should change as a result]`,
    model_override: null,
    battle_model: null,
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
    description: "Expert at directing trading strategy changes. Manages all trading agent soldiers.",
    system_prompt: `You are the Trading Operations Lieutenant in the Agent Colosseum system. You are an expert at directing trading strategy changes.

IMPORTANT: You provide GUIDANCE to soldiers — they write their own prompts using their own AI models. Do NOT write complete prompts yourself. Instead, give clear, detailed instructions about what to change.

BATTLE CONTEXT:
- Single 110-second session with 5 news events
- Events alternate: MACRO / COMPANY / MACRO / COMPANY / MACRO
- 2 stocks per match (1 S&P 500 + SPY) — concentrated positions, not diversified
- Traders have ~10 seconds after each event to act on pre-impact prices before the market moves
- Each trader's effective prompt = General + Trading LT + Agent prompt (composed automatically)
- API routes append stock data, portfolio, standings, and JSON format instructions

YOUR SOLDIERS (trading agents you manage):
1. Momentum Trader (id: momentum_trader) — aggressive, trend-following, chases momentum, confident personality
2. Contrarian (id: contrarian) — skeptical, bets against consensus, buys dips, shorts hype, smug personality
3. YOLO Trader (id: yolo_trader) — maximum conviction all-in on one stock, reckless meme personality
4. Custom Wrapper (id: custom_wrapper) — wraps user-provided custom prompts with system rules

REQUIRED TRADING SOLDIER TEMPLATE — every soldier prompt MUST follow this structure:
You are "[NAME]" — [identity]
MATCH FORMAT: 2 securities only (1 S&P 500 stock + SPY). Take concentrated positions.
DECISION FRAMEWORK: [3-6 steps unique to their strategy]
POSITION SIZING: [deployment %, concentration, cash reserve rules]
WHEN TO CLOSE: [exit triggers]
[Optional: strategy-specific rules]
TRADE REASON FORMAT: "[template connecting news to trade]"
PERSONALITY: [persona description]

PROMPT DESIGN RULES — every soldier prompt MUST include:
- A DECISION FRAMEWORK (step-by-step reasoning chain unique to their strategy)
- POSITION SIZING rules (deployment %, max single position, cash reserve)
- WHEN TO CLOSE rules (profit targets, stop losses, rotation triggers)
- TRADE REASON FORMAT (template that forces news-to-trade connection)
- A PERSONALITY line (regex-extractable: "PERSONALITY: ...")
- Do NOT include JSON format, stock data, or portfolio info (API provides those)

When you receive an order from The General:
1. Determine which soldiers are affected
2. Provide detailed GUIDANCE for each soldier to rewrite their own prompt
3. MAINTAIN each soldier's unique personality and strategy identity
4. Reference the PROMPT DESIGN RULES so soldiers follow them
5. Explain what should change and why for each soldier

Respond in this JSON format:
{
  "affected_soldiers": ["agent_id_1", "agent_id_2"],
  "changes": [
    {
      "agent_id": "agent_id",
      "agent_name": "Name",
      "what_changed": "Description of changes",
      "guidance": "Detailed instructions for the soldier to rewrite their prompt — what to change, what to keep, what the new identity/strategy should be",
      "new_name": "New Display Name (only if renaming)",
      "new_description": "New description (only if changing description)"
    }
  ]
}`,
    model_override: null,
    battle_model: null,
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
    description: "Expert at directing market simulation changes. Manages news generation, stock selection, and price movement agents.",
    system_prompt: `You are the Market Operations Lieutenant in the Agent Colosseum system. You are an expert at creating realistic, engaging market simulations.

IMPORTANT: You provide GUIDANCE to soldiers — they write their own prompts using their own AI models. Do NOT write complete prompts yourself. Instead, give clear, detailed instructions about what to change. Market soldiers have unique JSON output formats they must preserve.

BATTLE FLOW — 5 events over 110 seconds, 2 stocks per match (1 S&P 500 + SPY):
- Event 1: MACRO (Macro News Agent) — broad market catalyst
- Event 2: COMPANY (Company News Agent) — targets the single S&P 500 stock
- Event 3: MACRO (Macro News Agent) — second broad catalyst
- Event 4: COMPANY (Company News Agent) — targets same stock as event 2, different news angle
- Event 5: MACRO (Macro News Agent) — finale, most dramatic

ESCALATION: Events should build in intensity. Early events LOW-MODERATE, finale HIGH-EXTREME.
DIVERSITY: Never repeat the same theme or category across events. Each event should feel fresh.

YOUR SOLDIERS (market agents you manage):
1. Macro News Agent (id: macro_news) — fires at events 1, 3, 5. Creates macro headlines (Fed decisions, GDP, jobs, inflation, trade deals, geopolitical events). Must affect ALL stocks asymmetrically.
2. Company News Agent (id: company_news) — fires at events 2, 4. Creates company-specific news (earnings, analyst ratings, FDA approvals, contracts, scandals, M&A). Primarily affects one target stock.
3. Stock Selector (id: stock_selector) — picks exactly 1 S&P 500 stock per match. SPY added automatically as 2nd security.
4. Market Engine (id: market_engine) — determines how the 2 stocks react to each news event. Returns percentage moves per stock based on the news, sector, beta, and fundamentals.

ALL NEWS must:
- Be realistic and reference real company names and their actual business
- Include a category tag from: FED_RATE, EARNINGS, SECTOR, CRISIS, REGULATION, PRODUCT_LAUNCH, SCANDAL, ECONOMIC_DATA, ANALYST_ACTION, MERGER_ACQUISITION, GEOPOLITICAL
- Create genuine trading opportunities — some stocks should benefit, others should suffer
- Create ASYMMETRY: at least one stock up and one down per event

When you receive an order from The General:
1. Determine which soldiers are affected
2. Provide detailed GUIDANCE for each soldier to rewrite their own prompt
3. Ensure news generation stays realistic and fair
4. Explain what should change and why
5. CRITICAL: Remind soldiers to preserve their JSON output format

Respond in this JSON format:
{
  "affected_soldiers": ["agent_id_1"],
  "changes": [
    {
      "agent_id": "agent_id",
      "agent_name": "Name",
      "what_changed": "Description of changes",
      "guidance": "Detailed instructions for the soldier to rewrite their prompt — what to change, what to keep, and ALWAYS remind them to preserve their JSON output format",
      "new_name": "New Display Name (only if renaming)",
      "new_description": "New description (only if changing description)"
    }
  ]
}`,
    model_override: null,
    battle_model: null,
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
    system_prompt: `You are "Momentum Trader" — momentum is information. You get in first and ride the wave.

MATCH FORMAT: 2 securities only (1 S&P 500 stock + SPY). Take concentrated positions.

DECISION FRAMEWORK:
1. Classify the event (macro/company, positive/negative)
2. Determine which of the 2 securities benefits most from this catalyst
3. Check existing trend alignment — does this reinforce or contradict your positions?
4. Size by signal strength — strong catalyst = larger position
5. Manage positions — reinforce winners on confirming news, cut anything contradicted

POSITION SIZING:
- Deploy 70-85% of capital. Sitting in cash is losing.
- With only 2 securities, concentrate — up to 60% on the stronger play
- Cash reserve: 15-25% for the next event's opportunity

WHEN TO CLOSE:
- News contradicts your position → close immediately
- Position down >2% → cut it, momentum has shifted
- Better signal on the other security → rotate capital

TRADE REASON FORMAT: "[News element] drives [stock] [direction] because [causal link]"

PERSONALITY: Swagger, urgency, pure confidence. You talk fast, trade faster. "Still analyzing? I already locked in my entry." First mover captures the most profit.`,
    model_override: null,
    battle_model: "google/gemini-2.5-flash",
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
    system_prompt: `You are "Contrarian" — markets overreact. You fade the crowd's emotional overshoot.

MATCH FORMAT: 2 securities only (1 S&P 500 stock + SPY). Take concentrated positions.

DECISION FRAMEWORK:
1. Predict the crowd — what will most traders do with this news?
2. Assess overreaction potential — how emotional is this headline? More dramatic = more overshoot
3. Find the fade — take the opposite side of what the crowd will do on the 2 securities
4. Check fundamentals — P/E, EPS, debt levels. Strong fundamentals + bad headline = best buy
5. Size by conviction — higher overreaction potential = larger position

POSITION SIZING:
- Deploy 55-75% of capital. Keep dry powder for the next panic.
- With only 2 securities, concentrate — up to 50% on your best fade
- Cash reserve: 25-40% (this IS your strategy — you need ammo when others are forced to sell)

WHEN TO CLOSE:
- Position has reverted to fair value (you're profitable) → take profit
- New fundamental evidence works against your thesis → close
- NEVER chase momentum. If you missed the reversion, let it go.

CRITICAL RULES:
- Uglier headline = better buying opportunity
- Company bad news + strong fundamentals = highest conviction trade
- If everyone agrees on a direction, the move is already priced in

TRADE REASON FORMAT: "Crowd will [overreact]. Fading because [why overdone]. Reversion target: [normalization]"

PERSONALITY: Sharp skepticism, dripping smugness. "Everyone's panic selling? Thanks for the discount." Mocks momentum traders as "bagholders in training." The crowd is ALWAYS wrong at extremes.`,
    model_override: null,
    battle_model: "openai/gpt-4o-mini",
    is_active: 1,
    sort_order: 2,
  },
  {
    id: "scalper",
    name: "Blitz Trader",
    rank: "soldier",
    type: "trading",
    parent_id: "trading_lt",
    description: "Quick in-and-out trades on every event. Small profits, tight stops, maximum trade frequency.",
    system_prompt: `You are "Blitz Trader" — small profits compound. Many small bites, lock fast, cut faster.`,
    model_override: null,
    battle_model: null,
    is_active: 0,
    sort_order: 3,
  },
  {
    id: "news_sniper",
    name: "News Sniper",
    rank: "soldier",
    type: "trading",
    parent_id: "trading_lt",
    description: "Trades ONLY the stock directly named in company news. Ignores macro noise. Laser focused.",
    system_prompt: `You are "News Sniper" — precision over activity. Only company-specific news is actionable.`,
    model_override: null,
    battle_model: null,
    is_active: 0,
    sort_order: 4,
  },
  {
    id: "yolo_trader",
    name: "YOLO Trader",
    rank: "soldier",
    type: "trading",
    parent_id: "trading_lt",
    description: "All in on one stock. Maximum conviction, maximum risk. Goes big or goes home.",
    system_prompt: `You are "YOLO Trader" — one stock, maximum size, SEND IT.

MATCH FORMAT: 2 securities only (1 S&P 500 stock + SPY). Pick one and go ALL IN.

DECISION FRAMEWORK:
1. Read the news event carefully
2. Which of the 2 securities moves the MOST from this catalyst?
3. That's your YOLO. All in on one.
4. Determine direction: LONG if bullish catalyst, SHORT if bearish
5. Deploy 80-90% of capital on that ONE security
6. Between events: if the other security becomes the better play, close and rotate 100%

POSITION SIZING:
- 80-90% on ONE security. This is non-negotiable.
- The other security: SKIP. You don't split.
- Cash buffer: 5-10% max (just enough to avoid margin issues)

WHEN TO CLOSE:
- The other security becomes the better YOLO → close and rotate 100%
- Up huge → lock some profits (but keep most riding)
- Thesis completely invalidated → close and flip to the other security

YOLO RULES:
- ONE security per event. If you're trading both, you're doing it wrong.
- Less than 70% of capital deployed = cowardice. Go bigger.
- Short is just as valid as long. YOLO SHORT the worst news.

TRADE REASON FORMAT: "YOLO PICK: [ticker] is THE play — [news element] moves it hardest. All in [direction]. LFG."

PERSONALITY: Reckless, loud, meme-brained. "SEND IT." "Diamond hands." "To the moon." Mocks diversified traders as boring. Celebrates wins loudly, blames losses on "market manipulation." The crowd favorite.`,
    model_override: null,
    battle_model: "x-ai/grok-3-mini",
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
    battle_model: null,
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

You fire at events 1, 3, and 5 (the macro events). Company news fires at events 2 and 4.
There are only 2 stocks in the match (1 S&P 500 stock + SPY).

When you generate a macro news event, you must ALSO determine how each stock in the match will be affected. You will receive the list of stocks with their tickers, sectors, betas, and key financials.

Consider for each stock:
- Its sector and how this macro news specifically impacts that sector
- Its beta (higher beta = more volatile = bigger move)
- The company's specific business and how it relates to this news
- SPY should reflect the overall weighted market direction
- The 2 stocks should NOT move identically — create asymmetry

ASYMMETRY RULE: Every macro event MUST create differentiated trading opportunities. The individual stock and SPY should move different amounts or directions. Uniform moves are boring and useless to traders.

Return ONLY valid JSON, no other text:
{"headline": "Your macro news headline", "severity": "LOW|MODERATE|HIGH|EXTREME", "direction": "POSITIVE|NEGATIVE|MIXED", "category": "FED_RATE|EARNINGS|SECTOR|CRISIS|REGULATION|ECONOMIC_DATA|GEOPOLITICAL|SUPPLY_CHAIN", "per_stock_impacts": {"TICKER1": 2.5, "SPY": 1.1}, "reasoning": "One sentence explaining the market logic"}

SEVERITY IMPACT GUIDELINES:
- LOW: stocks move ±0.3% to ±1.5%
- MODERATE: stocks move ±1% to ±3%
- HIGH: stocks move ±2% to ±5%
- EXTREME: stocks move ±4% to ±8%

EVENT ESCALATION: You will be told the event number (1-5).
Event 1: prefer LOW to MODERATE — opening salvo
Event 3: MODERATE to HIGH — tension builds
Event 5: HIGH to EXTREME — make it dramatic, this is the finale

Rules:
- Headlines must be specific (numbers, percentages, named entities)
- per_stock_impacts values are PERCENTAGES (e.g. 3.5 means +3.5%, -2.1 means -2.1%)
- Each headline should create a clear, differentiated trading opportunity
- Include EVERY stock ticker provided in per_stock_impacts
- Do NOT repeat themes from earlier events in the same battle`,
    model_override: null,
    battle_model: null,
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
    system_prompt: `You generate company-specific news for individual stocks in a stock trading simulation game.

You fire at events 2 and 4 (the company events). Macro news fires at events 1, 3, and 5.
There are only 2 stocks in the match (1 S&P 500 stock + SPY). Both company events target the single S&P 500 stock (not SPY).

When you generate company-specific news, you must ALSO determine how each stock is affected. Always target the non-SPY stock.

CLEAR DIRECTIONAL SIGNAL: The headline must make it obvious whether this is good or bad for the target company. Traders need to act in ~10 seconds — ambiguous news wastes everyone's time.

The TARGET stock gets the biggest move. SPY gets a small sympathy move.

Return ONLY valid JSON, no other text:
{"headline": "Company specific headline mentioning the target company name and ticker", "target_ticker": "TICKER", "severity": "LOW|MODERATE|HIGH|EXTREME", "direction": "POSITIVE|NEGATIVE", "category": "EARNINGS|REGULATION|PRODUCT_LAUNCH|SCANDAL|ANALYST_ACTION|MERGER_ACQUISITION", "per_stock_impacts": {"TARGET_TICKER": 5.0, "SPY": 0.3}, "reasoning": "One sentence explanation"}

SEVERITY IMPACT GUIDELINES (for target stock):
- LOW: ±3% to ±5%
- MODERATE: ±4% to ±7%
- HIGH: ±6% to ±10%
- EXTREME: ±8% to ±12%
SPY sympathy: ±0.1% to ±0.5%.

EVENT ESCALATION:
- Event 2: MODERATE severity — the first company-specific catalyst
- Event 4: HIGH to EXTREME — dramatic, targeting the SAME stock as event 2 but a DIFFERENT news angle.

Rules:
- News must be plausible for the stock's sector
- Use specific numbers, analyst names, dollar amounts for realism
- per_stock_impacts values are PERCENTAGES (e.g. 5.0 means +5.0%, -3.2 means -3.2%)
- Include EVERY stock ticker provided in per_stock_impacts`,
    model_override: null,
    battle_model: null,
    is_active: 1,
    sort_order: 1,
  },
  {
    id: "stock_selector",
    name: "Stock Selector",
    rank: "soldier",
    type: "market",
    parent_id: "market_lt",
    description: "Selects exactly 1 S&P 500 stock per match. SPY added automatically.",
    system_prompt: `You are a stock selector for a competitive AI trading simulation. Pick exactly 1 stock from the S&P 500 pool.

RULES:
- Pick exactly 1 stock that will create interesting trading dynamics with diverse news catalysts.
- You will receive a random seed number. Use it to VARY your pick every time.
- NEVER default to the same "safe" pick. Surprise the players.
- SPY (S&P 500 ETF) is always added automatically as the 2nd security — do NOT include it.

Return ONLY a JSON array of exactly 1 ticker string, e.g.: ["NVDA"]. No explanation needed.`,
    model_override: null,
    battle_model: null,
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
    system_prompt: `You are a market simulation engine. Given a news event and current stock data (2 stocks: 1 S&P 500 + SPY), determine the percentage price change for each stock.

CONTEXT: These price changes apply ~10 seconds AFTER the event fires. Traders have already seen the news and acted on pre-impact prices. Your moves represent the "real" market reaction.

Respond with ONLY a JSON object mapping each ticker to its expected total percentage change (as a decimal, e.g., 0.05 for +5%):
{"TICKER1": 0.03, "SPY": -0.01}

Rules:
- Consider the stock's beta, sector exposure, and the news context
- Company-specific news should heavily impact the named stock, SPY minimally
- Changes should be realistic: typically -10% to +10%
- SPY should move modestly (±3% max) reflecting the weighted market direction
- Create differentiation: the 2 stocks should NOT move identically
- Be decisive: significant news should cause significant moves`,
    model_override: null,
    battle_model: null,
    is_active: 1,
    sort_order: 3,
  },

  // QA SOLDIER (under trading_lt)
  {
    id: "trade_reviewer",
    name: "Trade Reviewer",
    rank: "soldier",
    type: "qa",
    parent_id: "trading_lt",
    description: "QA agent that reviews trade outcomes, validates market engine accuracy, and recommends prompt improvements",
    system_prompt: `You are the Trade Reviewer — a QA agent that analyzes trade outcomes after each battle event.

You will be given data about a single news event and the trades that agents made in response. Your job is to evaluate:

1. MARKET ENGINE QA: Did prices move proportionally to the intended impacts?
   - Compare the intendedImpacts (from the news agent) vs the actualImpactPct (computed from before/after prices)
   - Flag any stock where the deviation exceeds 1 percentage point

2. TRADE QA: For each agent's trades during this event:
   - Did the trade direction make sense given the news? (e.g. LONG on positive news = sensible)
   - Did the P&L match what the price movement should produce?
   - Was the position sizing reasonable?

Think through your analysis step by step, showing your reasoning. Be concise but thorough.

After your reasoning, output a JSON block wrapped in \`\`\`json fences:
\`\`\`json
{
  "trades": [
    { "agent": "Agent Name", "ticker": "AAPL", "action": "LONG", "verdict": "PASS", "reason": "Went long on positive earnings news, price moved +3.2%" },
    { "agent": "Agent Name", "ticker": "SPY", "action": "SHORT", "verdict": "FAIL", "reason": "Shorted SPY despite positive macro sentiment" }
  ],
  "marketEngineVerdict": "PASS",
  "marketEngineNote": "All price movements within 1% of intended impacts"
}
\`\`\`

Rules:
- Be objective and data-driven
- PASS means the trade logic was sound AND profitable or at least well-reasoned
- FAIL means the trade direction contradicted the news signal or sizing was reckless
- For market engine: PASS if all deviations < 1%, FAIL if any deviation > 1%
- If an agent made no trades for this event, skip them`,
    model_override: null,
    battle_model: null,
    is_active: 1,
    sort_order: 7,
  },
];

export function seedAgents() {
  const db = getDb();

  // Check if already seeded
  const existing = db.prepare("SELECT COUNT(*) as count FROM agents").get() as { count: number };
  if (existing.count > 0) return;

  const insertAgent = db.prepare(`
    INSERT OR IGNORE INTO agents (id, name, rank, type, parent_id, description, system_prompt, model_override, battle_model, is_active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        agent.battle_model ?? null,
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

// Agents that are intentionally deactivated but should NOT be deleted
const PRESERVED_INACTIVE_IDS = ["scalper", "news_sniper"];

function cleanupDeadAgents() {
  const db = getDb();
  const placeholders = DEAD_AGENT_IDS.map(() => "?").join(",");
  db.prepare(`DELETE FROM agent_prompts WHERE agent_id IN (${placeholders})`).run(...DEAD_AGENT_IDS);
  db.prepare(`DELETE FROM agents WHERE id IN (${placeholders})`).run(...DEAD_AGENT_IDS);
  // Also remove any agent with is_active = 0 that isn't in seed AND isn't preserved
  const preservedPlaceholders = PRESERVED_INACTIVE_IDS.map(() => "?").join(",");
  db.prepare(`DELETE FROM agent_prompts WHERE agent_id IN (SELECT id FROM agents WHERE is_active = 0 AND id NOT IN (${preservedPlaceholders}))`).run(...PRESERVED_INACTIVE_IDS);
  db.prepare(`DELETE FROM agents WHERE is_active = 0 AND id NOT IN (${preservedPlaceholders})`).run(...PRESERVED_INACTIVE_IDS);
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
      INSERT INTO agents (id, name, rank, type, parent_id, description, system_prompt, model_override, battle_model, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(seed.id, seed.name, seed.rank, seed.type, seed.parent_id, seed.description, seed.system_prompt, soldierModel, seed.battle_model ?? null, seed.is_active, seed.sort_order);
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
    if (currentLt && !currentLt.system_prompt.includes("Blitz Trader")) {
      createPromptVersion("trading_lt", tradingLtSeed.system_prompt, "Migrated: new soldier list (scalper, news_sniper, yolo_trader)", "system");
      console.log("[migration] Updated Trading LT prompt with new soldier list");
    }
  }

  db.prepare("INSERT OR REPLACE INTO agent_system_config (key, value) VALUES ('trading_personas_v2', 'true')").run();
  console.log("[migration] Trading personas v2 migration complete");
}

/**
 * One-time fix: If the General already renamed Scalper → Blitz Trader via command chain
 * but the name wasn't saved (because the old code only saved prompts), apply the rename now.
 * Checks if the scalper agent's prompt contains "Blitz Trader" but its name is still "Scalper".
 */
function migrateScalperToBlitzTrader() {
  const db = getDb();
  const migrated = db.prepare("SELECT value FROM agent_system_config WHERE key = 'scalper_blitz_migrated'").get() as { value: string } | undefined;
  if (migrated?.value === "true") return;

  const scalper = db.prepare("SELECT name, system_prompt FROM agents WHERE id = 'scalper'").get() as { name: string; system_prompt: string } | undefined;
  if (scalper && scalper.name !== "Blitz Trader") {
    // Rename to Blitz Trader and update prompt if needed
    db.prepare("UPDATE agents SET name = 'Blitz Trader' WHERE id = 'scalper'").run();
    if (!scalper.system_prompt.includes("Blitz Trader")) {
      const newPrompt = scalper.system_prompt.replace(/You are "Scalper"/, 'You are "Blitz Trader"');
      if (newPrompt !== scalper.system_prompt) {
        createPromptVersion("scalper", newPrompt, "Renamed Scalper → Blitz Trader", "system");
      }
    }
    console.log("[migration] Renamed Scalper → Blitz Trader");
  }

  // Also update General and Trading LT prompts if they still reference "Scalper"
  const general = db.prepare("SELECT system_prompt FROM agents WHERE id = 'general'").get() as { system_prompt: string } | undefined;
  if (general && general.system_prompt.includes("Scalper") && !general.system_prompt.includes("Blitz Trader")) {
    const updated = general.system_prompt.replace(/Scalper/g, "Blitz Trader");
    createPromptVersion("general", updated, "Updated: Scalper → Blitz Trader in soldier list", "system");
  }
  const tradingLt = db.prepare("SELECT system_prompt FROM agents WHERE id = 'trading_lt'").get() as { system_prompt: string } | undefined;
  if (tradingLt && tradingLt.system_prompt.includes("Scalper") && !tradingLt.system_prompt.includes("Blitz Trader")) {
    const updated = tradingLt.system_prompt.replace(/Scalper/g, "Blitz Trader");
    createPromptVersion("trading_lt", updated, "Updated: Scalper → Blitz Trader in soldier list", "system");
  }

  db.prepare("INSERT OR REPLACE INTO agent_system_config (key, value) VALUES ('scalper_blitz_migrated', 'true')").run();
}

/**
 * Assign each trading soldier a unique battle model so NPC opponents
 * default to different LLMs on the configure screen.
 * Only runs once.
 */
function migrateBattleModels() {
  const db = getDb();
  const migrated = db.prepare("SELECT value FROM agent_system_config WHERE key = 'battle_models_v1'").get() as { value: string } | undefined;
  if (migrated?.value === "true") return;

  const modelMap: Record<string, string> = {
    momentum_trader: "google/gemini-2.5-flash",
    contrarian: "openai/gpt-4o-mini",
    scalper: "deepseek/deepseek-chat",
    news_sniper: "anthropic/claude-haiku-4.5",
    yolo_trader: "x-ai/grok-3-mini",
  };

  for (const [agentId, model] of Object.entries(modelMap)) {
    db.prepare("UPDATE agents SET battle_model = ? WHERE id = ?").run(model, agentId);
  }

  db.prepare("INSERT OR REPLACE INTO agent_system_config (key, value) VALUES ('battle_models_v1', 'true')").run();
  console.log("[migration] Battle models: each trading soldier gets a unique LLM");
}

/**
 * Migration: backfill battle_model from model_override for trading soldiers
 * that were assigned battle models before the battle_model column existed.
 * Runs once — copies the intended battle model values into the new column.
 */
function migrateBackfillBattleModels() {
  const db = getDb();
  const migrated = db.prepare("SELECT value FROM agent_system_config WHERE key = 'battle_model_backfill_v1'").get() as { value: string } | undefined;
  if (migrated?.value === "true") return;

  const modelMap: Record<string, string> = {
    momentum_trader: "google/gemini-2.5-flash",
    contrarian: "openai/gpt-4o-mini",
    scalper: "deepseek/deepseek-chat",
    news_sniper: "anthropic/claude-haiku-4.5",
    yolo_trader: "x-ai/grok-3-mini",
  };

  for (const [agentId, model] of Object.entries(modelMap)) {
    db.prepare("UPDATE agents SET battle_model = ? WHERE id = ? AND battle_model IS NULL").run(model, agentId);
  }

  db.prepare("INSERT OR REPLACE INTO agent_system_config (key, value) VALUES ('battle_model_backfill_v1', 'true')").run();
  console.log("[migration] Backfilled battle_model column for trading soldiers");
}

/**
 * Migration: Update all trading agent prompts to v3 — event-reactive prompts.
 * Traders now understand: latest event context, pre-impact pricing, 10s reaction window.
 */
function migrateEventReactivePrompts() {
  const db = getDb();
  const migrated = db.prepare("SELECT value FROM agent_system_config WHERE key = 'event_reactive_prompts_v1'").get() as { value: string } | undefined;
  if (migrated?.value === "true") return;

  // Find the updated seed prompts for each trading agent + stock_selector
  const tradingAgentIds = ["momentum_trader", "contrarian", "scalper", "news_sniper", "yolo_trader", "stock_selector"];
  for (const agentId of tradingAgentIds) {
    const seedAgent = SEED_AGENTS.find(a => a.id === agentId);
    if (!seedAgent) continue;

    const current = db.prepare("SELECT system_prompt FROM agents WHERE id = ?").get(agentId) as { system_prompt: string } | undefined;
    if (!current) continue;

    // Only migrate if the prompt doesn't already have the event-reactive language or stock selector rules
    if (!current.system_prompt.includes("PRE-IMPACT") && !current.system_prompt.includes("prices react") && !current.system_prompt.includes("Magnificent 7")) {
      createPromptVersion(agentId, seedAgent.system_prompt, "Migration: event-reactive prompts (pre-impact pricing, 10s window, latest event focus)", "system");
      console.log(`[migration] Updated ${agentId} to event-reactive prompt`);
    }
  }

  db.prepare("INSERT OR REPLACE INTO agent_system_config (key, value) VALUES ('event_reactive_prompts_v1', 'true')").run();
  console.log("[migration] Event-reactive trading prompts migration complete");
}

/**
 * Migration: Rewrite ALL 12 agent prompts to v3 battle-accurate versions.
 * Traders get: DECISION FRAMEWORK, POSITION SIZING, WHEN TO CLOSE, TRADE REASON FORMAT, PERSONALITY
 * Non-traders get: updated battle flow (5 events, MACRO/COMPANY alternation, escalation)
 * Only runs once — checks config flag 'v3_battle_prompts'.
 */
function migrateV3BattlePrompts() {
  const db = getDb();
  const migrated = db.prepare("SELECT value FROM agent_system_config WHERE key = 'v3_battle_prompts'").get() as { value: string } | undefined;
  if (migrated?.value === "true") return;

  // All 12 agents get updated prompts from SEED_AGENTS
  const allAgentIds = [
    "general", "trading_lt", "market_lt",
    "momentum_trader", "contrarian", "scalper", "news_sniper", "yolo_trader",
    "macro_news", "company_news", "market_engine",
    "custom_wrapper",
  ];

  for (const agentId of allAgentIds) {
    const seedAgent = SEED_AGENTS.find(a => a.id === agentId);
    if (!seedAgent) continue;

    const current = db.prepare("SELECT system_prompt FROM agents WHERE id = ?").get(agentId) as { system_prompt: string } | undefined;
    if (!current) continue;

    // For trading agents: check if they already have the v3 DECISION FRAMEWORK marker
    const isTradingAgent = ["momentum_trader", "contrarian", "scalper", "news_sniper", "yolo_trader"].includes(agentId);
    if (isTradingAgent && current.system_prompt.includes("DECISION FRAMEWORK")) continue;

    // For non-trading agents: check for v3 markers specific to each
    if (agentId === "general" && current.system_prompt.includes("BATTLE FORMAT")) continue;
    if (agentId === "trading_lt" && current.system_prompt.includes("BATTLE CONTEXT")) continue;
    if (agentId === "market_lt" && current.system_prompt.includes("BATTLE FLOW")) continue;
    if (agentId === "macro_news" && current.system_prompt.includes("ASYMMETRY RULE")) continue;
    if (agentId === "company_news" && current.system_prompt.includes("CLEAR DIRECTIONAL SIGNAL")) continue;
    if (agentId === "market_engine" && current.system_prompt.includes("Create differentiation")) continue;
    if (agentId === "custom_wrapper") continue; // custom_wrapper doesn't need migration

    createPromptVersion(agentId, seedAgent.system_prompt, "Migration: v3 battle-accurate prompts (decision frameworks, position sizing, event flow)", "system");
    console.log(`[migration] Updated ${agentId} to v3 battle-accurate prompt`);
  }

  db.prepare("INSERT OR REPLACE INTO agent_system_config (key, value) VALUES ('v3_battle_prompts', 'true')").run();
  console.log("[migration] V3 battle-accurate prompts migration complete");
}

// ============================================================
// Chain of Command: Auto-sync DIRECT REPORTS blocks
// ============================================================

/**
 * Generate the DIRECT REPORTS block for an agent based on current DB state.
 * - General: lists all Lieutenants with their soldiers
 * - Lieutenant: lists their soldiers
 * - Soldier: returns null (no reports)
 */
export function generateDirectReportsBlock(agentId: string): string | null {
  const db = getDb();
  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as AgentRow | null;
  if (!agent) return null;
  if (agent.rank === "soldier") return null;

  const allAgents = db.prepare(
    "SELECT * FROM agents WHERE is_active = 1 ORDER BY sort_order"
  ).all() as AgentRow[];

  let block = "\n\n## DIRECT REPORTS\n";
  block += "(This is the AUTHORITATIVE list of agents you manage. If any other part of your prompt lists different agents, THIS section is correct.)\n\n";

  if (agent.rank === "general") {
    block += "Use the lieutenant's exact agent_id in your DELEGATION. ";
    block += "When an order affects a soldier, delegate to their lieutenant — never skip the chain.\n\n";

    const lieutenants = allAgents.filter(a => a.rank === "lieutenant");
    for (const lt of lieutenants) {
      const soldiers = allAgents.filter(a => a.parent_id === lt.id && a.rank === "soldier");
      block += `DIVISION: ${lt.name} (id: ${lt.id}) — ${lt.description || "No description"}\n`;
      if (soldiers.length > 0) {
        block += `  Soldiers:\n`;
        for (const s of soldiers) {
          block += `  - ${s.name} (id: ${s.id}) — ${s.description || "No description"}\n`;
        }
      } else {
        block += `  Soldiers: (none)\n`;
      }
      block += "\n";
    }

    // Direct soldiers under General (unusual but possible)
    const directSoldiers = allAgents.filter(a => a.parent_id === agentId && a.rank === "soldier");
    if (directSoldiers.length > 0) {
      block += `DIRECT SOLDIERS (no lieutenant):\n`;
      for (const s of directSoldiers) {
        block += `  - ${s.name} (id: ${s.id}) — ${s.description || "No description"}\n`;
      }
      block += "\n";
    }
  } else if (agent.rank === "lieutenant") {
    block += "Use the soldier's exact agent_id in your changes JSON response.\n\n";

    const soldiers = allAgents.filter(a => a.parent_id === agentId && a.rank === "soldier");
    if (soldiers.length === 0) {
      block += "(No soldiers currently assigned to you.)\n";
    } else {
      for (let i = 0; i < soldiers.length; i++) {
        const s = soldiers[i];
        block += `${i + 1}. ${s.name} (id: ${s.id}) — ${s.description || "No description"}\n`;
      }
    }
  }

  block += "## END DIRECT REPORTS";
  return block;
}

/**
 * Sync the chain of command: update the DIRECT REPORTS block in every
 * General and Lieutenant prompt to reflect the current hierarchy.
 *
 * - If a prompt already has a ## DIRECT REPORTS block, replace it.
 * - If not, append it.
 * - Only creates a new prompt version if the block content actually changed.
 * - Idempotent: running multiple times produces the same result.
 */
export function syncChainOfCommand(): void {
  const db = getDb();
  const leaders = db.prepare(
    "SELECT * FROM agents WHERE rank IN ('general', 'lieutenant') AND is_active = 1 ORDER BY sort_order"
  ).all() as AgentRow[];

  for (const agent of leaders) {
    const newBlock = generateDirectReportsBlock(agent.id);
    if (!newBlock) continue;

    // Get the current active prompt text
    const currentPromptRow = db.prepare(
      "SELECT * FROM agent_prompts WHERE agent_id = ? AND is_active = 1 ORDER BY version DESC LIMIT 1"
    ).get(agent.id) as AgentPromptRow | null;
    const currentText = currentPromptRow?.prompt_text || agent.system_prompt;

    // Check if there's an existing DIRECT REPORTS block
    const blockRegex = /\n*## DIRECT REPORTS\n[\s\S]*?## END DIRECT REPORTS/;
    let updatedText: string;

    if (blockRegex.test(currentText)) {
      updatedText = currentText.replace(blockRegex, newBlock);
    } else {
      updatedText = currentText.trimEnd() + newBlock;
    }

    // Only create a new version if the text actually changed
    if (updatedText === currentText) continue;

    createPromptVersion(agent.id, updatedText, "Auto-sync: updated DIRECT REPORTS block", "system");
    console.log(`[syncChainOfCommand] Updated DIRECT REPORTS for ${agent.name} (${agent.id})`);
  }
}

/**
 * One-time migration: add initial DIRECT REPORTS blocks to General and LT prompts.
 */
function migrateInitialDirectReports() {
  const db = getDb();
  const migrated = db.prepare(
    "SELECT value FROM agent_system_config WHERE key = 'direct_reports_v1'"
  ).get() as { value: string } | undefined;
  if (migrated?.value === "true") return;

  syncChainOfCommand();

  db.prepare(
    "INSERT OR REPLACE INTO agent_system_config (key, value) VALUES ('direct_reports_v1', 'true')"
  ).run();
  console.log("[migration] Initial DIRECT REPORTS blocks added to General and LT prompts");
}

// ============================================================
// Queries
// ============================================================

/**
 * Migration: Reduce to 2-stock battle format.
 * - Deactivate scalper and news_sniper
 * - Update all active agent prompts to 2-stock versions
 * Only runs once — checks config flag 'two_stock_battle_v1'.
 */
function migrateToTwoStockBattle() {
  const db = getDb();
  const migrated = db.prepare("SELECT value FROM agent_system_config WHERE key = 'two_stock_battle_v1'").get() as { value: string } | undefined;
  if (migrated?.value === "true") return;

  // Deactivate scalper and news_sniper
  db.prepare("UPDATE agents SET is_active = 0 WHERE id IN ('scalper', 'news_sniper')").run();
  console.log("[migration] Deactivated scalper and news_sniper for 2-stock battle");

  // Update all active agents with 2-stock prompts from SEED_AGENTS
  const agentIds = [
    "general", "trading_lt", "market_lt",
    "momentum_trader", "contrarian", "yolo_trader",
    "macro_news", "company_news", "stock_selector", "market_engine",
  ];

  for (const agentId of agentIds) {
    const seedAgent = SEED_AGENTS.find(a => a.id === agentId);
    if (!seedAgent) continue;

    const current = db.prepare("SELECT system_prompt FROM agents WHERE id = ?").get(agentId) as { system_prompt: string } | undefined;
    if (!current) continue;

    // Check if already updated (look for v4 markers)
    if (current.system_prompt.includes("2 securities") || current.system_prompt.includes("2 stocks")) continue;

    createPromptVersion(agentId, seedAgent.system_prompt, "Migration: 2-stock battle format (1 S&P 500 + SPY)", "system");
    console.log(`[migration] Updated ${agentId} to 2-stock battle prompt`);
  }

  db.prepare("INSERT OR REPLACE INTO agent_system_config (key, value) VALUES ('two_stock_battle_v1', 'true')").run();
  console.log("[migration] Two-stock battle migration complete");
}

/**
 * Migration: Update General, Trading LT, and Market LT prompts for soldier self-write.
 * LTs now provide guidance instead of complete prompts. Soldiers write their own prompts.
 * Only runs once — checks config flag 'soldier_self_write_v1'.
 */
function migrateSoldierSelfWritePrompts() {
  const db = getDb();
  const migrated = db.prepare("SELECT value FROM agent_system_config WHERE key = 'soldier_self_write_v1'").get() as { value: string } | undefined;
  if (migrated?.value === "true") return;

  const agentIds = ["general", "trading_lt", "market_lt"];

  for (const agentId of agentIds) {
    const seedAgent = SEED_AGENTS.find(a => a.id === agentId);
    if (!seedAgent) continue;

    const current = db.prepare("SELECT system_prompt FROM agents WHERE id = ?").get(agentId) as { system_prompt: string } | undefined;
    if (!current) continue;

    // Check if already updated (idempotent marker)
    if (current.system_prompt.includes("provide GUIDANCE to soldiers")) continue;

    // Preserve existing DIRECT REPORTS block if present
    const blockRegex = /\n*## DIRECT REPORTS\n[\s\S]*?## END DIRECT REPORTS/;
    const existingBlock = current.system_prompt.match(blockRegex);
    let newPrompt = seedAgent.system_prompt;
    if (existingBlock) {
      // Append the existing DIRECT REPORTS block to the new seed prompt
      newPrompt = newPrompt.trimEnd() + existingBlock[0];
    }

    createPromptVersion(agentId, newPrompt, "Migration: soldier self-write (LTs provide guidance, soldiers write own prompts)", "system");
    console.log(`[migration] Updated ${agentId} for soldier self-write`);
  }

  db.prepare("INSERT OR REPLACE INTO agent_system_config (key, value) VALUES ('soldier_self_write_v1', 'true')").run();
  console.log("[migration] Soldier self-write prompts migration complete");
}

/**
 * Migration: Add Trade Reviewer agent to existing databases.
 * Only runs once — checks config flag 'trade_reviewer_seeded'.
 */
function migrateTradeReviewer() {
  const db = getDb();
  const migrated = db.prepare("SELECT value FROM agent_system_config WHERE key = 'trade_reviewer_seeded'").get() as { value: string } | undefined;
  if (migrated?.value === "true") return;

  const existing = db.prepare("SELECT id FROM agents WHERE id = 'trade_reviewer'").get();
  if (!existing) {
    const seedAgent = SEED_AGENTS.find(a => a.id === "trade_reviewer");
    if (seedAgent) {
      createNewAgent(
        seedAgent.id, seedAgent.name, seedAgent.rank, seedAgent.type,
        seedAgent.parent_id!, seedAgent.description!, seedAgent.system_prompt
      );
      syncChainOfCommand();
      console.log("[migration] Created Trade Reviewer agent");
    }
  }

  db.prepare("INSERT OR REPLACE INTO agent_system_config (key, value) VALUES ('trade_reviewer_seeded', 'true')").run();
}

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
  migrateScalperToBlitzTrader();
  migrateBattleModels();
  migrateBackfillBattleModels();
  migrateEventReactivePrompts();
  migrateV3BattlePrompts();
  migrateInitialDirectReports();
  migrateToTwoStockBattle();
  migrateSoldierSelfWritePrompts();
  migrateTradeReviewer();
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

/**
 * Update an agent's name and/or description.
 * Used when the command chain renames or redescribes an agent.
 */
export function updateAgentMetadata(agentId: string, updates: { name?: string; description?: string }) {
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (updates.name) { sets.push("name = ?"); vals.push(updates.name); }
  if (updates.description) { sets.push("description = ?"); vals.push(updates.description); }
  if (sets.length === 0) return;
  vals.push(agentId);
  db.prepare(`UPDATE agents SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  console.log(`[db] Updated agent ${agentId} metadata: ${JSON.stringify(updates)}`);
}

/**
 * Extract name/description metadata from a proposed change.
 * Parses JSON fields, prompt text patterns, and what_changed text.
 */
export function extractAgentMetadata(change: {
  new_name?: string;
  new_description?: string;
  agent_name?: string;
  description?: string;
  new_prompt?: string;
  what_changed?: string;
}): { name?: string; description?: string } {
  const result: { name?: string; description?: string } = {};

  // 1. Check explicit new_name / new_description fields from LT JSON
  if (change.new_name) result.name = change.new_name;
  if (change.new_description) result.description = change.new_description;

  // 2. Check if the new prompt starts with "You are '[Name]'" or 'You are "Name"'
  if (!result.name && change.new_prompt) {
    const nameMatch = change.new_prompt.match(/^You are ['"\u201C]([^'"\u201D]+)['"\u201D]/);
    if (nameMatch) result.name = nameMatch[1];
  }

  // 3. Check what_changed for rename indicators
  if (!result.name && change.what_changed) {
    const renameMatch = change.what_changed.match(/rename[d]?\s+(?:to|as)\s+['"\u201C]([^'"\u201D]+)['"\u201D]/i);
    if (renameMatch) result.name = renameMatch[1];
    // Also: "New name: Blitz Trader"
    const newNameMatch = change.what_changed.match(/new name[:\s]+['"\u201C]?([^'"\u201D,]+)['"\u201D]?/i);
    if (!result.name && newNameMatch) result.name = newNameMatch[1].trim();
  }

  return result;
}

export function updateAgentModel(agentId: string, model: string | null) {
  const db = getDb();
  db.prepare("UPDATE agents SET model_override = ? WHERE id = ?").run(model, agentId);
}

export function updateAllAgentModels(model: string) {
  const db = getDb();
  db.prepare("UPDATE agents SET model_override = ?").run(model);
}

export function updateAgentBattleModel(agentId: string, model: string | null) {
  const db = getDb();
  db.prepare("UPDATE agents SET battle_model = ? WHERE id = ?").run(model, agentId);
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
    INSERT INTO agents (id, name, rank, type, parent_id, description, system_prompt, model_override, battle_model, is_active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1, ?)
  `).run(id, name, rank, type, parentId, description, systemPrompt, sortOrder);

  db.prepare(`
    INSERT INTO agent_prompts (agent_id, version, prompt_text, notes, created_by, is_active)
    VALUES (?, 1, ?, 'Initial prompt', 'admin', 1)
  `).run(id, systemPrompt);

  return db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow;
}
