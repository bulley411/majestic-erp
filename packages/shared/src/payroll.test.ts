import assert from 'node:assert/strict';
import {
  MAPA_DEFAULT_STRUCTURE,
  computePayslip,
  payeAnnual,
  peculiarAllowance,
  money,
} from './payroll';

/**
 * Regression tests against the real July 2026 payroll for
 * Aminu Ahmad, MAPA-26-PER-0008, Info. Tech, GL DM_2.
 *
 * Source: Majestic_APA_Limited_Staff_Salary_for_the_Month_of_July_2026.xlsx
 *         Majectic_APA_11.xlsx
 */

const gross = money('195000');
let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${label}`);
};

console.log('\nMajestic APA payroll engine\n');

const slip = computePayslip({
  monthlyGross: gross,
  structure: MAPA_DEFAULT_STRUCTURE,
  // The annual sheet shows rent relief of 468,000, i.e. 20% of a declared
  // annual rent of 2,340,000 (uncapped, since it is below the 500,000 cap).
  annualRentPaid: money('2340000'),
});

check('component split matches sheet columns I..M', () => {
  assert.equal(slip.components['BASIC'].toString(), '78000');
  assert.equal(slip.components['HOUSING'].toString(), '48750');
  assert.equal(slip.components['TRANSPORT'].toString(), '29250');
  assert.equal(slip.components['UTILITY'].toString(), '19500');
  assert.equal(slip.components['MEAL'].toString(), '19500');
});

check('pensionable earnings (BHT) = 156,000', () => {
  assert.equal(slip.pensionableMonthly.toString(), '156000');
});

check('pension employee 8% = 12,480', () => {
  assert.equal(slip.pensionEmployee.toString(), '12480');
});

check('pension employer 10% = 15,600', () => {
  assert.equal(slip.pensionEmployer.toString(), '15600');
});

check('rent relief = 468,000', () => {
  assert.equal(slip.rentRelief.toString(), '468000');
});

check('annual taxable income = 1,722,240', () => {
  assert.equal(slip.annualTaxableIncome.toString(), '1722240');
});

check('annual PAYE = 138,336 (Tax Act 2025 bands)', () => {
  assert.equal(slip.payeAnnual.toString(), '138336');
});

check('monthly PAYE = 11,528', () => {
  assert.equal(slip.payeMonthly.toString(), '11528');
});

check('net pay = 171,-- reconciles to gross less deductions', () => {
  assert.equal(slip.totalDeductions.toString(), '24008');
  assert.equal(slip.netPay.toString(), '170992');
});

check('rent relief is capped at 500,000', () => {
  const capped = computePayslip({
    monthlyGross: money('2000000'),
    structure: MAPA_DEFAULT_STRUCTURE,
    annualRentPaid: money('10000000'),
  });
  assert.equal(capped.rentRelief.toString(), '500000');
});

check('PAYE band boundaries', () => {
  assert.equal(payeAnnual(money('800000')).toString(), '0');
  assert.equal(payeAnnual(money('3000000')).toString(), '330000');
  assert.equal(payeAnnual(money('12000000')).toString(), '1950000');
});

check('peculiar allowance splits 325,000 into 195,000 / 130,000', () => {
  const { payrollPortion, reimbursable } = peculiarAllowance(money('325000'));
  assert.equal(payrollPortion.toString(), '195000');
  assert.equal(reimbursable.toString(), '130000');
});

console.log(`\n${passed} checks passed\n`);
