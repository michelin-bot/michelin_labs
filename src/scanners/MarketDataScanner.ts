import axios from 'axios';

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  pairCreatedAt: number;
}

interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[];
}

export interface MarketData {
  tokenAddress: string;
  priceUsd: string;
  priceChange24h: number;
  volume24h: number;
  liquidityUsd: number;
  buyCount24h: number;
  sellCount24h: number;
  holderCount?: number;
  pairAddress: string;
  updatedAt: number;
}

export class MarketDataScanner {
  private baseUrl = 'https://api.dexscreener.com/latest/dex/tokens';
  private httpClient = axios.create({
    timeout: 10000,
    validateStatus: (status) => status < 500, // Don't throw for 4xx errors
  });

  async getMarketData(tokenAddress: string): Promise<MarketData | null> {
    try {
      const response = await this.httpClient.get<DexScreenerResponse>(
        `${this.baseUrl}/${tokenAddress}`
      );

      if (response.status !== 200 || !response.data) {
        console.error(`DexScreener API error: ${response.status} for ${tokenAddress}`);
        return null;
      }

      const data = response.data;

      if (!data.pairs || data.pairs.length === 0) {
        return null;
      }

      // Filter for BSC pairs first, then get highest liquidity
      const bscPairs = data.pairs.filter(p => p.chainId === 'bsc');
      const sortedPairs = bscPairs.length > 0 ? bscPairs : data.pairs;
      const topPair = sortedPairs.sort((a, b) => b.liquidity.usd - a.liquidity.usd)[0];

      const buyCount24h = topPair.txns.h24.buys;
      const sellCount24h = topPair.txns.h24.sells;

      return {
        tokenAddress,
        priceUsd: topPair.priceUsd || '0',
        priceChange24h: topPair.priceChange.h24,
        volume24h: topPair.volume.h24,
        liquidityUsd: topPair.liquidity.usd,
        buyCount24h,
        sellCount24h,
        pairAddress: topPair.pairAddress,
        updatedAt: Date.now(),
      };
    } catch (error) {
      console.error(`Failed to fetch market data for ${tokenAddress}:`, error);
      return null;
    }
  }

  async getMultipleMarketData(tokenAddresses: string[]): Promise<Map<string, MarketData>> {
    const results = new Map<string, MarketData>();

    // Fetch in parallel with concurrency limit
    const batchSize = 5;
    for (let i = 0; i < tokenAddresses.length; i += batchSize) {
      const batch = tokenAddresses.slice(i, i + batchSize);
      const promises = batch.map(addr => this.getMarketData(addr));
      const batchResults = await Promise.all(promises);

      batchResults.forEach((result, index) => {
        if (result) {
          results.set(batch[index], result);
        }
      });
    }

    return results;
  }
}
