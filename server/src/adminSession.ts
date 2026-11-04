import { createHmac, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);

export type AdminSession = { id: number; first_name: string; username: string };

export async function verifyAdminPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, expectedHex] = encoded.split('$');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32,128}$/i.test(salt || '') || !/^[a-f0-9]{128}$/i.test(expectedHex || '')) return false;
  const actual = await scrypt(password, Buffer.from(salt, 'hex'), 64) as Buffer;
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createAdminSession(adminId: number): string {
  const secret = process.env.ADMIN_SESSION_SECRET || '';
  if (secret.length < 32) throw new Error('ADMIN_SESSION_SECRET must contain at least 32 characters.');
  const payload = Buffer.from(JSON.stringify({ sub: adminId, exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60 })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + signature;
}

export function verifyAdminSession(token: string): AdminSession | null {
  try {
    const secret = process.env.ADMIN_SESSION_SECRET || '';
    if (secret.length < 32 || token.length > 2048) return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature || token.split('.').length !== 2) return null;
    const expected = createHmac('sha256', secret).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: number; exp?: number };
    const admins = new Set((process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(value => value.trim()).filter(Boolean));
    if (!Number.isSafeInteger(data.sub) || !admins.has(String(data.sub)) || !Number.isSafeInteger(data.exp) || (data.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return { id: data.sub as number, first_name: 'Web Admin', username: 'browser_admin' };
  } catch { return null; }
}
