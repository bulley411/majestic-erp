import Decimal from 'decimal.js';
import { requiredApprover, authorizeVoucherApproval, describeRouting, Limit } from './voucher-approval';

// Threshold: ED up to 500,000; MD unlimited above that.
const LIMITS: Limit[] = [
  { roleCode: 'ED', rank: 1, maxAmount: new Decimal('500000') },
  { roleCode: 'MD', rank: 2, maxAmount: null },
];

const ed  = { id: 'u-ed',  roles: ['ED'] };
const md  = { id: 'u-md',  roles: ['MD'] };
const acct= { id: 'u-acct',roles: ['ACCOUNTANT'] };

const v = (amount: string, over: any = {}) => ({
  id: 'v1', voucherNo: 'MAPA/VCH/2026/001', amount: new Decimal(amount),
  status: 'PENDING_APPROVAL', raisedById: 'u-acct', approvedById: null, ...over,
});

let n = 0;
const ok = (l: string, f: () => void) => { f(); n++; console.log('  ok  ' + l); };
const bad = (l: string, f: () => void, m: string) => {
  try { f(); throw new Error('expected throw: ' + l); }
  catch (e: any) {
    if (!String(e.message).includes(m)) throw new Error(`${l}: got "${e.message}"`);
    n++; console.log('  ok  ' + l);
  }
};

console.log('\nVoucher approval routing\n');

ok('50,000 routes to ED', () => {
  if (requiredApprover(new Decimal('50000'), LIMITS).roleCode !== 'ED') throw new Error('x');
});
ok('exactly 500,000 still routes to ED', () => {
  if (requiredApprover(new Decimal('500000'), LIMITS).roleCode !== 'ED') throw new Error('x');
});
ok('500,000.01 escalates to MD', () => {
  if (requiredApprover(new Decimal('500000.01'), LIMITS).roleCode !== 'MD') throw new Error('x');
});
ok('the 1,290,000 CAC registration routes to MD', () => {
  if (requiredApprover(new Decimal('1290000'), LIMITS).roleCode !== 'MD') throw new Error('x');
});

ok('ED approves a 200,000 voucher', () => authorizeVoucherApproval(v('200000'), ed, LIMITS));
ok('MD may approve below threshold too', () => authorizeVoucherApproval(v('200000'), md, LIMITS));
ok('MD approves 1,290,000', () => authorizeVoucherApproval(v('1290000'), md, LIMITS));

bad('ED cannot approve above threshold', () =>
  authorizeVoucherApproval(v('1290000'), ed, LIMITS), 'requires MD approval');
bad('accountant cannot approve at all', () =>
  authorizeVoucherApproval(v('10000', { raisedById: 'u-other' }), acct, LIMITS), 'requires ED approval');
bad('the raiser cannot approve their own voucher', () =>
  authorizeVoucherApproval(v('100000', { raisedById: 'u-ed' }), ed, LIMITS), 'raised this voucher');
bad('cannot approve an already-approved voucher', () =>
  authorizeVoucherApproval(v('100000', { status: 'APPROVED' }), md, LIMITS), 'not awaiting approval');
bad('zero-amount voucher is rejected', () =>
  requiredApprover(new Decimal('0'), LIMITS), 'greater than zero');

ok('routing hint for the form', () => {
  if (describeRouting(new Decimal('300000'), LIMITS) !== 'Requires Executive Director approval') throw new Error('a');
  if (describeRouting(new Decimal('900000'), LIMITS) !== 'Requires Managing Director approval') throw new Error('b');
});

ok('raising the threshold reroutes without code change', () => {
  const raised: Limit[] = [
    { roleCode: 'ED', rank: 1, maxAmount: new Decimal('2000000') },
    { roleCode: 'MD', rank: 2, maxAmount: null },
  ];
  if (requiredApprover(new Decimal('1290000'), raised).roleCode !== 'ED') throw new Error('x');
});

console.log(`\n${n} checks passed\n`);
