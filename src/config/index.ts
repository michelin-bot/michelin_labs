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
  // Real-time monitoring settings
  realtime: {
    enabled: process.env.REALTIME_MODE_ENABLED !== 'false', // Default: true
    scanIntervalSeconds: parseInt(process.env.REALTIME_SCAN_INTERVAL || '5', 10),
    alertThreshold: parseInt(process.env.REALTIME_ALERT_THRESHOLD || '10', 10),
    blocksPerScan: parseInt(process.env.REALTIME_BLOCKS_PER_SCAN || '100', 10),
    maxTokensPerScan: parseInt(process.env.REALTIME_MAX_TOKENS_PER_SCAN || '20', 10),
  },
  // Summary report settings
  summary: {
    enabled: process.env.SUMMARY_REPORT_ENABLED !== 'false', // Default: true
    intervalMinutes: parseInt(process.env.SUMMARY_REPORT_INTERVAL || '30', 10),
  },
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
