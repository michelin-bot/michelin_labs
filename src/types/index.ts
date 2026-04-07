// Token information
export interface Token {
  address: string;
  name: string;
  symbol: string;
  deployTime: Date;
  graduationTime: Date;
  devAddress: string;
  socialLinks: {
    twitter?: string;
    telegram?: string;
    website?: string;
  };
}

// Wallet position
export interface WalletPosition {
  walletAddress: string;
  tokenAddress: string;
  buyAmount: number;
  buyTime: Date;
  currentValue: number;
  isHolding: boolean;
  sellTime?: Date;
  profit?: number;
}

// Smart wallet configuration
export interface SmartWallet {
  address: string;
  name?: string;
  winRate: number;
  totalTrades: number;
  avgProfit: number;
  isActive: boolean;
}

// Score input data
export interface TokenScoreInput {
  token: Token;
  smartWalletHolders: WalletPosition[];
  smartWalletBuyers: WalletPosition[];
  holderGrowth: {
    oneHour: number;
    growthRate: number;
  };
  tradingVolume: {
    oneHour: number;
    buyCount: number;
    sellCount: number;
    buySellRatio: number;
  };
  devHistory: {
    totalCoins: number;
    gemCoins: number;
    rugCoins: number;
    isRugger: boolean;
  };
  discoveryMethod: 'signal' | 'scan';
  narrative: {
    type: string;      // Narrative type (e.g., 'ai', 'meme', '') - empty if no narrative
    strength: 1 | 2 | 3 | 4 | 5;  // Narrative strength, only meaningful when type is non-empty
    isCTO: boolean;
  };
  devHolding: number;
  insiderHolding: number;
}

// Alert message
export interface AlertMessage {
  type: 'wallet_activity' | 'score_change' | 'token_alert';
  title: string;
  content: string;
  data?: unknown;
  timestamp: number;
}

// Wallet activity
export interface WalletActivity {
  address: string;
  timestamp: number;
  txHash: string;
  action: 'buy' | 'sell' | 'transfer' | 'unknown';
  tokenAddress?: string;
  tokenSymbol?: string;
  amount?: string;
  valueInBnb?: string;
  fee?: string;        // Trading fee in quote
  price?: number;      // Price per token
}

// Wallet score
export interface WalletScore {
  address: string;
  totalScore: number;
  factors: {
    tradingFrequency: number;
    profitRate: number;
    holdingPeriod: number;
    tokenDiversity: number;
    interactionCount: number;
  };
  updatedAt: number;
}

// Scanned token
export interface ScannedToken {
  address: string;
  symbol: string;
  name: string;
  deployer: string;
  creationTime: number;
  initialLiquidity?: string;
  totalSupply?: string;
}

// Token trade event (from TokenPurchase/TokenSale)
export interface TokenTrade {
  txHash: string;
  tokenAddress: string;
  account: string;
  action: 'buy' | 'sell';
  price: number;      // Price per token (in quote, e.g., BNB)
  amount: number;      // Amount of tokens traded
  cost: number;        // Total cost (in quote)
  fee: number;        // Fee paid (in quote)
  offers: number;     // Offers at time of trade
  funds: number;      // Funds at time of trade
  timestamp: number;
  blockNumber: number;
}

// Token trading summary
export interface TokenTradingInfo {
  tokenAddress: string;
  totalBuys: number;
  totalSells: number;
  totalVolume: number;      // Total quote volume
  totalFees: number;        // Total fees paid
  buyVolume: number;
  sellVolume: number;
  uniqueTraders: Set<string>;
  smartMoneyTrades: TokenTrade[];
  lastTradeTime: number;
  priceHistory: { timestamp: number; price: number }[];
}

// Extended token info from four.meme contract
export interface FourMemeTokenInfo {
  address: string;
  creator: string;
  template: bigint;
  totalSupply: bigint;
  maxOffers: bigint;
  maxRaising: bigint;
  launchTime: bigint;
  offers: bigint;
  funds: bigint;
  lastPrice: bigint;
  status: number;
  // Extended info
  launchFee: bigint;
  pcFee: bigint;
  feeSetting: bigint;
  blockNumber: bigint;
  extraFee: bigint;
  // Flags
  isTaxToken: boolean;
  isAntiSniperFeeMode: boolean;
  isXModeExclusive: boolean;
  isAgentCreator: boolean;
}
