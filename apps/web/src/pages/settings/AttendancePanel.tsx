import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAttendancePolicy, updateAttendancePolicy, listHolidays,
  addHoliday, seedHolidays, removeHoliday, ApiError,
  type AttendancePolicy,
} from '../../lib/api';

const DAYS = [
  { value: 0, label: 'Sun' }, { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

export default function AttendancePanel({
  manage, onError,
}: {
  manage: boolean;
  onError: (m: string | null) => void;
}) {
  const qc = useQueryClient();
  const year = new Date().getUTCFullYear();
  const [draft, setDraft] = useState<AttendancePolicy | null>(null);
  const [holiday, setHoliday] = useState({ date: '', name: '' });
  const [saved, setSaved] = useState(false);

  const { data: policy } = useQuery({
    queryKey: ['attendance-policy'],
    queryFn: getAttendancePolicy,
  });
  const { data: holidays } = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => listHolidays(year),
  });

  useEffect(() => { if (policy && !draft) setDraft(policy); }, [policy, draft]);

  const done = () => {
    qc.invalidateQueries({ queryKey: ['attendance-policy'] });
    qc.invalidateQueries({ queryKey: ['holidays'] });
    qc.invalidateQueries({ queryKey: ['monthly-attendance'] });
    onError(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  const fail = (e: unknown) =>
    onError(e instanceof ApiError ? e.message : 'Could not save.');

  const save = useMutation({
    mutationFn: () => updateAttendancePolicy(draft!),
    onSuccess: done, onError: fail,
  });
  const add = useMutation({
    mutationFn: () => addHoliday(holiday.date, holiday.name),
    onSuccess: () => { setHoliday({ date: '', name: '' }); done(); },
    onError: fail,
  });
  const seed = useMutation({
    mutationFn: () => seedHolidays(year), onSuccess: done, onError: fail,
  });
  const drop = useMutation({
    mutationFn: removeHoliday, onSuccess: done, onError: fail,
  });

  if (!draft) return <div className="loading">Loading…</div>;

  const set = <K extends keyof AttendancePolicy>(k: K, v: AttendancePolicy[K]) =>
    setDraft({ ...draft, [k]: v });

  const toggleDay = (d: number) =>
    set('workingDays', draft.workingDays.includes(d)
      ? draft.workingDays.filter((x) => x !== d)
      : [...draft.workingDays, d].sort());

  return (
    <>
      <p className="fnote" style={{ padding: '0 0 14px' }}>
        These rules decide what people are paid when they miss work, so every change
        is recorded against your account.
      </p>

      <div className="fgrid">
        <div className="ffield span2">
          <span>Working days</span>
          <div className="daypicker">
            {DAYS.map((d) => (
              <button key={d.value} type="button" disabled={!manage}
                className={draft.workingDays.includes(d.value) ? 'on' : undefined}
                onClick={() => toggleDay(d.value)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <label className="ffield">
          <span>Work starts</span>
          <input type="time" value={draft.workStart} disabled={!manage}
            onChange={(e) => set('workStart', e.target.value)} />
        </label>
        <label className="ffield">
          <span>Work ends</span>
          <input type="time" value={draft.workEnd} disabled={!manage}
            onChange={(e) => set('workEnd', e.target.value)} />
        </label>

        <label className="ffield">
          <span>Grace period (minutes)</span>
          <input type="number" min={0} max={240} value={draft.lateGraceMinutes}
            disabled={!manage}
            onChange={(e) => set('lateGraceMinutes', Number(e.target.value))} />
          <em className="fhint">Arriving within this is not counted late</em>
        </label>

        <label className="ffield">
          <span>Late warning after</span>
          <input type="number" min={1} max={31} value={draft.lateWarningThreshold}
            disabled={!manage}
            onChange={(e) => set('lateWarningThreshold', Number(e.target.value))} />
          <em className="fhint">Flags the employee for HR. Never affects pay.</em>
        </label>

        <label className="ffield span2">
          <span>Absence deduction basis</span>
          <select value={draft.deductionBasis} disabled={!manage}
            onChange={(e) =>
              set('deductionBasis', e.target.value as AttendancePolicy['deductionBasis'])}>
            <option value="WORKING_DAYS">
              Working days — gross ÷ actual working days that month
            </option>
            <option value="FIXED_30">Fixed 30 — gross ÷ 30</option>
          </select>
          <em className="fhint">
            On ₦195,000 in a 23-working-day month, one absence costs ₦8,478.26 on the
            working-days basis or ₦6,500.00 on the fixed-30 basis.
          </em>
        </label>

        <label className="ffield span2">
          <span>Does lateness reduce pay?</span>
          <select value={draft.latenessPolicy} disabled={!manage}
            onChange={(e) =>
              set('latenessPolicy', e.target.value as AttendancePolicy['latenessPolicy'])}>
            <option value="NONE">No — track only, handle as a conduct matter</option>
            <option value="HALF_DAY_AFTER">Half a day after a number of free occurrences</option>
            <option value="PRORATA_MINUTES">Pro-rata — deduct the minutes missed</option>
          </select>
          <em className="fhint">
            Docking pay for lateness is a fine rather than pay for time not worked,
            which sits differently under the Labour Act. Worth confirming with your
            advisers before enabling.
          </em>
        </label>

        {draft.latenessPolicy === 'HALF_DAY_AFTER' ? (
          <label className="ffield">
            <span>Free late days per month</span>
            <input type="number" min={0} max={31} value={draft.latenessFreeCount}
              disabled={!manage}
              onChange={(e) => set('latenessFreeCount', Number(e.target.value))} />
          </label>
        ) : null}
      </div>

      {manage ? (
        <div className="acts" style={{ marginTop: 14 }}>
          <button className="btn pri" type="button" disabled={save.isPending}
            onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save policy'}
          </button>
          {saved ? <span className="tag ok">Saved</span> : null}
        </div>
      ) : null}

      <div style={{ marginTop: 26 }}>
        <h4 style={{
          fontFamily: 'Archivo', fontSize: 12, fontWeight: 600, letterSpacing: '.02em',
          textTransform: 'uppercase', color: 'var(--ink-2)', paddingBottom: 9,
          marginBottom: 14, borderBottom: '2px solid var(--brass)',
        }}>
          Public holidays {year}
        </h4>

        <p className="fnote" style={{ padding: '0 0 12px' }}>
          Eid and Easter dates move each year and are declared by the federal
          government, so they are entered here rather than guessed — a wrong date
          would silently change what people are paid.
        </p>

        {manage ? (
          <div className="draftrow">
            <input type="date" value={holiday.date}
              onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} />
            <input placeholder="Holiday name" style={{ flex: 2 }} value={holiday.name}
              onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} />
            <button className="btn pri" type="button"
              disabled={!holiday.date || holiday.name.length < 2 || add.isPending}
              onClick={() => add.mutate()}>
              Add
            </button>
            <button className="btn" type="button" disabled={seed.isPending}
              onClick={() => seed.mutate()}>
              Add fixed national holidays
            </button>
          </div>
        ) : null}

        {!holidays?.length ? (
          <p className="fnote" style={{ padding: 0 }}>None recorded for {year}.</p>
        ) : (
          <ul className="typelist">
            {holidays.map((h) => (
              <li key={h.id}>
                <div className="typemain">
                  <b>{h.name}</b>
                  <em className="mono">
                    {new Date(h.date).toLocaleDateString('en-NG', {
                      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                    })}
                  </em>
                </div>
                {manage ? (
                  <div className="typeacts">
                    <button className="linkact danger" type="button"
                      disabled={drop.isPending}
                      onClick={() => {
                        if (confirm(`Remove "${h.name}"?`)) drop.mutate(h.id);
                      }}>
                      Remove
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}