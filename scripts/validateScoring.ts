import { SqliteDatabase } from '../src/storage';
import { PumpDataFetcher, MarketDataScanner, TokenScanner } from '../src/scanners';
import { ScoringEngine, ScoreResult } from '../src/scorers/ScoringEngine';
import { config } from '../src/config';
import { TokenScoreInput, WalletPosition } from '../src/types';
import fs from 'fs';

async function main() {
  console.log('=== Scoring Algorithm Validation ===\n');

  const db = new SqliteDatabase('./data/monitor.db');
  await db.initialize();

  const pumpFetcher = new PumpDataFetcher(db);
  const marketScanner = new MarketDataScanner();
  const tokenScanner = new TokenScanner();
  const scoringEngine = new ScoringEngine();

  // Step 1: Fetch recent tokens
  console.log('1. Fetching recent tokens from four.meme...');
  let tokens = await pumpFetcher.fetchRecentTokens(7);

  if (tokens.length === 0) {
    console.log('   No tokens found on-chain, using existing database tokens...');
    tokens = db.getRecentTokens(100);
  } else {
    console.log(`   Found ${tokens.length} tokens on-chain`);
  }

  if (tokens.length === 0) {
    console.log('   No tokens available. Generating mock data for validation...');
    pumpFetcher.generateMockDataForTesting();
    tokens = db.getRecentTokens(100);
  }

  console.log(`   Total tokens to analyze: ${tokens.length}\n`);

  // Step 2: Fetch market data for tokens
  console.log('2. Fetching market data from DexScreener...');
  const tokenAddresses = tokens.map(t => t.address);
  const marketDataMap = await marketScanner.getMultipleMarketData(tokenAddresses);
  console.log(`   Market data fetched for ${marketDataMap.size} tokens\n`);

  // Step 3: Get watched wallet positions
  console.log('3. Loading watched wallet positions...');
  const watchedWallets = config.watchedWallets.length > 0
    ? config.watchedWallets
    : ['0x1111111111111111111111111111111111111111'];

  const allPositions: WalletPosition[] = [];
  for (const wallet of watchedWallets) {
    const positions = db.getPositionsByWallet(wallet);
    allPositions.push(...positions);
  }
  console.log(`   Total positions: ${allPositions.length}\n`);

  // Step 4: Score each token
  console.log('4. Scoring tokens...\n');
  const results: Array<{
    token: { symbol: string; address: string };
    score: ScoreResult;
    marketData: { priceUsd: string; volume24h: number; liquidityUsd: number } | null;
  }> = [];

  for (const token of tokens.slice(0, 50)) { // Limit to 50 for performance
    const marketData = marketDataMap.get(token.address);

    // Build scoring input
    const tokenPositions = allPositions.filter(p => p.tokenAddress === token.address);
    const holders = tokenPositions.filter(p => p.isHolding);
    const buyers = tokenPositions;

    const input: TokenScoreInput = {
      token,
      smartWalletHolders: holders,
      smartWalletBuyers: buyers,
      holderGrowth: {
        oneHour: marketData ? Math.floor(marketData.buyCount24h * 0.1) : 0,
        growthRate: marketData ? 5 + Math.random() * 20 : 0,
      },
      tradingVolume: {
        oneHour: marketData ? marketData.volume24h / 24 : 0,
        buyCount: marketData ? Math.floor(marketData.buyCount24h * 0.8) : 0,
        sellCount: marketData ? Math.floor(marketData.buyCount24h * 0.2) : 0,
        buySellRatio: marketData ? marketData.buyCount24h / Math.max(1, marketData.sellCount24h) : 0,
      },
      devHistory: {
        totalCoins: Math.floor(Math.random() * 10) + 1,
        gemCoins: Math.floor(Math.random() * 3),
        rugCoins: Math.random() > 0.8 ? 1 : 0,
        isRugger: Math.random() > 0.8,
      },
      discoveryMethod: Math.random() > 0.3 ? 'signal' : 'scan',
      narrative: {
        type: ['技术/AI', '热点事件', '社交病毒', '反讽文化'][Math.floor(Math.random() * 4)],
        strength: (Math.floor(Math.random() * 5) + 1) as 1 | 2 | 3 | 4 | 5,
        isCTO: Math.random() > 0.9,
      },
      devHolding: Math.random() * 15,
      insiderHolding: Math.random() * 50,
    };

    const score = scoringEngine.calculate(input);

    results.push({
      token: { symbol: token.symbol, address: token.address },
      score,
      marketData: marketData ? {
        priceUsd: marketData.priceUsd,
        volume24h: marketData.volume24h,
        liquidityUsd: marketData.liquidityUsd,
      } : null,
    });
  }

  // Step 5: Display results
  console.log('=== Scoring Results ===\n');

  // Sort by score descending
  results.sort((a, b) => b.score.totalScore - a.score.totalScore);

  console.log('TOP 10 HIGHEST SCORED TOKENS:\n');
  results.slice(0, 10).forEach((r, i) => {
    console.log(`${i + 1}. ${r.token.symbol} (${r.token.address.slice(0, 10)}...)`);
    console.log(`   Score: ${r.score.totalScore} (B:${r.score.bullishScore} / S:${r.score.bearishScore})`);
    console.log(`   ${r.score.summary}`);
    if (r.marketData) {
      console.log(`   Price: $${r.marketData.priceUsd?.slice(0, 10)} | Vol: $${(r.marketData.volume24h / 1000).toFixed(0)}K | Liq: $${(r.marketData.liquidityUsd / 1000).toFixed(0)}K`);
    }
    console.log('');
  });

  console.log('\nBOTTOM 5 LOWEST SCORED TOKENS:\n');
  results.slice(-5).forEach((r, i) => {
    const idx = results.length - 5 + i;
    console.log(`${idx + 1}. ${r.token.symbol}`);
    console.log(`   Score: ${r.score.totalScore} (B:${r.score.bullishScore} / S:${r.score.bearishScore})`);
    console.log(`   ${r.score.summary}`);
    console.log('');
  });

  // Step 6: Statistics
  console.log('\n=== Statistics ===\n');
  const scores = results.map(r => r.score.totalScore);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const positive = results.filter(r => r.score.totalScore > 0).length;
  const negative = results.filter(r => r.score.totalScore < 0).length;

  console.log(`Total tokens analyzed: ${results.length}`);
  console.log(`Average score: ${avg.toFixed(1)}`);
  console.log(`Highest score: ${max}`);
  console.log(`Lowest score: ${min}`);
  console.log(`Positive score tokens: ${positive} (${(positive / results.length * 100).toFixed(1)}%)`);
  console.log(`Negative score tokens: ${negative} (${(negative / results.length * 100).toFixed(1)}%)`);

  // Score distribution
  console.log('\nScore Distribution:');
  console.log(`  >50:  ${results.filter(r => r.score.totalScore > 50).length}`);
  console.log(`  20-50: ${results.filter(r => r.score.totalScore >= 20 && r.score.totalScore <= 50).length}`);
  console.log(`  0-20:  ${results.filter(r => r.score.totalScore >= 0 && r.score.totalScore < 20).length}`);
  console.log(`  <0:    ${results.filter(r => r.score.totalScore < 0).length}`);

  // Save results to file
  const outputPath = './data/scoring_results.json';
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nDetailed results saved to: ${outputPath}`);

  // Save score history to database
  console.log('\nSaving score history to database...');
  for (const r of results) {
    db.saveScoreHistory(
      r.token.address,
      r.score.totalScore,
      r.score.bullishScore,
      r.score.bearishScore,
      r.score.summary
    );
  }
  console.log('Done!');

  db.close();
}

main().catch(console.error);
