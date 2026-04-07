# Four.meme Smart Wallet Monitor

Real-time monitoring service for Four.meme tokens on BSC with smart wallet tracking and scoring.

## Features

- **Real-time Scanning**: Monitors Four.meme contract for new token creations and trades
- **Smart Wallet Tracking**: Tracks wallet positions and trading activities
- **Scoring Engine**: 19-condition scoring algorithm to identify high-potential tokens
- **Telegram Alerts**: Instant notifications when tokens score >= 10
- **SQLite Database**: Persistent storage for regression testing and analysis

## Setup

```bash
npm install
```

Configure `.env`:
```bash
cp .env.example .env
# Edit .env with your RPC URL, Telegram bot token, and wallet addresses
```

## Usage

```bash
# Start monitoring service
npx ts-node src/index.ts

# Fetch and test with real data
npx ts-node scripts/fetchAndMockData.ts
```

## Configuration

| Variable | Description |
|----------|-------------|
| `BSC_RPC_URL` | BSC RPC endpoint |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for alerts |
| `TELEGRAM_CHAT_ID` | Telegram chat ID |
| `WATCHED_WALLETS` | Comma-separated wallet addresses |

## Scoring System

### Bullish Factors (加分项)
- Smart money holding (1+ wallets)
- Smart money accumulation (3+ buyers)
- Holder growth > 10%
- Buy/Sell ratio > 2
- Volume > 20,000 per hour
- Dev history (gem coins)
- Early discovery (< 3 hours)
- Narrative match
- Social links
- CTO (Community Takeover)

### Bearish Factors (扣分项)
- Smart money sold
- Dev holding > 10%
- Insider holding > 40%
- Sell pressure
- Rug history
- No social links
- Token age > 24 hours
- No narrative

## License

MIT
