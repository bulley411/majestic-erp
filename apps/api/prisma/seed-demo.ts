/**
 * Demo data. Safe to skip in production — nothing else depends on it.
 *   pnpm --filter @mapa/api exec tsx prisma/seed-demo.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEPARTMENTS = [
  ['IT', 'Info. Tech'], ['FIN', 'Finance'], ['OPS', 'Operations'],
  ['BD', 'Business Dev.'], ['CMP', 'Compliance'], ['ADM', 'Admin / HR'],
];

const GRADES: Array<[string, string, number]> = [
  ['MD_1', 'Managing Director', 10], ['ED_1', 'Executive Director', 9],
  ['SM_1', 'Senior Manager 1', 7], ['M_1', 'Manager 1', 6], ['M_2', 'Manager 2', 6],
  ['DM_2', 'Deputy Manager 2', 5], ['AM_1', 'Assistant Manager 1', 4],
  ['AM_2', 'Assistant Manager 2', 4], ['O_1', 'Officer 1', 2],
  ['O_2', 'Officer 2', 2], ['O_3', 'Officer 3', 3],
];

const STAFF: Array<[string, string, string, string, string, string, number, string]> = [
  // staffId, first, last, dept, jobTitle, grade, monthlyGross, status
  ['MAPA-26-PER-0008', 'Aminu', 'Ahmad', 'IT', 'Info. Tech', 'DM_2', 195000, 'ACTIVE'],
  ['MAPA-26-PER-0001', 'Joel', 'Kure', 'OPS', 'Managing Director', 'MD_1', 850000, 'ACTIVE'],
  ['MAPA-26-PER-0002', 'Ngozi', 'Okafor', 'FIN', 'Finance Officer', 'SM_1', 420000, 'ACTIVE'],
  ['MAPA-26-PER-0003', 'Halima', 'Suleiman', 'ADM', 'HR & Admin Officer', 'M_2', 310000, 'ACTIVE'],
  ['MAPA-26-PER-0004', 'Chukwuemeka', 'Eze', 'CMP', 'Compliance Officer', 'M_1', 295000, 'ACTIVE'],
  ['MAPA-26-PER-0005', 'Fatima', 'Bello', 'OPS', 'Client Relations', 'O_3', 180000, 'ACTIVE'],
  ['MAPA-26-PER-0006', 'Tunde', 'Adeyemi', 'BD', 'Business Development', 'AM_1', 260000, 'ACTIVE'],
  ['MAPA-26-PER-0007', 'Grace', 'Nwachukwu', 'FIN', 'Accounts Assistant', 'O_2', 165000, 'ACTIVE'],
  ['MAPA-26-CON-0009', 'Ibrahim', 'Musa', 'IT', 'Systems Analyst', 'AM_2', 240000, 'ACTIVE'],
  ['MAPA-26-PER-0010', 'Blessing', 'Etim', 'OPS', 'Pension Administrator', 'O_3', 190000, 'ON_LEAVE'],
  ['MAPA-26-PER-0011', 'Yusuf', 'Danladi', 'CMP', 'Internal Auditor', 'M_2', 305000, 'ACTIVE'],
  ['MAPA-26-PER-0012', 'Adaeze', 'Obi', 'BD', 'Marketing Executive', 'O_3', 185000, 'ACTIVE'],
  ['MAPA-26-CON-0013', 'Sani', 'Abubakar', 'OPS', 'Operations Officer', 'O_2', 170000, 'ACTIVE'],
  ['MAPA-26-PER-0014', 'Chidinma', 'Uche', 'FIN', 'Payroll Assistant', 'O_2', 175000, 'ACTIVE'],
  ['MAPA-26-TMP-0015', 'Peter', 'Ojo', 'IT', 'IT Support', 'O_1', 140000, 'ONBOARDING'],
];

async function main() {
  for (const [code, name] of DEPARTMENTS)
    await prisma.department.upsert({ where: { code }, update: {}, create: { code, name } });
  for (const [code, name, rank] of GRADES)
    await prisma.gradeLevel.upsert({ where: { code }, update: {}, create: { code, name, rank } });

  const structure = await prisma.salaryStructure.findUniqueOrThrow({ where: { code: 'MAPA-STD' } });
  const docTypes = await prisma.documentType.findMany({ orderBy: { sortOrder: 'asc' } });

  let i = 0;
  for (const [staffId, first, last, dept, title, grade, gross, status] of STAFF) {
    const department = await prisma.department.findUniqueOrThrow({ where: { code: dept } });
    const gradeLevel = await prisma.gradeLevel.findUniqueOrThrow({ where: { code: grade } });
    const jobTitle = await prisma.jobTitle.upsert({
      where: { name: title }, update: {}, create: { name: title },
    });

    const employee = await prisma.employee.upsert({
      where: { staffId },
      update: {},
      create: {
        staffId, firstName: first, lastName: last,
        departmentId: department.id, jobTitleId: jobTitle.id, gradeLevelId: gradeLevel.id,
        employmentType: staffId.includes('-CON-') ? 'CONTRACT'
          : staffId.includes('-TMP-') ? 'TEMPORARY' : 'PERMANENT',
        status: status as never,
        dateOfEmployment: new Date(2026, 0, 15),
        dateOfAssumption: new Date(2026, 0, 15),
        annualRentPaid: (gross * 12).toString(),
      },
    });

    await prisma.employeeCompensation.deleteMany({ where: { employeeId: employee.id } });
    await prisma.employeeCompensation.create({
      data: {
        employeeId: employee.id, structureId: structure.id,
        totalPackage: (gross / 0.6).toFixed(2),
        monthlyGross: gross.toString(),
        peculiarAllowance: ((gross / 0.6) * 0.4).toFixed(2),
        effectiveFrom: new Date(2026, 0, 1), reason: 'Appointment',
      },
    });

    // Vary file completeness so the meter shows a realistic spread.
    const pre = [6, 6, 6, 6, 6, 5, 6, 4, 6, 6, 6, 5, 6, 6, 3][i];
    const onb = [10, 10, 10, 9, 10, 8, 10, 7, 10, 10, 9, 9, 8, 10, 4][i];
    const life = [4, 6, 5, 4, 3, 2, 4, 1, 3, 5, 3, 2, 2, 3, 0][i];
    const quota: Record<string, number> = {
      PRE_EMPLOYMENT: pre, ONBOARDING: onb, LIFECYCLE: life, EXIT: 0,
    };
    const used: Record<string, number> = {
      PRE_EMPLOYMENT: 0, ONBOARDING: 0, LIFECYCLE: 0, EXIT: 0,
    };
    for (const dt of docTypes) {
      const onFile = used[dt.category] < quota[dt.category];
      if (onFile) used[dt.category]++;
      await prisma.employeeDocument.upsert({
        where: { employeeId_documentTypeId: { employeeId: employee.id, documentTypeId: dt.id } },
        update: { onFile },
        create: { employeeId: employee.id, documentTypeId: dt.id, onFile },
      });
    }
    i++;
  }
  console.log(`Seeded ${STAFF.length} demo employees with file records.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
