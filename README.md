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

Authenticated API calls send Telegram WebApp `initData` in the `x-telegram-init-data` header. Do not trust user IDs supplied in request bodies. Admin IDs are comma-separated numeric Telegram IDs in `ADMIN_TELEGRAM_IDS`.

## Security and production checklist

- Keep bot tokens, database credentials, and admin IDs on the server. Never commit real secrets.
- Telegram init data is verified server-side and expires according to `TELEGRAM_INITDATA_MAX_AGE_SECONDS`.
- Points changes and withdrawal decisions use database transactions and are written to the ledger.
- Use HTTPS, a strong database password, explicit CORS origins, backups, monitoring, and a least-privilege database account in production.
- Review the local laws and your own published reward/withdrawal terms before offering real payouts.
- The task cards are UI placeholders; task verification, referrals, automated energy regeneration, and a standalone admin web dashboard are not implemented yet. Do not advertise those features as live.

## License

MIT. See `LICENSE`.
