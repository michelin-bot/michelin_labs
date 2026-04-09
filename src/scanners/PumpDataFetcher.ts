import { ethers } from 'ethers';
import axios from 'axios';
import { Token, WalletPosition, WalletActivity, TokenTrade, TokenTradingInfo } from '../types';
import { SqliteDatabase } from '../storage';
import { config } from '../config';

// Four.meme TokenManager2 Contract ABI (from TokenManager2.lite.abi)
const FACTORY_ABI = [
  // View functions
  'function _tokenCount() view returns (uint256)',
  'function _tokens(uint256) view returns (address)',
  'function _tokenInfos(address) view returns (address base, address quote, uint256 template, uint256 totalSupply, uint256 maxOffers, uint256 maxRaising, uint256 launchTime, uint256 offers, uint256 funds, uint256 lastPrice, uint256 K, uint256 T, uint256 status)',
  'function _tokenInfoEx1s(address) view returns (uint256 launchFee, uint256 pcFee, uint256 feeSetting, uint256 blockNumber, uint256 extraFee)',
  'function _tokenInfoExs(address) view returns (address creator, address founder, uint256 reserves)',
  // Events
  'event TokenCreate(address creator, address token, uint256 requestId, string name, string symbol, uint256 totalSupply, uint256 launchTime, uint256 launchFee)',
  'event TokenPurchase(address token, address account, uint256 price, uint256 amount, uint256 cost, uint256 fee, uint256 offers, uint256 funds)',
  'event TokenSale(address token, address account, uint256 price, uint256 amount, uint256 cost, uint256 fee, uint256 offers, uint256 funds)',
  'event LiquidityAdded(address base, uint256 offers, address quote, uint256 funds)',
  'event TradeStop(address indexed token)',
];

// RPC max block range limit (Ankr BSC ~100 blocks per query works reliably)
const MAX_BLOCKS_PER_QUERY = 100;

const TOKEN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
];

// Four.meme factory address
const FACTORY_ADDRESS = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';

// Token status constants
const STATUS = {
  ADDING_LIQUIDITY: 0,
  TRADING: 1,
  COMPLETED: 2,
  HALT: 3,
};

// Fee divisor (fees are in basis points, e.g., 100 = 1%)
const FEE_DIVISOR = 10000;

export class PumpDataFetcher {
  private provider: ethers.JsonRpcProvider | null = null;
  private db: SqliteDatabase;
  private factory: ethers.Contract | null = null;

  constructor(db: SqliteDatabase) {
    this.db = db;

    if (config.bscRpcUrl) {
      this.provider = new ethers.JsonRpcProvider(config.bscRpcUrl);
      this.factory = new ethers.Contract(
        FACTORY_ADDRESS,
        FACTORY_ABI,
        this.provider
      );
    }
  }

  /**
   * Get current block number
   */
  async getCurrentBlock(): Promise<number> {
    if (!this.provider) {
      throw new Error('RPC not configured');
    }
    return await this.provider.getBlockNumber();
  }

  /**
   * Get token info from four.meme contract
   */
  async getTokenInfoFromContract(tokenAddress: string): Promise<{
    name: string;
    symbol: string;
    creator: string;
    totalSupply: bigint;
    launchTime: bigint;
    offers: bigint;
    funds: bigint;
    lastPrice: bigint;
    status: number;
    template: number;
    feeSetting: bigint;
  } | null> {
    if (!this.factory || !this.provider) {
      return null;
    }

    try {
      const [tokenInfo, tokenInfoEx1, tokenContract] = await Promise.all([
        this.factory._tokenInfos(tokenAddress) as Promise<{
          base: string;
          quote: string;
          template: bigint;
          totalSupply: bigint;
          maxOffers: bigint;
          maxRaising: bigint;
          launchTime: bigint;
          offers: bigint;
          funds: bigint;
          lastPrice: bigint;
          K: bigint;
          T: bigint;
          status: bigint;
        }>,
        this.factory._tokenInfoEx1s(tokenAddress) as Promise<{
          launchFee: bigint;
          pcFee: bigint;
          feeSetting: bigint;
          blockNumber: bigint;
          extraFee: bigint;
        }>,
        new ethers.Contract(tokenAddress, TOKEN_ABI, this.provider),
      ]);

      const [name, symbol] = await Promise.all([
        tokenContract.name() as Promise<string>,
        tokenContract.symbol() as Promise<string>,
      ]);

      return {
        name,
        symbol,
        creator: tokenInfo.base, // base is the creator address for four.meme
        totalSupply: tokenInfo.totalSupply,
        launchTime: tokenInfo.launchTime,
        offers: tokenInfo.offers,
        funds: tokenInfo.funds,
        lastPrice: tokenInfo.lastPrice,
        status: Number(tokenInfo.status),
        template: Number(tokenInfo.template),
        feeSetting: tokenInfoEx1.feeSetting,
      };
    } catch (error) {
      console.error(`[PumpDataFetcher] Error getting token info for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Get creator type from template bits
   * Template encoding: bits 10-15 contain the creator type
   * Creator type 5 = TaxToken
   */
  getCreatorType(template: bigint): number {
    return Number((template >> BigInt(10)) & BigInt(0x3F));
  }

  /**
   * Check if token is a TaxToken (creatorType == 5)
   */
  isTaxToken(template: bigint): boolean {
    return this.getCreatorType(template) === 5;
  }

  /**
   * Check if AntiSniperFeeMode is enabled (feeSetting > 0)
   */
  isAntiSniperFeeMode(feeSetting: bigint): boolean {
    return feeSetting > BigInt(0);
  }

  /**
   * Fetch all tokens from the factory by enumerating _tokens(index)
   */
  async fetchAllTokensFromFactory(limit: number = 100): Promise<Token[]> {
    const tokens: Token[] = [];

    if (!this.factory || !this.provider) {
      console.warn('[PumpDataFetcher] RPC not configured');
      return [];
    }

    try {
      const tokenCount = await this.factory._tokenCount() as bigint;
      console.log(`[PumpDataFetcher] Total tokens in factory: ${tokenCount}`);

      // Start from the latest and work backwards
      const startIndex = Math.max(0, Number(tokenCount) - limit);
      const endIndex = Number(tokenCount);

      for (let i = startIndex; i < endIndex; i++) {
        try {
          const tokenAddress = await this.factory._tokens(i) as string;

          if (tokenAddress === '0x0000000000000000000000000000000000000000') {
            continue;
          }

          const tokenInfo = await this.getTokenInfoFromContract(tokenAddress);
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

          tokens.push(token);
          this.db.saveToken(token);

          // Progress indicator
          if ((i - startIndex + 1) % 20 === 0) {
            console.log(`[PumpDataFetcher] Processed ${i - startIndex + 1}/${endIndex - startIndex} tokens`);
          }
        } catch (e) {
          console.warn(`[PumpDataFetcher] Error fetching token at index ${i}:`, (e as Error).message);
        }
      }

      console.log(`[PumpDataFetcher] Fetched ${tokens.length} tokens from factory`);
    } catch (error) {
      console.error('[PumpDataFetcher] Error fetching tokens from factory:', error);
    }

    return tokens;
  }

  /**
   * Fetch recent tokens from DexScreener (supports pump.fun and other BSC tokens)
   */
  async fetchRecentTokensFromDexScreener(limit: number = 50): Promise<Token[]> {
    const tokens: Token[] = [];

    try {
      console.log('[PumpDataFetcher] Fetching recent tokens from DexScreener...');

      // DexScreener has a recent tokens endpoint
      const response = await axios.get('https://api.dexscreener.com/latest/dex/tokens', {
        params: { limit },
        timeout: 15000,
      });

      if (response.data && Array.isArray(response.data.pairs)) {
        const pairs = response.data.pairs;

        for (const pair of pairs) {
          // Filter for BSC tokens only
          if (pair.chainId !== 'bsc') continue;

          const token: Token = {
            address: pair.baseToken.address,
            name: pair.baseToken.name,
            symbol: pair.baseToken.symbol,
            deployTime: new Date(pair.pairCreatedAt || Date.now()),
            graduationTime: new Date(pair.pairCreatedAt || Date.now()),
            devAddress: pair.baseToken.address, // Use token address as dev for now
            socialLinks: {},
          };

          tokens.push(token);
          this.db.saveToken(token);
        }
      }

      console.log(`[PumpDataFetcher] Found ${tokens.length} recent BSC tokens`);
    } catch (error) {
      console.error('[PumpDataFetcher] Error fetching from DexScreener:', error);
    }

    return tokens;
  }

  /**
   * Fetch recent tokens created in the last N days using TokenCreate event
   */
  async fetchRecentTokens(days: number = 14): Promise<Token[]> {
    // Use factory contract events
    if (!this.factory || !this.provider) {
      console.warn('[PumpDataFetcher] RPC not configured');
      return [];
    }

    const tokens: Token[] = [];
    const now = Date.now();
    const sinceMs = days * 24 * 60 * 60 * 1000;
    const sinceTimestamp = Math.floor((now - sinceMs) / 1000);

    try {
      const currentBlock = await this.provider.getBlockNumber();
      const maxBlocksPerQuery = 50000;
      const recentHours = days * 24;
      const fromBlock = Math.max(1, currentBlock - (recentHours * 7200));

      console.log(`[PumpDataFetcher] Querying factory contract for TokenCreate events...`);

      const filter = this.factory.filters.TokenCreate();

      for (let start = fromBlock; start <= currentBlock; start += maxBlocksPerQuery) {
        const end = Math.min(start + maxBlocksPerQuery - 1, currentBlock);

        try {
          const events = await this.factory.queryFilter(filter, start, end);

          for (const event of events) {
            if (!('args' in event) || !event.args) continue;

            const args = event.args as unknown as {
              creator: string;
              token: string;
              requestId: bigint;
              name: string;
              symbol: string;
              totalSupply: bigint;
              launchTime: bigint;
              launchFee: bigint;
            };

            const launchTime = Number(args.launchTime);
            if (launchTime < sinceTimestamp) continue;

            const tokenAddress = args.token;

            const token: Token = {
              address: tokenAddress,
              name: args.name,
              symbol: args.symbol,
              deployTime: new Date(launchTime * 1000),
              graduationTime: new Date(launchTime * 1000),
              devAddress: args.creator,
              socialLinks: {},
            };

            tokens.push(token);
            this.db.saveToken(token);
          }
        } catch (e) {
          console.warn(`  Error querying batch ${start}-${end}:`, (e as Error).message);
        }
      }

      console.log(`[PumpDataFetcher] Found ${tokens.length} tokens from TokenCreate events`);
      return tokens;
    } catch (error) {
      console.error('[PumpDataFetcher] Error fetching recent tokens:', error);
      return [];
    }
  }

  /**
   * Fetch transactions for a specific wallet
   */
  async fetchWalletTransactions(walletAddress: string, sinceBlock?: number): Promise<WalletActivity[]> {
    if (!this.provider) {
      console.warn('[PumpDataFetcher] RPC not configured');
      return [];
    }

    const activities: WalletActivity[] = [];

    try {
      const currentBlock = await this.provider.getBlockNumber();
      const fromBlock = sinceBlock || Math.max(1, currentBlock - 10000);

      const transferTopic = ethers.id('Transfer(address,address,uint256)');
      const toTopic = ethers.zeroPadValue(walletAddress, 32);

      const logs = await this.provider.getLogs({
        topics: [transferTopic, null, toTopic],
        fromBlock,
        toBlock: currentBlock,
      });

      for (const log of logs) {
        const activity: WalletActivity = {
          address: walletAddress,
          timestamp: (await this.provider!.getBlock(log.blockNumber))?.timestamp || 0,
          txHash: log.transactionHash,
          action: 'transfer',
          tokenAddress: log.address,
        };

        activities.push(activity);
        this.db.saveActivity(activity);
      }

      console.log(`[PumpDataFetcher] Found ${activities.length} transactions for ${walletAddress}`);
      return activities;
    } catch (error) {
      console.error('[PumpDataFetcher] Error fetching wallet transactions:', error);
      return [];
    }
  }

  /**
   * Fetch wallet positions by scanning their transaction history
   */
  async fetchWalletPositions(walletAddress: string): Promise<WalletPosition[]> {
    if (!this.provider) return [];

    const positions = new Map<string, WalletPosition>();

    try {
      const recentTokens = this.db.getRecentTokens(1000);

      for (const token of recentTokens) {
        const tokenContract = new ethers.Contract(token.address, TOKEN_ABI, this.provider);

        try {
          const balance = await tokenContract.balanceOf(walletAddress) as bigint;

          if (balance > 0n) {
            const existing = positions.get(token.address);
            const balanceNum = Number(balance) / 1e18;

            positions.set(token.address, {
              walletAddress,
              tokenAddress: token.address,
              buyAmount: existing?.buyAmount || 0,
              buyTime: existing?.buyTime || new Date(),
              currentValue: balanceNum,
              isHolding: true,
            });
          }
        } catch {
          // Token might not have standard ERC20 interface
        }
      }

      const result = Array.from(positions.values());

      for (const pos of result) {
        this.db.savePosition(pos);
      }

      console.log(`[PumpDataFetcher] Found ${result.length} positions for ${walletAddress}`);
      return result;
    } catch (error) {
      console.error('[PumpDataFetcher] Error fetching wallet positions:', error);
      return [];
    }
  }

  /**
   * Fetch trading events (TokenPurchase and TokenSale) for a specific token
   * @param tokenAddress Token address to fetch trades for
   * @param fromBlock Start block (default: recent 10000 blocks)
   * @returns Array of TokenTrade objects
   */
  async fetchTokenTrades(tokenAddress: string, fromBlock?: number): Promise<TokenTrade[]> {
    if (!this.factory || !this.provider) {
      console.warn('[PumpDataFetcher] RPC not configured');
      return [];
    }

    const trades: TokenTrade[] = [];

    try {
      const currentBlock = await this.provider.getBlockNumber();
      const startBlock = fromBlock || Math.max(1, currentBlock - 10000);

      // Fetch TokenPurchase events
      const purchaseFilter = this.factory.filters.TokenPurchase();
      const purchaseEvents = await this.factory.queryFilter(purchaseFilter, startBlock, currentBlock);

      for (const event of purchaseEvents) {
        if (!('args' in event) || !event.args) continue;

        const args = event.args as unknown as {
          token: string;
          account: string;
          price: bigint;
          amount: bigint;
          cost: bigint;
          fee: bigint;
          offers: bigint;
          funds: bigint;
        };

        if (args.token.toLowerCase() !== tokenAddress.toLowerCase()) continue;

        const block = await this.provider!.getBlock(event.blockNumber);
        const timestamp = Number(block?.timestamp || 0);

        trades.push({
          txHash: event.transactionHash,
          tokenAddress: args.token,
          account: args.account,
          action: 'buy',
          price: Number(args.price) / 1e18,
          amount: Number(args.amount) / 1e18,
          cost: Number(args.cost) / 1e18,
          fee: Number(args.fee) / 1e18,
          offers: Number(args.offers),
          funds: Number(args.funds) / 1e18,
          timestamp,
          blockNumber: event.blockNumber,
        });
      }

      // Fetch TokenSale events
      const saleFilter = this.factory.filters.TokenSale();
      const saleEvents = await this.factory.queryFilter(saleFilter, startBlock, currentBlock);

      for (const event of saleEvents) {
        if (!('args' in event) || !event.args) continue;

        const args = event.args as unknown as {
          token: string;
          account: string;
          price: bigint;
          amount: bigint;
          cost: bigint;
          fee: bigint;
          offers: bigint;
          funds: bigint;
        };

        if (args.token.toLowerCase() !== tokenAddress.toLowerCase()) continue;

        const block = await this.provider!.getBlock(event.blockNumber);
        const timestamp = Number(block?.timestamp || 0);

        trades.push({
          txHash: event.transactionHash,
          tokenAddress: args.token,
          account: args.account,
          action: 'sell',
          price: Number(args.price) / 1e18,
          amount: Number(args.amount) / 1e18,
          cost: Number(args.cost) / 1e18,
          fee: Number(args.fee) / 1e18,
          offers: Number(args.offers),
          funds: Number(args.funds) / 1e18,
          timestamp,
          blockNumber: event.blockNumber,
        });
      }

      // Sort by timestamp
      trades.sort((a, b) => a.timestamp - b.timestamp);

      console.log(`[PumpDataFetcher] Found ${trades.length} trades for ${tokenAddress}`);
    } catch (error) {
      console.error(`[PumpDataFetcher] Error fetching trades for ${tokenAddress}:`, error);
    }

    return trades;
  }

  /**
   * Fetch recent trades across all tokens in recent blocks
   * @param hours Number of hours to look back (default: 6)
   * @returns Array of TokenTrade objects
   */
  async fetchRecentTrades(hours: number = 6): Promise<TokenTrade[]> {
    if (!this.factory || !this.provider) {
      console.warn('[PumpDataFetcher] RPC not configured');
      return [];
    }

    const trades: TokenTrade[] = [];

    try {
      const currentBlock = await this.provider.getBlockNumber();
      const blocksPerHour = 7200; // BSC ~3 sec block time
      const fromBlock = Math.max(1, currentBlock - (hours * blocksPerHour));

      console.log(`[PumpDataFetcher] Fetching trades from blocks ${fromBlock} to ${currentBlock} (chunked)...`);

      // Helper function to fetch events in chunks
      const fetchEventsInChunks = async (
        filter: ethers.ContractEventPayload['filter'],
        from: number,
        to: number,
        chunkSize: number
      ): Promise<ethers.Log[]> => {
        const events: ethers.Log[] = [];
        let currentFrom = from;

        while (currentFrom <= to) {
          const currentTo = Math.min(currentFrom + chunkSize - 1, to);
          try {
            const chunkEvents = await this.factory!.queryFilter(filter, currentFrom, currentTo);
            events.push(...chunkEvents);
          } catch (error) {
            const rangeSize = currentTo - currentFrom;
            // If range size is 0 (single block) and still fails, give up
            if (rangeSize <= 0) {
              console.warn(`[PumpDataFetcher] Chunk ${currentFrom}-${currentTo} failed, skipping single block...`);
              currentFrom = currentTo + 1;
              continue;
            }
            // If midPoint equals currentFrom, we can't split further
            const midPoint = Math.floor((currentFrom + currentTo) / 2);
            if (midPoint <= currentFrom) {
              console.warn(`[PumpDataFetcher] Cannot split chunk further ${currentFrom}-${currentTo}, skipping...`);
              currentFrom = currentTo + 1;
              continue;
            }
            console.warn(`[PumpDataFetcher] Chunk ${currentFrom}-${currentTo} failed, retrying with smaller chunks...`);
            // Retry with smaller chunks
            const smallerChunkSize = Math.max(10, Math.floor(chunkSize / 2));
            const firstHalf = await fetchEventsInChunks(filter, currentFrom, midPoint, smallerChunkSize);
            const secondHalf = await fetchEventsInChunks(filter, midPoint + 1, currentTo, smallerChunkSize);
            events.push(...firstHalf, ...secondHalf);
            currentFrom = currentTo + 1;
            continue;
          }
          currentFrom = currentTo + 1;
        }

        return events;
      };

      // Fetch TokenPurchase events (chunked)
      const purchaseFilter = this.factory.filters.TokenPurchase();
      const purchaseEvents = await fetchEventsInChunks(purchaseFilter, fromBlock, currentBlock, MAX_BLOCKS_PER_QUERY);

      for (const event of purchaseEvents) {
        if (!('args' in event) || !event.args) continue;

        const args = event.args as unknown as {
          token: string;
          account: string;
          price: bigint;
          amount: bigint;
          cost: bigint;
          fee: bigint;
          offers: bigint;
          funds: bigint;
        };

        const block = await this.provider!.getBlock(event.blockNumber);
        const timestamp = Number(block?.timestamp || 0);

        trades.push({
          txHash: event.transactionHash,
          tokenAddress: args.token,
          account: args.account,
          action: 'buy',
          price: Number(args.price) / 1e18,
          amount: Number(args.amount) / 1e18,
          cost: Number(args.cost) / 1e18,
          fee: Number(args.fee) / 1e18,
          offers: Number(args.offers),
          funds: Number(args.funds) / 1e18,
          timestamp,
          blockNumber: event.blockNumber,
        });
      }

      // Fetch TokenSale events (chunked)
      const saleFilter = this.factory.filters.TokenSale();
      const saleEvents = await fetchEventsInChunks(saleFilter, fromBlock, currentBlock, MAX_BLOCKS_PER_QUERY);

      for (const event of saleEvents) {
        if (!('args' in event) || !event.args) continue;

        const args = event.args as unknown as {
          token: string;
          account: string;
          price: bigint;
          amount: bigint;
          cost: bigint;
          fee: bigint;
          offers: bigint;
          funds: bigint;
        };

        const block = await this.provider!.getBlock(event.blockNumber);
        const timestamp = Number(block?.timestamp || 0);

        trades.push({
          txHash: event.transactionHash,
          tokenAddress: args.token,
          account: args.account,
          action: 'sell',
          price: Number(args.price) / 1e18,
          amount: Number(args.amount) / 1e18,
          cost: Number(args.cost) / 1e18,
          fee: Number(args.fee) / 1e18,
          offers: Number(args.offers),
          funds: Number(args.funds) / 1e18,
          timestamp,
          blockNumber: event.blockNumber,
        });
      }

      // Sort by timestamp descending (newest first)
      trades.sort((a, b) => b.timestamp - a.timestamp);

      console.log(`[PumpDataFetcher] Found ${trades.length} recent trades`);
    } catch (error) {
      console.error('[PumpDataFetcher] Error fetching recent trades:', error);
    }

    return trades;
  }

  /**
   * Fetch trades in a specific block range (for real-time incremental scanning)
   * @param fromBlock Start block
   * @param toBlock End block
   * @returns Array of TokenTrade objects
   */
  async fetchTradesInRange(fromBlock: number, toBlock: number): Promise<TokenTrade[]> {
    if (!this.factory || !this.provider) {
      console.warn('[PumpDataFetcher] RPC not configured');
      return [];
    }

    const trades: TokenTrade[] = [];

    try {
      console.log(`[PumpDataFetcher] Fetching trades from blocks ${fromBlock} to ${toBlock}...`);

      // Helper function to fetch events in chunks
      const fetchEventsInChunks = async (
        filter: ethers.ContractEventPayload['filter'],
        from: number,
        to: number,
        chunkSize: number
      ): Promise<ethers.Log[]> => {
        const events: ethers.Log[] = [];
        let currentFrom = from;

        while (currentFrom <= to) {
          const currentTo = Math.min(currentFrom + chunkSize - 1, to);
          try {
            const chunkEvents = await this.factory!.queryFilter(filter, currentFrom, currentTo);
            events.push(...chunkEvents);
          } catch (error) {
            const rangeSize = currentTo - currentFrom;
            // If range size is 0 (single block) and still fails, give up
            if (rangeSize <= 0) {
              console.warn(`[PumpDataFetcher] Chunk ${currentFrom}-${currentTo} failed, skipping single block...`);
              currentFrom = currentTo + 1;
              continue;
            }
            // If midPoint equals currentFrom, we can't split further
            const midPoint = Math.floor((currentFrom + currentTo) / 2);
            if (midPoint <= currentFrom) {
              console.warn(`[PumpDataFetcher] Cannot split chunk further ${currentFrom}-${currentTo}, skipping...`);
              currentFrom = currentTo + 1;
              continue;
            }
            console.warn(`[PumpDataFetcher] Chunk ${currentFrom}-${currentTo} failed, retrying with smaller chunks...`);
            // Retry with smaller chunks
            const smallerChunkSize = Math.max(10, Math.floor(chunkSize / 2));
            const firstHalf = await fetchEventsInChunks(filter, currentFrom, midPoint, smallerChunkSize);
            const secondHalf = await fetchEventsInChunks(filter, midPoint + 1, currentTo, smallerChunkSize);
            events.push(...firstHalf, ...secondHalf);
            currentFrom = currentTo + 1;
            continue;
          }
          currentFrom = currentTo + 1;
        }

        return events;
      };

      // Fetch TokenPurchase events (chunked)
      const purchaseFilter = this.factory.filters.TokenPurchase();
      const purchaseEvents = await fetchEventsInChunks(purchaseFilter, fromBlock, toBlock, MAX_BLOCKS_PER_QUERY);

      for (const event of purchaseEvents) {
        if (!('args' in event) || !event.args) continue;

        const args = event.args as unknown as {
          token: string;
          account: string;
          price: bigint;
          amount: bigint;
          cost: bigint;
          fee: bigint;
          offers: bigint;
          funds: bigint;
        };

        const block = await this.provider!.getBlock(event.blockNumber);
        const timestamp = Number(block?.timestamp || 0);

        trades.push({
          txHash: event.transactionHash,
          tokenAddress: args.token,
          account: args.account,
          action: 'buy',
          price: Number(args.price) / 1e18,
          amount: Number(args.amount) / 1e18,
          cost: Number(args.cost) / 1e18,
          fee: Number(args.fee) / 1e18,
          offers: Number(args.offers),
          funds: Number(args.funds) / 1e18,
          timestamp,
          blockNumber: event.blockNumber,
        });
      }

      // Fetch TokenSale events (chunked)
      const saleFilter = this.factory.filters.TokenSale();
      const saleEvents = await fetchEventsInChunks(saleFilter, fromBlock, toBlock, MAX_BLOCKS_PER_QUERY);

      for (const event of saleEvents) {
        if (!('args' in event) || !event.args) continue;

        const args = event.args as unknown as {
          token: string;
          account: string;
          price: bigint;
          amount: bigint;
          cost: bigint;
          fee: bigint;
          offers: bigint;
          funds: bigint;
        };

        const block = await this.provider!.getBlock(event.blockNumber);
        const timestamp = Number(block?.timestamp || 0);

        trades.push({
          txHash: event.transactionHash,
          tokenAddress: args.token,
          account: args.account,
          action: 'sell',
          price: Number(args.price) / 1e18,
          amount: Number(args.amount) / 1e18,
          cost: Number(args.cost) / 1e18,
          fee: Number(args.fee) / 1e18,
          offers: Number(args.offers),
          funds: Number(args.funds) / 1e18,
          timestamp,
          blockNumber: event.blockNumber,
        });
      }

      // Sort by timestamp descending (newest first)
      trades.sort((a, b) => b.timestamp - a.timestamp);

      console.log(`[PumpDataFetcher] Found ${trades.length} trades in range ${fromBlock}-${toBlock}`);
    } catch (error) {
      console.error('[PumpDataFetcher] Error fetching trades in range:', error);
    }

    return trades;
  }

  /**
   * Get trading summary for a token
   * @param tokenAddress Token address
   * @param trades Optional pre-fetched trades
   * @returns TokenTradingInfo with aggregated data
   */
  async getTokenTradingSummary(tokenAddress: string, trades?: TokenTrade[]): Promise<TokenTradingInfo> {
    const allTrades = trades || await this.fetchTokenTrades(tokenAddress);

    const tokenTrades = allTrades.filter(
      t => t.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
    );

    const uniqueTraders = new Set<string>();
    let totalBuys = 0;
    let totalSells = 0;
    let totalVolume = 0;
    let totalFees = 0;
    let buyVolume = 0;
    let sellVolume = 0;
    let lastTradeTime = 0;
    const priceHistory: { timestamp: number; price: number }[] = [];

    for (const trade of tokenTrades) {
      uniqueTraders.add(trade.account);

      if (trade.action === 'buy') {
        totalBuys++;
        buyVolume += trade.cost;
      } else {
        totalSells++;
        sellVolume += trade.cost;
      }

      totalVolume += trade.cost;
      totalFees += trade.fee;
      lastTradeTime = Math.max(lastTradeTime, trade.timestamp);
      priceHistory.push({ timestamp: trade.timestamp, price: trade.price });
    }

    // Sort price history by timestamp
    priceHistory.sort((a, b) => a.timestamp - b.timestamp);

    return {
      tokenAddress,
      totalBuys,
      totalSells,
      totalVolume,
      totalFees,
      buyVolume,
      sellVolume,
      uniqueTraders,
      smartMoneyTrades: [], // Will be populated by caller if needed
      lastTradeTime,
      priceHistory,
    };
  }

  /**
   * Calculate effective fee rate for a trade
   * @param trade TokenTrade object
   * @returns Fee rate as percentage (e.g., 1.5 for 1.5%)
   */
  calculateFeeRate(trade: TokenTrade): number {
    if (trade.cost === 0) return 0;
    return (trade.fee / trade.cost) * 100;
  }

  /**
   * Get fee information for a token from contract
   * @param tokenAddress Token address
   * @returns Object with fee details
   */
  async getTokenFeeInfo(tokenAddress: string): Promise<{
    launchFee: bigint;
    pcFee: bigint;
    feeSetting: bigint;
    extraFee: bigint;
    isAntiSniper: boolean;
    antiSniperFeeRate: number;
  } | null> {
    if (!this.factory) return null;

    try {
      const feeInfo = await this.factory._tokenInfoEx1s(tokenAddress) as {
        launchFee: bigint;
        pcFee: bigint;
        feeSetting: bigint;
        blockNumber: bigint;
        extraFee: bigint;
      };

      const isAntiSniper = feeInfo.feeSetting > BigInt(0);
      // AntiSniper fee rate is stored in basis points (100 = 1%)
      const antiSniperFeeRate = isAntiSniper ? Number(feeInfo.feeSetting) / 100 : 0;

      return {
        launchFee: feeInfo.launchFee,
        pcFee: feeInfo.pcFee,
        feeSetting: feeInfo.feeSetting,
        extraFee: feeInfo.extraFee,
        isAntiSniper,
        antiSniperFeeRate,
      };
    } catch (error) {
      console.error(`[PumpDataFetcher] Error getting fee info for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Fetch trades for smart money wallets specifically
   * @param walletAddresses Array of wallet addresses to track
   * @param hours Number of hours to look back
   * @returns Array of TokenTrade objects from smart wallets
   */
  async fetchSmartMoneyTrades(walletAddresses: string[], hours: number = 24): Promise<TokenTrade[]> {
    const allTrades = await this.fetchRecentTrades(hours);
    const walletSet = new Set(walletAddresses.map(w => w.toLowerCase()));

    const smartMoneyTrades = allTrades.filter(
      trade => walletSet.has(trade.account.toLowerCase())
    );

    console.log(`[PumpDataFetcher] Found ${smartMoneyTrades.length} smart money trades`);
    return smartMoneyTrades;
  }

  /**
   * Export data for regression testing
   */
  exportForRegressionTesting(): {
    tokens: Token[];
    positions: WalletPosition[];
    activities: WalletActivity[];
  } {
    const tokens = this.db.getRecentTokens(1000);
    const watchedWallets = config.watchedWallets;

    const positions: WalletPosition[] = [];
    const activities: WalletActivity[] = [];

    for (const wallet of watchedWallets) {
      positions.push(...this.db.getPositionsByWallet(wallet));
      activities.push(...this.db.getRecentActivities(wallet, 500));
    }

    return { tokens, positions, activities };
  }

  /**
   * Fetch all token trades from four.meme for a time range
   * @param days Number of days to look back
   * @returns All trades in the time range
   */
  async fetchAllTokenTrades(days: number = 14): Promise<TokenTrade[]> {
    if (!this.factory || !this.provider) {
      console.warn('[PumpDataFetcher] RPC not configured');
      return [];
    }

    const trades: TokenTrade[] = [];
    const now = Date.now();
    const sinceMs = days * 24 * 60 * 60 * 1000;
    const sinceTimestamp = Math.floor((now - sinceMs) / 1000);

    try {
      const currentBlock = await this.provider.getBlockNumber();
      const maxBlocksPerQuery = 50000;
      const recentHours = days * 24; // Convert days to hours
      const fromBlock = Math.max(1, currentBlock - (recentHours * 7200));

      console.log(`[PumpDataFetcher] Fetching all trades from blocks ${fromBlock} to ${currentBlock}...`);

      // Fetch TokenPurchase events
      const purchaseFilter = this.factory.filters.TokenPurchase();
      let purchaseEvents = [];
      for (let start = fromBlock; start <= currentBlock; start += maxBlocksPerQuery) {
        const end = Math.min(start + maxBlocksPerQuery - 1, currentBlock);
        try {
          const events = await this.factory.queryFilter(purchaseFilter, start, end);
          purchaseEvents.push(...events);
        } catch (e) {
          console.warn(`  Error querying purchase events ${start}-${end}:`, (e as Error).message);
        }
      }

      // Fetch TokenSale events
      const saleFilter = this.factory.filters.TokenSale();
      let saleEvents = [];
      for (let start = fromBlock; start <= currentBlock; start += maxBlocksPerQuery) {
        const end = Math.min(start + maxBlocksPerQuery - 1, currentBlock);
        try {
          const events = await this.factory.queryFilter(saleFilter, start, end);
          saleEvents.push(...events);
        } catch (e) {
          console.warn(`  Error querying sale events ${start}-${end}:`, (e as Error).message);
        }
      }

      // Process purchase events
      for (const event of purchaseEvents) {
        if (!('args' in event) || !event.args) continue;

        const args = event.args as unknown as {
          token: string;
          account: string;
          price: bigint;
          amount: bigint;
          cost: bigint;
          fee: bigint;
          offers: bigint;
          funds: bigint;
        };

        const block = await this.provider!.getBlock(event.blockNumber);
        const timestamp = Number(block?.timestamp || 0);

        if (timestamp < sinceTimestamp) continue;

        trades.push({
          txHash: event.transactionHash,
          tokenAddress: args.token,
          account: args.account,
          action: 'buy',
          price: Number(args.price) / 1e18,
          amount: Number(args.amount) / 1e18,
          cost: Number(args.cost) / 1e18,
          fee: Number(args.fee) / 1e18,
          offers: Number(args.offers),
          funds: Number(args.funds) / 1e18,
          timestamp,
          blockNumber: event.blockNumber,
        });
      }

      // Process sale events
      for (const event of saleEvents) {
        if (!('args' in event) || !event.args) continue;

        const args = event.args as unknown as {
          token: string;
          account: string;
          price: bigint;
          amount: bigint;
          cost: bigint;
          fee: bigint;
          offers: bigint;
          funds: bigint;
        };

        const block = await this.provider!.getBlock(event.blockNumber);
        const timestamp = Number(block?.timestamp || 0);

        if (timestamp < sinceTimestamp) continue;

        trades.push({
          txHash: event.transactionHash,
          tokenAddress: args.token,
          account: args.account,
          action: 'sell',
          price: Number(args.price) / 1e18,
          amount: Number(args.amount) / 1e18,
          cost: Number(args.cost) / 1e18,
          fee: Number(args.fee) / 1e18,
          offers: Number(args.offers),
          funds: Number(args.funds) / 1e18,
          timestamp,
          blockNumber: event.blockNumber,
        });
      }

      // Sort by timestamp descending
      trades.sort((a, b) => b.timestamp - a.timestamp);

      console.log(`[PumpDataFetcher] Fetched ${trades.length} trades in ${days} days`);
    } catch (error) {
      console.error('[PumpDataFetcher] Error fetching all trades:', error);
    }

    return trades;
  }

  private async getTokenDetails(tokenAddress: string): Promise<{ name: string; symbol: string }> {
    if (!this.provider) {
      return { name: 'Unknown', symbol: '???' };
    }

    try {
      const tokenContract = new ethers.Contract(tokenAddress, TOKEN_ABI, this.provider);
      const [name, symbol] = await Promise.all([
        tokenContract.name() as Promise<string>,
        tokenContract.symbol() as Promise<string>,
      ]);
      return { name, symbol };
    } catch {
      return { name: 'Unknown', symbol: '???' };
    }
  }
}
