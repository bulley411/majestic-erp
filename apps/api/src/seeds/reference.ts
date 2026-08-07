import { PrismaClient, AccountType } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Chart of accounts for Majestic APA Limited.
 *
 * Banks come from your Finance Officer Records workbook (Access, Globus,
 * Keystone, Summit). The payable accounts in the 22xx range are what the
 * payroll posting writes to ÔÇö each one is money withheld from staff that
 * you owe onward to a third party, and the balance of each tells you what
 * is outstanding to the PFA and the tax authority at any moment.
 */
const ACCOUNTS: Array<[string, string, AccountType, string?]> = [
  ['1000', 'Assets', 'ASSET'],
  ['1100', 'Cash and bank', 'ASSET', '1000'],
  ['1110', 'Access Bank', 'ASSET', '1100'],
  ['1120', 'Globus Bank', 'ASSET', '1100'],
  ['1130', 'Keystone Bank', 'ASSET', '1100'],
  ['1140', 'Summit Bank', 'ASSET', '1100'],
  ['1200', 'Accounts receivable', 'ASSET', '1000'],
  ['1250', 'Withholding tax receivable', 'ASSET', '1000'],
  ['1300', 'Prepayments', 'ASSET', '1000'],
  ['1400', 'Staff advances and loans', 'ASSET', '1000'],

  ['2000', 'Liabilities', 'LIABILITY'],
  ['2100', 'Accounts payable', 'LIABILITY', '2000'],
  ['2200', 'Net salaries payable', 'LIABILITY', '2000'],
  ['2210', 'PAYE payable', 'LIABILITY', '2000'],
  ['2220', 'Pension payable', 'LIABILITY', '2000'],
  ['2230', 'NHF payable', 'LIABILITY', '2000'],
  ['2240', 'Withholding tax payable', 'LIABILITY', '2000'],

  ['3000', 'Equity', 'EQUITY'],
  ['3100', 'Share capital', 'EQUITY', '3000'],
  ['3200', 'Retained earnings', 'EQUITY', '3000'],

  ['4000', 'Income', 'INCOME'],
  ['4100', 'Commission income', 'INCOME', '4000'],
  ['4200', 'Other income', 'INCOME', '4000'],

  ['6000', 'Expenses', 'EXPENSE'],
  ['6100', 'Salaries and wages', 'EXPENSE', '6000'],
  ['6110', 'Pension expense - employer', 'EXPENSE', '6000'],
  ['6120', 'Staff reimbursable allowance', 'EXPENSE', '6000'],
  ['6130', 'Staff welfare and training', 'EXPENSE', '6000'],
  ['6200', 'Startup and registration costs', 'EXPENSE', '6000'],
  ['6300', 'Rent and rates', 'EXPENSE', '6000'],
  ['6400', 'Utilities', 'EXPENSE', '6000'],
  ['6500', 'Professional and regulatory fees', 'EXPENSE', '6000'],
  ['6600', 'Bank charges', 'EXPENSE', '6000'],
  ['6700', 'Travel and transport', 'EXPENSE', '6000'],
  ['6800', 'Office and administrative', 'EXPENSE', '6000'],
];

const BANKS = [
  ['Access Bank', '1110'],
  ['Globus Bank', '1120'],
  ['Keystone Bank', '1130'],
  ['Summit Bank', '1140'],
];

const PERMISSIONS = [
  'employee.read', 'employee.write', 'employee.document.upload',
  'payroll.read', 'payroll.prepare', 'payroll.review', 'payroll.approve',
  'payroll.post', 'payroll.pay',
  'ledger.read', 'ledger.post', 'ledger.close_period',
  'voucher.read', 'voucher.raise', 'voucher.approve',
  'report.read', 'settings.manage',
  'user.read', 'user.manage',
  'attendance.read', 'attendance.write',
];

const ROLES: Record<string, { name: string; permissions: string[] }> = {
  ED: {
    name: 'Executive Director',
    permissions: ['employee.read', 'payroll.read', 'ledger.read',
      'voucher.read', 'voucher.approve', 'report.read','attendance.read'],
  },
  MD: {
    name: 'Managing Director',
    permissions: ['employee.read', 'payroll.read', 'payroll.approve',
      'ledger.read', 'voucher.read', 'voucher.approve', 'report.read','attendance.read'],
  },
  FINANCE_HEAD: {
    name: 'Head of Finance',
    permissions: ['employee.read', 'payroll.read', 'payroll.prepare',
      'payroll.review', 'payroll.post', 'payroll.pay', 'ledger.read',
      'ledger.post', 'ledger.close_period', 'voucher.read', 'voucher.raise',
      'voucher.approve', 'report.read','attendance.read'],
  },
  ACCOUNTANT: {
    name: 'Accountant',
    permissions: ['employee.read', 'payroll.read', 'payroll.prepare',
      'payroll.post', 'payroll.pay', 'ledger.read', 'ledger.post',
      'voucher.read', 'voucher.raise', 'report.read','attendance.read'],
  },
 HR_OFFICER: {
    name: 'HR and Admin Officer',
    permissions: ['employee.read', 'employee.write',
      'employee.document.upload', 'payroll.read', 'report.read',
      'settings.manage', 'user.read','attendance.read','attendance.write'],
  },
  STAFF: { name: 'Staff', permissions: [] },
};

/** The 28 rows of the Employee File Documentation Checklist. */
const DOCUMENT_TYPES: Array<[string, string, string]> = [
  ['EMP_APPROVAL_MEMO', 'Employment approval memo', 'PRE_EMPLOYMENT'],
  ['INTERVIEW_RATING', 'Interview rating sheet / assessment record', 'PRE_EMPLOYMENT'],
  ['CV', 'Updated curriculum vitae', 'PRE_EMPLOYMENT'],
  ['CREDENTIALS', 'Copies of credentials', 'PRE_EMPLOYMENT'],
  ['REFERENCES', 'Reference checks / reference letters', 'PRE_EMPLOYMENT'],
  ['MEDICAL', 'Medical fitness report', 'PRE_EMPLOYMENT'],

  ['OFFER_LETTER', 'Offer letter / appointment letter', 'ONBOARDING'],
  ['ACCEPTANCE_LETTER', 'Acceptance letter', 'ONBOARDING'],
  ['ASSUMPTION_OF_DUTY', 'Assumption of duty form', 'ONBOARDING'],
  ['EMPLOYEE_DATA_FORM', 'Employee data form', 'ONBOARDING'],
  ['PASSPORT_PHOTO', 'Passport photograph', 'ONBOARDING'],
  ['ID', 'Valid means of identification', 'ONBOARDING'],
  ['BANK_DETAILS', 'Bank account details', 'ONBOARDING'],
  ['PENSION_RSA', 'Pension RSA details / welcome letter', 'ONBOARDING'],
  ['NDA', 'Confidentiality / non-disclosure form', 'ONBOARDING'],
  ['HANDBOOK_ACK', 'Employee handbook acknowledgement form', 'ONBOARDING'],

  ['CONFIRMATION_LETTER', 'Confirmation letter', 'LIFECYCLE'],
  ['PROMOTION_LETTER', 'Promotion / salary review letter', 'LIFECYCLE'],
  ['TRANSFER_LETTER', 'Transfer / redeployment letter', 'LIFECYCLE'],
  ['TRAINING_RECORDS', 'Training records', 'LIFECYCLE'],
  ['APPRAISAL_RECORDS', 'Performance appraisal records', 'LIFECYCLE'],
  ['DISCIPLINARY', 'Disciplinary records', 'LIFECYCLE'],

  ['RESIGNATION_LETTER', 'Resignation / termination / retirement letter', 'EXIT'],
  ['EXIT_ACCEPTANCE', 'Acceptance of resignation / exit notice', 'EXIT'],
  ['EXIT_INTERVIEW', 'Exit interview form', 'EXIT'],
  ['CLEARANCE_FORM', 'Clearance form / handover note', 'EXIT'],
  ['FINAL_BENEFITS', 'Final benefits / entitlement computation', 'EXIT'],
  ['OTHER_EXIT', 'Other exit correspondence', 'EXIT'],
];

async function main() {
  for (const [code, name, type, parent] of ACCOUNTS) {
    const parentRec = parent
      ? await prisma.account.findUnique({ where: { code: parent } })
      : null;
    await prisma.account.upsert({
      where: { code },
      update: { name, type, parentId: parentRec?.id },
      create: { code, name, type, parentId: parentRec?.id },
    });
  }

  for (const [name, code] of BANKS) {
    const account = await prisma.account.findUniqueOrThrow({ where: { code } });
    await prisma.bank.upsert({
      where: { name },
      update: { accountId: account.id },
      create: { name, accountId: account.id },
    });
  }

  for (const code of PERMISSIONS) {
    await prisma.permission.upsert({ where: { code }, update: {}, create: { code } });
  }

  for (const [code, def] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { code },
      update: { name: def.name },
      create: { code, name: def.name },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    for (const pc of def.permissions) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { code: pc } });
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: perm.id },
      });
    }
  }

  let order = 0;
  for (const [code, name, category] of DOCUMENT_TYPES) {
    await prisma.documentType.upsert({
      where: { code },
      update: { name, sortOrder: order },
      create: { code, name, category: category as never, sortOrder: order },
    });
    order++;
  }

  // Salary structure: 40 / 25 / 15 / 10 / 10, from your July 2026 sheet.
  const structure = await prisma.salaryStructure.upsert({
    where: { code: 'MAPA-STD' },
    update: {},
    create: { code: 'MAPA-STD', name: 'Majestic APA standard structure' },
  });
  const COMPONENTS: Array<[string, string, string, boolean]> = [
    ['BASIC', 'Basic salary', '0.40', true],
    ['HOUSING', 'Housing allowance', '0.25', true],
    ['TRANSPORT', 'Transport allowance', '0.15', true],
    ['UTILITY', 'Utility allowance', '0.10', false],
    ['MEAL', 'Meal allowance', '0.10', false],
  ];
  let ci = 0;
  for (const [code, name, ratio, pensionable] of COMPONENTS) {
    await prisma.salaryStructureComponent.upsert({
      where: { structureId_code: { structureId: structure.id, code } },
      update: { ratio, pensionable, sortOrder: ci },
      create: { structureId: structure.id, code, name, ratio, pensionable, sortOrder: ci },
    });
    ci++;
  }

  // PAYE bands, Nigeria Tax Act 2025, effective 1 January 2026.
  const BANDS: Array<[number, string | null, string]> = [
    [0, '800000', '0.00'],
    [1, '2200000', '0.15'],
    [2, '9000000', '0.18'],
    [3, '13000000', '0.21'],
    [4, '25000000', '0.23'],
    [5, null, '0.25'],
  ];
  for (const [sortOrder, width, rate] of BANDS) {
    await prisma.taxBand.upsert({
      where: { effectiveYear_sortOrder: { effectiveYear: 2026, sortOrder } },
      update: { width, rate },
      create: { effectiveYear: 2026, sortOrder, width, rate },
    });
  }

  // Fiscal periods for 2026.
  for (let month = 1; month <= 12; month++) {
    await prisma.fiscalPeriod.upsert({
      where: { year_month: { year: 2026, month } },
      update: {},
      create: { year: 2026, month },
    });
  }

  // Voucher approval limits. ED up to the threshold, MD unlimited above.
  // Change VOUCHER_ED_LIMIT in settings rather than editing this file.
  const ED_LIMIT = process.env.VOUCHER_ED_LIMIT ?? '500000';
  await prisma.approvalLimit.deleteMany({ where: { documentType: 'VOUCHER' } });
  await prisma.approvalLimit.createMany({
    data: [
      { roleCode: 'ED', rank: 1, documentType: 'VOUCHER', maxAmount: ED_LIMIT },
      { roleCode: 'MD', rank: 2, documentType: 'VOUCHER', maxAmount: null },
    ],
  });

  console.log(`Seeded accounts, roles, document types, salary structure, tax bands.`);
  console.log(`Voucher threshold: ED up to NGN ${Number(ED_LIMIT).toLocaleString()}, MD above.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
