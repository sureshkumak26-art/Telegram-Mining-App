import { Router } from 'express';
import { pool } from './db.js';
import { telegramAuth, getTelegramUser } from './telegram.js';

export const gameRouter = Router();
const MIN_WITHDRAWAL = 100;
function admins(): Set<string> {
  return new Set((process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
}
function requireAdmin(req: Parameters<Parameters<typeof gameRouter.get>[1]>[0], res: Parameters<Parameters<typeof gameRouter.get>[1]>[1]): boolean {
  const tg = getTelegramUser(req);
  if (!admins().has(String(tg.id))) { res.status(403).json({ error: 'Admin access required.' }); return false; }
  return true;
}

gameRouter.post('/withdrawals', telegramAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const tg = getTelegramUser(req);
    const points = Number(req.body?.points);
    const method = typeof req.body?.payoutMethod === 'string' ? req.body.payoutMethod.trim() : '';
    const details = typeof req.body?.payoutDetails === 'string' ? req.body.payoutDetails.trim() : '';
    if (!Number.isSafeInteger(points) || points < MIN_WITHDRAWAL || points > 1_000_000_000) return res.status(400).json({ error: `Minimum withdrawal is ${MIN_WITHDRAWAL} points.` });
    if (!['UPI'].includes(method.toUpperCase())) return res.status(400).json({ error: 'Supported payout method: UPI.' });
    if (details.length < 3 || details.length > 200 || /[<>\u0000-\u001f]/.test(details)) return res.status(400).json({ error: 'Enter valid payout details (3–200 characters).' });
    await client.query('BEGIN');
    const locked = await client.query('SELECT points FROM users WHERE telegram_id=$1 FOR UPDATE', [tg.id]);
    if (!locked.rowCount || Number(locked.rows[0].points) < points) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Insufficient points.' }); }
    await client.query('UPDATE users SET points=points-$2, updated_at=NOW() WHERE telegram_id=$1', [tg.id, points]);
    const created = await client.query('INSERT INTO withdrawals(telegram_id, points, payout_method, payout_details) VALUES($1,$2,$3,$4) RETURNING id, points, payout_method, status, created_at', [tg.id, points, 'UPI', details]);
    await client.query('INSERT INTO ledger(telegram_id, delta, reason) VALUES($1,$2,$3)', [tg.id, -points, `withdrawal-request:${created.rows[0].id}`]);
    await client.query('COMMIT');
    res.status(201).json({ withdrawal: created.rows[0] });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
  finally { client.release(); }
});

gameRouter.get('/admin/withdrawals', telegramAuth, async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const result = await pool.query(`SELECT id, telegram_id, points, payout_method, payout_details, status, created_at FROM withdrawals WHERE status='pending' ORDER BY created_at ASC LIMIT 100`);
    res.json({ withdrawals: result.rows.map(r => ({ ...r, telegram_id: String(r.telegram_id), points: Number(r.points) })) });
  } catch (e) { next(e); }
});

gameRouter.post('/admin/withdrawals/:id/review', telegramAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!requireAdmin(req, res)) return;
    const tg = getTelegramUser(req);
    const id = Number(req.params.id);
    const decision = req.body?.decision;
    if (!Number.isSafeInteger(id) || id <= 0 || !['approved','rejected'].includes(decision)) return res.status(400).json({ error: 'Invalid withdrawal review.' });
    await client.query('BEGIN');
    const found = await client.query('SELECT id, telegram_id, points, status FROM withdrawals WHERE id=$1 FOR UPDATE', [id]);
    if (!found.rowCount || found.rows[0].status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Withdrawal not found or already reviewed.' }); }
    const w = found.rows[0];
    await client.query('UPDATE withdrawals SET status=$2, reviewed_by=$3, reviewed_at=NOW() WHERE id=$1', [id, decision, tg.id]);
    if (decision === 'rejected') {
      await client.query('UPDATE users SET points=points+$2, updated_at=NOW() WHERE telegram_id=$1', [w.telegram_id, w.points]);
      await client.query('INSERT INTO ledger(telegram_id, delta, reason) VALUES($1,$2,$3)', [w.telegram_id, w.points, `withdrawal-refund:${id}`]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, id, status: decision });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
  finally { client.release(); }
});
