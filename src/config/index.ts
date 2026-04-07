import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  bscRpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
  scanInterval: parseInt(process.env.SCAN_INTERVAL || '60000', 10),
  watchedWallets: (process.env.WATCHED_WALLETS || '')
    .split(',')
    .map(w => w.trim())
    .filter(w => w.length > 0),
};

export function validateConfig(): boolean {
  const errors: string[] = [];

  if (!config.bscRpcUrl) {
    errors.push('BSC_RPC_URL is required');
  }
  if (!config.telegram.botToken) {
    errors.push('TELEGRAM_BOT_TOKEN is required');
  }
  if (!config.telegram.chatId) {
    errors.push('TELEGRAM_CHAT_ID is required');
  }

  if (errors.length > 0) {
    console.error('Configuration errors:', errors);
    return false;
  }

  return true;
}
