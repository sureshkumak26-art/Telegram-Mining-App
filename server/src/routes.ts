import { Router, type Request, type Response } from 'express';
import { getSetting, pool, setSetting } from './db.js';
import { adminAuth, telegramAuth, getTelegramUser } from './telegram.js';
import { getAddress, isAddress } from 'ethers';

export const gameRouter = Router();
const MIN_WITHDRAWAL = 100;
function admins(): Set<string> {
  return new Set((process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
}
function requireAdmin(req: Request, res: Response): boolean {
  const tg = getTelegramUser(req);
  if (!admins().has(String(tg.id))) { res.status(403).json({ error: 'Admin access required.' }); return false; }
  return true;
}

gameRouter.post('/withdrawals', telegramAuth, async (_req, res) => {
  res.status(410).json({ error: 'Points withdrawals are disabled. Use the Ethereum wallet for Hyperliquid withdrawals.' });
});



function referralReward() { const value = Number(process.env.REFERRAL_REWARD_POINTS || '10'); return Number.isFinite(value) && value >= 0 ? value : 10; }
async function referralSettings() { const enabled = (await getSetting('referral_enabled')) !== 'false'; const saved = await getSetting('referral_reward_points'); const reward = saved === undefined ? referralReward() : Number(saved); return { enabled, reward: Number.isFinite(reward) && reward >= 0 ? reward : 10 }; }
gameRouter.get('/referral/public-config', async (_req,res) => { const raw=(process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/,'').trim(); res.json({ botUsername: /^[A-Za-z0-9_]{5,64}$/.test(raw) ? raw : '' }); });
gameRouter.get('/referral/summary', telegramAuth, async (req, res, next) => { try { const tg=getTelegramUser(req), settings=await referralSettings(); const counts=await pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE updated_at > NOW()-INTERVAL '30 days')::int AS active FROM users WHERE referred_by=$1`,[tg.id]); const earned=await pool.query('SELECT COALESCE(SUM(reward),0)::numeric AS points FROM referral_rewards WHERE referrer_telegram_id=$1',[tg.id]); res.json({ enabled:settings.enabled, reward:settings.reward, totalReferrals:Number(counts.rows[0].total), activeReferrals:Number(counts.rows[0].active), pointsEarned:Number(earned.rows[0].points) }); } catch(e){ next(e); } });
gameRouter.get('/admin/referral-settings', adminAuth, async (req,res,next)=>{ try { if(!requireAdmin(req,res))return; const settings=await referralSettings(); res.json(settings); } catch(e){next(e);} });
gameRouter.patch('/admin/referral-settings', adminAuth, async (req,res,next)=>{ try { if(!requireAdmin(req,res))return; const enabled=req.body?.enabled; const reward=Number(req.body?.reward); if(typeof enabled!=='boolean'||!Number.isFinite(reward)||reward<0||reward>100000) return res.status(400).json({error:'Enter a valid referral reward and status.'}); await setSetting('referral_enabled',String(enabled)); await setSetting('referral_reward_points',reward.toFixed(2)); res.json({enabled,reward}); } catch(e){next(e);} });

function taskRow(row: any) { return { id: row.id, title: row.title, description: row.description, url: row.url, icon: row.icon, reward: Number(row.reward), enabled: Boolean(row.enabled), claimed: Boolean(row.claimed) }; }
gameRouter.get('/tasks', async (req, res, next) => {
  try {
    const tg = req.headers['x-telegram-init-data'] ? getTelegramUser(req) : null;
    const result = await pool.query('SELECT t.*, c.telegram_id IS NOT NULL AS claimed FROM task_configs t LEFT JOIN task_claims c ON c.task_id=t.id AND c.telegram_id=$1 ORDER BY t.id', [tg?.id || 0]);
    res.json({ tasks: result.rows.map(taskRow) });
  } catch (e) { next(e); }
});
gameRouter.post('/tasks/:id/claim', telegramAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const tg = getTelegramUser(req); await client.query('BEGIN');
    const task = await client.query('SELECT id, title, reward, enabled FROM task_configs WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!task.rowCount || !task.rows[0].enabled) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This task is not enabled.' }); }
    const reward = Number(task.rows[0].reward); if (!Number.isFinite(reward) || reward <= 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This task has no reward configured.' }); }
    const inserted = await client.query('INSERT INTO task_claims(task_id, telegram_id, reward) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING task_id', [req.params.id, tg.id, reward]);
    if (!inserted.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'You already claimed this task.' }); }
    await client.query('UPDATE users SET points=points+$2, updated_at=NOW() WHERE telegram_id=$1', [tg.id, reward]);
    await client.query('INSERT INTO ledger(telegram_id, delta, reason) VALUES($1,$2,$3)', [tg.id, reward, 'task-reward:'+req.params.id]);
    await client.query('COMMIT'); res.json({ ok: true, reward });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); } finally { client.release(); }
});
gameRouter.get('/admin/tasks', adminAuth, async (req, res, next) => { try { if (!requireAdmin(req,res)) return; const result=await pool.query('SELECT id,title,description,url,icon,reward,enabled FROM task_configs ORDER BY id'); res.json({ tasks: result.rows.map(taskRow) }); } catch(e){ next(e); } });
gameRouter.patch('/admin/tasks/:id', adminAuth, async (req, res, next) => { try { if (!requireAdmin(req,res)) return; const reward=Number(req.body?.reward); const enabled=req.body?.enabled; const title=typeof req.body?.title==='string' ? req.body.title.trim() : ''; const url=typeof req.body?.url==='string' ? req.body.url.trim() : ''; const icon=typeof req.body?.icon==='string' ? req.body.icon.trim() : ''; const iconImage=/^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(icon); const iconUrl=/^https:\/\//.test(icon); if (!Number.isFinite(reward)||reward<0||reward>100000||typeof enabled!=='boolean'||!title||!url||!/^https?:\/\//.test(url)||!icon||(iconImage && icon.length>350000)||(!iconImage && !iconUrl && icon.length>32)|| (iconUrl && icon.length>1000)) return res.status(400).json({error:'Invalid task configuration or icon. Use an emoji, HTTPS image URL, or image under 250 KB.'}); const result=await pool.query('UPDATE task_configs SET title=$2,url=$3,icon=$4,reward=$5,enabled=$6,updated_at=NOW() WHERE id=$1 RETURNING id,title,description,url,icon,reward,enabled',[req.params.id,title,url,icon,reward,enabled]); if(!result.rowCount)return res.status(404).json({error:'Task not found.'}); res.json({task:taskRow(result.rows[0])}); } catch(e){ next(e); } });

gameRouter.get('/admin/settings', adminAuth, async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const saved = await getSetting('ethereum_deposit_address');
    const value = saved || process.env.ETHEREUM_DEPOSIT_ADDRESS || process.env.ETHEREUM_TREASURY_ADDRESS || '';
    res.json({ ethereumDepositAddress: isAddress(value) ? getAddress(value) : null });
  } catch (e) { next(e); }
});

gameRouter.patch('/admin/settings', adminAuth, async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const raw = typeof req.body?.ethereumDepositAddress === 'string' ? req.body.ethereumDepositAddress.trim() : '';
    const qr = typeof req.body?.qrDataUrl === 'string' ? req.body.qrDataUrl.trim() : '';
    if (!isAddress(raw)) return res.status(400).json({ error: 'Enter a valid Ethereum deposit address.' });
    if (qr && (!/^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(qr) || qr.length > 700000)) return res.status(400).json({ error: 'QR upload must be a PNG, JPEG, or WebP image under 500 KB.' });
    await setSetting('ethereum_deposit_address', getAddress(raw));
    await setSetting('ethereum_deposit_qr', qr);
    res.json({ ok: true, ethereumDepositAddress: getAddress(raw), qrUploaded: Boolean(qr) });
  } catch (e) { next(e); }
});

gameRouter.get('/admin/dashboard', adminAuth, async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const [stats, users, ledger, withdrawals, cryptoWithdrawals, cryptoStats] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total_users, COALESCE(SUM(points),0)::numeric(14,2) AS total_points, COALESCE(SUM(taps),0)::bigint AS total_taps, COUNT(*) FILTER (WHERE updated_at > NOW()-INTERVAL '24 hours')::int AS active_24h FROM users`),
      pool.query(`SELECT telegram_id, first_name, username, points, energy, taps, created_at, updated_at FROM users ORDER BY updated_at DESC LIMIT 100`),
      pool.query(`SELECT id, telegram_id, delta, reason, created_at FROM ledger ORDER BY created_at DESC LIMIT 50`),
      pool.query(`SELECT id, telegram_id, points, payout_method, payout_details, status, created_at FROM withdrawals WHERE status='pending' ORDER BY created_at ASC LIMIT 100`),
      pool.query(`SELECT id, telegram_id, asset, amount, destination_address, status, tx_hash, created_at FROM crypto_withdrawals WHERE status IN ('pending','approved') ORDER BY created_at ASC LIMIT 100`),
      pool.query(`SELECT COALESCE((SELECT SUM(amount) FROM crypto_deposits WHERE asset='ETH'),0)::text AS deposits, COALESCE((SELECT SUM(amount) FROM crypto_withdrawals WHERE asset='ETH' AND status IN ('approved','completed')),0)::text AS withdrawals, COUNT(*) FILTER (WHERE status='pending')::int AS pending_crypto FROM crypto_withdrawals`)
    ]);
    const s = stats.rows[0];
    res.json({
      stats: { totalUsers: Number(s.total_users), totalPoints: Number(s.total_points), totalTaps: Number(s.total_taps), active24h: Number(s.active_24h), pendingWithdrawals: (withdrawals.rowCount || 0) + Number(cryptoStats.rows[0].pending_crypto || 0), totalDeposits: String(cryptoStats.rows[0].deposits), totalWithdrawals: String(cryptoStats.rows[0].withdrawals) },
      users: users.rows.map(u => ({ ...u, telegram_id: String(u.telegram_id), points: Number(u.points), taps: Number(u.taps), energy: Number(u.energy) })),
      ledger: ledger.rows.map(l => ({ ...l, telegram_id: String(l.telegram_id), delta: Number(l.delta) })),
      withdrawals: withdrawals.rows.map(w => ({ ...w, telegram_id: String(w.telegram_id), points: Number(w.points) })),
      cryptoWithdrawals: cryptoWithdrawals.rows.map(w => ({ ...w, telegram_id: String(w.telegram_id), amount: String(w.amount), fee: w.asset === 'ETH' ? '0.02' : '0', txHash: w.tx_hash })),
      settings: { ethereumTreasuryAddress: isAddress((await getSetting('ethereum_deposit_address')) || process.env.ETHEREUM_DEPOSIT_ADDRESS || process.env.ETHEREUM_TREASURY_ADDRESS || '') ? getAddress(((await getSetting('ethereum_deposit_address')) || process.env.ETHEREUM_DEPOSIT_ADDRESS || process.env.ETHEREUM_TREASURY_ADDRESS) as string) : null, ethereumDepositQr: (await getSetting('ethereum_deposit_qr')) || null, network: 'Ethereum Mainnet' }
    });
  } catch (e) { next(e); }
});

gameRouter.get('/admin/withdrawals', adminAuth, async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const result = await pool.query(`SELECT id, telegram_id, points, payout_method, payout_details, status, created_at FROM withdrawals WHERE status='pending' ORDER BY created_at ASC LIMIT 100`);
    res.json({ withdrawals: result.rows.map(r => ({ ...r, telegram_id: String(r.telegram_id), points: Number(r.points) })) });
  } catch (e) { next(e); }
});

gameRouter.post('/admin/withdrawals/:id/review', adminAuth, async (req, res, next) => {
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
