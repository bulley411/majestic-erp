import Decimal from 'decimal.js';

/**
 * Attendance calculation for Majestic APA Limited.
 *
 * The central question this answers: when someone is absent without leave,
 * how much of their pay is withheld?
 *
 * The approach here is pro-rata against working days — an employee absent
 * 2 of 22 working days forfeits 2/22 of their monthly gross. This is the
 * "no work, no pay" principle, and it is a *reduction of earnings* rather
 * than a penalty.
 *
 * That distinction matters. Reducing gross means PAYE and pension are
 * computed on what was actually earned, which is correct: an employee who
 * worked 20 of 22 days did not earn the other two days, so should not be
 * taxed on them. Deducting from net pay instead would tax income that was
 * never received.
 *
 * It also matters legally. The Nigerian Labour Act permits deductions for
 * time not worked, but treats punitive fines differently. Framing this as
 * unearned pay rather than a fine keeps it on the safer side. Confirm with
 * your own advisers before running it against real staff.
 */

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type AttendanceStatus =
  | 'PRESENT'
  | 'REMOTE'
  | 'LATE'
  | 'HALF_DAY'
  | 'ABSENT'
  | 'ON_LEAVE'
  | 'PUBLIC_HOLIDAY'
  | 'WEEKEND'
  | 'SUSPENDED';

/** How much of a day's pay each status earns. */
export const DAY_VALUE: Record<AttendanceStatus, Decimal> = {
  PRESENT: new Decimal(1),
  REMOTE: new Decimal(1),
  // Overridden by latenessValue() when the policy says lateness costs pay.
  LATE: new Decimal(1),
  HALF_DAY: new Decimal('0.5'),
  ABSENT: new Decimal(0),
  ON_LEAVE: new Decimal(1),
  PUBLIC_HOLIDAY: new Decimal(1),
  WEEKEND: new Decimal(1),
  // Suspension without pay is a disciplinary outcome, recorded explicitly.
  SUSPENDED: new Decimal(0),
};

/** Statuses that consume a working day and can therefore reduce pay. */
export const COUNTS_AS_WORKING_DAY: Record<AttendanceStatus, boolean> = {
  PRESENT: true,
  REMOTE: true,
  LATE: true,
  HALF_DAY: true,
  ABSENT: true,
  ON_LEAVE: true,
  PUBLIC_HOLIDAY: false,
  WEEKEND: false,
  SUSPENDED: true,
};

export interface AttendancePolicy {
  /** Days of week that are working days. 0 = Sunday. Default Mon-Fri. */
  workingDays: number[];
  /** Minutes after start time before a day is marked LATE. */
  lateGraceMinutes: number;
  /** Local work start, "HH:MM". */
  workStart: string;
  /** Local work end, "HH:MM". */
  workEnd: string;
  /**
   * Denominator for the daily rate.
   *
   *   WORKING_DAYS  — gross / actual working days that month. A day off in
   *                   a short month costs more than in a long one, which
   *                   reflects the value of the day actually missed.
   *   FIXED_30      — gross / 30. Simpler, matches some Nigerian practice,
   *                   but under-deducts relative to days actually worked.
   */
  deductionBasis: 'WORKING_DAYS' | 'FIXED_30';
  /** Lateness occurrences before HR is prompted to act. */
  lateWarningThreshold: number;
  /**
   * Whether lateness reduces pay, and how.
   *
   *   NONE            — tracked only. Lateness is a conduct matter and
   *                     docking pay for it is a fine rather than a
   *                     pro-rata reduction, which sits differently under
   *                     the Labour Act.
   *   HALF_DAY_AFTER  — the first N late days are free; each one after
   *                     that counts as half a day.
   *   PRORATA_MINUTES — the minutes missed are deducted as a fraction of
   *                     the working day. Strictly proportional, but harsh
   *                     on someone caught in Lagos traffic once.
   */
  latenessPolicy: 'NONE' | 'HALF_DAY_AFTER' | 'PRORATA_MINUTES';
  /** Free late days before HALF_DAY_AFTER starts biting. */
  latenessFreeCount: number;
}

export const DEFAULT_POLICY: AttendancePolicy = {
  workingDays: [1, 2, 3, 4, 5],
  lateGraceMinutes: 15,
  workStart: '08:00',
  workEnd: '17:00',
  deductionBasis: 'WORKING_DAYS',
  lateWarningThreshold: 3,
  latenessPolicy: 'NONE',
  latenessFreeCount: 3,
};

/* ------------------------------------------------------------------ */
/* Calendar                                                            */
/* ------------------------------------------------------------------ */

/** All dates in a month, as UTC midnight. */
export function datesInMonth(year: number, month: number): Date[] {
  const out: Date[] = [];
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = 1; d <= days; d++) out.push(new Date(Date.UTC(year, month - 1, d)));
  return out;
}

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export const isWorkingDay = (
  date: Date,
  policy: AttendancePolicy,
  holidays: Set<string> = new Set(),
): boolean =>
  policy.workingDays.includes(date.getUTCDay()) && !holidays.has(isoDate(date));

/** Working days in a month, excluding weekends and public holidays. */
export function workingDaysInMonth(
  year: number,
  month: number,
  policy: AttendancePolicy = DEFAULT_POLICY,
  holidays: Set<string> = new Set(),
): number {
  return datesInMonth(year, month).filter((d) => isWorkingDay(d, policy, holidays)).length;
}

/** Status implied by the calendar when nothing has been recorded. */
export function defaultStatus(
  date: Date,
  policy: AttendancePolicy,
  holidays: Set<string>,
): AttendanceStatus | null {
  if (holidays.has(isoDate(date))) return 'PUBLIC_HOLIDAY';
  if (!policy.workingDays.includes(date.getUTCDay())) return 'WEEKEND';
  return null; // a working day with no record — needs marking
}

/* ------------------------------------------------------------------ */
/* Lateness                                                            */
/* ------------------------------------------------------------------ */

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Minutes late, floored at zero. Grace period applied by the caller. */
export function minutesLate(checkIn: string, policy: AttendancePolicy): number {
  return Math.max(0, toMinutes(checkIn) - toMinutes(policy.workStart));
}

export function statusFromCheckIn(
  checkIn: string,
  policy: AttendancePolicy,
): 'PRESENT' | 'LATE' {
  return minutesLate(checkIn, policy) > policy.lateGraceMinutes ? 'LATE' : 'PRESENT';
}

/* ------------------------------------------------------------------ */
/* Monthly summary and deduction                                       */
/* ------------------------------------------------------------------ */

export interface DayRecord {
  date: string;
  status: AttendanceStatus;
  minutesLate?: number;
}

export interface AttendanceSummary {
  workingDays: number;
  daysPresent: number;
  daysRemote: number;
  daysLate: number;
  daysHalf: number;
  daysAbsent: number;
  daysOnLeave: number;
  daysSuspended: number;
  daysUnmarked: number;
  /** Working days actually earned, counting half days as 0.5. */
  daysEarned: Decimal;
  /** Working days not earned. Drives the deduction. */
  daysForfeited: Decimal;
  totalMinutesLate: number;
  lateWarning: boolean;
}

/** Minutes in a working day, from the configured start and end times. */
const workingMinutes = (policy: AttendancePolicy): number =>
  Math.max(1, toMinutes(policy.workEnd) - toMinutes(policy.workStart));

/**
 * How much of a day a late arrival earns, under the configured policy.
 * `occurrence` is 1-based: the first late day of the month is 1.
 */
export function latenessValue(
  record: DayRecord,
  occurrence: number,
  policy: AttendancePolicy,
): Decimal {
  switch (policy.latenessPolicy) {
    case 'HALF_DAY_AFTER':
      return occurrence > policy.latenessFreeCount
        ? new Decimal('0.5')
        : new Decimal(1);

    case 'PRORATA_MINUTES': {
      const late = Math.max(0, (record.minutesLate ?? 0) - policy.lateGraceMinutes);
      const fraction = new Decimal(late).dividedBy(workingMinutes(policy));
      return Decimal.max(new Decimal(1).minus(fraction), new Decimal(0));
    }

    case 'NONE':
    default:
      return new Decimal(1);
  }
}

export function summarise(
  year: number,
  month: number,
  records: DayRecord[],
  policy: AttendancePolicy = DEFAULT_POLICY,
  holidays: Set<string> = new Set(),
): AttendanceSummary {
  const byDate = new Map(records.map((r) => [r.date, r]));
  // Counts late arrivals in date order, so HALF_DAY_AFTER applies to the
  // right occurrences rather than whichever rows happened to be stored first.
  let lateSeen = 0;

  const workingDates = datesInMonth(year, month).filter((d) =>
    isWorkingDay(d, policy, holidays),
  );

  const s: AttendanceSummary = {
    workingDays: workingDates.length,
    daysPresent: 0, daysRemote: 0, daysLate: 0, daysHalf: 0,
    daysAbsent: 0, daysOnLeave: 0, daysSuspended: 0, daysUnmarked: 0,
    daysEarned: new Decimal(0),
    daysForfeited: new Decimal(0),
    totalMinutesLate: 0,
    lateWarning: false,
  };

  for (const date of workingDates) {
    const record = byDate.get(isoDate(date));

    // An unmarked working day is treated as worked. Assuming absence from
    // missing data would dock pay because HR was slow to fill the register,
    // which is the wrong default when money is involved.
    if (!record) {
      s.daysUnmarked++;
      s.daysEarned = s.daysEarned.plus(1);
      continue;
    }

    switch (record.status) {
      case 'PRESENT': s.daysPresent++; break;
      case 'REMOTE': s.daysRemote++; break;
      case 'LATE': s.daysLate++; break;
      case 'HALF_DAY': s.daysHalf++; break;
      case 'ABSENT': s.daysAbsent++; break;
      case 'ON_LEAVE': s.daysOnLeave++; break;
      case 'SUSPENDED': s.daysSuspended++; break;
      default: break;
    }

    s.totalMinutesLate += record.minutesLate ?? 0;

    let earned = DAY_VALUE[record.status];

    if (record.status === 'LATE') {
      earned = latenessValue(record, ++lateSeen, policy);
    }

    s.daysEarned = s.daysEarned.plus(earned);
    s.daysForfeited = s.daysForfeited.plus(new Decimal(1).minus(earned));
  }

  s.lateWarning = s.daysLate >= policy.lateWarningThreshold;
  return s;
}

export interface DeductionResult {
  dailyRate: Decimal;
  daysForfeited: Decimal;
  amount: Decimal;
  basis: AttendancePolicy['deductionBasis'];
  /** Gross after the reduction. PAYE and pension compute from this. */
  adjustedGross: Decimal;
}

/**
 * Converts forfeited days into a reduction of monthly gross.
 *
 * The result reduces gross rather than net, so PAYE and pension are
 * assessed on what the employee actually earned.
 */
export function computeDeduction(
  monthlyGross: Decimal,
  summary: AttendanceSummary,
  year: number,
  month: number,
  policy: AttendancePolicy = DEFAULT_POLICY,
  holidays: Set<string> = new Set(),
): DeductionResult {
  const denominator =
    policy.deductionBasis === 'FIXED_30'
      ? new Decimal(30)
      : new Decimal(workingDaysInMonth(year, month, policy, holidays));

  // A month with no working days would otherwise divide by zero.
  const dailyRate = denominator.isZero()
    ? new Decimal(0)
    : monthlyGross.dividedBy(denominator);

  const amount = dailyRate.times(summary.daysForfeited);

  // Never let a deduction exceed the gross itself.
  const capped = Decimal.min(amount, monthlyGross);

  return {
    dailyRate,
    daysForfeited: summary.daysForfeited,
    amount: capped,
    basis: policy.deductionBasis,
    adjustedGross: monthlyGross.minus(capped),
  };
}

/* ------------------------------------------------------------------ */
/* Nigerian public holidays                                            */
/* ------------------------------------------------------------------ */

/**
 * Fixed-date national holidays. Islamic and Easter dates move each year
 * and are declared by the federal government, so they are entered by HR
 * rather than computed here — a wrong guess would silently mis-state pay.
 */
export const FIXED_NIGERIAN_HOLIDAYS: Array<[number, number, string]> = [
  [1, 1, "New Year's Day"],
  [5, 1, 'Workers\u2019 Day'],
  [6, 12, 'Democracy Day'],
  [10, 1, 'Independence Day'],
  [12, 25, 'Christmas Day'],
  [12, 26, 'Boxing Day'],
];

export function fixedHolidaysFor(year: number): Array<{ date: string; name: string }> {
  return FIXED_NIGERIAN_HOLIDAYS.map(([month, day, name]) => ({
    date: isoDate(new Date(Date.UTC(year, month - 1, day))),
    name,
  }));
}