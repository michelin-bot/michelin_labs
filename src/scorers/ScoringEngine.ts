import { TokenScoreInput } from '../types';

export interface ScoreResult {
  totalScore: number;
  bullishScore: number;
  bearishScore: number;
  details: {
    bullish: Array<{ reason: string; points: number }>;
    bearish: Array<{ reason: string; points: number }>;
  };
  summary: string;
}

export class ScoringEngine {
  calculate(input: TokenScoreInput): ScoreResult {
    const bullish: Array<{ reason: string; points: number }> = [];
    const bearish: Array<{ reason: string; points: number }> = [];

    // ========== Bullish Factors ==========

    // 1. Smart money holding - 15 points
    if (input.smartWalletHolders.length >= 1) {
      bullish.push({
        reason: `${input.smartWalletHolders.length} smart money holding`,
        points: 15,
      });
    }

    // 2. Smart money accumulation - 20 points
    if (input.smartWalletBuyers.length >= 3) {
      bullish.push({
        reason: `${input.smartWalletBuyers.length} smart money bought`,
        points: 20,
      });
    }

    // 3. Holder growth - 10 points
    if (input.holderGrowth.growthRate > 10) {
      bullish.push({
        reason: `1h holders +${input.holderGrowth.oneHour} (+${input.holderGrowth.growthRate.toFixed(1)}%)`,
        points: 10,
      });
    }

    // 4. Buy pressure - 8 points
    if (input.tradingVolume.buySellRatio > 2) {
      bullish.push({
        reason: `1h buy/sell ratio ${input.tradingVolume.buySellRatio.toFixed(1)}`,
        points: 8,
      });
    }

    // 5. High volume - 8 points
    if (input.tradingVolume.oneHour > 20000) {
      bullish.push({
        reason: `1h volume ${(input.tradingVolume.oneHour / 10000).toFixed(1)}k USD`,
        points: 8,
      });
    }

    // 6. Dev history (gem coins) - 10 points
    if (input.devHistory.gemCoins > 0 && input.devHistory.rugCoins === 0) {
      bullish.push({
        reason: `Dev launched ${input.devHistory.totalCoins} coins, gem ${input.devHistory.gemCoins}x`,
        points: 10,
      });
    }

    // 7. Early discovery - 8 points
    const now = Date.now();
    const graduationAge = (now - input.token.graduationTime.getTime()) / (1000 * 60); // minutes
    if (graduationAge < 180) { // 3 hours = 180 minutes
      bullish.push({
        reason: `Graduated ${Math.round(graduationAge)} min ago`,
        points: 8,
      });
    }

    // 8. Narrative match - 15 points base, 1.5x for strength 4-5
    if (input.narrative.strength >= 1 && input.narrative.type && input.narrative.type !== '') {
      const basePoints = 15;
      const multiplier = input.narrative.strength >= 4 ? 1.5 : 1;
      const points = Math.round(basePoints * multiplier * 10) / 10;
      bullish.push({
        reason: `Narrative [${input.narrative.type}] strength ${input.narrative.strength}/5`,
        points,
      });
    }

    // 9. Signal-driven discovery - 12 points
    if (input.discoveryMethod === 'signal') {
      bullish.push({
        reason: 'Discovered via smart money signal',
        points: 12,
      });
    }

    // 10. Has social accounts - 3 points
    const socials: string[] = [];
    if (input.token.socialLinks.twitter) socials.push('Twitter');
    if (input.token.socialLinks.telegram) socials.push('Telegram');
    if (input.token.socialLinks.website) socials.push('Website');
    if (socials.length > 0) {
      bullish.push({
        reason: `Has ${socials.join('+')}`,
        points: 3,
      });
    }

    // 11. CTO (Community Takeover) - 5 points
    if (input.narrative.isCTO) {
      bullish.push({
        reason: 'Community Takeover (CTO)',
        points: 5,
      });
    }

    // ========== Bearish Factors ==========

    // 1. Smart money sold - 15 points
    const allSmartMoneySold = input.smartWalletBuyers.length > 0 && input.smartWalletHolders.length === 0;
    if (allSmartMoneySold) {
      bearish.push({
        reason: `${input.smartWalletBuyers.length} smart money all sold`,
        points: -15,
      });
    }

    // 2. High dev holding - 15 points
    if (input.devHolding > 10) {
      bearish.push({
        reason: `Dev holds ${input.devHolding.toFixed(1)}%`,
        points: -15,
      });
    }

    // 3. Insider control - 12 points
    if (input.insiderHolding > 40) {
      bearish.push({
        reason: `Insiders+packers+snipers ${input.insiderHolding.toFixed(1)}%`,
        points: -12,
      });
    }

    // 4. Sell pressure - 8 points
    if (input.tradingVolume.buyCount > 0 && input.tradingVolume.sellCount / input.tradingVolume.buyCount > 2) {
      bearish.push({
        reason: `1h sell ${input.tradingVolume.sellCount}/buy ${input.tradingVolume.buyCount}`,
        points: -8,
      });
    }

    // 5. Dev rug history - 20 points
    if (input.devHistory.rugCoins >= 1) {
      bearish.push({
        reason: `Dev has ${input.devHistory.rugCoins}x rug history`,
        points: -20,
      });
    }

    // 6. No social links - 5 points
    const hasNoSocials = !input.token.socialLinks.twitter && !input.token.socialLinks.telegram && !input.token.socialLinks.website;
    if (hasNoSocials) {
      bearish.push({
        reason: 'No social links',
        points: -5,
      });
    }

    // 7. Token too old - 10 points
    const ageInHours = graduationAge / 60;
    if (ageInHours > 24) {
      const days = Math.floor(ageInHours / 24);
      bearish.push({
        reason: `Graduated ${days} days ago`,
        points: -10,
      });
    }

    // 8. No narrative - 8 points
    if (!input.narrative.type || input.narrative.type === '') {
      bearish.push({
        reason: 'No clear narrative',
        points: -8,
      });
    }

    // Calculate total score
    const bullishScore = bullish.reduce((sum, item) => sum + item.points, 0);
    const bearishScore = Math.abs(bearish.reduce((sum, item) => sum + item.points, 0));
    const totalScore = bullishScore - bearishScore;

    // Generate summary
    const holderCount = input.smartWalletHolders.length;
    const buyerCount = input.smartWalletBuyers.length;
    const summary = `${buyerCount > 0 ? `${buyerCount} smart money bought` : ''}${buyerCount > 0 && holderCount > 0 ? ', ' : ''}${holderCount > 0 ? `${holderCount} holding` : ''}${buyerCount > 0 || holderCount > 0 ? ', ' : ''}score ${totalScore}`;

    return {
      totalScore,
      bullishScore,
      bearishScore,
      details: { bullish, bearish },
      summary: summary || 'No clear signals',
    };
  }
}
