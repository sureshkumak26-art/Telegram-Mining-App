import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { getSetting, pool, initDb } from './db.js';
import { telegramAuth, getTelegramUser } from './telegram.js';
import { gameRouter } from './routes.js';
import { cryptoRouter } from './crypto.js';
import { configureTelegramBot } from './telegramBot.js';


async function applyReferral(telegramId: number, initData: string) {
  if ((await getSetting('referral_enabled')) === 'false') return;
  const start = new URLSearchParams(initData).get('start_param') || '';
  const match = /^ref_(\d+)$/.exec(start); if (!match) return;
  const referrer = Number(match[1]); if (!Number.isSafeInteger(referrer) || referrer <= 0 || referrer === telegramId) return;
  const saved = await getSetting('referral_reward_points'); const reward = Number(saved ?? process.env.REFERRAL_REWARD_POINTS ?? '10'); if (!Number.isFinite(reward) || reward <= 0) return;
  const client = await pool.connect();
  try { await client.query('BEGIN'); const linked = await client.query('UPDATE users SET referred_by=$2 WHERE telegram_id=$1 AND referred_by IS NULL AND EXISTS (SELECT 1 FROM users WHERE telegram_id=$2) RETURNING telegram_id',[telegramId,referrer]); if (linked.rowCount) { const inserted = await client.query('INSERT INTO referral_rewards(referred_telegram_id,referrer_telegram_id,reward) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING referred_telegram_id',[telegramId,referrer,reward]); if (inserted.rowCount) { await client.query('UPDATE users SET points=points+$2, updated_at=NOW() WHERE telegram_id=$1',[referrer,reward]); await client.query('INSERT INTO ledger(telegram_id,delta,reason) VALUES($1,$2,$3)',[referrer,reward,'referral-reward:'+telegramId]); } } await client.query('COMMIT'); } catch(e) { await client.query('ROLLBACK').catch(()=>{}); throw e; } finally { client.release(); }
}

const app = express();
const port = Number(process.env.PORT || 3001);
app.disable('x-powered-by');
app.use(helmet());
const configuredOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    let isProjectVercelPreview = false;
    try {
      const hostname = new URL(origin).hostname;
      isProjectVercelPreview = /^telegram-mining-app(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(hostname);
    } catch { /* Invalid origins are rejected below. */ }
    callback(null, configuredOrigins.includes(origin) || isProjectVercelPreview);
  },
  methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['content-type','x-telegram-init-data']
}));
app.use(express.json({ limit: '1mb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use('/api', gameRouter);
app.use('/api', cryptoRouter);
app.get('/health', async (_req, res) => { try { await pool.query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); } });
app.get('/api/me', telegramAuth, async (req, res, next) => {
  try {
    const tg = getTelegramUser(req);
    await pool.query(`INSERT INTO users(telegram_id, first_name, username, photo_url) VALUES($1,$2,$3,$4) ON CONFLICT(telegram_id) DO UPDATE SET first_name=EXCLUDED.first_name, username=EXCLUDED.username, photo_url=EXCLUDED.photo_url, updated_at=NOW()`, [tg.id, tg.first_name.slice(0,100), tg.username?.slice(0,100) || null, tg.photo_url || null]);
    await applyReferral(tg.id, req.header('x-telegram-init-data') || '');
    // Repair legacy depleted accounts that have no reset timestamp, otherwise the UI stays at 00:00:00 forever.
    await pool.query(`UPDATE users SET energy_reset_at=NOW()+INTERVAL '5 hours', updated_at=NOW() WHERE telegram_id=$1 AND energy=0 AND energy_reset_at IS NULL`, [tg.id]);
    await pool.query(`UPDATE users SET energy=1000, energy_reset_at=NULL, updated_at=NOW() WHERE telegram_id=$1 AND energy=0 AND energy_reset_at IS NOT NULL AND energy_reset_at<=NOW()`, [tg.id]);
    const profile = await pool.query(`SELECT telegram_id, first_name, username, photo_url, points, energy, taps, energy_reset_at FROM users WHERE telegram_id=$1`, [tg.id]);
    res.json({ profile: toProfile(profile.rows[0]) });
  } catch (e) { next(e); }
});
app.post('/api/tap', telegramAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const tg = getTelegramUser(req);
    const count = Number(req.body?.count ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > 50) return res.status(400).json({ error: 'Tap batch must contain between 1 and 50 taps.' });
    await client.query('BEGIN');
    await client.query('INSERT INTO users(telegram_id, first_name, username, photo_url) VALUES($1,$2,$3,$4) ON CONFLICT(telegram_id) DO NOTHING', [tg.id, tg.first_name.slice(0,100), tg.username?.slice(0,100) || null, tg.photo_url || null]);
    const locked = await client.query('SELECT telegram_id, first_name, username, photo_url, points, energy, taps, energy_reset_at FROM users WHERE telegram_id=$1 FOR UPDATE', [tg.id]);
    let u = locked.rows[0];
    if (Number(u.energy) === 0 && u.energy_reset_at && new Date(u.energy_reset_at).getTime() <= Date.now()) {
      const reset = await client.query('UPDATE users SET energy=1000, energy_reset_at=NULL WHERE telegram_id=$1 RETURNING telegram_id, first_name, username, photo_url, points, energy, taps, energy_reset_at', [tg.id]);
      u = reset.rows[0];
    }
    if (Number(u.energy) < 1) { await client.query('ROLLBACK'); return res.status(429).json({ error: 'No taps left. Your 5-hour reset is still running.', resetAt: u.energy_reset_at }); }
    const acceptedCount = Math.min(count, Number(u.energy));
    const earned = (acceptedCount * 0.02).toFixed(2);
    const updated = await client.query(`UPDATE users SET points=points+$2::numeric, energy=energy-$3, taps=taps+$3, energy_reset_at=CASE WHEN energy <= $3 THEN NOW()+INTERVAL '5 hours' ELSE energy_reset_at END, updated_at=NOW() WHERE telegram_id=$1 RETURNING telegram_id, first_name, username, photo_url, points, energy, taps, energy_reset_at`, [tg.id, earned, acceptedCount]);
    await client.query('INSERT INTO ledger(telegram_id, delta, reason) VALUES($1,$2,$3)', [tg.id, earned, `tap-batch:${acceptedCount}`]);
    await client.query('COMMIT');
    res.json({ profile: toProfile(updated.rows[0]), acceptedCount });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
  finally { client.release(); }
});
function toProfile(r: any) { return { id: String(r.telegram_id), firstName: r.first_name, username: r.username || undefined, avatarUrl: r.photo_url || undefined, points: Number(r.points), energy: Number(r.energy), maxEnergy: 1000, taps: Number(r.taps), resetAt: r.energy_reset_at ? new Date(r.energy_reset_at).toISOString() : null }; }
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { console.error(err); res.status(500).json({ error: 'Internal server error' }); });
initDb().then(async () => {
  app.listen(port, '0.0.0.0', () => console.log(`Mining API listening on ${port}`));
  try { await configureTelegramBot(); console.log('Telegram bot commands and Mini App menu configured.'); } catch (error) { console.error('Telegram bot configuration failed', error); }
}).catch(err => { console.error('Database initialization failed', err); process.exit(1); });
