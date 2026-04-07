import { SqliteDatabase } from '../src/storage';
import { PumpDataFetcher } from '../src/scanners';
import { TokenScanner } from '../src/scanners/TokenScanner';
import { AlertManager } from '../src/alerts';
import { ScoringEngine, ScoreResult } from '../src/scorers/ScoringEngine';
import { Token, TokenTrade, WalletPosition } from '../src/types';

interface TestResult {
  token: Token;
  trades: TokenTrade[];
  score: ScoreResult;
  tradingSummary: {
    totalBuys: number;
    totalSells: number;
    totalVolume: number;
    totalFees: number;
    uniqueTraders: number;
  };
}

async function main() {
  console.log('=== Four.meme Real Data Fetcher ===\n');

  const db = new SqliteDatabase('./data/monitor.db');
  await db.initialize();

  const fetcher = new PumpDataFetcher(db);
  const scanner = new TokenScanner();
  const scorer = new ScoringEngine();
  const alertManager = new AlertManager();

  const command = process.argv[2] || 'fetch';

  if (command === 'fetch') {
    const hours = 6;
    console.log(`Fetching recent tokens (last ${hours} hours due to RPC limitations)...\n`);

    // Step 1: Get trades first to discover active tokens
    console.log('Step 1: Fetching recent trades...');
    const allTrades = await fetcher.fetchRecentTrades(hours);
    console.log(`Found ${allTrades.length} total trades\n`);

    // Group trades by token
    const tokenTrades = new Map<string, TokenTrade[]>();
    const tradedTokenAddresses = new Set<string>();
    for (const trade of allTrades) {
      if (!tokenTrades.has(trade.tokenAddress)) {
        tokenTrades.set(trade.tokenAddress, []);
      }
      tokenTrades.get(trade.tokenAddress)!.push(trade);
      tradedTokenAddresses.add(trade.tokenAddress);
    }

    const tradedTokensList = Array.from(tradedTokenAddresses);
    console.log(`Discovered ${tradedTokensList.length} tokens with trades\n`);

    // Step 2: Get token info for traded tokens (batch processing)
    console.log('Step 2: Getting token info (batch processing)...');
    const testResults: TestResult[] = [];

    const BATCH_SIZE = 10;
    for (let i = 0; i < tradedTokensList.length; i += BATCH_SIZE) {
      const batch = tradedTokensList.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(tradedTokensList.length / BATCH_SIZE);
      console.log(`Processing batch ${batchNum}/${totalBatches}...`);

      // Process batch in parallel
      const batchPromises = batch.map(async (tokenAddress) => {
        const tradeList = tokenTrades.get(tokenAddress) || [];
        if (tradeList.length === 0) return null;

        try {
          const tokenInfo = await scanner.getTokenInfo(tokenAddress);
          if (!tokenInfo) return null;

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
          const summary = await fetcher.getTokenTradingSummary(tokenAddress, tradeList);

          // Build score input
          const scoreInput = {
            token,
            smartWalletHolders: [] as WalletPosition[],
            smartWalletBuyers: [] as WalletPosition[],
            holderGrowth: { oneHour: 0, growthRate: 0 },
            tradingVolume: {
              oneHour: summary.buyVolume + summary.sellVolume,
              buyCount: summary.totalBuys,
              sellCount: summary.totalSells,
              buySellRatio: summary.totalSells > 0 ? summary.totalBuys / summary.totalSells : summary.totalBuys,
            },
            devHistory: { totalCoins: 0, gemCoins: 0, rugCoins: 0, isRugger: false },
            discoveryMethod: 'scan' as const,
            narrative: { type: '', strength: 1 as const, isCTO: false },
            devHolding: 0,
            insiderHolding: 0,
          };

          const score = scorer.calculate(scoreInput);

          return {
            token,
            trades: tradeList,
            score,
            tradingSummary: {
              totalBuys: summary.totalBuys,
              totalSells: summary.totalSells,
              totalVolume: summary.totalVolume,
              totalFees: summary.totalFees,
              uniqueTraders: summary.uniqueTraders.size,
            },
          };
        } catch (err) {
          console.log(`  Error processing ${tokenAddress}: ${(err as Error).message}`);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      testResults.push(...batchResults.filter((r): r is TestResult => r !== null));

      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < tradedTokensList.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Sort by score
    testResults.sort((a, b) => b.score.totalScore - a.score.totalScore);

    // Print results
    console.log('\n=== Top Scored Tokens with Trades ===\n');
    const topToShow = Math.min(20, testResults.length);
    for (let i = 0; i < topToShow; i++) {
      const result = testResults[i];
      const emoji = result.score.totalScore >= 50 ? '🟢' : result.score.totalScore >= 20 ? '🟡' : '🔴';
      console.log(`${emoji} ${result.token.symbol} (${result.token.name})`);
      console.log(`   Score: ${result.score.totalScore} | Buys: ${result.tradingSummary.totalBuys} | Sells: ${result.tradingSummary.totalSells}`);
      console.log(`   Volume: ${result.tradingSummary.totalVolume.toFixed(4)} BNB | Fees: ${result.tradingSummary.totalFees.toFixed(6)} BNB`);
      if (result.score.details.bullish.length > 0) {
        console.log(`   Bullish: ${result.score.details.bullish.map(b => `${b.reason}(+${b.points})`).join(', ')}`);
      }
      if (result.score.details.bearish.length > 0) {
        console.log(`   Bearish: ${result.score.details.bearish.map(b => `${b.reason}(${b.points})`).join(', ')}`);
      }
      console.log('');
    }

    // Save to database
    console.log('Saving tokens to database...');
    for (const result of testResults) {
      db.saveToken(result.token);
    }

    // Step 4: Send to Telegram
    console.log('\nStep 4: Sending results to Telegram...');
    await sendTestResultsToTG(alertManager, testResults, hours);

    console.log('\n=== Test Complete ===');
    console.log(`Total tokens processed: ${testResults.length}`);
    console.log(`Total trades: ${testResults.reduce((sum, r) => sum + r.trades.length, 0)}`);
  } else if (command === 'stats') {
    const stats = db.getStats();
    console.log('Database stats:');
    console.log(`  Tokens: ${stats.tokenCount}`);
    console.log(`  Wallets: ${stats.walletCount}`);
    console.log(`  Activities: ${stats.activityCount}`);
    console.log(`  Score records: ${stats.scoreCount}`);
  }

  db.close();
}

async function sendTestResultsToTG(
  alertManager: AlertManager,
  results: TestResult[],
  hours: number
): Promise<void> {
  if (!alertManager.isEnabled()) {
    console.log('[TG] Telegram not enabled, skipping...');
    return;
  }

  try {
    const totalVolume = results.reduce((sum, r) => sum + r.tradingSummary.totalVolume, 0);
    const totalFees = results.reduce((sum, r) => sum + r.tradingSummary.totalFees, 0);
    const totalBuys = results.reduce((sum, r) => sum + r.tradingSummary.totalBuys, 0);
    const totalSells = results.reduce((sum, r) => sum + r.tradingSummary.totalSells, 0);
    const avgScore = results.length > 0
      ? results.reduce((sum, r) => sum + r.score.totalScore, 0) / results.length
      : 0;
    const positiveCount = results.filter(r => r.score.totalScore > 0).length;

    const summaryMsg = `
📊 <b>Four.meme 链上数据测试报告</b>

📅 统计周期: 最近 ${hours} 小时 (RPC限制)

📈 <b>整体数据:</b>
• 有交易的代币: ${results.length}
• 总交易次数: ${totalBuys + totalSells}
  - 买入: ${totalBuys}
  - 卖出: ${totalSells}
• 总成交量: ${totalVolume.toFixed(4)} BNB
• 总手续费: ${totalFees.toFixed(6)} BNB

📊 <b>评分统计:</b>
• 平均评分: ${avgScore.toFixed(1)} 分
• 正分代币: ${positiveCount} (${results.length > 0 ? ((positiveCount / results.length) * 100).toFixed(1) : 0}%)
• 负分代币: ${results.length - positiveCount}

🏆 <b>Top 5 代币:</b>
${results.slice(0, 5).map((r, i) => {
  const emoji = r.score.totalScore >= 50 ? '🟢' : r.score.totalScore >= 20 ? '🟡' : '🔴';
  return `${emoji} ${i + 1}. ${r.token.symbol} - 评分: ${r.score.totalScore} | 成交量: ${r.tradingSummary.totalVolume.toFixed(4)} BNB`;
}).join('\n')}
`;

    await alertManager.send({
      type: 'token_alert',
      title: `Four.meme ${hours}小时数据测试报告`,
      content: summaryMsg,
      timestamp: Date.now(),
    });

    // Send top token details
    for (let i = 0; i < Math.min(5, results.length); i++) {
      const r = results[i];
      const feeRate = r.tradingSummary.totalVolume > 0
        ? ((r.tradingSummary.totalFees / r.tradingSummary.totalVolume) * 100).toFixed(2)
        : '0';

      const detailMsg = `
🏆 <b>Top ${i + 1}: ${r.token.symbol}</b>

📛 名称: ${r.token.name}
📍 地址: <code>${r.token.address}</code>
👤 创建者: <code>${r.token.devAddress}</code>

📊 <b>评分: ${r.score.totalScore}</b> 分
   拉盘证据: +${r.score.bullishScore}
   砸盘证据: -${r.score.bearishScore}

📈 <b>交易数据:</b>
• 买入: ${r.tradingSummary.totalBuys}
• 卖出: ${r.tradingSummary.totalSells}
• 成交量: ${r.tradingSummary.totalVolume.toFixed(6)} BNB
• 手续费: ${r.tradingSummary.totalFees.toFixed(6)} BNB (费率: ${feeRate}%)
• 交易者: ${r.tradingSummary.uniqueTraders} 人

${r.score.details.bullish.length > 0 ? '🟢 <b>加分项:</b>\n' + r.score.details.bullish.map(b => `   • ${b.reason}`).join('\n') : ''}
${r.score.details.bearish.length > 0 ? '🔴 <b>扣分项:</b>\n' + r.score.details.bearish.map(b => `   • ${b.reason}`).join('\n') : ''}

🔗 <a href="https://dexscreener.com/bsc/${r.token.address}">DexScreener</a>
`;

      await alertManager.send({
        type: 'score_change',
        title: `${r.token.symbol} 评分 ${r.score.totalScore}分`,
        content: detailMsg,
        timestamp: Date.now(),
        data: { tokenAddress: r.token.address, score: r.score },
      });
    }

    console.log('[TG] Results sent to Telegram');
  } catch (error) {
    console.error('[TG] Error sending to Telegram:', error);
  }
}

main().catch(console.error);
