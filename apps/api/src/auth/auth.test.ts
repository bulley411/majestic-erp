import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, checkPasswordStrength } from './password';
import { signAccessToken, verifyAccessToken, generateRefreshToken, hashRefreshToken } from './tokens';

const S = 'a-test-secret-at-least-32-characters-long';
let n = 0;
const ok = (l: string, f: () => void | Promise<void>) =>
  Promise.resolve(f()).then(() => { n++; console.log('  ok  ' + l); });

(async () => {
console.log('\nAuthentication\n');

// --- password hashing ---
const h = await hashPassword('Tarragon9Vessel');
await ok('scrypt hash has embedded parameters', () =>
  assert.ok(h.startsWith('scrypt$16384$8$1$')));
await ok('correct password verifies', async () =>
  assert.equal(await verifyPassword('Tarragon9Vessel', h), true));
await ok('wrong password rejected', async () =>
  assert.equal(await verifyPassword('Tarragon9Vesse1', h), false));
await ok('identical passwords hash differently (salted)', async () =>
  assert.notEqual(await hashPassword('same'), await hashPassword('same')));
await ok('malformed stored hash rejected, no throw', async () =>
  assert.equal(await verifyPassword('x', 'not-a-hash'), false));

// --- password policy ---
await ok('short password rejected', () =>
  assert.ok(checkPasswordStrength('Ab1cdefg')));
await ok('no uppercase rejected', () =>
  assert.ok(checkPasswordStrength('abcdefgh1234')));
await ok('no digit rejected', () =>
  assert.ok(checkPasswordStrength('abcdefghIJKL')));
await ok('company name rejected', () =>
  assert.ok(checkPasswordStrength('MajesticApa2026')));
await ok('strong password accepted', () =>
  assert.equal(checkPasswordStrength('Tarragon9Vessel'), null));

// --- tokens ---
const claims = { sub:'u1', email:'a@b.com', roles:['MD'], permissions:['payroll.approve'], employeeId:'e1' };
const token = signAccessToken(claims, S);

await ok('token round-trips with roles and permissions', () => {
  const v = verifyAccessToken(token, S);
  assert.equal(v?.sub, 'u1');
  assert.deepEqual(v?.permissions, ['payroll.approve']);
});
await ok('signature checked against secret', () =>
  assert.equal(verifyAccessToken(token, 'a-different-secret-32-characters-x'), null));
await ok('tampered claims rejected', () => {
  const p = token.split('.');
  p[1] = Buffer.from(JSON.stringify({ ...claims, permissions:['ledger.post'], iat:1, exp:9e9 })).toString('base64url');
  assert.equal(verifyAccessToken(p.join('.'), S), null);
});
await ok('expired token rejected', () =>
  assert.equal(verifyAccessToken(signAccessToken(claims, S, -60), S), null));
await ok('alg:none forgery rejected', () => {
  const hdr = Buffer.from(JSON.stringify({ alg:'none', typ:'JWT' })).toString('base64url');
  const bod = Buffer.from(JSON.stringify({ ...claims, iat:1, exp:9e9 })).toString('base64url');
  assert.equal(verifyAccessToken(`${hdr}.${bod}.`, S), null);
});
await ok('garbage rejected without throwing', () => {
  assert.equal(verifyAccessToken('nonsense', S), null);
  assert.equal(verifyAccessToken('a.b.c', S), null);
  assert.equal(verifyAccessToken('', S), null);
});

// --- refresh tokens ---
const r = generateRefreshToken();
await ok('refresh token is opaque, not a JWT', () =>
  assert.equal(r.token.split('.').length, 1));
await ok('only the hash would be stored', () => {
  assert.equal(r.hash, hashRefreshToken(r.token));
  assert.notEqual(r.hash, r.token);
});
await ok('refresh tokens are unique', () =>
  assert.notEqual(generateRefreshToken().token, generateRefreshToken().token));

console.log(`\n${n} checks passed\n`);
})();
