/**
 * Creates the first user accounts, linked to seeded employees.
 *
 *   corepack pnpm --filter @mapa/api exec tsx prisma/seed-users.ts
 *
 * Every account starts with mustChangePassword = true. The temporary
 * passwords below are printed once and are not stored anywhere else —
 * change them on first login.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

// email, role code, staffId to link (or null)
const USERS: Array<[string, string, string | null]> = [
  ['md@majesticpensionagent.tech', 'MD', 'MAPA-26-PER-0001'],
  ['ed@majesticpensionagent.tech', 'ED', null],
  ['finance@majesticpensionagent.tech', 'FINANCE_HEAD', 'MAPA-26-PER-0002'],
  ['accounts@majesticpensionagent.tech', 'ACCOUNTANT', 'MAPA-26-PER-0007'],
  ['hr@majesticpensionagent.tech', 'HR_OFFICER', 'MAPA-26-PER-0003'],
];

/** Readable but random: 4 words + digits beats a random string nobody types right. */
function tempPassword(): string {
  const words = ['Harbour', 'Lantern', 'Copper', 'Meadow', 'Falcon', 'Thistle',
                 'Compass', 'Amber', 'Willow', 'Quartz', 'Beacon', 'Cedar'];
  const pick = () => words[randomBytes(1)[0] % words.length];
  return `${pick()}${pick()}${randomBytes(2).readUInt16BE(0) % 9000 + 1000}`;
}

async function main() {
  const created: Array<[string, string, string]> = [];

  for (const [email, roleCode, staffId] of USERS) {
    const role = await prisma.role.findUnique({ where: { code: roleCode } });
    if (!role) {
      console.warn(`Role ${roleCode} not found — run seed.ts first. Skipping ${email}.`);
      continue;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`${email} already exists, skipping.`);
      continue;
    }

    const password = tempPassword();
    const employee = staffId
      ? await prisma.employee.findUnique({ where: { staffId } })
      : null;

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        roles: { create: { roleId: role.id } },
      },
    });

    if (employee) {
      await prisma.employee.update({
        where: { id: employee.id },
        data: { userId: user.id },
      });
    }

    created.push([email, roleCode, password]);
  }

  if (!created.length) {
    console.log('\nNo new users created.');
    return;
  }

  console.log('\n  Temporary passwords — shown once, not recoverable:\n');
  for (const [email, role, password] of created) {
    console.log(`    ${email.padEnd(42)} ${role.padEnd(14)} ${password}`);
  }
  console.log('\n  All accounts must change password on first login.\n');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
