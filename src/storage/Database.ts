import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import { Token, WalletPosition, WalletActivity, SmartWallet } from '../types';

export class SqliteDatabase {
  private db: BetterSqlite3.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'monitor.db');
  }

  async initialize(): Promise<void> {
    try {
      this.db = new BetterSqlite3(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.createTables();
      console.log('[Database] Initialized at', this.dbPath);
    } catch (error) {
      console.error('[Database] Failed to initialize:', error);
      throw error;
    }
  }

  private createTables(): void {
    if (!this.db) return;

    // Tokens table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tokens (
        address TEXT PRIMARY KEY,
        name TEXT,
        symbol TEXT,
        deploy_time INTEGER,
        graduation_time INTEGER,
        dev_address TEXT,
        twitter TEXT,
        telegram TEXT,
        website TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Wallet positions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wallet_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wallet_address TEXT,
        token_address TEXT,
        buy_amount REAL,
        buy_time INTEGER,
        current_value REAL,
        is_holding INTEGER DEFAULT 1,
        sell_time INTEGER,
        profit REAL,
        UNIQUE(wallet_address, token_address)
      )
    `);

    // Wallet activities table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wallet_activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wallet_address TEXT,
        timestamp INTEGER,
        tx_hash TEXT UNIQUE,
        action TEXT,
        token_address TEXT,
        token_symbol TEXT,
        amount TEXT,
        value_in_bnb TEXT
      )
    `);

    // Smart wallets table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS smart_wallets (
        address TEXT PRIMARY KEY,
        name TEXT,
        win_rate REAL DEFAULT 0,
        total_trades INTEGER DEFAULT 0,
        avg_profit REAL DEFAULT 0,
        is_active INTEGER DEFAULT 1
      )
    `);

    // Score history table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS score_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_address TEXT,
        total_score INTEGER,
        bullish_score INTEGER,
        bearish_score INTEGER,
        summary TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_positions_wallet ON wallet_positions(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_positions_token ON wallet_positions(token_address);
      CREATE INDEX IF NOT EXISTS idx_activities_wallet ON wallet_activities(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_activities_timestamp ON wallet_activities(timestamp);
      CREATE INDEX IF NOT EXISTS idx_score_token ON score_history(token_address);
    `);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('[Database] Closed');
    }
  }

  // ========== Token Operations ==========

  saveToken(token: Token): void {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tokens (address, name, symbol, deploy_time, graduation_time, dev_address, twitter, telegram, website)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      token.address,
      token.name,
      token.symbol,
      token.deployTime.getTime(),
      token.graduationTime.getTime(),
      token.devAddress,
      token.socialLinks.twitter || null,
      token.socialLinks.telegram || null,
      token.socialLinks.website || null
    );
  }

  getToken(address: string): Token | null {
    if (!this.db) return null;

    const row = this.db.prepare('SELECT * FROM tokens WHERE address = ?').get(address) as any;
    if (!row) return null;

    return {
      address: row.address,
      name: row.name,
      symbol: row.symbol,
      deployTime: new Date(row.deploy_time),
      graduationTime: new Date(row.graduation_time),
      devAddress: row.dev_address,
      socialLinks: {
        twitter: row.twitter || undefined,
        telegram: row.telegram || undefined,
        website: row.website || undefined,
      },
    };
  }

  getRecentTokens(limit: number = 100): Token[] {
    if (!this.db) return [];

    const rows = this.db.prepare('SELECT * FROM tokens ORDER BY created_at DESC LIMIT ?').all(limit) as any[];

    return rows.map(row => ({
      address: row.address,
      name: row.name,
      symbol: row.symbol,
      deployTime: new Date(row.deploy_time),
      graduationTime: new Date(row.graduation_time),
      devAddress: row.dev_address,
      socialLinks: {
        twitter: row.twitter || undefined,
        telegram: row.telegram || undefined,
        website: row.website || undefined,
      },
    }));
  }

  // ========== Wallet Position Operations ==========

  savePosition(position: WalletPosition): void {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO wallet_positions
      (wallet_address, token_address, buy_amount, buy_time, current_value, is_holding, sell_time, profit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      position.walletAddress,
      position.tokenAddress,
      position.buyAmount,
      position.buyTime.getTime(),
      position.currentValue,
      position.isHolding ? 1 : 0,
      position.sellTime?.getTime() || null,
      position.profit || null
    );
  }

  getPositionsByWallet(walletAddress: string): WalletPosition[] {
    if (!this.db) return [];

    const rows = this.db.prepare('SELECT * FROM wallet_positions WHERE wallet_address = ?').all(walletAddress) as any[];

    return rows.map(row => ({
      walletAddress: row.wallet_address,
      tokenAddress: row.token_address,
      buyAmount: row.buy_amount,
      buyTime: new Date(row.buy_time),
      currentValue: row.current_value,
      isHolding: row.is_holding === 1,
      sellTime: row.sell_time ? new Date(row.sell_time) : undefined,
      profit: row.profit || undefined,
    }));
  }

  getPositionsByToken(tokenAddress: string): WalletPosition[] {
    if (!this.db) return [];

    const rows = this.db.prepare('SELECT * FROM wallet_positions WHERE token_address = ?').all(tokenAddress) as any[];

    return rows.map(row => ({
      walletAddress: row.wallet_address,
      tokenAddress: row.token_address,
      buyAmount: row.buy_amount,
      buyTime: new Date(row.buy_time),
      currentValue: row.current_value,
      isHolding: row.is_holding === 1,
      sellTime: row.sell_time ? new Date(row.sell_time) : undefined,
      profit: row.profit || undefined,
    }));
  }

  // ========== Wallet Activity Operations ==========

  saveActivity(activity: WalletActivity): void {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO wallet_activities
      (wallet_address, timestamp, tx_hash, action, token_address, token_symbol, amount, value_in_bnb)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      activity.address,
      activity.timestamp,
      activity.txHash,
      activity.action,
      activity.tokenAddress || null,
      activity.tokenSymbol || null,
      activity.amount || null,
      activity.valueInBnb || null
    );
  }

  getRecentActivities(walletAddress: string, limit: number = 100): WalletActivity[] {
    if (!this.db) return [];

    const rows = this.db.prepare(
      'SELECT * FROM wallet_activities WHERE wallet_address = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(walletAddress, limit) as any[];

    return rows.map(row => ({
      address: row.wallet_address,
      timestamp: row.timestamp,
      txHash: row.tx_hash,
      action: row.action as WalletActivity['action'],
      tokenAddress: row.token_address || undefined,
      tokenSymbol: row.token_symbol || undefined,
      amount: row.amount || undefined,
      valueInBnb: row.value_in_bnb || undefined,
    }));
  }

  // ========== Smart Wallet Operations ==========

  saveSmartWallet(wallet: SmartWallet): void {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO smart_wallets (address, name, win_rate, total_trades, avg_profit, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(wallet.address, wallet.name || null, wallet.winRate, wallet.totalTrades, wallet.avgProfit, wallet.isActive ? 1 : 0);
  }

  getSmartWallet(address: string): SmartWallet | null {
    if (!this.db) return null;

    const row = this.db.prepare('SELECT * FROM smart_wallets WHERE address = ?').get(address) as any;
    if (!row) return null;

    return {
      address: row.address,
      name: row.name || undefined,
      winRate: row.win_rate,
      totalTrades: row.total_trades,
      avgProfit: row.avg_profit,
      isActive: row.is_active === 1,
    };
  }

  getAllSmartWallets(): SmartWallet[] {
    if (!this.db) return [];

    const rows = this.db.prepare('SELECT * FROM smart_wallets WHERE is_active = 1').all() as any[];

    return rows.map(row => ({
      address: row.address,
      name: row.name || undefined,
      winRate: row.win_rate,
      totalTrades: row.total_trades,
      avgProfit: row.avg_profit,
      isActive: row.is_active === 1,
    }));
  }

  // ========== Score History Operations ==========

  saveScoreHistory(tokenAddress: string, totalScore: number, bullishScore: number, bearishScore: number, summary: string): void {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT INTO score_history (token_address, total_score, bullish_score, bearish_score, summary)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(tokenAddress, totalScore, bullishScore, bearishScore, summary);
  }

  getScoreHistory(tokenAddress: string, limit: number = 10): Array<{
    totalScore: number;
    bullishScore: number;
    bearishScore: number;
    summary: string;
    createdAt: Date;
  }> {
    if (!this.db) return [];

    const rows = this.db.prepare(
      'SELECT * FROM score_history WHERE token_address = ? ORDER BY created_at DESC LIMIT ?'
    ).all(tokenAddress, limit) as any[];

    return rows.map(row => ({
      totalScore: row.total_score,
      bullishScore: row.bullish_score,
      bearishScore: row.bearish_score,
      summary: row.summary,
      createdAt: new Date(row.created_at * 1000),
    }));
  }

  // ========== Utility Operations ==========

  getStats(): {
    tokenCount: number;
    walletCount: number;
    activityCount: number;
    scoreCount: number;
  } {
    if (!this.db) return { tokenCount: 0, walletCount: 0, activityCount: 0, scoreCount: 0 };

    const tokenCount = (this.db.prepare('SELECT COUNT(*) as c FROM tokens').get() as any).c;
    const walletCount = (this.db.prepare('SELECT COUNT(*) as c FROM smart_wallets').get() as any).c;
    const activityCount = (this.db.prepare('SELECT COUNT(*) as c FROM wallet_activities').get() as any).c;
    const scoreCount = (this.db.prepare('SELECT COUNT(*) as c FROM score_history').get() as any).c;

    return { tokenCount, walletCount, activityCount, scoreCount };
  }
}

// Singleton instance
export const db = new SqliteDatabase();
