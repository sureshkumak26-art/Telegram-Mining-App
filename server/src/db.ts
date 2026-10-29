import pg from 'pg';
const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
export async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (telegram_id BIGINT PRIMARY KEY, first_name TEXT NOT NULL, username TEXT, points NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(points >= 0), energy INTEGER NOT NULL DEFAULT 1000 CHECK(energy >= 0 AND energy <= 1000), taps BIGINT NOT NULL DEFAULT 0 CHECK(taps >= 0), energy_reset_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  ALTER TABLE users ALTER COLUMN points TYPE NUMERIC(14,2) USING points::NUMERIC(14,2);
  ALTER TABLE users ALTER COLUMN energy SET DEFAULT 1000;
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_energy_check;
  ALTER TABLE users ADD CONSTRAINT users_energy_check CHECK(energy >= 0 AND energy <= 1000);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS energy_reset_at TIMESTAMPTZ;
  UPDATE users SET energy=1000 WHERE energy=100 AND energy_reset_at IS NULL;
  CREATE TABLE IF NOT EXISTS ledger (id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES users(telegram_id), delta NUMERIC(14,2) NOT NULL, reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  ALTER TABLE ledger ALTER COLUMN delta TYPE NUMERIC(14,2) USING delta::NUMERIC(14,2);
  CREATE INDEX IF NOT EXISTS ledger_user_date_idx ON ledger(telegram_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS withdrawals (id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES users(telegram_id), points BIGINT NOT NULL CHECK(points > 0), payout_method TEXT NOT NULL, payout_details TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), reviewed_by BIGINT, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE INDEX IF NOT EXISTS withdrawals_status_idx ON withdrawals(status, created_at);

  CREATE TABLE IF NOT EXISTS crypto_wallet_links (telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id) ON DELETE CASCADE, address TEXT NOT NULL, verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX IF NOT EXISTS crypto_wallet_address_unique_idx ON crypto_wallet_links(LOWER(address));
  CREATE TABLE IF NOT EXISTS crypto_wallet_challenges (id TEXT PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE, address TEXT NOT NULL, message TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ);
  CREATE INDEX IF NOT EXISTS crypto_wallet_challenge_expiry_idx ON crypto_wallet_challenges(expires_at);
  CREATE TABLE IF NOT EXISTS crypto_balances (telegram_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE, asset TEXT NOT NULL CHECK(asset IN ('ETH','USDC')), balance NUMERIC(36,18) NOT NULL DEFAULT 0 CHECK(balance >= 0), PRIMARY KEY(telegram_id, asset));
  CREATE TABLE IF NOT EXISTS crypto_deposits (tx_hash TEXT PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES users(telegram_id), asset TEXT NOT NULL CHECK(asset IN ('ETH','USDC')), amount NUMERIC(36,18) NOT NULL CHECK(amount > 0), from_address TEXT NOT NULL, block_number BIGINT NOT NULL, confirmations INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE INDEX IF NOT EXISTS crypto_deposits_user_date_idx ON crypto_deposits(telegram_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS crypto_withdrawals (id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES users(telegram_id), asset TEXT NOT NULL CHECK(asset IN ('ETH','USDC')), amount NUMERIC(36,18) NOT NULL CHECK(amount > 0), destination_address TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','paid')), tx_hash TEXT UNIQUE, reviewed_by BIGINT, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE INDEX IF NOT EXISTS crypto_withdrawals_status_idx ON crypto_withdrawals(status, created_at);
  CREATE TABLE IF NOT EXISTS crypto_ledger (id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES users(telegram_id), asset TEXT NOT NULL CHECK(asset IN ('ETH','USDC')), delta NUMERIC(36,18) NOT NULL, reason TEXT NOT NULL, tx_hash TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE INDEX IF NOT EXISTS crypto_ledger_user_date_idx ON crypto_ledger(telegram_id, created_at DESC);
`);
}
