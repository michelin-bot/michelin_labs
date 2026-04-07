import TelegramBot from 'node-telegram-bot-api';
import { AlertMessage } from '../types';
import { config } from '../config';
import { formatAddress } from '../utils';

export class AlertManager {
  private bot: TelegramBot | null = null;
  private chatId: string;
  private enabled: boolean = false;

  constructor() {
    this.chatId = config.telegram.chatId;

    if (config.telegram.botToken && this.chatId) {
      try {
        this.bot = new TelegramBot(config.telegram.botToken, { polling: false });
        this.enabled = true;
        console.log('[AlertManager] Telegram bot initialized');
      } catch (error) {
        console.error('[AlertManager] Failed to initialize bot:', error);
      }
    } else {
      console.warn('[AlertManager] Bot token or chat ID not configured');
    }
  }

  async send(alert: AlertMessage): Promise<boolean> {
    if (!this.enabled || !this.bot) {
      console.log('[AlertManager] Bot not enabled, skipping alert');
      return false;
    }

    try {
      const message = this.formatMessage(alert);
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
      console.log(`[AlertManager] Alert sent: ${alert.title}`);
      return true;
    } catch (error) {
      console.error('[AlertManager] Failed to send alert:', error);
      return false;
    }
  }

  async sendScoreAlert(
    tokenSymbol: string,
    tokenAddress: string,
    score: number,
    bullishScore: number,
    bearishScore: number,
    summary: string
  ): Promise<boolean> {
    const emoji = score >= 50 ? '🟢' : score >= 20 ? '🟡' : '🔴';
    const message = `
${emoji} <b>代币评分更新</b>

🏷️ <b>${tokenSymbol}</b>
📍 ${formatAddress(tokenAddress)}

📊 评分: <b>${score}</b> 分
   • 拉盘证据: +${bullishScore}
   • 砸盘证据: -${bearishScore}

📝 ${summary}

🔗 <a href="https://dexscreener.com/bsc/${tokenAddress}">DexScreener</a>
`;

    const alert: AlertMessage = {
      type: 'score_change',
      title: `${tokenSymbol} 评分 ${score}分`,
      content: summary,
      timestamp: Date.now(),
      data: { tokenAddress, score, bullishScore, bearishScore },
    };

    return this.send(alert);
  }

  async sendWalletActivityAlert(
    walletName: string,
    walletAddress: string,
    action: string,
    tokenSymbol: string,
    amount: string,
    valueInBnb: string
  ): Promise<boolean> {
    const emoji = action === 'buy' ? '🟢买入' : action === 'sell' ? '🔴卖出' : '📤转账';

    const message = `
${emoji} <b>聪明钱活动</b>

👛 <b>${walletName}</b>
📍 ${formatAddress(walletAddress)}

${action === 'buy' ? '🟢' : '🔴'} 操作: <b>${action.toUpperCase()}</b>
💰 代币: ${tokenSymbol}
💎 数量: ${amount}
💵 价值: ${valueInBnb} BNB
`;

    const alert: AlertMessage = {
      type: 'wallet_activity',
      title: `${walletName} ${action} ${tokenSymbol}`,
      content: `${walletName} ${action} ${amount} ${tokenSymbol}`,
      timestamp: Date.now(),
      data: { walletAddress, tokenSymbol, action, amount, valueInBnb },
    };

    return this.send(alert);
  }

  async sendTokenAlert(
    tokenSymbol: string,
    tokenAddress: string,
    alertType: 'new_token' | 'high_score' | ' whale_dump',
    details: string
  ): Promise<boolean> {
    const emoji = alertType === 'new_token' ? '🆕' : alertType === 'high_score' ? '🚨' : '🐋';
    const title = alertType === 'new_token' ? '新币发现' : alertType === 'high_score' ? '高分警报' : '鲸鱼砸盘';

    const message = `
${emoji} <b>${title}</b>

🏷️ <b>${tokenSymbol}</b>
📍 ${formatAddress(tokenAddress)}

📋 ${details}

🔗 <a href="https://dexscreener.com/bsc/${tokenAddress}">DexScreener</a>
`;

    const alert: AlertMessage = {
      type: 'token_alert',
      title: `${title}: ${tokenSymbol}`,
      content: details,
      timestamp: Date.now(),
      data: { tokenAddress, alertType },
    };

    return this.send(alert);
  }

  private formatMessage(alert: AlertMessage): string {
    const time = new Date(alert.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    let message = `
📨 <b>${alert.title}</b>

${alert.content}

🕐 ${time}
`;

    return message;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
