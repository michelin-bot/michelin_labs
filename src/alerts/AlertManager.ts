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
${emoji} <b>Token Score Update</b>

🏷️ <b>${tokenSymbol}</b>
📍 ${formatAddress(tokenAddress)}

📊 Score: <b>${score}</b>
   • Bullish: +${bullishScore}
   • Bearish: -${bearishScore}

📝 ${summary}

🔗 <a href="https://dexscreener.com/bsc/${tokenAddress}">DexScreener</a>
`;

    const alert: AlertMessage = {
      type: 'score_change',
      title: `${tokenSymbol} Score ${score}`,
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
    const emoji = action === 'buy' ? '🟢 BUY' : action === 'sell' ? '🔴 SELL' : '📤 TRANSFER';

    const message = `
${emoji} <b>Smart Money Activity</b>

👛 <b>${walletName}</b>
📍 ${formatAddress(walletAddress)}

${action === 'buy' ? '🟢' : '🔴'} Action: <b>${action.toUpperCase()}</b>
💰 Token: ${tokenSymbol}
💎 Amount: ${amount}
💵 Value: ${valueInBnb} BNB
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
    const title = alertType === 'new_token' ? 'New Token' : alertType === 'high_score' ? 'High Score Alert' : 'Whale Dump';

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
    const time = new Date(alert.timestamp).toLocaleString();

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
