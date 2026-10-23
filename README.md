# Telegram Mining App

A Telegram Mini App starter for a points-based tap-to-earn experience. Includes a mobile-first cyberpunk UI, Telegram WebApp identity integration, a server-authoritative points ledger, rate-limited earning APIs, withdrawal review workflow, admin endpoints, and GitHub Actions checks.

> **Important:** Points are virtual in-app rewards, not cryptocurrency or guaranteed cash. Withdrawals must be manually reviewed and paid only under your published rules. Never collect Telegram bot tokens or admin secrets in the frontend.

## Stack

- React + Vite + TypeScript frontend
- Node.js + Express + TypeScript API
- PostgreSQL via Prisma
- Telegram Web Apps `initData` verification on the server
- GitHub Actions CI

## Local development

1. Copy `.env.example` to `.env` and fill in values.
2. Install dependencies with `npm install`.
3. Start PostgreSQL and apply the Prisma schema.
4. Run `npm run dev`.

See the setup guide below once the backend and frontend files are added. Do not deploy with placeholder secrets or disable Telegram signature verification in production.

## Security

- Validate Telegram `initData` server-side using the bot token.
- Keep bot tokens, database credentials, and admin IDs in server environment variables.
- All points mutations must be recorded in an immutable ledger and performed in database transactions.
- Withdrawals are pending until an authorized admin approves or rejects them.
- Use HTTPS in production and configure allowed origins explicitly.

## License

MIT License. See `LICENSE`.