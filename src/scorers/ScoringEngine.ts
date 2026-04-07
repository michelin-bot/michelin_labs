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

    // ========== 拉盘证据（加分项）==========

    // 1. 聪明钱在持 - 权重15分
    if (input.smartWalletHolders.length >= 1) {
      bullish.push({
        reason: `${input.smartWalletHolders.length}个聪明钱在持`,
        points: 15,
      });
    }

    // 2. 聪明钱聚集 - 权重20分
    if (input.smartWalletBuyers.length >= 3) {
      bullish.push({
        reason: `${input.smartWalletBuyers.length}个聪明钱买入`,
        points: 20,
      });
    }

    // 3. 持有人暴增 - 权重10分
    if (input.holderGrowth.growthRate > 10) {
      bullish.push({
        reason: `1小时持有人+${input.holderGrowth.oneHour}人(+${input.holderGrowth.growthRate.toFixed(1)}%)`,
        points: 10,
      });
    }

    // 4. 买压强势 - 权重8分
    if (input.tradingVolume.buySellRatio > 2) {
      bullish.push({
        reason: `1小时买卖比${input.tradingVolume.buySellRatio.toFixed(1)}`,
        points: 8,
      });
    }

    // 5. 成交量大 - 权重8分
    if (input.tradingVolume.oneHour > 20000) {
      bullish.push({
        reason: `1小时成交${(input.tradingVolume.oneHour / 10000).toFixed(1)}万美元`,
        points: 8,
      });
    }

    // 6. Dev出过好币 - 权重10分
    if (input.devHistory.gemCoins > 0 && input.devHistory.rugCoins === 0) {
      bullish.push({
        reason: `Dev发过${input.devHistory.totalCoins}个币，gem ${input.devHistory.gemCoins}次`,
        points: 10,
      });
    }

    // 7. 发现得早 - 权重8分
    const now = Date.now();
    const graduationAge = (now - input.token.graduationTime.getTime()) / (1000 * 60); // minutes
    if (graduationAge < 180) { // 3小时 = 180分钟
      bullish.push({
        reason: `毕业仅${Math.round(graduationAge)}分钟`,
        points: 8,
      });
    }

    // 8. 叙事匹配 - 权重15分（基础分），强度4-5分乘1.5倍
    if (input.narrative.strength >= 1 && input.narrative.type && input.narrative.type !== '') {
      const basePoints = 15;
      const multiplier = input.narrative.strength >= 4 ? 1.5 : 1;
      const points = Math.round(basePoints * multiplier * 10) / 10;
      bullish.push({
        reason: `叙事类型 [${input.narrative.type}] 强度${input.narrative.strength}/5`,
        points,
      });
    }

    // 9. 信号驱动发现 - 权重12分
    if (input.discoveryMethod === 'signal') {
      bullish.push({
        reason: '由聪明钱信号触发发现',
        points: 12,
      });
    }

    // 10. 有社交账号 - 权重3分
    const socials: string[] = [];
    if (input.token.socialLinks.twitter) socials.push('Twitter');
    if (input.token.socialLinks.telegram) socials.push('Telegram');
    if (input.token.socialLinks.website) socials.push('Website');
    if (socials.length > 0) {
      bullish.push({
        reason: `有${socials.join('+')}`,
        points: 3,
      });
    }

    // 11. 社区接管 - 权重5分
    if (input.narrative.isCTO) {
      bullish.push({
        reason: '社区接管(CTO)',
        points: 5,
      });
    }

    // ========== 砸盘证据（扣分项）==========

    // 1. 聪明钱跑了 - 扣15分
    const allSmartMoneySold = input.smartWalletBuyers.length > 0 && input.smartWalletHolders.length === 0;
    if (allSmartMoneySold) {
      bearish.push({
        reason: `${input.smartWalletBuyers.length}个聪明钱已全部卖出`,
        points: -15,
      });
    }

    // 2. Dev持仓太高 - 扣15分
    if (input.devHolding > 10) {
      bearish.push({
        reason: `Dev持仓${input.devHolding.toFixed(1)}%`,
        points: -15,
      });
    }

    // 3. 内部人控盘 - 扣12分
    if (input.insiderHolding > 40) {
      bearish.push({
        reason: `内部人+打包机+狙击手合计${input.insiderHolding.toFixed(1)}%`,
        points: -12,
      });
    }

    // 4. 卖压强势 - 扣8分
    if (input.tradingVolume.buyCount > 0 && input.tradingVolume.sellCount / input.tradingVolume.buyCount > 2) {
      bearish.push({
        reason: `1小时卖${input.tradingVolume.sellCount}笔/买${input.tradingVolume.buyCount}笔`,
        points: -8,
      });
    }

    // 5. Dev有rug前科 - 扣20分 (rug >= 1 but < 2)
    if (input.devHistory.rugCoins >= 1) {
      bearish.push({
        reason: `Dev有${input.devHistory.rugCoins}次rug历史`,
        points: -20,
      });
    }

    // 6. 没有任何社交 - 扣5分
    const hasNoSocials = !input.token.socialLinks.twitter && !input.token.socialLinks.telegram && !input.token.socialLinks.website;
    if (hasNoSocials) {
      bearish.push({
        reason: '无任何社交链接',
        points: -5,
      });
    }

    // 7. 币太老了 - 扣10分
    const ageInHours = graduationAge / 60;
    if (ageInHours > 24) {
      const days = Math.floor(ageInHours / 24);
      bearish.push({
        reason: `毕业已${days}天`,
        points: -10,
      });
    }

    // 8. 没有叙事 - 扣8分 (当type为空时即视为无叙事)
    if (!input.narrative.type || input.narrative.type === '') {
      bearish.push({
        reason: '未找到明确叙事',
        points: -8,
      });
    }

    // 计算总分
    const bullishScore = bullish.reduce((sum, item) => sum + item.points, 0);
    const bearishScore = Math.abs(bearish.reduce((sum, item) => sum + item.points, 0));
    const totalScore = bullishScore - bearishScore;

    // 生成摘要
    const holderCount = input.smartWalletHolders.length;
    const buyerCount = input.smartWalletBuyers.length;
    const summary = `${buyerCount > 0 ? `${buyerCount}个聪明钱买入` : ''}${buyerCount > 0 && holderCount > 0 ? '，' : ''}${holderCount > 0 ? `${holderCount}个在持` : ''}${buyerCount > 0 || holderCount > 0 ? '，' : ''}总评分${totalScore}分`;

    return {
      totalScore,
      bullishScore,
      bearishScore,
      details: { bullish, bearish },
      summary: summary || '无明显信号',
    };
  }
}
