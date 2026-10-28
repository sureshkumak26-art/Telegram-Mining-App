# Telegram Mining App

A Telegram Mini App starter for a points-based tap-to-earn experience. Includes a mobile-first dark cyberpunk UI, server-side Telegram WebApp identity verification, a PostgreSQL points ledger, rate-limited earning APIs, withdrawal review endpoints, and GitHub Actions checks.

> **Important:** Points are virtual in-app rewards, not cryptocurrency or guaranteed cash. Withdrawal requests are not payments; an authorized admin must review and fulfil approved requests according to your published rules.

## Stack

- **Frontend:** React, TypeScript, Vite
- **API:** Node.js, Express, TypeScript
- **Database:** PostgreSQL
- **Authentication:** Telegram Mini Apps `initData` signature verification using the bot token
- **CI:** GitHub Actions

## Local setup

Requirements: Node.js 22+, npm, PostgreSQL, and a Telegram bot created with BotFather.

1. Clone the repository and install packages:
   ```bash
   git clone https://github.com/sureshkumak26-art/Telegram-Mining-App.git
   cd Telegram-Mining-App
   npm install
   ```
2. Create a PostgreSQL database named `mining_app`.
3. Copy `.env.example` to `.env`, then set `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `ADMIN_TELEGRAM_IDS`, and `CLIENT_ORIGIN`.
4. Start the app:
   ```bash
   npm run dev
   ```
   Frontend: `http://localhost:5173`; API health check: `http://localhost:3001/health`. The API creates its required tables on startup.
5. Configure your Telegram bot's Mini App URL in BotFather and use an HTTPS URL for deployment. Set `VITE_API_URL` at frontend build time to your deployed API origin if it differs from the local default.

## API overview

- `GET /health` — database/API health
- `GET /api/me` — verifies Telegram init data and loads the player profile
- `POST /api/tap` — awards one point with a row lock and ledger entry
- `POST /api/withdrawals` — request a withdrawal (minimum 100 points; UPI method)
- `GET /api/admin/withdrawals` — list pending withdrawals for configured admins
- `POST /api/admin/withdrawals/:id/review` — approve or reject; rejection refunds points
- `GET /api/crypto/summary` — linked wallet, in-app ETH/USDC balances and recent activity
- `POST /api/crypto/challenge` and `POST /api/crypto/connect` — one-time wallet-signature challenge and server-side address verification
- `POST /api/crypto/deposits/verify` — verify a mined Ethereum mainnet ETH/USDC deposit and credit it once
- `POST /api/crypto/withdrawals` — reserve crypto balance and submit an admin-reviewed payout request
- `GET /api/admin/crypto/withdrawals` and `POST /api/admin/crypto/withdrawals/:id/review` — admin review queue
- `POST /api/admin/crypto/withdrawals/:id/paid` — verify a manually sent, confirmed payout transaction

Authenticated API calls send Telegram WebApp `initData` in the `x-telegram-init-data` header. Do not trust user IDs supplied in request bodies. Admin IDs are comma-separated numeric Telegram IDs in `ADMIN_TELEGRAM_IDS`.

## Ethereum wallet setup

The crypto wallet supports **Ethereum Mainnet ETH and USDC** (the USDC contract must be configured explicitly). It provides an external wallet link using a one-time signed message, an internal app balance, on-chain deposit verification, and admin-reviewed withdrawals. It does **not** generate or hold a user's private key. The treasury address is a shared deposit address; only ETH and the exact configured USDC contract are accepted, and deposits must originate from the linked wallet address.

Set these variables on the **backend only** before enabling crypto deposits:

```env
ETHEREUM_RPC_URL=https://YOUR-ETHEREUM-MAINNET-RPC
ETHEREUM_TREASURY_ADDRESS=0xYOUR_TREASURY_ADDRESS
ETHEREUM_USDC_CONTRACT=0xYOUR_VERIFIED_MAINNET_USDC_CONTRACT
ADMIN_TELEGRAM_IDS=YOUR_NUMERIC_TELEGRAM_ID
```

Use a trusted Ethereum RPC provider and keep any provider API key private. The app requires 12 confirmations before crediting deposits or marking payout transactions paid. Duplicate transaction hashes are rejected. Withdrawal requests reserve the internal balance; an admin must manually send the transfer from the treasury, then submit its transaction hash for server-side verification. Approving a request does not itself transfer funds.

**Production caution:** a shared treasury deposit address is a simple starter flow, not a production custody architecture. Users must send from the wallet linked to their Telegram account; third-party transfers and unsupported tokens are not credited automatically. Before handling meaningful funds, get a security review, use a dedicated monitored treasury, implement reconciliation and incident procedures, and check applicable legal/tax requirements. Never put a treasury private key or signing secret in the frontend.

## Security and production checklist

- Keep bot tokens, database credentials, and admin IDs on the server. Never commit real secrets.
- Telegram init data is verified server-side and expires according to `TELEGRAM_INITDATA_MAX_AGE_SECONDS`.
- Points changes and withdrawal decisions use database transactions and are written to the ledger.
- Use HTTPS, a strong database password, explicit CORS origins, backups, monitoring, and a least-privilege database account in production.
- Review the local laws and your own published reward/withdrawal terms before offering real payouts.
- The task cards are UI placeholders; task verification, referrals, and automated energy regeneration are not implemented yet. Do not advertise those features as live.

## License

MIT. See `LICENSE`.
