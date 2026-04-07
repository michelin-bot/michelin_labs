import { ethers } from 'ethers';
import { Token, TokenTrade, TokenTradingInfo } from '../types';
import { config } from '../config';

// Four.meme TokenManager2 Contract ABI (from TokenManager2.lite.abi)
const FOUR_MEME_FACTORY_ABI = [
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

// ERC20 token ABI for reading token details
const TOKEN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
];

// Four.meme TokenManager2 factory address
const FOUR_MEME_FACTORY_ADDRESS = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';

// Token status constants
const STATUS = {
  ADDING_LIQUIDITY: 0,
  TRADING: 1,
  COMPLETED: 2,
  HALT: 3,
};

export class TokenScanner {
  private provider: ethers.JsonRpcProvider | null = null;
  private factory: ethers.Contract | null = null;

  constructor() {
    if (config.bscRpcUrl) {
      this.provider = new ethers.JsonRpcProvider(config.bscRpcUrl);
      this.factory = new ethers.Contract(
        FOUR_MEME_FACTORY_ADDRESS,
        FOUR_MEME_FACTORY_ABI,
        this.provider
      );
    }
  }

  /**
   * Scan for new tokens by querying recent TokenCreate events
   */
  async scanNewTokens(sinceBlock?: number): Promise<Token[]> {
    if (!this.factory || !this.provider) {
      console.warn('[TokenScanner] RPC not configured');
      return [];
    }

    try {
      const currentBlock = await this.provider.getBlockNumber();
      const fromBlock = sinceBlock || Math.max(1, currentBlock - 10000);

      console.log(`[TokenScanner] Scanning blocks ${fromBlock} to ${currentBlock} for TokenCreate events...`);

      const filter = this.factory.filters.TokenCreate();
      const events = await this.factory.queryFilter(filter, fromBlock, currentBlock);

      console.log(`[TokenScanner] Found ${events.length} TokenCreate events`);

      const tokens: Token[] = [];

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

        const tokenAddress = args.token;
        const launchTime = Number(args.launchTime);

        tokens.push({
          address: tokenAddress,
          name: args.name,
          symbol: args.symbol,
          deployTime: new Date(launchTime * 1000),
          graduationTime: new Date(launchTime * 1000),
          devAddress: args.creator,
          socialLinks: {},
        });
      }

      return tokens;
    } catch (error) {
      console.error('[TokenScanner] Error scanning tokens:', error);
      return [];
    }
  }

  /**
   * Get detailed info for a specific token from the contract
   */
  async getTokenInfo(tokenAddress: string): Promise<{
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
        creator: tokenInfo.base,
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
      console.error(`[TokenScanner] Error getting token info for ${tokenAddress}:`, error);
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
   * Get all tokens by enumerating _tokens(index)
   */
  async getAllTokens(limit: number = 100): Promise<string[]> {
    if (!this.factory) {
      console.warn('[TokenScanner] Factory not configured');
      return [];
    }

    try {
      const tokenCount = await this.factory._tokenCount() as bigint;
      const tokens: string[] = [];

      const startIndex = Math.max(0, Number(tokenCount) - limit);
      const endIndex = Number(tokenCount);

      for (let i = startIndex; i < endIndex; i++) {
        try {
          const tokenAddress = await this.factory._tokens(i) as string;
          if (tokenAddress !== '0x0000000000000000000000000000000000000000') {
            tokens.push(tokenAddress);
          }
        } catch (e) {
          console.warn(`[TokenScanner] Error fetching token at index ${i}`);
        }
      }

      return tokens;
    } catch (error) {
      console.error('[TokenScanner] Error getting all tokens:', error);
      return [];
    }
  }

  /**
   * Get the total number of tokens
   */
  async getTokenCount(): Promise<number> {
    if (!this.factory) {
      return 0;
    }

    try {
      const count = await this.factory._tokenCount() as bigint;
      return Number(count);
    } catch (error) {
      console.error('[TokenScanner] Error getting token count:', error);
      return 0;
    }
  }

  /**
   * Check if a specific token exists on four.meme
   */
  async isFourMemeToken(tokenAddress: string): Promise<boolean> {
    if (!this.factory) {
      return false;
    }

    try {
      const tokenInfo = await this.factory._tokenInfos(tokenAddress);
      return tokenInfo.base !== '0x0000000000000000000000000000000000000000';
    } catch {
      return false;
    }
  }

  /**
   * Get token status description
   */
  getStatusName(status: number): string {
    switch (status) {
      case STATUS.ADDING_LIQUIDITY:
        return 'Adding Liquidity';
      case STATUS.TRADING:
        return 'Trading';
      case STATUS.COMPLETED:
        return 'Completed';
      case STATUS.HALT:
        return 'Halted';
      default:
        return 'Unknown';
    }
  }

  /**
   * Check if token is X Mode exclusive
   * X Mode flag is in bit 16 of template
   */
  isXModeExclusive(template: bigint): boolean {
    return (template & BigInt(0x10000)) !== BigInt(0);
  }

  /**
   * Check if token was created by an Agent
   * Agent flag is in bit 85 of template
   */
  isAgentCreator(template: bigint): boolean {
    return (template & (BigInt(1) << BigInt(85))) !== BigInt(0);
  }

  /**
   * Fetch trading events for a specific token
   * @param tokenAddress Token address
   * @param fromBlock Start block (default: recent 10000 blocks)
   * @returns Array of TokenTrade objects
   */
  async fetchTokenTrades(tokenAddress: string, fromBlock?: number): Promise<TokenTrade[]> {
    if (!this.factory || !this.provider) {
      console.warn('[TokenScanner] RPC not configured');
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
    } catch (error) {
      console.error(`[TokenScanner] Error fetching trades for ${tokenAddress}:`, error);
    }

    return trades;
  }

  /**
   * Get trading summary for a token
   */
  getTokenTradingSummary(trades: TokenTrade[]): TokenTradingInfo {
    const uniqueTraders = new Set<string>();
    let totalBuys = 0;
    let totalSells = 0;
    let totalVolume = 0;
    let totalFees = 0;
    let buyVolume = 0;
    let sellVolume = 0;
    let lastTradeTime = 0;
    const priceHistory: { timestamp: number; price: number }[] = [];

    for (const trade of trades) {
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

    priceHistory.sort((a, b) => a.timestamp - b.timestamp);

    return {
      tokenAddress: trades[0]?.tokenAddress || '',
      totalBuys,
      totalSells,
      totalVolume,
      totalFees,
      buyVolume,
      sellVolume,
      uniqueTraders,
      smartMoneyTrades: [],
      lastTradeTime,
      priceHistory,
    };
  }

  /**
   * Calculate fee rate from cost and fee
   */
  calculateFeeRate(cost: number, fee: number): number {
    if (cost === 0) return 0;
    return (fee / cost) * 100;
  }

  /**
   * Create a mock token for testing
   */
  static createMockToken(address: string, symbol: string, name: string, devAddress?: string): Token {
    const now = new Date();
    return {
      address,
      symbol,
      name,
      deployTime: now,
      graduationTime: now,
      devAddress: devAddress || '0x0000000000000000000000000000000000000000',
      socialLinks: {},
    };
  }
}
