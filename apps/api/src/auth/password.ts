import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (
  password: string, salt: Buffer, keylen: number, options: object,
) => Promise<Buffer>;

/**
 * Password hashing with scrypt.
 *
 * scrypt is in Node's standard library and is memory-hard, which is what
 * makes it resistant to GPU cracking. Using it avoids a native bcrypt
 * dependency — that matters here because bcrypt needs compilation, and
 * this project is developed on Windows and built for Alpine in CI. A
 * native module that builds on one and not the other is a deploy-day
 * problem nobody wants.
 *
 * Format: scrypt$N$r$p$salt$hash — parameters are stored with the hash so
 * they can be raised later without invalidating existing passwords.
 */

const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, PARAMS.keylen, {
    N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: 64 * 1024 * 1024,
  });
  return [
    'scrypt', PARAMS.N, PARAMS.r, PARAMS.p,
    salt.toString('base64'), derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = await scrypt(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    // Constant-time. A plain === leaks information through timing.
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Password policy. Returns null if acceptable, else the reason. */
export function checkPasswordStrength(password: string): string | null {
  if (password.length < 12) return 'Password must be at least 12 characters.';
  if (password.length > 200) return 'Password is too long.';
  if (!/[a-z]/.test(password)) return 'Include at least one lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Include at least one uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Include at least one number.';

  const weak = [
    'password', 'majestic', 'majesticapa', 'mapa', 'welcome',
    'qwerty', '123456', 'letmein', 'admin', 'nigeria', 'lagos', 'abuja',
  ];
  const lower = password.toLowerCase();
  if (weak.some((w) => lower.includes(w))) {
    return 'Password contains a common or easily guessed word.';
  }
  return null;
}
