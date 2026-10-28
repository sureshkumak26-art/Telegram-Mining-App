import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { Interface, JsonRpcProvider, formatUnits, getAddress, isAddress, parseUnits, verifyMessage } from 'ethers';
import { pool } from './db.js';
import { telegramAuth, getTelegramUser } from './telegram.js';

export const cryptoRouter = Router();
const CONFIRMATIONS_REQUIRED = 12;
const HYPERLIQUID_WITHDRAWAL_FEE_ETH = '0.02';
const ERC20 = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
const adminIds = () => new Set((process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
function requireAdmin(req: Request, res: Response) {
  if (!adminIds().has(String(getTelegramUser(req).id))) { res.status(403).json({ error: 'Admin access required.' }); return false; }
  return true;
}
function config() {
  const treasuryRaw = process.env.ETHEREUM_TREASURY_ADDRESS || '';
  const treasury = isAddress(treasuryRaw) ? getAddress(treasuryRaw) : '';
  const usdcRaw = process.env.ETHEREUM_USDC_CONTRACT || '';
  const usdc = isAddress(usdcRaw) ? getAddress(usdcRaw) : '';
  return { treasury, usdc, rpcUrl: process.env.ETHEREUM_RPC_URL || '' };
}
async function provider() {
  const c = config();
  if (!c.rpcUrl || !c.treasury) throw new Error('Ethereum deposits are not configured. Set ETHEREUM_RPC_URL and ETHEREUM_TREASURY_ADDRESS on the backend.');
  const p = new JsonRpcProvider(c.rpcUrl);
  const network = await p.getNetwork();
  if (network.chainId !== 1n) { await p.destroy(); throw new Error('Configured Ethereum RPC endpoint is not Ethereum Mainnet (chain ID 1).'); }
  return p;
}
function validHash(value: unknown): value is string { return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value); }
function decimalAmount(value: unknown, decimals: number) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,18})?$/.test(value)) throw new Error('Enter a valid positive decimal amount.');
  const parsed = parseUnits(value, decimals);
  if (parsed <= 0n) throw new Error('Amount must be greater than zero.');
  return parsed;
}
function assetDecimals(asset: string) { if (asset === 'ETH') return 18; if (asset === 'USDC') return 6; throw new Error('Supported assets are ETH and USDC on Ethereum mainnet.'); }
async function linkedAddress(telegramId: number) {
  const result = await pool.query('SELECT address FROM crypto_wallet_links WHERE telegram_id=$1', [telegramId]);
  if (!result.rowCount) throw new Error('Connect and verify your Ethereum wallet first.');
  return getAddress(result.rows[0].address as string);
}
cryptoRouter.get('/crypto/summary', telegramAuth, async (req, res, next) => {
  try {
    const tg = getTelegramUser(req), c = config();
    let ethereumConfigured = false;
    let configurationMessage = 'Set ETHEREUM_RPC_URL and ETHEREUM_TREASURY_ADDRESS on the backend.';
    if (c.rpcUrl && c.treasury) {
      try { const p = await provider(); ethereumConfigured = true; configurationMessage = ''; await p.destroy(); }
      catch { configurationMessage = 'Ethereum Mainnet RPC or treasury configuration could not be validated. Check the backend environment and RPC endpoint.'; }
    }
    const wallet = await pool.query('SELECT address, verified_at FROM crypto_wallet_links WHERE telegram_id=$1', [tg.id]);
    const balances = await pool.query('SELECT asset, balance FROM crypto_balances WHERE telegram_id=$1 ORDER BY asset', [tg.id]);
    const deposits = await pool.query('SELECT tx_hash, asset, amount, block_number, confirmations, created_at FROM crypto_deposits WHERE telegram_id=$1 ORDER BY created_at DESC LIMIT 10', [tg.id]);
    const withdrawals = await pool.query('SELECT id, asset, amount, destination_address, status, tx_hash, created_at FROM crypto_withdrawals WHERE telegram_id=$1 ORDER BY created_at DESC LIMIT 10', [tg.id]);
    res.json({ network: 'Ethereum Mainnet', chainId: 1, configured: ethereumConfigured, configurationMessage, treasuryAddress: ethereumConfigured ? c.treasury : null, usdcEnabled: Boolean(c.usdc), confirmationsRequired: CONFIRMATIONS_REQUIRED, withdrawalFeeEth: HYPERLIQUID_WITHDRAWAL_FEE_ETH, wallet: wallet.rows[0] ? { address: wallet.rows[0].address, verifiedAt: wallet.rows[0].verified_at } : null, balances: balances.rows.map(b => ({ asset: b.asset, balance: String(b.balance) })), deposits: deposits.rows.map(d => ({ ...d, amount: String(d.amount), txHash: d.tx_hash, blockNumber: String(d.block_number) })), withdrawals: withdrawals.rows.map(w => ({ ...w, amount: String(w.amount), txHash: w.tx_hash })) });
  } catch (e) { next(e); }
});
cryptoRouter.post('/crypto/challenge', telegramAuth, async (req, res, next) => {
  try {
    const tg = getTelegramUser(req), raw = req.body?.address;
    if (typeof raw !== 'string' || !isAddress(raw)) return res.status(400).json({ error: 'Enter a valid Ethereum address.' });
    const address = getAddress(raw), nonce = randomUUID(), expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const message = ['Hyperliquid Mining Wallet Verification', `Telegram ID: ${tg.id}`, `Ethereum address: ${address}`, `Nonce: ${nonce}`, `Expires: ${expiresAt.toISOString()}`, 'This signature only links your address. It cannot authorize transactions.'].join('\n');
    await pool.query('INSERT INTO crypto_wallet_challenges(id, telegram_id, address, message, expires_at) VALUES($1,$2,$3,$4,$5)', [nonce, tg.id, address, message, expiresAt]);
    res.json({ challengeId: nonce, message, expiresAt });
  } catch (e) { next(e); }
});
cryptoRouter.post('/crypto/connect', telegramAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const tg = getTelegramUser(req), id = req.body?.challengeId, signature = req.body?.signature;
    if (typeof id !== 'string' || typeof signature !== 'string' || signature.length > 500) return res.status(400).json({ error: 'Invalid wallet signature request.' });
    await client.query('BEGIN');
    const found = await client.query('SELECT address, message, expires_at, used_at FROM crypto_wallet_challenges WHERE id=$1 AND telegram_id=$2 FOR UPDATE', [id, tg.id]);
    if (!found.rowCount || found.rows[0].used_at || new Date(found.rows[0].expires_at).getTime() < Date.now()) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Wallet challenge expired or already used. Try connecting again.' }); }
    let recovered: string;
    try { recovered = getAddress(verifyMessage(found.rows[0].message, signature)); }
    catch { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Wallet signature could not be verified.' }); }
    if (recovered !== getAddress(found.rows[0].address)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Signature does not match the requested wallet address.' }); }
    await client.query('UPDATE crypto_wallet_challenges SET used_at=NOW() WHERE id=$1', [id]);
    await client.query('INSERT INTO crypto_wallet_links(telegram_id,address,verified_at) VALUES($1,$2,NOW()) ON CONFLICT(telegram_id) DO UPDATE SET address=EXCLUDED.address, verified_at=NOW()', [tg.id, recovered]);
    await client.query('COMMIT');
    res.json({ ok: true, address: recovered });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
  finally { client.release(); }
});
cryptoRouter.post('/crypto/disconnect', telegramAuth, async (req, res, next) => {
  try { await pool.query('DELETE FROM crypto_wallet_links WHERE telegram_id=$1', [getTelegramUser(req).id]); res.json({ ok: true }); }
  catch (e) { next(e); }
});
cryptoRouter.post('/crypto/deposits/verify', telegramAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const tg = getTelegramUser(req), asset = req.body?.asset;
    const hash = typeof req.body?.txHash === 'string' ? req.body.txHash.trim() : '';
    if (!validHash(hash)) return res.status(400).json({ error: 'Enter a valid Ethereum transaction hash.' });
    if (!['ETH','USDC'].includes(asset)) return res.status(400).json({ error: 'Supported assets are ETH and USDC on Ethereum mainnet.' });
    const decimals = assetDecimals(asset);
    const sender = await linkedAddress(tg.id), c = config();
    if (asset === 'USDC' && !c.usdc) return res.status(503).json({ error: 'USDC deposits are not configured on this backend.' });
    const p = await provider();
    const tx = await p.getTransaction(hash);
    const receipt = await p.getTransactionReceipt(hash);
    if (!tx || !receipt) return res.status(409).json({ error: 'Transaction not found or not mined yet. Try again after it is included in a block.' });
    if (receipt.status !== 1) return res.status(400).json({ error: 'This transaction failed on Ethereum.' });
    if (getAddress(tx.from) !== sender) return res.status(400).json({ error: 'Transaction sender must be your currently linked wallet.' });
    const currentBlock = await p.getBlockNumber();
    const confirmations = currentBlock - receipt.blockNumber + 1;
    if (confirmations < CONFIRMATIONS_REQUIRED) return res.status(409).json({ error: `Only ${confirmations} confirmations. Wait for ${CONFIRMATIONS_REQUIRED} confirmations and retry.`, confirmations, required: CONFIRMATIONS_REQUIRED });
    let rawAmount = 0n;
    if (asset === 'ETH') {
      if (!tx.to || getAddress(tx.to) !== c.treasury) return res.status(400).json({ error: 'This ETH transaction was not sent to the configured deposit address.' });
      rawAmount = tx.value;
    } else {
      for (const log of receipt.logs) {
        if (getAddress(log.address) !== c.usdc) continue;
        try {
          const parsed = ERC20.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === 'Transfer' && getAddress(parsed.args.from) === sender && getAddress(parsed.args.to) === c.treasury) rawAmount += parsed.args.value as bigint;
        } catch { /* Ignore logs that are not the standard ERC-20 Transfer event. */ }
      }
    }
    if (rawAmount <= 0n) return res.status(400).json({ error: `No qualifying ${asset} transfer to the configured deposit address was found.` });
    const amount = formatUnits(rawAmount, decimals);
    await client.query('BEGIN');
    const inserted = await client.query('INSERT INTO crypto_deposits(tx_hash,telegram_id,asset,amount,from_address,block_number,confirmations) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tx_hash) DO NOTHING RETURNING tx_hash', [hash.toLowerCase(), tg.id, asset, amount, sender, receipt.blockNumber, confirmations]);
    if (!inserted.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This transaction hash has already been credited or submitted.' }); }
    await client.query('INSERT INTO crypto_balances(telegram_id,asset,balance) VALUES($1,$2,$3) ON CONFLICT(telegram_id,asset) DO UPDATE SET balance=crypto_balances.balance+EXCLUDED.balance', [tg.id, asset, amount]);
    await client.query('INSERT INTO crypto_ledger(telegram_id,asset,delta,reason,tx_hash) VALUES($1,$2,$3,$4,$5)', [tg.id, asset, amount, 'confirmed-deposit', hash.toLowerCase()]);
    await client.query('COMMIT');
    res.status(201).json({ ok: true, asset, amount, txHash: hash, confirmations, credited: true });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
  finally { client.release(); }
});
cryptoRouter.post('/crypto/withdrawals', telegramAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const tg = getTelegramUser(req), asset = req.body?.asset, destinationRaw = req.body?.destination, rawAmount = req.body?.amount;
    if (asset !== 'ETH') return res.status(400).json({ error: 'Hyperliquid withdrawals are currently ETH-only on Ethereum Mainnet.' });
    const amount = decimalAmount(rawAmount, 18);
    const fee = parseUnits(HYPERLIQUID_WITHDRAWAL_FEE_ETH, 18);
    if (amount <= 0n) return res.status(400).json({ error: 'Withdrawal amount must be greater than zero.' });
    if (typeof destinationRaw !== 'string' || !isAddress(destinationRaw)) return res.status(400).json({ error: 'Enter a valid Hyperliquid ETH deposit address.' });
    const destination = getAddress(destinationRaw);
    await linkedAddress(tg.id);
    await client.query('BEGIN');
    const amountText = formatUnits(amount, 18);
    const totalDebitText = formatUnits(amount + fee, 18);
    const balance = await client.query('SELECT balance >= $3::numeric AS enough FROM crypto_balances WHERE telegram_id=$1 AND asset=$2 FOR UPDATE', [tg.id, 'ETH', totalDebitText]);
    if (!balance.rowCount || !balance.rows[0].enough) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Insufficient ETH balance. Your balance must cover the withdrawal amount plus the 0.02 ETH fee.' }); }
    await client.query('UPDATE crypto_balances SET balance=balance-$3 WHERE telegram_id=$1 AND asset=$2', [tg.id, 'ETH', totalDebitText]);
    const created = await client.query('INSERT INTO crypto_withdrawals(telegram_id,asset,amount,destination_address) VALUES($1,$2,$3,$4) RETURNING id,asset,amount,destination_address,status,created_at', [tg.id, 'ETH', amountText, destination]);
    await client.query('INSERT INTO crypto_ledger(telegram_id,asset,delta,reason) VALUES($1,$2,$3,$4)', [tg.id, 'ETH', '-'+amountText, `withdrawal-request:${created.rows[0].id}`]);
    await client.query('INSERT INTO crypto_ledger(telegram_id,asset,delta,reason) VALUES($1,$2,$3,$4)', [tg.id, 'ETH', '-'+HYPERLIQUID_WITHDRAWAL_FEE_ETH, `hyperliquid-withdrawal-fee:${created.rows[0].id}`]);
    await client.query('COMMIT');
    res.status(201).json({ withdrawal: { ...created.rows[0], amount: String(created.rows[0].amount), fee: HYPERLIQUID_WITHDRAWAL_FEE_ETH, network: 'Ethereum Mainnet', destination: 'Hyperliquid' } });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); if (e instanceof Error && /Ethereum|wallet|address|amount|decimal|Supported assets/.test(e.message)) return res.status(400).json({ error: e.message }); next(e); }
  finally { client.release(); }
});
cryptoRouter.get('/admin/crypto/withdrawals', telegramAuth, async (req, res, next) => {
  try {
    if (!requireAdmin(req,res)) return;
    const r = await pool.query(`SELECT id,telegram_id,asset,amount,destination_address,status,tx_hash,created_at FROM crypto_withdrawals WHERE status IN ('pending','approved') ORDER BY created_at ASC LIMIT 100`);
    res.json({ withdrawals: r.rows.map(w => ({ ...w, telegram_id: String(w.telegram_id), amount: String(w.amount) })) });
  } catch (e) { next(e); }
});
cryptoRouter.post('/admin/crypto/withdrawals/:id/review', telegramAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!requireAdmin(req,res)) return;
    const tg = getTelegramUser(req), id = Number(req.params.id), decision = req.body?.decision;
    if (!Number.isSafeInteger(id) || id <= 0 || !['approved','rejected'].includes(decision)) return res.status(400).json({ error: 'Invalid crypto withdrawal review.' });
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM crypto_withdrawals WHERE id=$1 FOR UPDATE', [id]);
    if (!found.rowCount || found.rows[0].status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Withdrawal not found or already reviewed.' }); }
    const w = found.rows[0];
    await client.query('UPDATE crypto_withdrawals SET status=$2, reviewed_by=$3, reviewed_at=NOW() WHERE id=$1', [id, decision, tg.id]);
    if (decision === 'rejected') {
      const refundAmount = w.asset === 'ETH' ? formatUnits(parseUnits(String(w.amount), 18) + parseUnits(HYPERLIQUID_WITHDRAWAL_FEE_ETH, 18), 18) : String(w.amount);
      await client.query('INSERT INTO crypto_balances(telegram_id,asset,balance) VALUES($1,$2,$3) ON CONFLICT(telegram_id,asset) DO UPDATE SET balance=crypto_balances.balance+EXCLUDED.balance', [w.telegram_id,w.asset,refundAmount]);
      await client.query('INSERT INTO crypto_ledger(telegram_id,asset,delta,reason) VALUES($1,$2,$3,$4)', [w.telegram_id,w.asset,w.amount,`withdrawal-refund:${id}`]);
      if (w.asset === 'ETH') await client.query('INSERT INTO crypto_ledger(telegram_id,asset,delta,reason) VALUES($1,$2,$3,$4)', [w.telegram_id,'ETH',HYPERLIQUID_WITHDRAWAL_FEE_ETH,`hyperliquid-withdrawal-fee-refund:${id}`]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, id, status: decision });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
  finally { client.release(); }
});
cryptoRouter.post('/admin/crypto/withdrawals/:id/paid', telegramAuth, async (req, res, next) => {
  try {
    if (!requireAdmin(req,res)) return;
    const id = Number(req.params.id), hash = typeof req.body?.txHash === 'string' ? req.body.txHash.trim() : '';
    if (!Number.isSafeInteger(id) || id <= 0 || !validHash(hash)) return res.status(400).json({ error: 'Provide a valid withdrawal ID and Ethereum transaction hash.' });
    const r = await pool.query('SELECT * FROM crypto_withdrawals WHERE id=$1', [id]);
    if (!r.rowCount || r.rows[0].status !== 'approved') return res.status(409).json({ error: 'Approve the request before marking it paid.' });
    const w = r.rows[0], c = config(), p = await provider();
    const tx = await p.getTransaction(hash), receipt = await p.getTransactionReceipt(hash);
    if (!tx || !receipt || receipt.status !== 1) return res.status(409).json({ error: 'Payout transaction is missing or failed.' });
    const confirmations = await p.getBlockNumber() - receipt.blockNumber + 1;
    if (confirmations < CONFIRMATIONS_REQUIRED) return res.status(409).json({ error: `Payout needs ${CONFIRMATIONS_REQUIRED} confirmations (currently ${confirmations}).` });
    let valid = false;
    if (w.asset === 'ETH') valid = Boolean(tx.to && getAddress(tx.from) === c.treasury && getAddress(tx.to) === getAddress(w.destination_address) && tx.value >= parseUnits(String(w.amount),18));
    else if (w.asset === 'USDC' && c.usdc) {
      for (const log of receipt.logs) if (getAddress(log.address) === c.usdc) {
        try { const parsed = ERC20.parseLog({ topics: [...log.topics], data: log.data }); if (parsed?.name === 'Transfer' && getAddress(parsed.args.from) === c.treasury && getAddress(parsed.args.to) === getAddress(w.destination_address) && (parsed.args.value as bigint) >= parseUnits(String(w.amount),6)) valid = true; } catch { /* Ignore non-Transfer logs. */ }
      }
    }
    if (!valid) return res.status(400).json({ error: 'Transaction does not match the treasury, asset, destination and requested amount.' });
    const updated = await pool.query(`UPDATE crypto_withdrawals SET status='paid', tx_hash=$2, reviewed_at=NOW() WHERE id=$1 AND status='approved' RETURNING id`, [id, hash.toLowerCase()]);
    if (!updated.rowCount) return res.status(409).json({ error: 'Withdrawal was updated by another admin.' });
    await pool.query('INSERT INTO crypto_ledger(telegram_id,asset,delta,reason,tx_hash) VALUES($1,$2,0,$3,$4)', [w.telegram_id,w.asset,`withdrawal-paid:${id}`,hash.toLowerCase()]);
    res.json({ ok: true, id, status: 'paid', txHash: hash });
  } catch (e) { next(e); }
});
