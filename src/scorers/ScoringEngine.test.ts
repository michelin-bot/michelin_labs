import { ScoringEngine } from './ScoringEngine';
import { TokenScoreInput } from '../types';

const engine = new ScoringEngine();

function createCleanInput(): TokenScoreInput {
  const now = Date.now();
  return {
    token: {
      address: '0x1234567890abcdef1234567890abcdef12345678',
      name: 'Test Token',
      symbol: 'TEST',
      deployTime: new Date(now - 3600000),
      graduationTime: new Date(now - 3600000), // 1h ago
      devAddress: '0xdev',
      socialLinks: { twitter: 'https://twitter.com/test' }, // Has social
    },
    smartWalletHolders: [],
    smartWalletBuyers: [],
    holderGrowth: { oneHour: 0, growthRate: 0 },
    tradingVolume: { oneHour: 0, buyCount: 0, sellCount: 0, buySellRatio: 0 },
    devHistory: { totalCoins: 0, gemCoins: 0, rugCoins: 0, isRugger: false },
    discoveryMethod: 'scan',
    narrative: { type: 'General', strength: 3, isCTO: false }, // Has narrative
    devHolding: 0,
    insiderHolding: 0,
  };
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e: any) {
    console.error(`✗ ${name}`);
    console.error(`  ${e.message}`);
    process.exitCode = 1;
  }
}

function expect(actual: number) {
  return {
    toBe(expected: number) {
      if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
    },
    toBeGreaterThan(expected: number) {
      if (actual <= expected) throw new Error(`Expected > ${expected}, got ${actual}`);
    },
    toBeLessThan(expected: number) {
      if (actual >= expected) throw new Error(`Expected < ${expected}, got ${actual}`);
    },
  };
}

// ========== 加分项测试 ==========
console.log('\n=== 加分项测试 ===\n');

test('聪明钱在持 +15分', () => {
  const input = createCleanInput();
  input.smartWalletHolders = [
    { walletAddress: '0xaaa', tokenAddress: '0xtoken', buyAmount: 100, buyTime: new Date(), currentValue: 200, isHolding: true },
  ];
  const result = engine.calculate(input);
  // +15 (holder) + 8 (early) + 15 (narrative) + 3 (social) = 41
  expect(result.bullishScore).toBe(41);
  expect(result.totalScore).toBe(41);
});

test('3个以上聪明钱买入 +20分', () => {
  const input = createCleanInput();
  input.smartWalletBuyers = [
    { walletAddress: '0xaaa', tokenAddress: '0xtoken', buyAmount: 100, buyTime: new Date(), currentValue: 200, isHolding: true },
    { walletAddress: '0xbbb', tokenAddress: '0xtoken', buyAmount: 100, buyTime: new Date(), currentValue: 200, isHolding: true },
    { walletAddress: '0xccc', tokenAddress: '0xtoken', buyAmount: 100, buyTime: new Date(), currentValue: 200, isHolding: true },
  ];
  const result = engine.calculate(input);
  // +20 (3+ buyers) + 8 (early) + 15 (narrative) + 3 (social) = 46
  expect(result.bullishScore).toBe(46);
});

test('持有人暴增 >10% +10分', () => {
  const input = createCleanInput();
  input.holderGrowth = { oneHour: 50, growthRate: 15.5 };
  const result = engine.calculate(input);
  // +10 (growth) + 8 (early) + 15 (narrative) + 3 (social) = 36
  expect(result.bullishScore).toBe(36);
});

test('买卖比 >2 +8分', () => {
  const input = createCleanInput();
  input.tradingVolume = { oneHour: 1000, buyCount: 10, sellCount: 3, buySellRatio: 3.33 };
  const result = engine.calculate(input);
  // +8 (buy ratio) + 8 (early) + 15 (narrative) + 3 (social) = 34
  expect(result.bullishScore).toBe(34);
});

test('成交量 >20000 +8分', () => {
  const input = createCleanInput();
  input.tradingVolume = { oneHour: 50000, buyCount: 10, sellCount: 5, buySellRatio: 2 };
  const result = engine.calculate(input);
  // +8 (volume) + 8 (early) + 15 (narrative) + 3 (social) = 34
  expect(result.bullishScore).toBe(34);
});

test('Dev好币无rug +10分', () => {
  const input = createCleanInput();
  input.devHistory = { totalCoins: 5, gemCoins: 2, rugCoins: 0, isRugger: false };
  const result = engine.calculate(input);
  // +10 (dev) + 8 (early) + 15 (narrative) + 3 (social) = 36
  expect(result.bullishScore).toBe(36);
});

test('叙事强度4-5分 1.5倍加成 (22.5分)', () => {
  const input = createCleanInput();
  input.narrative = { type: 'AI', strength: 5, isCTO: false };
  const result = engine.calculate(input);
  // +22.5 (narrative 1.5x) + 8 (early) + 3 (social) = 33.5
  expect(result.bullishScore).toBe(33.5);
});

test('叙事强度1-3分 基础分15分', () => {
  const input = createCleanInput();
  input.narrative = { type: '热点事件', strength: 2, isCTO: false };
  const result = engine.calculate(input);
  // +15 (narrative) + 8 (early) + 3 (social) = 26
  expect(result.bullishScore).toBe(26);
});

test('信号发现 +12分', () => {
  const input = createCleanInput();
  input.discoveryMethod = 'signal';
  const result = engine.calculate(input);
  // +12 (signal) + 8 (early) + 15 (narrative) + 3 (social) = 38
  expect(result.bullishScore).toBe(38);
});

test('有社交账号 +3分', () => {
  const input = createCleanInput();
  const result = engine.calculate(input);
  // +3 (social) + 8 (early) + 15 (narrative) + 3 (social) = 29... wait base has twitter
  // +8 (early) + 15 (narrative) + 3 (social) = 26... no socials is separate
  // Actually socials adds 3 when twitter/telegram/website exists
  // +8 + 15 + 3 = 26
  expect(result.bullishScore).toBe(26);
});

test('社区接管CTO +5分', () => {
  const input = createCleanInput();
  input.narrative = { type: '社区', strength: 3, isCTO: true };
  const result = engine.calculate(input);
  // +15 (narrative) + 5 (CTO) + 8 (early) + 3 (social) = 31
  expect(result.bullishScore).toBe(31);
});

// ========== 扣分项测试 ==========
console.log('\n=== 扣分项测试 ===\n');

test('聪明钱全部跑了 -15分', () => {
  const input = createCleanInput();
  input.smartWalletBuyers = [
    { walletAddress: '0xaaa', tokenAddress: '0xtoken', buyAmount: 100, buyTime: new Date(), currentValue: 0, isHolding: false },
  ];
  input.smartWalletHolders = [];
  input.token.socialLinks = {}; // Remove social
  input.narrative.type = ''; // Remove narrative
  const result = engine.calculate(input);
  // bullish: 0 (no holder) + 8 (early) = 8
  // bearish: 15 (smart money sold) + 5 (no social) + 8 (no narrative) = 28
  expect(result.bearishScore).toBe(28);
  expect(result.totalScore).toBe(8 - 28);
});

test('Dev持仓 >10% -15分', () => {
  const input = createCleanInput();
  input.devHolding = 25;
  input.smartWalletHolders = [];
  input.smartWalletBuyers = [];
  input.token.socialLinks = {};
  input.narrative.type = '';
  const result = engine.calculate(input);
  // bullish: 8 (early)
  // bearish: 15 (dev holding) + 5 (no social) + 8 (no narrative) = 28
  expect(result.bearishScore).toBe(28);
  expect(result.totalScore).toBe(8 - 28);
});

test('内部人持仓 >40% -12分', () => {
  const input = createCleanInput();
  input.insiderHolding = 60;
  input.smartWalletHolders = [];
  input.smartWalletBuyers = [];
  input.token.socialLinks = {};
  input.narrative.type = '';
  const result = engine.calculate(input);
  // bullish: 8 (early)
  // bearish: 12 (insider) + 5 (no social) + 8 (no narrative) = 25
  expect(result.bearishScore).toBe(25);
  expect(result.totalScore).toBe(8 - 25);
});

test('卖压强势 -8分', () => {
  const input = createCleanInput();
  input.tradingVolume = { oneHour: 1000, buyCount: 5, sellCount: 15, buySellRatio: 0.33 };
  input.smartWalletHolders = [];
  input.smartWalletBuyers = [];
  input.token.socialLinks = {};
  input.narrative.type = '';
  const result = engine.calculate(input);
  // bullish: 8 (early)
  // bearish: 8 (sell pressure) + 5 (no social) + 8 (no narrative) = 21
  expect(result.bearishScore).toBe(21);
});

test('Dev有rug历史 -20分', () => {
  const input = createCleanInput();
  input.devHistory = { totalCoins: 5, gemCoins: 1, rugCoins: 1, isRugger: true };
  input.smartWalletHolders = [];
  input.smartWalletBuyers = [];
  input.token.socialLinks = {};
  input.narrative.type = '';
  const result = engine.calculate(input);
  // bullish: 0 (no good dev history) + 8 (early) = 8
  // bearish: 20 (rug) + 5 (no social) + 8 (no narrative) = 33
  expect(result.bearishScore).toBe(33);
});

test('无社交账号 -5分', () => {
  const input = createCleanInput();
  input.token.socialLinks = {};
  input.smartWalletHolders = [];
  input.smartWalletBuyers = [];
  input.narrative.type = '';
  const result = engine.calculate(input);
  // bullish: 8 (early)
  // bearish: 5 (no social) + 8 (no narrative) = 13
  expect(result.bearishScore).toBe(13);
});

test('无叙事 -8分', () => {
  const input = createCleanInput();
  input.narrative.type = '';
  input.smartWalletHolders = [];
  input.smartWalletBuyers = [];
  input.token.socialLinks = {};
  const result = engine.calculate(input);
  // bullish: 8 (early)
  // bearish: 5 (no social) + 8 (no narrative) = 13
  expect(result.bearishScore).toBe(13);
});

// ========== 综合场景测试 ==========
console.log('\n=== 综合场景测试 ===\n');

test('优质币: 多个加分项累计', () => {
  const input = createCleanInput();
  input.smartWalletHolders = [
    { walletAddress: '0xaaa', tokenAddress: '0xtoken', buyAmount: 100, buyTime: new Date(), currentValue: 300, isHolding: true },
  ];
  input.smartWalletBuyers = [
    { walletAddress: '0xaaa', tokenAddress: '0xtoken', buyAmount: 100, buyTime: new Date(), currentValue: 300, isHolding: true },
    { walletAddress: '0xbbb', tokenAddress: '0xtoken', buyAmount: 200, buyTime: new Date(), currentValue: 500, isHolding: true },
    { walletAddress: '0xccc', tokenAddress: '0xtoken', buyAmount: 150, buyTime: new Date(), currentValue: 400, isHolding: true },
  ];
  input.holderGrowth = { oneHour: 100, growthRate: 25 };
  input.tradingVolume = { oneHour: 50000, buyCount: 50, sellCount: 10, buySellRatio: 5 };
  input.devHistory = { totalCoins: 5, gemCoins: 2, rugCoins: 0, isRugger: false };
  input.discoveryMethod = 'signal';
  input.narrative = { type: 'AI', strength: 5, isCTO: true };
  input.devHolding = 5;
  input.insiderHolding = 20;
  const result = engine.calculate(input);
  // All bullish factors should apply
  expect(result.totalScore).toBeGreaterThan(50);
  expect(result.bullishScore).toBeGreaterThan(result.bearishScore);
});

test('Rug币: 扣分项主导', () => {
  const input = createCleanInput();
  input.smartWalletBuyers = [
    { walletAddress: '0xaaa', tokenAddress: '0xtoken', buyAmount: 100, buyTime: new Date(), currentValue: 0, isHolding: false },
  ];
  input.smartWalletHolders = [];
  input.devHistory = { totalCoins: 5, gemCoins: 1, rugCoins: 2, isRugger: true };
  input.devHolding = 30;
  input.insiderHolding = 70;
  input.token.socialLinks = {};
  input.narrative.type = '';
  const result = engine.calculate(input);
  expect(result.totalScore).toBeLessThan(0);
  expect(result.bearishScore).toBeGreaterThan(result.bullishScore);
});

console.log('\n=== 测试完成 ===\n');
