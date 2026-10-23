import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pool, initDb } from './db.js';
import { telegramAuth, getTelegramUser } from './telegram.js';

const app = express();
const port = Number(process.env.PORT || 3001);
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim()), methods: ['GET','POST'], allowedHeaders: ['content-type','x-telegram-init-data'] }));
app.use(express.json({ limit: '10kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: 'draft-7', legacyHeaders: false }));
app.get('/health', async (_req, res) => { try { await pool.query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); } });
app.get('/api/me', telegramAuth, async (req, res, next) => {
  try {
    const tg = getTelegramUser(req);
    const result = await pool.query(`INSERT INTO users(telegram_id, first_name, username) VALUES($1,$2,$3) ON CONFLICT(telegram_id) DO UPDATE SET first_name=EXCLUDED.first_name, username=EXCLUDED.username, updated_at=NOW() RETURNING telegram_id, first_name, username, points, energy, taps`, [tg.id, tg.first_name.slice(0,100), tg.username?.slice(0,100) || null]);
    res.json({ profile: toProfile(result.rows[0]) });
  } catch (e) { next(e); }
});
app.post('/api/tap', telegramAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const tg = getTelegramUser(req);
    const count = Number(req.body?.count ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > 1) return res.status(400).json({ error: 'Tap count must be 1.' });
    await client.query('BEGIN');
    await client.query('INSERT INTO users(telegram_id, first_name, username) VALUES($1,$2,$3) ON CONFLICT(telegram_id) DO NOTHING', [tg.id, tg.first_name.slice(0,100), tg.username?.slice(0,100) || null]);
    const locked = await client.query('SELECT telegram_id, first_name, username, points, energy, taps FROM users WHERE telegram_id=$1 FOR UPDATE', [tg.id]);
    const u = locked.rows[0];
    if (Number(u.energy) < 1) { await client.query('ROLLBACK'); return res.status(429).json({ error: 'No energy left. Come back later.' }); }
    const updated = await client.query('UPDATE users SET points=points+1, energy=energy-1, taps=taps+1, updated_at=NOW() WHERE telegram_id=$1 RETURNING telegram_id, first_name, username, points, energy, taps', [tg.id]);
    await client.query('INSERT INTO ledger(telegram_id, delta, reason) VALUES($1,1,$2)', [tg.id, 'tap']);
    await client.query('COMMIT');
    res.json({ profile: toProfile(updated.rows[0]) });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
  finally { client.release(); }
});
function toProfile(r: any) { return { id: String(r.telegram_id), firstName: r.first_name, username: r.username || undefined, points: Number(r.points), energy: Number(r.energy), maxEnergy: 100, taps: Number(r.taps) }; }
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { console.error(err); res.status(500).json({ error: 'Internal server error' }); });
initDb().then(() => app.listen(port, '0.0.0.0', () => console.log(`Mining API listening on ${port}`))).catch(err => { console.error('Database initialization failed', err); process.exit(1); });
