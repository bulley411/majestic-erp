import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Default expense categories matching the company budget structure.
 * These link to the Chart of Accounts expense accounts (6xxx).
 */
const CATEGORIES = [
  // [code, name, accountCode, description]
  ['PERSONNEL', 'Personnel, Directors and Governance Cost', '6100', 'Staff salaries, benefits, and director fees'],
  ['PREMISES', 'Premises and Occupancy Cost', '6300', 'Rent, rates, and office occupancy'],
  ['TRAINING', 'Train & Cap. Development', '6130', 'Training and capacity development'],
  ['FURNITURE', 'Furniture, Equipment & Fittings', '6800', 'Office furniture and equipment'],
  ['REGULATORY', 'Regulatory Compliance', '6500', 'Regulatory fees and compliance costs'],
  ['IT_INFRA', 'Info. Tech & Digital Infrastructure', '6400', 'Technology and infrastructure'],
  ['ADVISORY', 'Professional and Advisory Fees', '6500', 'Legal, audit, and advisory fees'],
  ['ADMIN', 'Finance & Administrative Exp.', '6800', 'Administrative expenses'],
  ['MARKETING', 'Marketing and Business Development', '6800', 'Marketing and business development'],
  ['CUSTOMER', 'Customer Service And Operations', '6800', 'Customer service and operations'],
  ['FIELD_OPS', 'Agent Network and Field Operations', '6700', 'Field operations and agent network'],
  ['CONTINGENCY', 'Contingency', '6800', 'Contingency reserve'],
  ['WELFARE', 'Staff Welfare', '6130', 'Staff welfare and events'],
  ['UTILITIES', 'Utilities', '6400', 'Electricity, water, internet'],
  ['BANK_CHARGES', 'Bank Charges', '6600', 'Bank fees and charges'],
  ['TRAVEL', 'Travel and Transport', '6700', 'Travel and transportation'],
];

async function main() {
  console.log('Seeding expense categories...\n');

  for (const [code, name, accountCode, description] of CATEGORIES) {
    // Find the account
    const account = await prisma.account.findUnique({
      where: { code: accountCode },
    });

    if (!account) {
      console.warn(`  ⚠️  Account ${accountCode} not found, skipping ${name}`);
      continue;
    }

    // Upsert the category
    const category = await prisma.expenseCategory.upsert({
      where: { code },
      update: {
        name,
        description,
        accountId: account.id,
      },
      create: {
        code,
        name,
        description,
        accountId: account.id,
        isActive: true,
      },
    });

    console.log(`  ✅ ${category.code} → ${category.name} (${accountCode})`);
  }

  console.log('\n✅ Expense categories seeded.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());