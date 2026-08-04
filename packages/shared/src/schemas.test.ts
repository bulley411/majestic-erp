import assert from 'node:assert/strict';
import { employeeCreate, employeeUpdate, documentToggleSchema } from './schemas';

let n = 0;
const ok = (l: string, f: () => void) => { f(); n++; console.log('  ok  ' + l); };
const base = { staffId: 'MAPA-26-PER-0016', firstName: 'Test', lastName: 'User' };
const good = (v: object) => employeeCreate.safeParse({ ...base, ...v }).success;
const bad = (v: object) => !employeeCreate.safeParse({ ...base, ...v }).success;

console.log('\nEmployee validation\n');

ok('minimal record accepted', () => assert.ok(good({})));
ok('staff ID format enforced', () => assert.ok(bad({ staffId: 'ABC-1' })));
ok('missing last name rejected', () =>
  assert.ok(!employeeCreate.safeParse({ staffId: base.staffId, firstName: 'A' }).success));

ok('RSA PIN must be PEN + 12 digits', () =>
  assert.ok(bad({ rsaPin: '12345', pensionFundAdministrator: 'Stanbic IBTC Pension' })));
ok('valid RSA PIN accepted', () =>
  assert.ok(good({ rsaPin: 'PEN123456789012', pensionFundAdministrator: 'Stanbic IBTC Pension' })));
ok('RSA PIN without PFA rejected', () => assert.ok(bad({ rsaPin: 'PEN123456789012' })));

ok('NUBAN must be 10 digits', () => assert.ok(bad({ bankAccountNumber: '123', bankName: 'Access' })));
ok('valid NUBAN accepted', () => assert.ok(good({ bankAccountNumber: '0123456789', bankName: 'Access' })));
ok('account number without bank rejected', () => assert.ok(bad({ bankAccountNumber: '0123456789' })));

ok('local phone accepted', () => assert.ok(good({ phoneNumber: '08031234567' })));
ok('+234 phone accepted', () => assert.ok(good({ phoneNumber: '+2348031234567' })));
ok('short phone rejected', () => assert.ok(bad({ phoneNumber: '12345' })));

ok('empty strings coerce to undefined', () => {
  const r = employeeCreate.safeParse({ ...base, phoneNumber: '', rsaPin: '', personalEmail: '' });
  assert.equal(r.success, true);
});

ok('DOB after employment date rejected', () =>
  assert.ok(bad({ dateOfBirth: '2020-01-01', dateOfEmployment: '2010-01-01' })));
ok('under-16 rejected', () => assert.ok(bad({ dateOfBirth: '2015-01-01' })));
ok('implausible age rejected', () => assert.ok(bad({ dateOfBirth: '1900-01-01' })));
ok('assumption before employment rejected', () =>
  assert.ok(bad({ dateOfEmployment: '2026-02-01', dateOfAssumption: '2026-01-01' })));
ok('assumption same day as employment accepted', () =>
  assert.ok(good({ dateOfEmployment: '2026-02-01', dateOfAssumption: '2026-02-01' })));

ok('partial update accepts one field', () =>
  assert.ok(employeeUpdate.safeParse({ phoneNumber: '08031234567' }).success));
ok('partial update still enforces format', () =>
  assert.ok(!employeeUpdate.safeParse({ phoneNumber: 'abc' }).success));

ok('document toggle requires uuid', () => {
  assert.ok(!documentToggleSchema.safeParse({ documentTypeId: 'x', onFile: true }).success);
  assert.ok(documentToggleSchema.safeParse({
    documentTypeId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', onFile: true }).success);
});

console.log(`\n${n} checks passed\n`);
