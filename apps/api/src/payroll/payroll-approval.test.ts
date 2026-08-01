// Standalone check of the approval state machine with the Nest/Prisma
// imports shimmed, so it runs before the API is installed.
type PayrollRunStatus = 'DRAFT'|'PREPARED'|'REVIEWED'|'APPROVED'|'POSTED'|'PAID'|'REJECTED';
type ApprovalAction = 'PREPARE'|'REVIEW'|'APPROVE'|'REJECT'|'POST'|'MARK_PAID';

import { authorizeTransition, availableActions } from './payroll-approval';

const accountant = { id:'u-acct', roles:['ACCOUNTANT'] };
const head       = { id:'u-head', roles:['FINANCE_HEAD'] };
const md         = { id:'u-md',   roles:['MD'] };
const superuser  = { id:'u-both', roles:['ACCOUNTANT','FINANCE_HEAD','MD'] };

const run = (s: any, over: any = {}) => ({ status:s, preparedById:null, reviewedById:null, approvedById:null, ...over });
let n = 0;
const ok = (label: string, fn: () => void) => { fn(); n++; console.log('  ok  '+label); };
const throws = (label: string, fn: () => void, match: string) => {
  try { fn(); throw new Error('expected a throw: '+label); }
  catch (e: any) {
    if (!String(e.message).includes(match)) throw new Error(`${label}: got "${e.message}"`);
    n++; console.log('  ok  '+label);
  }
};

console.log('\nPayroll approval chain\n');

ok('accountant prepares a draft', () =>
  authorizeTransition(run('DRAFT'), 'PREPARE', accountant));

ok('head of finance reviews a prepared run', () =>
  authorizeTransition(run('PREPARED', {preparedById:'u-acct'}), 'REVIEW', head));

ok('MD approves a reviewed run', () =>
  authorizeTransition(run('REVIEWED', {preparedById:'u-acct', reviewedById:'u-head'}), 'APPROVE', md));

throws('accountant cannot review', () =>
  authorizeTransition(run('PREPARED',{preparedById:'u-acct'}), 'REVIEW', accountant), 'requires FINANCE_HEAD');

throws('head of finance cannot approve', () =>
  authorizeTransition(run('REVIEWED',{preparedById:'u-acct',reviewedById:'u-head'}), 'APPROVE', head), 'requires MD');

throws('MD cannot approve before review', () =>
  authorizeTransition(run('PREPARED'), 'APPROVE', md), 'Cannot approve');

throws('cannot post an unapproved run', () =>
  authorizeTransition(run('REVIEWED'), 'POST', accountant), 'Cannot post');

// The important one.
throws('a user holding every role cannot review their own preparation', () =>
  authorizeTransition(run('PREPARED',{preparedById:'u-both'}), 'REVIEW', superuser), 'already signed');

throws('...nor approve a run they reviewed', () =>
  authorizeTransition(run('REVIEWED',{preparedById:'u-acct',reviewedById:'u-both'}), 'APPROVE', superuser), 'already signed');

throws('rejection requires a reason', () =>
  authorizeTransition(run('PREPARED'), 'REJECT', head), 'must include a reason');

ok('rejection with a reason is allowed', () =>
  authorizeTransition(run('PREPARED'), 'REJECT', head, 'Transport allowance wrong for 3 staff'));

ok('rejected run can be re-prepared', () =>
  authorizeTransition(run('REJECTED'), 'PREPARE', accountant));

ok('UI action list is role-aware', () => {
  const a = availableActions(run('PREPARED',{preparedById:'u-acct'}), head);
  if (!a.includes('REVIEW') || !a.includes('REJECT')) throw new Error('expected REVIEW+REJECT, got '+a);
  const b = availableActions(run('PREPARED',{preparedById:'u-acct'}), accountant);
  if (b.length) throw new Error('accountant should have no actions, got '+b);
});

console.log(`\n${n} checks passed\n`);
