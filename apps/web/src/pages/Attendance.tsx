import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getRegister, markAttendance, markRemainingPresent, getMonthlyAttendance,
  downloadAttendanceTemplate, importAttendance, ApiError,
  type AttendanceStatus, type RegisterRow,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';

const TABS = [
  { id: 'daily', label: 'Daily register' },
  { id: 'monthly', label: 'Monthly summary' },
  { id: 'import', label: 'Import from spreadsheet' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** Only these can be set by hand; the rest come from the calendar. */
const SETTABLE: { value: AttendanceStatus; label: string; short: string }[] = [
  { value: 'PRESENT', label: 'Present', short: 'P' },
  { value: 'REMOTE', label: 'Remote', short: 'R' },
  { value: 'LATE', label: 'Late', short: 'L' },
  { value: 'HALF_DAY', label: 'Half day', short: 'H' },
  { value: 'ABSENT', label: 'Absent', short: 'A' },
  { value: 'ON_LEAVE', label: 'On leave', short: 'LV' },
  { value: 'SUSPENDED', label: 'Suspended', short: 'S' },
];

const SHORT: Record<string, string> = {
  PRESENT: 'P', REMOTE: 'R', LATE: 'L', HALF_DAY: 'H', ABSENT: 'A',
  ON_LEAVE: 'LV', SUSPENDED: 'S', PUBLIC_HOLIDAY: '·', WEEKEND: '·',
};

const naira = (v: string) =>
  '₦' + Number(v).toLocaleString('en-NG', { minimumFractionDigits: 2 });

const today = () => new Date().toISOString().slice(0, 10);

/* ------------------------------ daily ----------------------------- */

function DailyRegisterTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['register', date],
    queryFn: () => getRegister(date),
  });

  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
    qc.invalidateQueries({ queryKey: ['register', date] });
    qc.invalidateQueries({ queryKey: ['monthly-attendance'] });
  };

  const mark = useMutation({
    mutationFn: (row: { employeeId: string; status: AttendanceStatus }) =>
      markAttendance([{ ...row, date }]),
    onSuccess: () => { setError(null); flash(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save.'),
  });

  const rest = useMutation({
    mutationFn: () => markRemainingPresent(date),
    onSuccess: () => { setError(null); flash(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save.'),
  });

  const rows = data?.employees ?? [];
  const unmarked = rows.filter((r) => !r.recorded).length;

  return (
    <>
      <div className="regbar">
        <label className="ffield" style={{ maxWidth: 180 }}>
          <span>Date</span>
          <input type="date" value={date} max={today()}
            onChange={(e) => { setDate(e.target.value); setError(null); }} />
        </label>

        <div className="regmeta">
          {data && !data.isWorkingDay ? (
            <span className="tag warn">
              {data.calendarStatus === 'PUBLIC_HOLIDAY' ? 'Public holiday' : 'Not a working day'}
            </span>
          ) : (
            <span className="tag">{unmarked} of {rows.length} unmarked</span>
          )}
          {saved ? <span className="tag ok">Saved</span> : null}
        </div>

        {canWrite && data?.isWorkingDay && unmarked > 0 ? (
          <button className="btn pri" type="button" disabled={rest.isPending}
            onClick={() => rest.mutate()}>
            Mark remaining {unmarked} present
          </button>
        ) : null}
      </div>

      {error ? <div className="dbanner err" style={{ marginBottom: 14 }}>{error}</div> : null}

      {isLoading ? <div className="loading">Loading register…</div> : null}

      {data && !data.isWorkingDay ? (
        <div className="empty">
          <h3>Not a working day</h3>
          <p>Nothing to record. Change the date, or adjust working days in settings.</p>
        </div>
      ) : null}

      {data?.isWorkingDay ? (
        <div className="fsection">
          <ul className="reglist">
            {rows.map((r: RegisterRow) => (
              <li key={r.employeeId} className={r.recorded ? 'marked' : undefined}>
                <div className="regwho">
                  <b>{r.name}</b>
                  <em className="mono">
                    {r.staffId}
                    {r.department ? ` · ${r.department}` : ''}
                    {r.onApprovedLeave ? ` · approved ${r.onApprovedLeave}` : ''}
                  </em>
                </div>

                <div className="regstatus">
                  {SETTABLE.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      title={s.label}
                      className={`statbtn s-${s.value}${r.status === s.value ? ' on' : ''}`}
                      disabled={!canWrite || r.locked || mark.isPending}
                      onClick={() =>
                        mark.mutate({ employeeId: r.employeeId, status: s.value })}
                    >
                      {s.short}
                    </button>
                  ))}
                  {r.locked ? <span className="tag warn">Locked by payroll</span> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="fnote">
        Unmarked working days are treated as worked, so a gap in the register never
        costs anyone pay. Only Absent, Half day and Suspended reduce earnings.
      </p>
    </>
  );
}

/* ----------------------------- monthly ---------------------------- */

function MonthlyTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);

  const { data, isLoading } = useQuery({
    queryKey: ['monthly-attendance', year, month],
    queryFn: () => getMonthlyAttendance(year, month),
  });

  const totalDeduction = (data?.employees ?? [])
    .reduce((sum, e) => sum + Number(e.deduction.amount), 0);

  return (
    <>
      <div className="regbar">
        <label className="ffield" style={{ maxWidth: 130 }}>
          <span>Month</span>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(Date.UTC(2000, i, 1)).toLocaleString('en-NG', { month: 'long' })}
              </option>
            ))}
          </select>
        </label>
        <label className="ffield" style={{ maxWidth: 110 }}>
          <span>Year</span>
          <input type="number" value={year} min={2020} max={2100}
            onChange={(e) => setYear(Number(e.target.value))} />
        </label>
        <div className="regmeta">
          {data ? (
            <>
              <span className="tag">{data.employees[0]?.summary.workingDays ?? 0} working days</span>
              <span className="tag">
                Basis: {data.policy.deductionBasis === 'FIXED_30' ? '÷30' : '÷working days'}
              </span>
              {totalDeduction > 0 ? (
                <span className="tag warn">
                  Total deduction {naira(String(totalDeduction))}
                </span>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {isLoading ? <div className="loading">Loading…</div> : null}

      {data?.employees.length ? (
        <div className="fsection">
          <div className="tablewrap">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="num">Present</th>
                  <th className="num">Late</th>
                  <th className="num">Half</th>
                  <th className="num">Leave</th>
                  <th className="num">Absent</th>
                  <th className="num">Forfeited</th>
                  <th className="num">Daily rate</th>
                  <th className="num">Deduction</th>
                  <th className="num">Adjusted gross</th>
                </tr>
              </thead>
              <tbody>
                {data.employees.map((e) => (
                  <tr key={e.employeeId}>
                    <td>
                      <b>{e.name}</b>
                      <em className="mono">{e.staffId}</em>
                      {e.summary.lateWarning ? (
                        <span className="tag warn">Late {e.summary.daysLate}×</span>
                      ) : null}
                    </td>
                    <td className="num">{e.summary.daysPresent + e.summary.daysRemote + e.summary.daysUnmarked}</td>
                    <td className="num">{e.summary.daysLate || '—'}</td>
                    <td className="num">{e.summary.daysHalf || '—'}</td>
                    <td className="num">{e.summary.daysOnLeave || '—'}</td>
                    <td className={`num${e.summary.daysAbsent ? ' bad' : ''}`}>
                      {e.summary.daysAbsent || '—'}
                    </td>
                    <td className="num mono">{e.summary.daysForfeited}</td>
                    <td className="num mono">{naira(e.deduction.dailyRate)}</td>
                    <td className={`num mono${Number(e.deduction.amount) > 0 ? ' bad' : ''}`}>
                      {Number(e.deduction.amount) > 0 ? naira(e.deduction.amount) : '—'}
                    </td>
                    <td className="num mono">{naira(e.deduction.adjustedGross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <p className="fnote">
        Deductions reduce gross pay, so PAYE and pension are computed on what was
        actually earned. Payroll reads these figures when the run for this period
        is prepared.
      </p>
    </>
  );
}

/* ------------------------------ import ---------------------------- */

function ImportTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const run = useMutation({
    mutationFn: (dryRun: boolean) => importAttendance(file!, year, month, dryRun),
    onSuccess: (r, dryRun) => {
      setRows([]);
      setError(null);
      setMessage(dryRun
        ? `Checked. ${r.wouldImport} entries are ready to import.`
        : `Imported ${r.imported} entries.`);
      if (!dryRun) {
        qc.invalidateQueries({ queryKey: ['monthly-attendance'] });
        qc.invalidateQueries({ queryKey: ['register'] });
        setFile(null);
        if (input.current) input.current.value = '';
      }
    },
    onError: (e) => {
      setMessage(null);
      setError(e instanceof Error ? e.message : 'Import failed.');
      setRows((e as ApiError & { rows?: string[] }).rows ?? []);
    },
  });

  return (
    <>
      <div className="fsection">
        <h4>1. Download the template</h4>
        <p className="fnote" style={{ padding: '0 0 12px' }}>
          One row per employee, one column per day. Weekends and public holidays are
          pre-filled with a dash, so a blank cell means the day is simply not marked yet.
        </p>
        <div className="regbar" style={{ marginBottom: 0 }}>
          <label className="ffield" style={{ maxWidth: 130 }}>
            <span>Month</span>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(Date.UTC(2000, i, 1)).toLocaleString('en-NG', { month: 'long' })}
                </option>
              ))}
            </select>
          </label>
          <label className="ffield" style={{ maxWidth: 110 }}>
            <span>Year</span>
            <input type="number" value={year} min={2020} max={2100}
              onChange={(e) => setYear(Number(e.target.value))} />
          </label>
          <button className="btn" type="button"
            onClick={() => downloadAttendanceTemplate(year, month)}>
            Download template
          </button>
        </div>
      </div>

      {canWrite ? (
        <div className="fsection">
          <h4>2. Fill it in and upload</h4>
          <p className="fnote" style={{ padding: '0 0 12px' }}>
            Codes: <b>P</b> present · <b>R</b> remote · <b>L</b> late · <b>H</b> half day ·{' '}
            <b>A</b> absent · <b>LV</b> on leave · <b>S</b> suspended. Leave a cell blank
            for a normal working day.
          </p>

          <input ref={input} type="file" accept=".xlsx"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError(null); setMessage(null); setRows([]);
            }} />

          <div className="acts" style={{ marginTop: 14 }}>
            <button className="btn" type="button" disabled={!file || run.isPending}
              onClick={() => run.mutate(true)}>
              Check without saving
            </button>
            <button className="btn pri" type="button" disabled={!file || run.isPending}
              onClick={() => run.mutate(false)}>
              {run.isPending ? 'Working…' : 'Import'}
            </button>
          </div>
        </div>
      ) : null}

      {message ? <div className="dbanner">{message}</div> : null}

      {error ? (
        <div className="dbanner err">
          <b>{error}</b>
          {rows.length ? (
            <ul style={{ margin: '8px 0 0 18px' }}>
              {rows.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="fnote">
        Nothing is saved unless the whole sheet is valid, so a mistake on one row
        never leaves the month half-imported.
      </p>
    </>
  );
}

/* ------------------------------ page ------------------------------ */

export default function Attendance() {
  const { can } = useAuth();
  const canWrite = can('attendance.write');
  const [tab, setTab] = useState<TabId>('daily');

  return (
    <>
      <header className="topbar">
        <div className="crumb">People</div>
        <div className="titlerow">
          <h2 className="page">Attendance</h2>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} type="button"
              className={`tab${tab === t.id ? ' on' : ''}`}
              onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="body">
        {tab === 'daily' ? <DailyRegisterTab canWrite={canWrite} /> : null}
        {tab === 'monthly' ? <MonthlyTab /> : null}
        {tab === 'import' ? <ImportTab canWrite={canWrite} /> : null}
      </div>
    </>
  );
}