import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import {
  summarise, computeDeduction, datesInMonth, isWorkingDay, isoDate,
  defaultStatus, statusFromCheckIn, minutesLate, fixedHolidaysFor,
  type AttendancePolicy, type AttendanceStatus, type DayRecord,
} from '@mapa/shared';

/** Statuses HR may set. The calendar-derived ones are not chooseable. */
const SETTABLE: AttendanceStatus[] = [
  'PRESENT', 'REMOTE', 'LATE', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'SUSPENDED',
];

/** Accepted spellings when importing a spreadsheet. */
const STATUS_ALIASES: Record<string, AttendanceStatus> = {
  p: 'PRESENT', present: 'PRESENT', y: 'PRESENT', yes: 'PRESENT', '1': 'PRESENT',
  r: 'REMOTE', remote: 'REMOTE', wfh: 'REMOTE',
  l: 'LATE', late: 'LATE',
  h: 'HALF_DAY', half: 'HALF_DAY', 'half day': 'HALF_DAY', halfday: 'HALF_DAY',
  a: 'ABSENT', absent: 'ABSENT', n: 'ABSENT', no: 'ABSENT', '0': 'ABSENT',
  lv: 'ON_LEAVE', leave: 'ON_LEAVE', 'on leave': 'ON_LEAVE', onleave: 'ON_LEAVE',
  s: 'SUSPENDED', suspended: 'SUSPENDED',
};

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  /* ------------------------- configuration ------------------------- */

  async policy(): Promise<AttendancePolicy> {
    const row = await this.prisma.attendanceSettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: { id: 'singleton' },
    });
    return {
      workingDays: row.workingDays,
      workStart: row.workStart,
      workEnd: row.workEnd,
      lateGraceMinutes: row.lateGraceMinutes,
      deductionBasis: row.deductionBasis as AttendancePolicy['deductionBasis'],
      latenessPolicy: row.latenessPolicy as AttendancePolicy['latenessPolicy'],
      latenessFreeCount: row.latenessFreeCount,
      lateWarningThreshold: row.lateWarningThreshold,
    };
  }

  async updatePolicy(data: Partial<AttendancePolicy>, actorId: string) {
    const before = await this.policy();

    const row = await this.prisma.attendanceSettings.upsert({
      where: { id: 'singleton' },
      update: { ...data, updatedById: actorId },
      create: { id: 'singleton', ...data, updatedById: actorId },
    });

    // These rules decide what people are paid, so a change is recorded
    // with who made it and what it was before.
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'attendance.policy_changed',
        entityType: 'AttendanceSettings',
        entityId: 'singleton',
        before: before as never,
        after: data as never,
      },
    });

    return row;
  }

  async holidays(year?: number) {
    const where = year
      ? {
          date: {
            gte: new Date(Date.UTC(year, 0, 1)),
            lt: new Date(Date.UTC(year + 1, 0, 1)),
          },
        }
      : {};
    return this.prisma.publicHoliday.findMany({ where, orderBy: { date: 'asc' } });
  }

  private async holidaySet(year: number): Promise<Set<string>> {
    const rows = await this.holidays(year);
    return new Set(rows.map((h) => isoDate(h.date)));
  }

  async addHoliday(date: string, name: string, actorId: string) {
    const created = await this.prisma.publicHoliday.upsert({
      where: { date: new Date(`${date}T00:00:00Z`) },
      update: { name },
      create: { date: new Date(`${date}T00:00:00Z`), name },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId, action: 'holiday.added', entityType: 'PublicHoliday',
        entityId: created.id, after: { date, name } as never,
      },
    });
    return created;
  }

  async removeHoliday(id: string, actorId: string) {
    const holiday = await this.prisma.publicHoliday.findUniqueOrThrow({ where: { id } });
    await this.prisma.publicHoliday.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: {
        actorId, action: 'holiday.removed', entityType: 'PublicHoliday',
        entityId: id, before: { name: holiday.name } as never,
      },
    });
    return { ok: true };
  }

  /** Seeds the six fixed national holidays for a year. Movable ones stay manual. */
  async seedFixedHolidays(year: number, actorId: string) {
    const added: string[] = [];
    for (const h of fixedHolidaysFor(year)) {
      const exists = await this.prisma.publicHoliday.findUnique({
        where: { date: new Date(`${h.date}T00:00:00Z`) },
      });
      if (!exists) {
        await this.addHoliday(h.date, h.name, actorId);
        added.push(h.name);
      }
    }
    return { added };
  }

  /* --------------------------- the register ------------------------ */

  /**
   * One day's register for every active employee, so HR can mark the
   * whole team in a single screen rather than opening 15 records.
   */
  async dailyRegister(date: string) {
    const day = new Date(`${date}T00:00:00Z`);
    const policy = await this.policy();
    const holidays = await this.holidaySet(day.getUTCFullYear());

    const [employees, records, leave] = await Promise.all([
      this.prisma.employee.findMany({
        where: { status: { in: ['ACTIVE', 'ON_LEAVE', 'ONBOARDING'] } },
        select: {
          id: true, staffId: true, firstName: true, lastName: true,
          department: { select: { name: true } },
        },
        orderBy: { staffId: 'asc' },
      }),
      this.prisma.attendanceRecord.findMany({ where: { date: day } }),
      // Approved leave covering this date pre-fills the register, so HR
      // cannot accidentally mark someone absent who is on approved leave.
      this.prisma.leaveRequest.findMany({
        where: { status: 'APPROVED', startDate: { lte: day }, endDate: { gte: day } },
        select: { employeeId: true, leaveType: { select: { name: true } } },
      }),
    ]);

    const byEmployee = new Map(records.map((r) => [r.employeeId, r]));
    const onLeave = new Map(leave.map((l) => [l.employeeId, l.leaveType.name]));
    const calendarStatus = defaultStatus(day, policy, holidays);

    return {
      date,
      isWorkingDay: isWorkingDay(day, policy, holidays),
      calendarStatus,
      employees: employees.map((e) => {
        const record = byEmployee.get(e.id);
        return {
          employeeId: e.id,
          staffId: e.staffId,
          name: `${e.firstName} ${e.lastName}`,
          department: e.department?.name ?? null,
          status: record?.status ?? (onLeave.has(e.id) ? 'ON_LEAVE' : calendarStatus),
          checkIn: record?.checkIn ?? null,
          checkOut: record?.checkOut ?? null,
          minutesLate: record?.minutesLate ?? 0,
          notes: record?.notes ?? null,
          onApprovedLeave: onLeave.get(e.id) ?? null,
          locked: !!record?.lockedByRunId,
          recorded: !!record,
        };
      }),
    };
  }

  private async assertUnlocked(employeeId: string, date: Date) {
    const existing = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date } },
    });
    if (existing?.lockedByRunId) {
      throw new BadRequestException(
        'This day has already been used in a payroll run and cannot be changed. ' +
          'Correct it with a payroll adjustment instead.',
      );
    }
  }

  async mark(
    entries: Array<{
      employeeId: string;
      date: string;
      status: AttendanceStatus;
      checkIn?: string;
      checkOut?: string;
      notes?: string;
    }>,
    actorId: string,
  ) {
    const policy = await this.policy();
    let saved = 0;

    for (const entry of entries) {
      if (!SETTABLE.includes(entry.status)) {
        throw new BadRequestException(`${entry.status} cannot be set manually.`);
      }

      const date = new Date(`${entry.date}T00:00:00Z`);
      await this.assertUnlocked(entry.employeeId, date);

      // A check-in time decides late-or-not, rather than trusting whatever
      // status was clicked alongside it.
      let status = entry.status;
      let late = 0;
      if (entry.checkIn) {
        late = minutesLate(entry.checkIn, policy);
        if (status === 'PRESENT' || status === 'LATE') {
          status = statusFromCheckIn(entry.checkIn, policy);
        }
      }

      await this.prisma.attendanceRecord.upsert({
        where: { employeeId_date: { employeeId: entry.employeeId, date } },
        update: {
          status, checkIn: entry.checkIn, checkOut: entry.checkOut,
          minutesLate: late, notes: entry.notes, recordedById: actorId,
        },
        create: {
          employeeId: entry.employeeId, date, status,
          checkIn: entry.checkIn, checkOut: entry.checkOut,
          minutesLate: late, notes: entry.notes, recordedById: actorId,
        },
      });
      saved++;
    }

    return { saved };
  }

  /**
   * Marks every unmarked employee present for a date. The common case is
   * a normal day where one or two people were out.
   */
  async markRemainingPresent(date: string, actorId: string) {
    const register = await this.dailyRegister(date);
    if (!register.isWorkingDay) {
      throw new BadRequestException('That date is not a working day.');
    }
    const entries = register.employees
      .filter((e) => !e.recorded && !e.onApprovedLeave)
      .map((e) => ({ employeeId: e.employeeId, date, status: 'PRESENT' as const }));
    return this.mark(entries, actorId);
  }

  /* --------------------------- monthly view ------------------------ */

  async monthly(year: number, month: number) {
    const policy = await this.policy();
    const holidays = await this.holidaySet(year);
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));

    const [employees, records] = await Promise.all([
      this.prisma.employee.findMany({
        where: { status: { in: ['ACTIVE', 'ON_LEAVE', 'ONBOARDING'] } },
        select: {
          id: true, staffId: true, firstName: true, lastName: true,
          compensations: {
            where: { effectiveFrom: { lte: to } },
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
          },
        },
        orderBy: { staffId: 'asc' },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { date: { gte: from, lt: to } },
      }),
    ]);

    const byEmployee = new Map<string, DayRecord[]>();
    for (const r of records) {
      const list = byEmployee.get(r.employeeId) ?? [];
      list.push({
        date: isoDate(r.date),
        status: r.status as AttendanceStatus,
        minutesLate: r.minutesLate,
      });
      byEmployee.set(r.employeeId, list);
    }

    return {
      year,
      month,
      policy,
      days: datesInMonth(year, month).map((d) => ({
        date: isoDate(d),
        working: isWorkingDay(d, policy, holidays),
        holiday: holidays.has(isoDate(d)),
      })),
      employees: employees.map((e) => {
        const days = byEmployee.get(e.id) ?? [];
        const summary = summarise(year, month, days, policy, holidays);
        const gross = e.compensations[0]
          ? new Decimal(e.compensations[0].monthlyGross.toString())
          : new Decimal(0);
        const deduction = computeDeduction(gross, summary, year, month, policy, holidays);

        return {
          employeeId: e.id,
          staffId: e.staffId,
          name: `${e.firstName} ${e.lastName}`,
          monthlyGross: gross.toFixed(2),
          summary: {
            ...summary,
            daysEarned: summary.daysEarned.toString(),
            daysForfeited: summary.daysForfeited.toString(),
          },
          deduction: {
            dailyRate: deduction.dailyRate.toFixed(2),
            amount: deduction.amount.toFixed(2),
            adjustedGross: deduction.adjustedGross.toFixed(2),
          },
          days: days.reduce<Record<string, string>>((acc, d) => {
            acc[d.date] = d.status;
            return acc;
          }, {}),
        };
      }),
    };
  }

  /* ------------------------ spreadsheet import --------------------- */

  /**
   * Builds a template with one row per employee and one column per day,
   * pre-filled with weekends and holidays so HR only marks exceptions.
   */
  async importTemplate(year: number, month: number): Promise<Buffer> {
    const policy = await this.policy();
    const holidays = await this.holidaySet(year);
    const employees = await this.prisma.employee.findMany({
      where: { status: { in: ['ACTIVE', 'ON_LEAVE', 'ONBOARDING'] } },
      select: { staffId: true, firstName: true, lastName: true },
      orderBy: { staffId: 'asc' },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`${year}-${String(month).padStart(2, '0')}`);
    const dates = datesInMonth(year, month);

    ws.columns = [
      { header: 'Staff ID', key: 'staffId', width: 20 },
      { header: 'Name', key: 'name', width: 26 },
      ...dates.map((d) => ({
        header: String(d.getUTCDate()),
        key: isoDate(d),
        width: 5,
      })),
    ];

    for (const e of employees) {
      const row: Record<string, string> = {
        staffId: e.staffId,
        name: `${e.firstName} ${e.lastName}`,
      };
      for (const d of dates) {
        // Non-working days are filled in, so a blank cell unambiguously
        // means "not yet marked" rather than "weekend".
        row[isoDate(d)] = isWorkingDay(d, policy, holidays) ? '' : '-';
      }
      ws.addRow(row);
    }

    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

    const legend = wb.addWorksheet('Legend');
    legend.columns = [
      { header: 'Code', key: 'code', width: 12 },
      { header: 'Meaning', key: 'meaning', width: 32 },
    ];
    legend.addRows([
      { code: 'P', meaning: 'Present' },
      { code: 'R', meaning: 'Remote / working from home' },
      { code: 'L', meaning: 'Late' },
      { code: 'H', meaning: 'Half day' },
      { code: 'A', meaning: 'Absent (pay is reduced)' },
      { code: 'LV', meaning: 'On approved leave' },
      { code: 'S', meaning: 'Suspended without pay' },
      { code: '-', meaning: 'Not a working day' },
      { code: '(blank)', meaning: 'Not marked — treated as worked' },
    ]);
    legend.getRow(1).font = { bold: true };

    // ExcelJS declares its own Buffer type, which does not structurally
    // match Node's under this TypeScript version. The value is a real
    // Node Buffer at runtime, so the cast goes via unknown.
    return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
  }

  /**
   * Reads a filled template back.
   *
   * Nothing is written until the whole sheet parses, so a typo on row 12
   * does not leave rows 1 to 11 saved and the rest not.
   */
  async importMonth(
    buffer: Buffer,
    year: number,
    month: number,
    actorId: string,
    dryRun = false,
  ) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as never);

    const ws = wb.worksheets.find((s) => s.name !== 'Legend');
    if (!ws) throw new BadRequestException('No data sheet found in that file.');

    const employees = await this.prisma.employee.findMany({
      select: { id: true, staffId: true },
    });
    const byStaffId = new Map(employees.map((e) => [e.staffId.toUpperCase(), e.id]));

    const policy = await this.policy();
    const holidays = await this.holidaySet(year);
    const dates = datesInMonth(year, month);

    const entries: Array<{ employeeId: string; date: string; status: AttendanceStatus }> = [];
    const errors: string[] = [];
    const unknownStaff: string[] = [];

    // Header row maps column index to day of month.
    const header = ws.getRow(1);
    const dayColumn = new Map<number, string>();
    header.eachCell((cell, col) => {
      const raw = String(cell.value ?? '').trim();
      const day = Number(raw);
      if (day >= 1 && day <= dates.length) {
        dayColumn.set(col, isoDate(dates[day - 1]));
      }
    });

    if (!dayColumn.size) {
      throw new BadRequestException(
        'No day columns found. The first row should hold day numbers 1 to 31.',
      );
    }

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const staffId = String(row.getCell(1).value ?? '').trim().toUpperCase();
      if (!staffId) return;

      const employeeId = byStaffId.get(staffId);
      if (!employeeId) {
        unknownStaff.push(staffId);
        return;
      }

      for (const [col, date] of dayColumn) {
        const raw = String(row.getCell(col).value ?? '').trim();
        if (!raw || raw === '-') continue;

        const status = STATUS_ALIASES[raw.toLowerCase()];
        if (!status) {
          errors.push(`Row ${rowNumber}, ${date}: "${raw}" is not a recognised code.`);
          continue;
        }

        if (!isWorkingDay(new Date(`${date}T00:00:00Z`), policy, holidays)) {
          errors.push(`Row ${rowNumber}: ${date} is not a working day but was marked "${raw}".`);
          continue;
        }

        entries.push({ employeeId, date, status });
      }
    });

    if (unknownStaff.length) {
      errors.unshift(
        `Unknown staff ID(s): ${[...new Set(unknownStaff)].join(', ')}.`,
      );
    }

    if (errors.length) {
      throw new BadRequestException({
        message: `${errors.length} problem(s) found. Nothing was imported.`,
        errors: errors.slice(0, 25),
      });
    }

    if (dryRun) {
      return { imported: 0, wouldImport: entries.length, errors: [] };
    }

    const { saved } = await this.mark(entries, actorId);

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'attendance.imported',
        entityType: 'AttendanceRecord',
        entityId: `${year}-${month}`,
        after: { rows: saved, period: `${year}-${month}` } as never,
      },
    });

    return { imported: saved, wouldImport: saved, errors: [] };
  }
}