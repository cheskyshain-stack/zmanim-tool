import { cookies } from 'next/headers';
import crypto from 'node:crypto';

const COOKIE = 'bp_session';
const SECRET = process.env.SESSION_SECRET ?? 'dev-only-insecure-secret';
const PASSWORD = process.env.APP_PASSWORD ?? 'changeme';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function sign(payload: string) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

export function checkPassword(input: string): boolean {
  const a = Buffer.from(input || '');
  const b = Buffer.from(PASSWORD);
  // constant-time compare, padded so length alone does not leak
  const len = Math.max(a.length, b.length);
  return crypto.timingSafeEqual(
    Buffer.concat([a], len),
    Buffer.concat([b], len)
  );
}

export async function createSession() {
  const issued = Date.now().toString();
  const token = `${issued}.${sign(issued)}`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function isAuthed(): Promise<boolean> {
  const c = (await cookies()).get(COOKIE)?.value;
  if (!c) return false;
  const [issued, sig] = c.split('.');
  if (!issued || !sig) return false;
  if (sign(issued) !== sig) return false;
  return Date.now() - Number(issued) < MAX_AGE * 1000;
}
