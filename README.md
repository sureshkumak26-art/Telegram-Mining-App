# Telegram Mining App

A Telegram Mini App starter for a points-based tap-to-earn experience. Includes a mobile-first dark cyberpunk UI, server-side Telegram WebApp identity verification, a PostgreSQL points ledger, rate-limited earning APIs, withdrawal review endpoints, and GitHub Actions checks.

> **Important:** Points are virtual in-app rewards, not cryptocurrency or guaranteed cash. Withdrawal requests are not payments; an authorized admin must review and fulfil approved requests according to your published rules.

## Stack

- **Frontend:** React, TypeScript, Vite
- **API:** Node.js, Express, TypeScript
- **Database:** PostgreSQL
- **Authentication:** Telegram Mini Apps `initData` signature verification using the bot token
- **CI:** GitHub Actions

## Automatic setup on Android Termux

For a guided local setup on Android, install Git and clone the branch, then run the setup script:

```bash
pkg update -y
pkg install -y git
git clone --branch feature/ethereum-wallet https://github.com/sureshkumak26-art/Telegram-Mining-App.git
cd Telegram-Mining-App
bash setup-termux.sh
```

The script installs Node.js and PostgreSQL, initializes a local database if needed, prompts for bot/admin/RPC settings without echoing the bot token, writes the private `.env` file, runs type checks and production builds, and starts the development servers. If `cloudflared` is already installed, it offers an optional temporary public HTTPS tunnel. You must still set the returned URL as the Mini App URL in BotFather. A quick tunnel is temporary and intended only for testing, not production.

The script never asks for or stores a treasury private key. Leave the RPC URL and treasury address blank to configure deposits later. Do not use real funds until wallet and payout flows have been tested and reviewed.

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
- `POST /api/withdrawals` — disabled legacy points/UPI withdrawal endpoint (returns HTTP 410)
- `GET /api/admin/withdrawals` — list pending withdrawals for configured admins
- `POST /api/admin/withdrawals/:id/review` — approve or reject; rejection refunds points
- `GET /api/crypto/summary` — linked wallet, in-app ETH/USDC balances and recent activity
- `POST /api/crypto/challenge` and `POST /api/crypto/connect` — one-time wallet-signature challenge and server-side address verification
- `POST /api/crypto/deposits/verify` — verify a mined Ethereum mainnet ETH/USDC deposit and credit it once
- `POST /api/crypto/withdrawals` — reserve crypto balance and submit an admin-reviewed payout request
- `GET /api/admin/crypto/withdrawals` and `POST /api/admin/crypto/withdrawals/:id/review` — admin review queue
- `POST /api/admin/crypto/withdrawals/:id/paid` — verify a manually sent, confirmed payout transaction

Authenticated API calls send Telegram WebApp `initData` in the `x-telegram-init-data` header. Do not trust user IDs supplied in request bodies. Admin IDs are comma-separated numeric Telegram IDs in `ADMIN_TELEGRAM_IDS`.

## Admin panel setup

The admin dashboard is served by the same frontend at `/admin` (for example, `https://YOUR-MINI-APP-DOMAIN/admin`). Open it from inside Telegram so the backend receives valid Telegram Mini App authentication data. Admin authorization is enforced by the API; hiding the URL is not a security control.

1. Find your numeric Telegram user ID using a trusted Telegram ID bot.
2. On the backend host, set `ADMIN_TELEGRAM_IDS` to your numeric ID. For multiple admins, use comma-separated numeric IDs (no @ usernames).
3. Set `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, `CLIENT_ORIGIN`, and the Ethereum backend variables below in the server environment. Never place these secrets in `client/.env`, frontend code, or a public repository.
4. Restart/redeploy the API, then reopen `/admin` inside Telegram. If you see “Admin access required”, verify the exact numeric ID and that the deployed API received the new environment variable.
5. In the dashboard, review users and the points ledger. Crypto withdrawals appear in the crypto withdrawal queue: reject to refund, or approve to authorize a manual payout. After sending from the treasury, submit the outgoing Ethereum transaction hash so the API can verify it.

The admin dashboard does not collect or store a treasury private key and does not automatically sign or broadcast payouts. Protect the hosting account and database, use HTTPS, and never share the admin URL as a substitute for authorization. Do not use real funds until the deposit and payout paths have been tested with small amounts and reviewed.

## Ethereum wallet setup

The crypto wallet supports **Ethereum Mainnet ETH deposits**. USDC deposit verification remains backend-optional and is only enabled when its contract is configured. Withdrawals are Hyperliquid-only ETH requests sent manually to the user's Hyperliquid ETH deposit address. It provides an external wallet link using a one-time signed message, an internal app balance, on-chain deposit verification, and admin-reviewed withdrawals. It does **not** generate or hold a user's private key. The treasury address is a shared deposit address; only ETH and the exact configured USDC contract are accepted, and deposits must originate from the linked wallet address.

Set these variables on the **backend only** before enabling crypto deposits:

```env
ETHEREUM_RPC_URL=https://YOUR-ETHEREUM-MAINNET-RPC
ETHEREUM_TREASURY_ADDRESS=0xYOUR_TREASURY_ADDRESS
ETHEREUM_USDC_CONTRACT=0xYOUR_VERIFIED_MAINNET_USDC_CONTRACT
ADMIN_TELEGRAM_IDS=YOUR_NUMERIC_TELEGRAM_ID
```

Use a trusted Ethereum RPC provider and keep any provider API key private. The app requires 12 confirmations before crediting deposits or marking payout transactions paid. Duplicate transaction hashes are rejected. Hyperliquid ETH withdrawal requests debit the requested amount plus a fixed **0.02 ETH fee** from the user's internal ETH balance. Rejected requests refund both amount and fee. An admin must manually send the ETH transfer on Ethereum Mainnet to the user's Hyperliquid ETH deposit address, then submit its transaction hash for server-side verification. The 0.02 ETH fee is an app-configured charge, not a quote of the actual Ethereum gas cost. Approving a request does not itself transfer funds.

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
