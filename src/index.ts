import { config, validateConfig } from './config';
import { SqliteDatabase } from './storage';
import { PumpDataFetcher } from './scanners/PumpDataFetcher';
import { TokenScanner } from './scanners/TokenScanner';
import { AlertManager } from './alerts/AlertManager';
import { ScoringEngine, ScoreResult } from './scorers/ScoringEngine';
import { Token, TokenTrade, WalletPosition, TokenScoreInput } from './types';
import nodeCron from 'node-cron';

interface MonitorState {
  db: SqliteDatabase;
  fetcher: PumpDataFetcher;
  scanner: TokenScanner;
  scorer: ScoringEngine;
  alertManager: AlertManager;
  lastProcessedBlock: number;
  knownTokens: Set<string>;
  startTime: number;
}

const SCAN_INTERVAL_SECONDS = 5;  // Scan every 5 seconds
const BLOCKS_PER_SCAN = 100;       // Only scan ~100 blocks at a time (~5 min on BSC)
const NEW_TOKEN_ALERT_THRESHOLD = 10; // Alert if score >= 10
const MAX_TOKENS_PER_SCAN = 20;    // Max tokens to process per scan

async function main() {
  console.log(`
╔═══════════════════════════════════════════════╗
║     Four.meme Smart Wallet Monitor Service     ║
╚═══════════════════════════════════════════════╝
`);

  if (!validateConfig()) {
    console.error('[Main] Invalid configuration. Please check your .env file.');
    process.exit(1);
  }

  console.log('[Main] Configuration loaded:');
  console.log(`[Main]   RPC: ${config.bscRpcUrl}`);
  console.log(`[Main]   Scan Interval: every ${SCAN_INTERVAL_SECONDS} second`);
  console.log(`[Main]   Alert Threshold: score >= ${NEW_TOKEN_ALERT_THRESHOLD}`);
  console.log(`[Main]   Watched Wallets: ${config.watchedWallets.length}`);
  console.log(`[Main]   Telegram: ${config.telegram.botToken ? 'Enabled' : 'Disabled'}`);

  // Initialize modules
  const db = new SqliteDatabase('./data/monitor.db');
  await db.initialize();
  console.log('[Main] Database initialized');

  const fetcher = new PumpDataFetcher(db);
  const scanner = new TokenScanner();
  const scorer = new ScoringEngine();
  const alertManager = new AlertManager();

  // Get current block number to start scanning from recent blocks
  const currentBlock = await fetcher.getCurrentBlock();
  console.log(`[Main] Current block: ${currentBlock}`);

  const state: MonitorState = {
    db,
    fetcher,
    scanner,
    scorer,
    alertManager,
    lastProcessedBlock: currentBlock - 10, // Start from 10 blocks ago to catch recent
    knownTokens: new Set(),
    startTime: Date.now(),
  };

  // Load known tokens from database
  const existingTokens = db.getRecentTokens(10000);
  for (const token of existingTokens) {
    state.knownTokens.add(token.address.toLowerCase());
  }
  console.log(`[Main] Loaded ${existingTokens.length} known tokens from database`);

  // Initial scan
  console.log('[Main] Running initial scan...');
  await runScan(state);

  // Schedule periodic scans (every second)
  console.log(`[Main] Scheduling periodic scans: every ${SCAN_INTERVAL_SECONDS} second(s)`);

  setInterval(async () => {
    console.log(`\n[Main] === Scheduled Scan Started at ${new Date().toLocaleString()} ===`);
    await runScan(state);
    console.log(`[Main] === Scheduled Scan Completed ===\n`);
  }, SCAN_INTERVAL_SECONDS * 1000);

  // Schedule daily summary at 9:00 AM
  nodeCron.schedule('0 9 * * *', async () => {
    console.log(`\n[Main] === Daily Summary Started at ${new Date().toLocaleString()} ===`);
    await sendDailySummary(state);
    console.log(`[Main] === Daily Summary Completed ===\n`);
  });

  console.log('[Main] Service started successfully. Press Ctrl+C to stop.');

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[Main] Shutting down...');
    db.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[Main] Shutting down...');
    db.close();
    process.exit(0);
  });
}

async function runScan(state: MonitorState): Promise<void> {
  const { db, fetcher, scanner, scorer, alertManager } = state;

  try {
    // Get current block number
    const currentBlock = await fetcher.getCurrentBlock();
    if (currentBlock <= state.lastProcessedBlock) {
      return; // No new blocks
    }

    // Only scan a limited range of blocks at a time
    const fromBlock = state.lastProcessedBlock + 1;
    const toBlock = Math.min(currentBlock, fromBlock + BLOCKS_PER_SCAN - 1);

    console.log(`[Scan] Scanning blocks ${fromBlock} to ${toBlock}...`);

    // Fetch trades in this range
    const newTrades = await fetcher.fetchTradesInRange(fromBlock, toBlock);

    if (newTrades.length === 0) {
      state.lastProcessedBlock = toBlock;
      console.log('[Scan] No new trades in this range');
      return;
    }

    console.log(`[Scan] Found ${newTrades.length} new trades`);

    // Update last processed block
    state.lastProcessedBlock = toBlock;

    // Group trades by token
    const tokenTrades = new Map<string, TokenTrade[]>();
    for (const trade of newTrades) {
      if (!tokenTrades.has(trade.tokenAddress)) {
        tokenTrades.set(trade.tokenAddress, []);
      }
      tokenTrades.get(trade.tokenAddress)!.push(trade);
    }

    console.log(`[Scan] ${tokenTrades.size} tokens have new activity`);

    // Process tokens (limit per scan to avoid overload)
    const tokenAddresses = Array.from(tokenTrades.keys()).slice(0, MAX_TOKENS_PER_SCAN);
    let highScoreCount = 0;

    for (const tokenAddress of tokenAddresses) {
      const trades = tokenTrades.get(tokenAddress)!;

      try {
        const tokenInfo = await scanner.getTokenInfo(tokenAddress);
        if (!tokenInfo) continue;

        const token: Token = {
          address: tokenAddress,
          name: tokenInfo.name,
          symbol: tokenInfo.symbol,
          deployTime: new Date(Number(tokenInfo.launchTime) * 1000),
          graduationTime: new Date(Number(tokenInfo.launchTime) * 1000),
          devAddress: tokenInfo.creator,
          socialLinks: {},
        };

        // Calculate trading summary
        const summaryInfo = await fetcher.getTokenTradingSummary(tokenAddress, trades);

        // Build score input
        const scoreInput: TokenScoreInput = {
          token,
          smartWalletHolders: [] as WalletPosition[],
          smartWalletBuyers: [] as WalletPosition[],
          holderGrowth: { oneHour: 0, growthRate: 0 },
          tradingVolume: {
            oneHour: summaryInfo.buyVolume + summaryInfo.sellVolume,
            buyCount: summaryInfo.totalBuys,
            sellCount: summaryInfo.totalSells,
            buySellRatio: summaryInfo.totalSells > 0 ? summaryInfo.totalBuys / summaryInfo.totalSells : summaryInfo.totalBuys,
          },
          devHistory: { totalCoins: 0, gemCoins: 0, rugCoins: 0, isRugger: false },
          discoveryMethod: 'scan',
          narrative: { type: '', strength: 1, isCTO: false },
          devHolding: 0,
          insiderHolding: 0,
        };

        const score = scorer.calculate(scoreInput);

        // Save to database
        db.saveToken(token);

        // IMMEDIATELY alert if score >= threshold
        if (score.totalScore >= NEW_TOKEN_ALERT_THRESHOLD) {
          highScoreCount++;
          console.log(`[Scan] 🚨 HIGH SCORE ALERT: ${token.symbol} = ${score.totalScore}`);

          if (alertManager.isEnabled()) {
            await sendTokenAlert(alertManager, {
              token,
              score,
              summary: {
                totalBuys: summaryInfo.totalBuys,
                totalSells: summaryInfo.totalSells,
                totalVolume: summaryInfo.totalVolume,
                totalFees: summaryInfo.totalFees,
                uniqueTraders: summaryInfo.uniqueTraders.size,
              }
            });
          }
        }
      } catch (err) {
        console.warn(`[Scan] Error processing token ${tokenAddress}: ${(err as Error).message}`);
      }
    }

    if (highScoreCount > 0) {
      console.log(`[Scan] Sent ${highScoreCount} high-score alerts`);
    }

  } catch (error) {
    console.error('[Scan] Error during scan:', error);
  }
}

async function sendTokenAlert(
  alertManager: AlertManager,
  item: {
    token: Token;
    score: ScoreResult;
    summary: {
      totalBuys: number;
      totalSells: number;
      totalVolume: number;
      totalFees: number;
      uniqueTraders: number;
    };
  }
): Promise<void> {
  const { token, score, summary } = item;
  const emoji = score.totalScore >= 50 ? '🟢' : score.totalScore >= 30 ? '🟡' : '🔴';
  const feeRate = summary.totalVolume > 0
    ? ((summary.totalFees / summary.totalVolume) * 100).toFixed(2)
    : '0';

  const message = `
${emoji} <b>High Score Alert</b>

🏷️ <b>${token.symbol}</b>
📛 ${token.name}
📍 <code>${token.address}</code>

📊 <b>Score: ${score.totalScore}</b>
   Bullish: +${score.bullishScore}
   Bearish: -${score.bearishScore}

📈 <b>Trading Data:</b>
• Buys: ${summary.totalBuys} | Sells: ${summary.totalSells}
• Volume: ${summary.totalVolume.toFixed(4)} BNB
• Fee Rate: ${feeRate}%
• Traders: ${summary.uniqueTraders}

${score.details.bullish.length > 0 ? '🟢 <b>Bullish Factors:</b>\n' + score.details.bullish.map(b => `   • ${b.reason}`).join('\n') : ''}

🔗 <a href="https://dexscreener.com/bsc/${token.address}">DexScreener</a>
`;

  await alertManager.send({
    type: 'score_change',
    title: `${token.symbol} Score ${score.totalScore}`,
    content: message,
    timestamp: Date.now(),
    data: { tokenAddress: token.address, score },
  });
}

async function sendPeriodicSummary(
  alertManager: AlertManager,
  scoredTokens: Array<{
    token: Token;
    score: ScoreResult;
    summary: {
      totalBuys: number;
      totalSells: number;
      totalVolume: number;
      totalFees: number;
      uniqueTraders: number;
    };
  }>
): Promise<void> {
  if (scoredTokens.length === 0) return;

  const totalVolume = scoredTokens.reduce((sum, t) => sum + t.summary.totalVolume, 0);
  const totalFees = scoredTokens.reduce((sum, t) => sum + t.summary.totalFees, 0);
  const totalBuys = scoredTokens.reduce((sum, t) => sum + t.summary.totalBuys, 0);
  const totalSells = scoredTokens.reduce((sum, t) => sum + t.summary.totalSells, 0);
  const avgScore = scoredTokens.reduce((sum, t) => sum + t.score.totalScore, 0) / scoredTokens.length;
  const positiveCount = scoredTokens.filter(t => t.score.totalScore > 0).length;

  const message = `
📊 <b>Four.meme Real-time Monitor Report</b>

🕐 ${new Date().toLocaleString()}

📈 <b>Overview:</b>
• Active Tokens: ${scoredTokens.length}
• Total Trades: ${totalBuys + totalSells} (Buy ${totalBuys} / Sell ${totalSells})
• Total Volume: ${totalVolume.toFixed(4)} BNB
• Total Fees: ${totalFees.toFixed(6)} BNB

📊 <b>Score Stats:</b>
• Avg Score: ${avgScore.toFixed(1)}
• Positive: ${positiveCount} (${((positiveCount / scoredTokens.length) * 100).toFixed(1)}%)

🏆 <b>Top ${scoredTokens.length} Tokens:</b>
${scoredTokens.slice(0, scoredTokens.length).map((t, i) => {
  const emoji = t.score.totalScore >= 50 ? '🟢' : t.score.totalScore >= 20 ? '🟡' : '🔴';
  return `${emoji} ${i + 1}. ${t.token.symbol} - Score: ${t.score.totalScore} | Vol: ${t.summary.totalVolume.toFixed(4)} BNB`;
}).join('\n')}
`;

  await alertManager.send({
    type: 'token_alert',
    title: `Four.meme Real-time Monitor Report`,
    content: message,
    timestamp: Date.now(),
  });
}

async function sendDailySummary(state: MonitorState): Promise<void> {
  const { db, fetcher, scanner, scorer, alertManager } = state;

  try {
    // Get stats from database
    const stats = db.getStats();
    const recentTokens = db.getRecentTokens(1000);

    const message = `
📊 <b>Four.meme Daily Report</b>

🕐 ${new Date().toLocaleString()}

📈 <b>System Status:</b>
• Uptime: ${formatUptime(Date.now() - state.startTime)}
• DB Tokens: ${stats.tokenCount}
• Monitored Trades: ${stats.activityCount}

📈 <b>Recent Updates:</b>
• New Tokens: ${recentTokens.length}
• New Trades: ${stats.activityCount}

🔗 <a href="https://dexscreener.com/bsc">DexScreener</a>
`;

    await alertManager.send({
      type: 'token_alert',
      title: 'Four.meme Daily Report',
      content: message,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('[Main] Error sending daily summary:', error);
  }
}

function formatUptime(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

main().catch(console.error);
