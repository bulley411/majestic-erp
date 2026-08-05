/**
 * Creates the initial administrator account.
 *
 *   Local:  corepack pnpm --filter @mapa/api exec tsx src/seeds/admin.ts
 *   Server: docker exec -w /app/apps/api <container> node dist/seeds/admin.js
 *
 * Lives under src/ so it compiles into dist/ with everything else — the
 * production image contains no TypeScript, so a seed script outside src/
 * cannot run there.
 *
 * Everything else — departments, employees, other users — is configured
 * through the UI by this account.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../auth/password';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@majesticpensionagent.com';

/** Readable but random. Four words beat a random string nobody types right. */
function tempPassword(): string {
  const words = ['Harbour', 'Lantern', 'Copper', 'Meadow', 'Falcon', 'Thistle',
                 'Compass', 'Amber', 'Willow', 'Quartz', 'Beacon', 'Cedar'];
  const pick = () => words[randomBytes(1)[0] % words.length];
  return `${pick()}${pick()}${(randomBytes(2).readUInt16BE(0) % 9000) + 1000}`;
}

async function main() {
  const permissions = await prisma.permission.findMany();
  if (!permissions.length) {
    console.error('No permissions found. Run the reference seed first.');
    process.exit(1);
  }

  const role = await prisma.role.upsert({
    where: { code: 'SUPER_ADMIN' },
    update: { name: 'System Administrator' },
    create: { code: 'SUPER_ADMIN', name: 'System Administrator' },
  });

  // Rebuilt each run, so a permission added later is picked up.
  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
  for (const p of permissions) {
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: p.id },
    });
  }

  const existing = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (existing) {
    console.log(`\n  ${EMAIL} already exists — permissions refreshed, password unchanged.\n`);
    return;
  }

  const password = tempPassword();
  await prisma.user.create({
    data: {
      email: EMAIL,
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
      roles: { create: { roleId: role.id } },
    },
  });

  console.log('');
  console.log('  Administrator account created');
  console.log('  ─────────────────────────────');
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${password}`);
  console.log('');
  console.log('  Shown once. You will be asked to change it on first sign in.');
  console.log('');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());