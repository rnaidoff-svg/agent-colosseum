/**
 * Test script — runs a 10-round match with 3 mock agents
 * Usage: npx tsx scripts/test-match.ts
 */

import chalk from "chalk";
import { runMatch, AgentConfig, RoundSnapshot } from "../src/lib/engine";
import { createDecisionFn } from "../src/lib/agents/runner";

// Agent colors for visual distinction
const agentColors = [chalk.cyan, chalk.magenta, chalk.yellow, chalk.blue, chalk.green];
function agentColor(index: number) {
  return agentColors[index % agentColors.length];
}

const agents: AgentConfig[] = [
  {
    id: "agent-1",
    name: "Aggressive Alpha",
    model: "mock",
    systemPrompt: "",
    provider: "mock",
  },
  {
    id: "agent-2",
    name: "Conservative Beta",
    model: "mock",
    systemPrompt: "",
    provider: "mock",
  },
  {
    id: "agent-3",
    name: "Random Gamma",
    model: "mock",
    systemPrompt: "",
    provider: "mock",
  },
];

const agentIndexMap = new Map(agents.map((a, i) => [a.id, i]));

function pnlColor(value: number): string {
  if (value > 0) return chalk.green(`+${value.toFixed(2)}%`);
  if (value < 0) return chalk.red(`${value.toFixed(2)}%`);
  return chalk.gray(`${value.toFixed(2)}%`);
}

function priceChange(changePct: number): string {
  const pct = (changePct * 100).toFixed(2);
  if (changePct > 0) return chalk.green(`+${pct}%`);
  if (changePct < 0) return chalk.red(`${pct}%`);
  return chalk.gray(`${pct}%`);
}

function actionColor(action: string): string {
  switch (action) {
    case "BUY": return chalk.green.bold(action);
    case "SELL": return chalk.red.bold(action);
    case "SHORT": return chalk.yellow.bold(action);
    default: return chalk.gray(action);
  }
}

function printRound(snapshot: RoundSnapshot) {
  const dim = chalk.dim;
  const bold = chalk.bold;

  console.log("");
  console.log(chalk.bgBlue.white.bold(` ⚡ ROUND ${String(snapshot.round).padStart(2)} `));
  console.log(dim("─".repeat(60)));

  // Prices
  console.log(bold("  📈 PRICES"));
  for (const sp of Object.values(snapshot.prices)) {
    const ticker = chalk.bold.white(sp.ticker.padEnd(5));
    const price = `$${sp.price.toFixed(2).padStart(8)}`;
    const change = priceChange(sp.changePct);
    const sector = dim(`[${sp.sector}]`);
    console.log(`    ${ticker} ${price}  ${change}  ${sector}`);
  }

  // News
  if (snapshot.news.length > 0) {
    console.log("");
    console.log(bold("  📰 NEWS"));
    for (const event of snapshot.news) {
      console.log(chalk.yellowBright(`    ⚡ ${event.headline}`));
      const impacts = Object.entries(event.sectorImpacts)
        .map(([sector, impact]) => {
          const pct = (impact * 100).toFixed(1);
          return impact >= 0
            ? chalk.green(`${sector} +${pct}%`)
            : chalk.red(`${sector} ${pct}%`);
        })
        .join(dim(" | "));
      console.log(`      ${dim("Impact:")} ${impacts}`);
    }
  }

  // Trades
  console.log("");
  if (snapshot.trades.length > 0) {
    console.log(bold("  💰 TRADES"));
    for (const trade of snapshot.trades) {
      const idx = agentIndexMap.get(trade.agentId) ?? 0;
      const name = agentColor(idx)(trade.agentName.padEnd(20));
      const rejected = trade.reasoning.startsWith("REJECTED");

      if (rejected) {
        console.log(
          `    ${name} ${chalk.bgRed.white(" REJECTED ")} ${trade.action} ${trade.quantity}x ${trade.asset}`
        );
        const reason = trade.reasoning.replace("REJECTED: ", "").split(". Original")[0];
        console.log(`    ${" ".repeat(20)} ${dim(reason)}`);
      } else {
        const act = actionColor(trade.action);
        const detail = `${trade.quantity}x ${chalk.bold(trade.asset)} @ $${trade.price.toFixed(2)}`;
        const total = dim(`($${trade.total.toFixed(2)})`);
        console.log(`    ${name} ${act} ${detail} ${total}`);
        console.log(`    ${" ".repeat(20)} ${dim(trade.reasoning)}`);
      }
    }
  } else {
    console.log(bold("  💰 TRADES: ") + dim("none"));
  }

  // Standings
  console.log("");
  console.log(bold("  🏆 STANDINGS"));
  for (let i = 0; i < snapshot.standings.length; i++) {
    const s = snapshot.standings[i];
    const idx = agentIndexMap.get(s.agentId) ?? 0;
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
    const name = agentColor(idx)(s.agentName.padEnd(20));
    const value = chalk.white(`$${s.totalValue.toFixed(2).padStart(12)}`);
    const pnl = pnlColor(s.pnlPct * 100);
    const positions = Object.keys(s.portfolio.positions).length;
    const info = dim(`[${positions} pos, $${s.portfolio.cash.toFixed(0)} cash]`);
    console.log(`    ${medal} ${name} ${value}  ${pnl}  ${info}`);
  }
}

async function main() {
  console.log("");
  console.log(chalk.bgMagenta.white.bold("                                                            "));
  console.log(chalk.bgMagenta.white.bold("       ⚔️  AGENT COLOSSEUM — TEST MATCH  ⚔️                 "));
  console.log(chalk.bgMagenta.white.bold("                                                            "));
  console.log("");
  console.log(
    chalk.dim("  Agents: ") +
    agents.map((a, i) => agentColor(i)(a.name)).join(chalk.dim(" vs "))
  );
  console.log(chalk.dim("  Rounds: 10 | Starting Cash: $100,000 | Mode: MOCK"));
  console.log("");

  const result = await runMatch({
    agents,
    decisionFn: createDecisionFn(),
    onRound: printRound,
  });

  // Final results
  console.log("");
  console.log(chalk.bgGreen.black.bold("                                                            "));
  console.log(chalk.bgGreen.black.bold("                    🏆 FINAL RESULTS 🏆                     "));
  console.log(chalk.bgGreen.black.bold("                                                            "));

  for (let i = 0; i < result.finalStandings.length; i++) {
    const s = result.finalStandings[i];
    const idx = agentIndexMap.get(s.agentId) ?? 0;
    const trades = result.tradesByAgent[s.agentId]?.length ?? 0;
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
    const trophy = i === 0 ? chalk.bgYellow.black.bold(" WINNER ") : "";

    console.log("");
    console.log(`  ${medal} ${agentColor(idx).bold(s.agentName)} ${trophy}`);
    console.log(chalk.dim("  " + "─".repeat(40)));
    console.log(`     Total Value:  ${chalk.bold.white(`$${s.totalValue.toFixed(2)}`)}`);
    console.log(`     P&L:          ${pnlColor(s.pnlPct * 100)}`);
    console.log(`     Trades:       ${chalk.white(String(trades))}`);
    console.log(`     Cash:         ${chalk.white(`$${s.portfolio.cash.toFixed(2)}`)}`);

    const positions = Object.values(s.portfolio.positions);
    if (positions.length > 0) {
      console.log(`     Positions:`);
      for (const pos of positions) {
        const side = pos.side === "long" ? chalk.green("LONG ") : chalk.red("SHORT");
        console.log(
          `       ${side} ${chalk.bold(String(pos.quantity))}x ${chalk.bold(pos.ticker)} @ $${pos.avgCost.toFixed(2)}`
        );
      }
    }
  }

  console.log("");
  console.log(chalk.dim(`  Match completed in ${result.durationMs}ms`));
  console.log("");
}

main().catch(console.error);
