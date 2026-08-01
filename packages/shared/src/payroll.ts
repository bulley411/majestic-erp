import Decimal from 'decimal.js';

/**
 * Payroll engine for Majestic APA Limited.
 *
 * Derived from:
 *   - "Majestic APA Limited Staff Salary for the Month of July, 2026.xlsx"
 *   - "Majectic_APA_11.xlsx" (annual view)
 *   - "Peculiar_Allowance.xlsx"
 *
 * All money is Decimal. Never float. Never number.
 */

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type Money = Decimal;
export const money = (v: Decimal.Value): Money => new Decimal(v);
export const ZERO = money(0);

/* ------------------------------------------------------------------ */
/* Salary structure                                                    */
/* ------------------------------------------------------------------ */

/**
 * Gross pay is split into components by fixed ratios. Your July sheet
 * stores these in row 7 (I7:M7) as 0.4 / 0.25 / 0.15 / 0.1 / 0.1.
 *
 * These are stored per-structure in the database, not hardcoded, so
 * you can version them without a code deploy.
 */
export interface SalaryStructure {
  code: string;
  name: string;
  components: SalaryComponentRule[];
}

export interface SalaryComponentRule {
  code: string;
  name: string;
  /** Fraction of gross pay. The set must sum to exactly 1. */
  ratio: Decimal;
  /** Whether this component counts toward pensionable earnings (BHT). */
  pensionable: boolean;
}

export const MAPA_DEFAULT_STRUCTURE: SalaryStructure = {
  code: 'MAPA-STD',
  name: 'Majestic APA standard structure',
  components: [
    { code: 'BASIC', name: 'Basic salary', ratio: money('0.40'), pensionable: true },
    { code: 'HOUSING', name: 'Housing allowance', ratio: money('0.25'), pensionable: true },
    { code: 'TRANSPORT', name: 'Transport allowance', ratio: money('0.15'), pensionable: true },
    { code: 'UTILITY', name: 'Utility allowance', ratio: money('0.10'), pensionable: false },
    { code: 'MEAL', name: 'Meal allowance', ratio: money('0.10'), pensionable: false },
  ],
};

export function assertStructureBalances(s: SalaryStructure): void {
  const total = s.components.reduce((a, c) => a.plus(c.ratio), ZERO);
  if (!total.equals(1)) {
    throw new Error(
      `Salary structure "${s.code}" ratios sum to ${total.toString()}, must be exactly 1`,
    );
  }
}

export function splitGross(
  gross: Money,
  structure: SalaryStructure,
): Record<string, Money> {
  assertStructureBalances(structure);
  const out: Record<string, Money> = {};
  for (const c of structure.components) {
    out[c.code] = gross.times(c.ratio);
  }
  return out;
}

/** Basic + Housing + Transport — the pension base. */
export function pensionableEarnings(
  gross: Money,
  structure: SalaryStructure,
): Money {
  const parts = splitGross(gross, structure);
  return structure.components
    .filter((c) => c.pensionable)
    .reduce((a, c) => a.plus(parts[c.code]), ZERO);
}

/* ------------------------------------------------------------------ */
/* Statutory rates                                                     */
/* ------------------------------------------------------------------ */

export const STATUTORY = {
  PENSION_EMPLOYEE: money('0.08'), // 8% of BHT
  PENSION_EMPLOYER: money('0.10'), // 10% of BHT
  NHF: money('0.025'), // 2.5% of basic salary
  RENT_RELIEF_RATE: money('0.20'), // 20% of annual rent paid
  RENT_RELIEF_CAP: money('500000'), // capped at NGN 500,000
} as const;

/* ------------------------------------------------------------------ */
/* PAYE — Nigeria Tax Act 2025, effective 1 January 2026               */
/* ------------------------------------------------------------------ */

export interface TaxBand {
  /** Width of this band in naira. null = unlimited (top band). */
  width: Money | null;
  rate: Decimal;
}

export const PAYE_BANDS_2026: TaxBand[] = [
  { width: money('800000'), rate: money('0.00') },
  { width: money('2200000'), rate: money('0.15') },
  { width: money('9000000'), rate: money('0.18') },
  { width: money('13000000'), rate: money('0.21') },
  { width: money('25000000'), rate: money('0.23') },
  { width: null, rate: money('0.25') },
];

/**
 * Annual PAYE on a given annual taxable income.
 *
 * Verified against Aminu Ahmad (MAPA-26-PER-0008):
 *   taxable 1,722,240 -> 800,000 @ 0% + 922,240 @ 15% = 138,336
 */
export function payeAnnual(
  taxableIncome: Money,
  bands: TaxBand[] = PAYE_BANDS_2026,
): Money {
  let remaining = Decimal.max(taxableIncome, ZERO);
  let tax = ZERO;
  for (const band of bands) {
    if (remaining.lte(0)) break;
    const slice = band.width === null ? remaining : Decimal.min(remaining, band.width);
    tax = tax.plus(slice.times(band.rate));
    remaining = remaining.minus(slice);
  }
  return tax;
}

/* ------------------------------------------------------------------ */
/* Payslip                                                             */
/* ------------------------------------------------------------------ */

export interface PayslipInput {
  /** Monthly gross pay (the taxable payroll portion, not total package). */
  monthlyGross: Money;
  structure: SalaryStructure;
  /** Annual rent the employee declared, for rent relief. 0 if none. */
  annualRentPaid?: Money;
  /** Is the employee enrolled in NHF? */
  nhfEnrolled?: boolean;
  /** Additional taxable earnings this month (bonus, arrears). */
  adjustmentPlus?: Money;
  /** Additional deductions this month (loan repayment, etc). */
  adjustmentMinus?: Money;
  loanRepayment?: Money;
  bands?: TaxBand[];
}

export interface Payslip {
  components: Record<string, Money>;
  monthlyGross: Money;
  annualGross: Money;
  pensionableMonthly: Money;
  pensionEmployee: Money;
  pensionEmployer: Money;
  nhf: Money;
  rentRelief: Money;
  annualTaxableIncome: Money;
  payeAnnual: Money;
  payeMonthly: Money;
  loanRepayment: Money;
  adjustmentPlus: Money;
  adjustmentMinus: Money;
  totalDeductions: Money;
  netPay: Money;
}

export function computePayslip(input: PayslipInput): Payslip {
  const {
    structure,
    annualRentPaid = ZERO,
    nhfEnrolled = false,
    adjustmentPlus = ZERO,
    adjustmentMinus = ZERO,
    loanRepayment = ZERO,
    bands = PAYE_BANDS_2026,
  } = input;

  const monthlyGross = input.monthlyGross.plus(adjustmentPlus);
  const annualGross = monthlyGross.times(12);

  const components = splitGross(monthlyGross, structure);
  const pensionableMonthly = pensionableEarnings(monthlyGross, structure);
  const pensionableAnnual = pensionableMonthly.times(12);

  const pensionEmployee = pensionableMonthly.times(STATUTORY.PENSION_EMPLOYEE);
  const pensionEmployer = pensionableMonthly.times(STATUTORY.PENSION_EMPLOYER);

  const nhf = nhfEnrolled
    ? (components['BASIC'] ?? ZERO).times(STATUTORY.NHF)
    : ZERO;

  const rentRelief = Decimal.min(
    annualRentPaid.times(STATUTORY.RENT_RELIEF_RATE),
    STATUTORY.RENT_RELIEF_CAP,
  );

  // Annual reliefs: pension, NHF, rent relief
  const annualReliefs = pensionableAnnual
    .times(STATUTORY.PENSION_EMPLOYEE)
    .plus(nhf.times(12))
    .plus(rentRelief);

  const annualTaxableIncome = Decimal.max(annualGross.minus(annualReliefs), ZERO);
  const annualTax = payeAnnual(annualTaxableIncome, bands);
  const payeMonthly = annualTax.dividedBy(12);

  const totalDeductions = payeMonthly
    .plus(pensionEmployee)
    .plus(nhf)
    .plus(loanRepayment)
    .plus(adjustmentMinus);

  return {
    components,
    monthlyGross,
    annualGross,
    pensionableMonthly,
    pensionEmployee,
    pensionEmployer,
    nhf,
    rentRelief,
    annualTaxableIncome,
    payeAnnual: annualTax,
    payeMonthly,
    loanRepayment,
    adjustmentPlus,
    adjustmentMinus,
    totalDeductions,
    netPay: monthlyGross.minus(totalDeductions),
  };
}

/* ------------------------------------------------------------------ */
/* Peculiar allowance                                                  */
/* ------------------------------------------------------------------ */

/**
 * Your "Peculiar Staff Allowance" sheet pays a reimbursable amount
 * alongside payroll. For MAPA-26-PER-0008: total package 325,000 ->
 * 195,000 payroll (60%) + 130,000 reimbursable (40%).
 *
 * This is paid outside PAYE, so it is modelled as a separate run that
 * posts to a different expense account.
 */
export function peculiarAllowance(
  totalPackage: Money,
  reimbursableRate: Money = money('0.40'),
): { payrollPortion: Money; reimbursable: Money } {
  const reimbursable = totalPackage.times(reimbursableRate);
  return { payrollPortion: totalPackage.minus(reimbursable), reimbursable };
}
