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
  CREATE INDEX IF NOT EXISTS withdrawals_status_idx ON withdrawals(status, created_at);`);
}
