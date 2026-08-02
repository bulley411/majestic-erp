import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

/**
 * JWT signing and verification, HS256, using only Node's crypto.
 *
 * Access tokens are short-lived (15 min) and carry the user's roles and
 * permissions so most requests need no database read. Refresh tokens are
 * opaque random strings — never JWTs — stored hashed in the database so
 * a database leak does not hand over usable sessions.
 */

export interface AccessTokenPayload {
  sub: string;          // user id
  email: string;
  roles: string[];
  permissions: string[];
  employeeId: string | null;
  iat: number;
  exp: number;
}

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (s: string) =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 7;

export function signAccessToken(
  payload: Omit<AccessTokenPayload, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds = ACCESS_TOKEN_TTL_SECONDS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const body: AccessTokenPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify(body));
  const signature = b64url(
    createHmac('sha256', secret).update(`${header}.${claims}`).digest(),
  );
  return `${header}.${claims}.${signature}`;
}

export function verifyAccessToken(
  token: string,
  secret: string,
): AccessTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, claims, signature] = parts;

  // Reject anything not HS256. Without this check a token with
  // {"alg":"none"} could be accepted unsigned — a classic JWT attack.
  try {
    const h = JSON.parse(b64urlDecode(header).toString());
    if (h.alg !== 'HS256' || h.typ !== 'JWT') return null;
  } catch {
    return null;
  }

  const expected = createHmac('sha256', secret)
    .update(`${header}.${claims}`).digest();
  const given = b64urlDecode(signature);
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(given, expected)) return null;

  try {
    const payload = JSON.parse(b64urlDecode(claims).toString()) as AccessTokenPayload;
    if (typeof payload.exp !== 'number') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Opaque refresh token. Returned to the client; only its hash is stored. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export const hashRefreshToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

export const refreshTokenExpiry = (days = REFRESH_TOKEN_TTL_DAYS) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000);
