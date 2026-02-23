import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface AgentDecisionBody {
  agentName: string;
  model: string;
  round: number;
  newsHeadline: string;
  newsType: string;
  newsCategory: string;
  actionTaken: string;
  ticker: string;
  qty: number;
  price: number;
  reasoning: string;
  pnlFromTrade?: number;
  wasCorrect?: number;
}

interface MatchResultBody {
  numRounds: number;
  stockTickers: string[];
  agents: {
    name: string;
    model: string;
    strategy: string;
    finalPnlPct: number;
    finalRank: number;
    numTrades: number;
    isUser?: boolean;
    customPrompt?: string;
  }[];
  decisions?: AgentDecisionBody[];
}

function ensureSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT (datetime('now')),
      num_rounds INTEGER,
      stocks_json TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS match_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER REFERENCES matches(id),
      agent_name TEXT,
      model TEXT,
      strategy TEXT,
      final_pnl_pct REAL,
      final_rank INTEGER,
      num_trades INTEGER,
      is_user INTEGER DEFAULT 0
    )
  `);
  // Add is_user column if it doesn't exist (migration for existing DBs)
  try {
    db.exec(`ALTER TABLE match_agents ADD COLUMN is_user INTEGER DEFAULT 0`);
  } catch {
    // Column already exists
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER REFERENCES matches(id),
      agent_name TEXT,
      model TEXT,
      round INTEGER,
      news_headline TEXT,
      news_type TEXT,
      news_category TEXT DEFAULT 'unknown',
      action_taken TEXT,
      ticker TEXT,
      qty INTEGER,
      price REAL,
      reasoning TEXT,
      pnl_from_trade REAL DEFAULT NULL,
      was_correct INTEGER DEFAULT NULL
    )
  `);
  // Migration: add news_category if it doesn't exist
  try { db.exec(`ALTER TABLE agent_decisions ADD COLUMN news_category TEXT DEFAULT 'unknown'`); } catch { /* column may already exist */ }
  // Migration: add custom_prompt to match_agents if it doesn't exist
  try { db.exec(`ALTER TABLE match_agents ADD COLUMN custom_prompt TEXT DEFAULT NULL`); } catch { /* column may already exist */ }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as MatchResultBody;
    const { numRounds, stockTickers, agents } = body;

    ensureSchema();
    const db = getDb();

    const insertMatch = db.prepare(
      "INSERT INTO matches (num_rounds, stocks_json) VALUES (?, ?)"
    );
    const result = insertMatch.run(numRounds, JSON.stringify(stockTickers));
    const matchId = result.lastInsertRowid;

    const insertAgent = db.prepare(
      "INSERT INTO match_agents (match_id, agent_name, model, strategy, final_pnl_pct, final_rank, num_trades, is_user, custom_prompt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );

    for (const agent of agents) {
      insertAgent.run(
        matchId,
        agent.name,
        agent.model,
        agent.strategy,
        agent.finalPnlPct,
        agent.finalRank,
        agent.numTrades,
        agent.isUser ? 1 : 0,
        agent.customPrompt || null
      );
    }

    // Save decisions if provided
    if (body.decisions && body.decisions.length > 0) {
      const insertDecision = db.prepare(
        `INSERT INTO agent_decisions (match_id, agent_name, model, round, news_headline, news_type, news_category, action_taken, ticker, qty, price, reasoning, pnl_from_trade, was_correct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const d of body.decisions) {
        insertDecision.run(
          matchId, d.agentName, d.model, d.round,
          d.newsHeadline, d.newsType, d.newsCategory || "unknown",
          d.actionTaken, d.ticker, d.qty, d.price, d.reasoning,
          d.pnlFromTrade ?? null, d.wasCorrect ?? null
        );
      }
    }

    return NextResponse.json({ ok: true, matchId: Number(matchId) });
  } catch (error) {
    console.error("Match results save error:", error);
    return NextResponse.json({ ok: false, error: "Failed to save" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    ensureSchema();
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") || "matches";
    const timeFilter = searchParams.get("time") || "all";

    // Build time clause
    let timeClause = "";
    if (timeFilter === "today") {
      timeClause = "AND m.timestamp >= date('now')";
    } else if (timeFilter === "24h") {
      timeClause = "AND m.timestamp >= datetime('now', '-1 day')";
    } else if (timeFilter === "7d") {
      timeClause = "AND m.timestamp >= datetime('now', '-7 days')";
    }

    if (view === "matches") {
      // Full match history with all agents
      const matches = db.prepare(`
        SELECT m.id, m.timestamp, m.num_rounds, m.stocks_json,
               ma.agent_name, ma.model, ma.strategy, ma.final_pnl_pct,
               ma.final_rank, ma.num_trades, ma.is_user
        FROM matches m
        JOIN match_agents ma ON ma.match_id = m.id
        WHERE 1=1 ${timeClause}
        ORDER BY m.timestamp DESC, ma.final_rank ASC
      `).all();
      return NextResponse.json({ matches });
    }

    if (view === "agents") {
      // Aggregated agent stats
      const agents = db.prepare(`
        SELECT
          ma.agent_name,
          ma.model,
          ma.strategy,
          COUNT(*) as matches_played,
          SUM(CASE WHEN ma.final_rank = 1 THEN 1 ELSE 0 END) as wins,
          ROUND(100.0 * SUM(CASE WHEN ma.final_rank = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as win_rate,
          ROUND(AVG(ma.final_pnl_pct), 2) as avg_pnl_pct
        FROM match_agents ma
        JOIN matches m ON m.id = ma.match_id
        WHERE 1=1 ${timeClause}
        GROUP BY ma.agent_name, ma.model, ma.strategy
        ORDER BY win_rate DESC, avg_pnl_pct DESC
      `).all();
      return NextResponse.json({ agents });
    }

    if (view === "models") {
      // Aggregated model stats
      const models = db.prepare(`
        SELECT
          ma.model,
          COUNT(*) as total_matches,
          ROUND(100.0 * SUM(CASE WHEN ma.final_rank = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as win_rate,
          ROUND(AVG(ma.final_pnl_pct), 2) as avg_pnl_pct,
          ROUND(100.0 * SUM(CASE WHEN ma.final_rank <= 2 THEN 1 ELSE 0 END) / COUNT(*), 1) as top2_rate
        FROM match_agents ma
        JOIN matches m ON m.id = ma.match_id
        WHERE 1=1 ${timeClause}
        GROUP BY ma.model
        ORDER BY win_rate DESC, avg_pnl_pct DESC
      `).all();

      // Top models (highest win rate, min 1 match)
      const topModels = db.prepare(`
        SELECT
          ma.model,
          COUNT(*) as total_matches,
          ROUND(100.0 * SUM(CASE WHEN ma.final_rank = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as win_rate,
          ROUND(AVG(ma.final_pnl_pct), 2) as avg_pnl_pct
        FROM match_agents ma
        JOIN matches m ON m.id = ma.match_id
        WHERE 1=1 ${timeClause}
        GROUP BY ma.model
        ORDER BY win_rate DESC, avg_pnl_pct DESC
        LIMIT 5
      `).all();

      // Bottom models (lowest win rate, min 3 matches to qualify)
      const bottomModels = db.prepare(`
        SELECT
          ma.model,
          COUNT(*) as total_matches,
          ROUND(100.0 * SUM(CASE WHEN ma.final_rank = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as win_rate,
          ROUND(AVG(ma.final_pnl_pct), 2) as avg_pnl_pct
        FROM match_agents ma
        JOIN matches m ON m.id = ma.match_id
        WHERE 1=1 ${timeClause}
        GROUP BY ma.model
        HAVING COUNT(*) >= 3
        ORDER BY win_rate ASC, avg_pnl_pct ASC
        LIMIT 5
      `).all();

      // User win rate by model
      const userModelStats = db.prepare(`
        SELECT
          ma.model,
          COUNT(*) as matches,
          ROUND(100.0 * SUM(CASE WHEN ma.final_rank = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as win_rate
        FROM match_agents ma
        JOIN matches m ON m.id = ma.match_id
        WHERE ma.is_user = 1 ${timeClause}
        GROUP BY ma.model
        ORDER BY matches DESC
      `).all();

      return NextResponse.json({ models, topModels, bottomModels, userModelStats });
    }

    if (view === "strategies") {
      // Aggregated strategy stats
      const strategies = db.prepare(`
        SELECT
          ma.strategy,
          COUNT(*) as total_matches,
          ROUND(100.0 * SUM(CASE WHEN ma.final_rank = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as win_rate,
          ROUND(AVG(ma.final_pnl_pct), 2) as avg_pnl_pct
        FROM match_agents ma
        JOIN matches m ON m.id = ma.match_id
        WHERE 1=1 ${timeClause}
        GROUP BY ma.strategy
        ORDER BY win_rate DESC, avg_pnl_pct DESC
      `).all();

      // Get best model per strategy
      const bestModels = db.prepare(`
        SELECT
          ma.strategy,
          ma.model,
          SUM(CASE WHEN ma.final_rank = 1 THEN 1 ELSE 0 END) as wins
        FROM match_agents ma
        JOIN matches m ON m.id = ma.match_id
        WHERE 1=1 ${timeClause}
        GROUP BY ma.strategy, ma.model
        ORDER BY ma.strategy, wins DESC
      `).all() as { strategy: string; model: string; wins: number }[];

      const bestModelMap: Record<string, string> = {};
      for (const row of bestModels) {
        if (!bestModelMap[row.strategy]) {
          bestModelMap[row.strategy] = row.model;
        }
      }

      return NextResponse.json({ strategies, bestModelMap });
    }

    if (view === "profile") {
      // User profile stats (only user agents)
      const stats = db.prepare(`
        SELECT
          COUNT(*) as total_matches,
          SUM(CASE WHEN ma.final_rank = 1 THEN 1 ELSE 0 END) as wins,
          ROUND(100.0 * SUM(CASE WHEN ma.final_rank = 1 THEN 1 ELSE 0 END) / MAX(COUNT(*), 1), 1) as win_rate,
          ROUND(AVG(ma.final_pnl_pct), 2) as avg_pnl_pct,
          MAX(ma.final_pnl_pct) as best_pnl,
          MIN(ma.final_pnl_pct) as worst_pnl
        FROM match_agents ma
        JOIN matches m ON m.id = ma.match_id
        WHERE ma.is_user = 1 ${timeClause}
      `).get();

      // Recent matches for streak calc + chart data
      const recentMatches = db.prepare(`
        SELECT m.timestamp, ma.final_rank, ma.final_pnl_pct, ma.model, ma.strategy, ma.agent_name
        FROM match_agents ma
        JOIN matches m ON m.id = ma.match_id
        WHERE ma.is_user = 1 ${timeClause}
        ORDER BY m.timestamp DESC
      `).all() as { timestamp: string; final_rank: number; final_pnl_pct: number; model: string; strategy: string; agent_name: string }[];

      // Calculate streak
      let currentStreak = 0;
      for (const match of recentMatches) {
        if (match.final_rank === 1) {
          currentStreak++;
        } else {
          break;
        }
      }

      // Strategy usage
      const strategyStats = db.prepare(`
        SELECT
          ma.strategy,
          COUNT(*) as uses,
          SUM(CASE WHEN ma.final_rank = 1 THEN 1 ELSE 0 END) as wins
        FROM match_agents ma
        JOIN matches m ON m.id = ma.match_id
        WHERE ma.is_user = 1 ${timeClause}
        GROUP BY ma.strategy
        ORDER BY uses DESC
      `).all() as { strategy: string; uses: number; wins: number }[];

      // Model usage
      const modelStats = db.prepare(`
        SELECT
          ma.model,
          COUNT(*) as uses,
          SUM(CASE WHEN ma.final_rank = 1 THEN 1 ELSE 0 END) as wins
        FROM match_agents ma
        JOIN matches m ON m.id = ma.match_id
        WHERE ma.is_user = 1 ${timeClause}
        GROUP BY ma.model
        ORDER BY uses DESC
      `).all() as { model: string; uses: number; wins: number }[];

      // Badges check
      const distinctWinModels = db.prepare(`
        SELECT COUNT(DISTINCT ma.model) as cnt
        FROM match_agents ma WHERE ma.is_user = 1 AND ma.final_rank = 1
      `).get() as { cnt: number };

      const distinctStrategies = db.prepare(`
        SELECT COUNT(DISTINCT ma.strategy) as cnt
        FROM match_agents ma WHERE ma.is_user = 1
      `).get() as { cnt: number };

      // Best streak ever
      let bestStreak = 0;
      let tempStreak = 0;
      for (const match of [...recentMatches].reverse()) {
        if (match.final_rank === 1) {
          tempStreak++;
          bestStreak = Math.max(bestStreak, tempStreak);
        } else {
          tempStreak = 0;
        }
      }

      return NextResponse.json({
        stats,
        recentMatches,
        currentStreak,
        bestStreak,
        strategyStats,
        modelStats,
        distinctWinModels: distinctWinModels?.cnt || 0,
        distinctStrategies: distinctStrategies?.cnt || 0,
      });
    }

    if (view === "decisions") {
      // All decisions with optional filters
      const model = searchParams.get("model");
      const ticker = searchParams.get("ticker");
      const newsType = searchParams.get("newsType");
      const category = searchParams.get("category");
      const limit = parseInt(searchParams.get("limit") || "100", 10);
      const offset = parseInt(searchParams.get("offset") || "0", 10);

      let whereExtra = "";
      const params: unknown[] = [];
      if (model) { whereExtra += " AND ad.model = ?"; params.push(model); }
      if (ticker) { whereExtra += " AND ad.ticker = ?"; params.push(ticker); }
      if (newsType) { whereExtra += " AND ad.news_type = ?"; params.push(newsType); }
      if (category) { whereExtra += " AND ad.news_category = ?"; params.push(category); }

      const decisions = db.prepare(`
        SELECT
          ad.id, ad.agent_name, ad.model, ad.round, ad.news_headline, ad.news_type,
          ad.news_category, ad.action_taken, ad.ticker, ad.qty, ad.price, ad.reasoning,
          ad.pnl_from_trade, ad.was_correct,
          m.timestamp, m.id as match_id
        FROM agent_decisions ad
        JOIN matches m ON m.id = ad.match_id
        WHERE 1=1 ${timeClause} ${whereExtra}
        ORDER BY m.timestamp DESC, ad.id DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      const totalCount = db.prepare(`
        SELECT COUNT(*) as cnt
        FROM agent_decisions ad
        JOIN matches m ON m.id = ad.match_id
        WHERE 1=1 ${timeClause} ${whereExtra}
      `).get(...params) as { cnt: number };

      // Accuracy summary
      const accuracy = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN ad.was_correct = 1 THEN 1 ELSE 0 END) as correct,
          SUM(CASE WHEN ad.was_correct = 0 THEN 1 ELSE 0 END) as incorrect,
          ROUND(100.0 * SUM(CASE WHEN ad.was_correct = 1 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN ad.was_correct IS NOT NULL THEN 1 ELSE 0 END), 0), 1) as accuracy_pct,
          ROUND(AVG(ad.pnl_from_trade), 2) as avg_pnl
        FROM agent_decisions ad
        JOIN matches m ON m.id = ad.match_id
        WHERE 1=1 ${timeClause} ${whereExtra}
      `).get(...params);

      return NextResponse.json({ decisions, totalCount: totalCount?.cnt || 0, accuracy });
    }

    if (view === "head2head") {
      // Head-to-head: model vs model win rates from same matches
      const h2h = db.prepare(`
        SELECT
          a1.model as model_a,
          a2.model as model_b,
          COUNT(*) as matches,
          SUM(CASE WHEN a1.final_rank < a2.final_rank THEN 1 ELSE 0 END) as a_wins,
          SUM(CASE WHEN a2.final_rank < a1.final_rank THEN 1 ELSE 0 END) as b_wins,
          SUM(CASE WHEN a1.final_rank = a2.final_rank THEN 1 ELSE 0 END) as ties
        FROM match_agents a1
        JOIN match_agents a2 ON a1.match_id = a2.match_id AND a1.model < a2.model
        JOIN matches m ON m.id = a1.match_id
        WHERE 1=1 ${timeClause}
        GROUP BY a1.model, a2.model
        HAVING COUNT(*) >= 1
        ORDER BY matches DESC
      `).all();
      return NextResponse.json({ h2h });
    }

    if (view === "model_detail") {
      const modelId = searchParams.get("model");
      if (!modelId) return NextResponse.json({ error: "model param required" }, { status: 400 });

      const summary = db.prepare(`
        SELECT
          ma.model,
          COUNT(*) as total_matches,
          SUM(CASE WHEN ma.final_rank = 1 THEN 1 ELSE 0 END) as wins,
          ROUND(100.0 * SUM(CASE WHEN ma.final_rank = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as win_rate,
          ROUND(AVG(ma.final_pnl_pct), 2) as avg_pnl_pct,
          ROUND(MAX(ma.final_pnl_pct), 2) as best_pnl,
          ROUND(MIN(ma.final_pnl_pct), 2) as worst_pnl,
          ROUND(100.0 * SUM(CASE WHEN ma.final_rank <= 2 THEN 1 ELSE 0 END) / COUNT(*), 1) as top2_rate,
          ROUND(AVG(ma.final_rank), 1) as avg_rank,
          ROUND(AVG(ma.num_trades), 1) as avg_trades
        FROM match_agents ma
        JOIN matches m ON m.id = ma.match_id
        WHERE ma.model = ? ${timeClause}
      `).get(modelId);

      const byStrategy = db.prepare(`
        SELECT
          ma.strategy,
          COUNT(*) as matches,
          SUM(CASE WHEN ma.final_rank = 1 THEN 1 ELSE 0 END) as wins,
          ROUND(100.0 * SUM(CASE WHEN ma.final_rank = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as win_rate,
          ROUND(AVG(ma.final_pnl_pct), 2) as avg_pnl_pct
        FROM match_agents ma
        JOIN matches m ON m.id = ma.match_id
        WHERE ma.model = ? ${timeClause}
        GROUP BY ma.strategy
        ORDER BY win_rate DESC
      `).all(modelId);

      const bySituation = db.prepare(`
        SELECT
          ad.news_type,
          COUNT(*) as decisions,
          SUM(CASE WHEN ad.was_correct = 1 THEN 1 ELSE 0 END) as correct,
          SUM(CASE WHEN ad.was_correct = 0 THEN 1 ELSE 0 END) as incorrect,
          ROUND(100.0 * SUM(CASE WHEN ad.was_correct = 1 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN ad.was_correct IS NOT NULL THEN 1 ELSE 0 END), 0), 1) as accuracy,
          ROUND(AVG(ad.pnl_from_trade), 2) as avg_pnl
        FROM agent_decisions ad
        JOIN matches m ON m.id = ad.match_id
        WHERE ad.model = ? ${timeClause}
        GROUP BY ad.news_type
        ORDER BY decisions DESC
      `).all(modelId);

      const recentMatches = db.prepare(`
        SELECT m.id, m.timestamp, ma.strategy, ma.final_rank, ma.final_pnl_pct, ma.num_trades
        FROM match_agents ma
        JOIN matches m ON m.id = ma.match_id
        WHERE ma.model = ? ${timeClause}
        ORDER BY m.timestamp DESC
        LIMIT 20
      `).all(modelId);

      const opponents = db.prepare(`
        SELECT
          opp.model as opponent,
          COUNT(*) as matches,
          SUM(CASE WHEN ma.final_rank < opp.final_rank THEN 1 ELSE 0 END) as wins
        FROM match_agents ma
        JOIN match_agents opp ON ma.match_id = opp.match_id AND ma.id != opp.id
        JOIN matches m ON m.id = ma.match_id
        WHERE ma.model = ? ${timeClause}
        GROUP BY opp.model
        ORDER BY matches DESC
      `).all(modelId);

      return NextResponse.json({ summary, byStrategy, bySituation, recentMatches, opponents });
    }

    return NextResponse.json({ error: "Unknown view" }, { status: 400 });
  } catch (error) {
    console.error("Match results GET error:", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
