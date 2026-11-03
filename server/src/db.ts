import pg from 'pg';
const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
export async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS users (telegram_id BIGINT PRIMARY KEY, first_name TEXT NOT NULL, username TEXT, points NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(points >= 0), energy INTEGER NOT NULL DEFAULT 1000 CHECK(energy >= 0 AND energy <= 1000), taps BIGINT NOT NULL DEFAULT 0 CHECK(taps >= 0), energy_reset_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by BIGINT REFERENCES users(telegram_id);
  CREATE TABLE IF NOT EXISTS referral_rewards (referred_telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id) ON DELETE CASCADE, referrer_telegram_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE, reward NUMERIC(14,2) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  INSERT INTO system_settings(key,value) VALUES ('referral_enabled','true'),('referral_reward_points','10') ON CONFLICT(key) DO NOTHING;
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
  CREATE TABLE IF NOT EXISTS crypto_withdrawals (id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES users(telegram_id), asset TEXT NOT NULL CHECK(asset IN ('ETH','USDC')), amount NUMERIC(36,18) NOT NULL CHECK(amount > 0), destination_address TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','completed')), tx_hash TEXT UNIQUE, reviewed_by BIGINT, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  ALTER TABLE crypto_withdrawals DROP CONSTRAINT IF EXISTS crypto_withdrawals_status_check;
  UPDATE crypto_withdrawals SET status='completed' WHERE status='paid';
  ALTER TABLE crypto_withdrawals ADD CONSTRAINT crypto_withdrawals_status_check CHECK(status IN ('pending','approved','rejected','completed'));
  CREATE INDEX IF NOT EXISTS crypto_withdrawals_status_idx ON crypto_withdrawals(status, created_at);
  CREATE TABLE IF NOT EXISTS crypto_ledger (id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES users(telegram_id), asset TEXT NOT NULL CHECK(asset IN ('ETH','USDC')), delta NUMERIC(36,18) NOT NULL, reason TEXT NOT NULL, tx_hash TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE INDEX IF NOT EXISTS crypto_ledger_user_date_idx ON crypto_ledger(telegram_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS task_configs (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, url TEXT NOT NULL, icon TEXT NOT NULL, reward NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(reward >= 0), enabled BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS task_claims (task_id TEXT NOT NULL REFERENCES task_configs(id) ON DELETE CASCADE, telegram_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE, reward NUMERIC(14,2) NOT NULL, claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(task_id, telegram_id));
  INSERT INTO task_configs(id,title,description,url,icon,reward,enabled) VALUES ('x-follow','Follow our X page','Follow the official Telegram Miner X account','https://x.com/','𝕏',10,FALSE),('telegram-join','Join our Telegram','Join the official Telegram community','https://t.me/','➤',10,FALSE),('youtube-watch','Watch community videos','Watch the latest community video','https://youtube.com/','▶',10,FALSE) ON CONFLICT(id) DO NOTHING;
  UPDATE task_configs SET enabled=TRUE WHERE reward > 0;
`);
}

export async function getSetting(key: string) { const result = await pool.query('SELECT value FROM system_settings WHERE key=$1', [key]); return result.rows[0]?.value as string | undefined; }
export async function setSetting(key: string, value: string) { await pool.query('INSERT INTO system_settings(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()', [key, value]); }
