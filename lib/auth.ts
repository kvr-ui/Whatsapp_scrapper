/**
 * Minimal single-password gate for the dashboard.
 *
 * The cookie holds `<expiry>.<hmac>` signed with AUTH_SECRET, so it can be
 * verified in Edge middleware without a database round-trip. Uses WebCrypto,
 * which is available in both the Edge and Node.js runtimes.
 */

const COOKIE_NAME = 'focas_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export { COOKIE_NAME, MAX_AGE_SECONDS };

/**
 * The dashboard gate is opt-in: it is active only while DASHBOARD_PASSWORD is
 * set. Unset the variable (locally or on Vercel) and the console is reachable
 * without logging in. Note this leaves lead phone numbers open to anyone who
 * has the URL.
 */
export function authEnabled(): boolean {
  return Boolean(process.env.DASHBOARD_PASSWORD);
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error('AUTH_SECRET is missing or too short (need 16+ characters).');
  }
  return s;
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function createSessionToken(): Promise<string> {
  const expiry = String(Date.now() + MAX_AGE_SECONDS * 1000);
  return `${expiry}.${await hmac(expiry)}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const [expiry, sig] = token.split('.');
  if (!expiry || !sig) return false;
  if (Number(expiry) < Date.now()) return false;
  return timingSafeEqual(await hmac(expiry), sig);
}

export function checkPassword(input: string): boolean {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) throw new Error('DASHBOARD_PASSWORD is not set.');
  return timingSafeEqual(input, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
