import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export type TelegramUser = { id: number; first_name: string; username?: string };
export function verifyInitData(initData: string, botToken: string, maxAgeSeconds = 86400): TelegramUser {
  if (!initData || initData.length > 10_000) throw new Error('Missing or invalid Telegram init data');
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  const userRaw = params.get('user');
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash) || !Number.isFinite(authDate) || !userRaw) throw new Error('Malformed Telegram init data');
  if (Math.abs(Date.now() / 1000 - authDate) > maxAgeSeconds) throw new Error('Telegram session expired. Reopen the app.');
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest();
  const actual = Buffer.from(receivedHash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Telegram signature validation failed');
  const user = JSON.parse(userRaw) as TelegramUser;
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== 'string') throw new Error('Invalid Telegram user');
  return user;
}
export function telegramAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || token === 'replace_me') return res.status(503).json({ error: 'Telegram bot is not configured on the server.' });
    const initData = req.header('x-telegram-init-data') || '';
    const maxAge = Number(process.env.TELEGRAM_INITDATA_MAX_AGE_SECONDS || 86400);
    (req as Request & { tgUser?: TelegramUser }).tgUser = verifyInitData(initData, token, maxAge);
    next();
  } catch (e) { res.status(401).json({ error: e instanceof Error ? e.message : 'Unauthorized' }); }
}
export function getTelegramUser(req: Request): TelegramUser { return (req as Request & { tgUser?: TelegramUser }).tgUser!; }
