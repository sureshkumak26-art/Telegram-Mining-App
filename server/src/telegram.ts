import { createHmac, timingSafeEqual } from 'node:crypto';
import { verifyAdminSession } from './adminSession.js';
import type { Request, Response, NextFunction } from 'express';

export type TelegramUser = { id: number; first_name: string; username?: string; photo_url?: string };
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
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== 'string' || user.first_name.length > 255) throw new Error('Invalid Telegram user');
  if (user.username !== undefined && (typeof user.username !== 'string' || user.username.length > 255)) throw new Error('Invalid Telegram username');
  if (user.photo_url !== undefined && (typeof user.photo_url !== 'string' || user.photo_url.length > 2048 || !/^https:\/\//i.test(user.photo_url))) throw new Error('Invalid Telegram profile image');
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

export function adminAuth(req: Request, res: Response, next: NextFunction) {
  const browserToken = req.header('x-admin-session') || '';
  if (browserToken) {
    const browserAdmin = verifyAdminSession(browserToken);
    if (!browserAdmin) {
      return res.status(401).json({ error: 'Browser admin session expired or is invalid. Sign in again.' });
    }
    (req as Request & { tgUser?: TelegramUser }).tgUser = browserAdmin;
    return next();
  }
  const enabled = process.env.NODE_ENV === 'development' && process.env.ALLOW_LOCAL_ADMIN === 'true';
  if (!enabled) return telegramAuth(req, res, next);
  const id = Number(process.env.LOCAL_ADMIN_TELEGRAM_ID || '1');
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(503).json({ error: 'Invalid local admin configuration.' });
  (req as Request & { tgUser?: TelegramUser }).tgUser = { id, first_name: 'Local Admin', username: 'local_admin' };
  next();
}
