import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pool, initDb } from './db.js';
import { telegramAuth, getTelegramUser } from './telegram.js';
import { gameRouter } from './routes.js';
import { cryptoRouter } from './crypto.js';

const app = express();
const port = Number(process.env.PORT || 3001);
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim()), methods: ['GET','POST'], allowedHeaders: ['content-type','x-telegram-init-data'] }));
app.use(express.json({ limit: '10kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use('/api', gameRouter);
app.use('/api', cryptoRouter);
app.get('/health', async (_req, res) => { try { await pool.query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); } });
app.get('/api/me', telegramAuth, async (req, res, next) => {
  try {
    const tg = getTelegramUser(req);
    const result = await pool.query(`INSERT INTO users(telegram_id, first_name, username) VALUES($1,$2,$3) ON CONFLICT(telegram_id) DO UPDATE SET first_name=EXCLUDED.first_name, username=EXCLUDED.username, updated_at=NOW() RETURNING telegram_id`, [tg.id, tg.first_name.slice(0,100), tg.username?.slice(0,100) || null]);
    // Repair legacy depleted accounts that have no reset timestamp, otherwise the UI stays at 00:00:00 forever.
    await pool.query(`UPDATE users SET energy_reset_at=NOW()+INTERVAL '5 hours', updated_at=NOW() WHERE telegram_id=$1 AND energy=0 AND energy_reset_at IS NULL`, [tg.id]);
    await pool.query(`UPDATE users SET energy=1000, energy_reset_at=NULL, updated_at=NOW() WHERE telegram_id=$1 AND energy=0 AND energy_reset_at IS NOT NULL AND energy_reset_at<=NOW()`, [tg.id]);
    const profile = await pool.query(`SELECT telegram_id, first_name, username, points, energy, taps, energy_reset_at FROM users WHERE telegram_id=$1`, [tg.id]);
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
    await client.query('INSERT INTO users(telegram_id, first_name, username) VALUES($1,$2,$3) ON CONFLICT(telegram_id) DO NOTHING', [tg.id, tg.first_name.slice(0,100), tg.username?.slice(0,100) || null]);
    const locked = await client.query('SELECT telegram_id, first_name, username, points, energy, taps, energy_reset_at FROM users WHERE telegram_id=$1 FOR UPDATE', [tg.id]);
    let u = locked.rows[0];
    if (Number(u.energy) === 0 && u.energy_reset_at && new Date(u.energy_reset_at).getTime() <= Date.now()) {
      const reset = await client.query('UPDATE users SET energy=1000, energy_reset_at=NULL WHERE telegram_id=$1 RETURNING telegram_id, first_name, username, points, energy, taps, energy_reset_at', [tg.id]);
      u = reset.rows[0];
    }
    if (Number(u.energy) < 1) { await client.query('ROLLBACK'); return res.status(429).json({ error: 'No taps left. Your 5-hour reset is still running.', resetAt: u.energy_reset_at }); }
    const acceptedCount = Math.min(count, Number(u.energy));
    const earned = (acceptedCount * 0.02).toFixed(2);
    const updated = await client.query(`UPDATE users SET points=points+$2::numeric, energy=energy-$3, taps=taps+$3, energy_reset_at=CASE WHEN energy <= $3 THEN NOW()+INTERVAL '5 hours' ELSE energy_reset_at END, updated_at=NOW() WHERE telegram_id=$1 RETURNING telegram_id, first_name, username, points, energy, taps, energy_reset_at`, [tg.id, earned, acceptedCount]);
    await client.query('INSERT INTO ledger(telegram_id, delta, reason) VALUES($1,$2,$3)', [tg.id, earned, `tap-batch:${acceptedCount}`]);
    await client.query('COMMIT');
    res.json({ profile: toProfile(updated.rows[0]), acceptedCount });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
  finally { client.release(); }
});
function toProfile(r: any) { return { id: String(r.telegram_id), firstName: r.first_name, username: r.username || undefined, points: Number(r.points), energy: Number(r.energy), maxEnergy: 1000, taps: Number(r.taps), resetAt: r.energy_reset_at ? new Date(r.energy_reset_at).toISOString() : null }; }
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { console.error(err); res.status(500).json({ error: 'Internal server error' }); });
initDb().then(() => app.listen(port, '0.0.0.0', () => console.log(`Mining API listening on ${port}`))).catch(err => { console.error('Database initialization failed', err); process.exit(1); });
