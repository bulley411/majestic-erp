import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCompensation, addCompensation, getFormOptions, ApiError, type Compensation,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';

const naira = (v: string | number) =>
  '₦' + Number(v).toLocaleString('en-NG', { minimumFractionDigits: 2 });

const today = () => new Date().toISOString().slice(0, 10);

const blank = {
  structureId: '',
  totalPackage: '',
  monthlyGross: '',
  peculiarAllowance: '0',
  effectiveFrom: today(),
  reason: '',
};

export default function SalaryTab({ employeeId }: { employeeId: string }) {
  const { can } = useAuth();
  const editable = can('employee.write');
  const qc = useQueryClient();

  const [draft, setDraft] = useState<typeof blank | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { data: history, isLoading } = useQuery({
    queryKey: ['compensation', employeeId],
    queryFn: () => getCompensation(employeeId),
  });
  const { data: options } = useQuery({
    queryKey: ['employee-options'],
    queryFn: getFormOptions,
  });

  const add = useMutation({
    mutationFn: (d: typeof blank) =>
      addCompensation(employeeId, {
        structureId: d.structureId,
        totalPackage: Number(d.totalPackage),
        monthlyGross: Number(d.monthlyGross),
        peculiarAllowance: Number(d.peculiarAllowance || 0),
        effectiveFrom: d.effectiveFrom,
        reason: d.reason || undefined,
      }),
    onSuccess: () => {
      setDraft(null);
      setError(null);
      setFieldErrors({});
      qc.invalidateQueries({ queryKey: ['compensation', employeeId] });
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors) {
        setFieldErrors(e.fieldErrors);
        setError(null);
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not save.');
      }
    },
  });

  const current = history?.find((c) => c.effectiveTo === null);

  /** Keeps the three figures consistent as they are typed. */
  const setPackage = (value: string) => {
    if (!draft) return;
    const total = Number(value || 0);
    const allowance = Number(draft.peculiarAllowance || 0);
    setDraft({
      ...draft,
      totalPackage: value,
      monthlyGross: total > allowance ? String(total - allowance) : draft.monthlyGross,
    });
  };

  const setAllowance = (value: string) => {
    if (!draft) return;
    const total = Number(draft.totalPackage || 0);
    const allowance = Number(value || 0);
    setDraft({
      ...draft,
      peculiarAllowance: value,
      monthlyGross: total > allowance ? String(total - allowance) : draft.monthlyGross,
    });
  };

  if (isLoading) return <div className="loading">Loading salary history…</div>;

  return (
    <>
      {error ? <div className="dbanner err" style={{ marginBottom: 14 }}>{error}</div> : null}

      {current ? (
        <div className="salarynow">
          <div>
            <span className="photolabel">Current monthly gross</span>
            <b className="mono">{naira(current.monthlyGross)}</b>
            <em>
              Effective {new Date(current.effectiveFrom).toLocaleDateString('en-NG')}
              {current.reason ? ` · ${current.reason}` : ''}
            </em>
          </div>
          <div className="salarysplit">
            <span>Package {naira(current.totalPackage)}</span>
            <span>Reimbursable {naira(current.peculiarAllowance)}</span>
          </div>
        </div>
      ) : (
        <div className="empty" style={{ marginBottom: 14 }}>
          <h3>No salary recorded</h3>
          <p>Payroll cannot include this employee until a salary is set.</p>
        </div>
      )}

      {editable && !draft ? (
        <button className="btn pri" type="button" style={{ marginBottom: 14 }}
          onClick={() => {
            setDraft({
              ...blank,
              structureId: options?.structures[0]?.id ?? '',
              totalPackage: current?.totalPackage ?? '',
              monthlyGross: current?.monthlyGross ?? '',
              peculiarAllowance: current?.peculiarAllowance ?? '0',
            });
            setError(null);
            setFieldErrors({});
          }}>
          {current ? 'Record salary change' : 'Set salary'}
        </button>
      ) : null}

      {draft ? (
        <div className="fsection">
          <h4>{current ? 'Salary change' : 'Initial salary'}</h4>
          <div className="fgrid">
            <label className="ffield">
              <span>Salary structure<b> *</b></span>
              <select value={draft.structureId}
                onChange={(e) => setDraft({ ...draft, structureId: e.target.value })}>
                {(options?.structures ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="ffield">
              <span>Effective from<b> *</b></span>
              <input type="date" value={draft.effectiveFrom}
                onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })} />
              <em className="fhint">Payroll uses this from the stated month</em>
            </label>

            <label className={`ffield${fieldErrors.totalPackage ? ' has-error' : ''}`}>
              <span>Total monthly package (₦)<b> *</b></span>
              <input type="number" step="0.01" value={draft.totalPackage}
                onChange={(e) => setPackage(e.target.value)} />
              {fieldErrors.totalPackage
                ? <em className="ferr">{fieldErrors.totalPackage}</em>
                : <em className="fhint">Everything the employee receives</em>}
            </label>

            <label className="ffield">
              <span>Reimbursable allowance (₦)</span>
              <input type="number" step="0.01" value={draft.peculiarAllowance}
                onChange={(e) => setAllowance(e.target.value)} />
              <em className="fhint">Non-taxable portion, paid outside PAYE</em>
            </label>

            <label className={`ffield span2${fieldErrors.monthlyGross ? ' has-error' : ''}`}>
              <span>Taxable monthly gross (₦)<b> *</b></span>
              <input type="number" step="0.01" value={draft.monthlyGross}
                onChange={(e) => setDraft({ ...draft, monthlyGross: e.target.value })} />
              {fieldErrors.monthlyGross
                ? <em className="ferr">{fieldErrors.monthlyGross}</em>
                : <em className="fhint">
                    PAYE and pension are computed from this. Splits 40% basic,
                    25% housing, 15% transport, 10% utility, 10% meal.
                  </em>}
            </label>

            <label className="ffield span2">
              <span>Reason</span>
              <input value={draft.reason} placeholder="Appointment, promotion, annual review"
                onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
            </label>
          </div>

          <div className="acts" style={{ marginTop: 14 }}>
            <button className="btn pri" type="button"
              disabled={add.isPending || !draft.totalPackage || !draft.monthlyGross}
              onClick={() => add.mutate(draft)}>
              {add.isPending ? 'Saving…' : 'Record salary'}
            </button>
            <button className="btn" type="button" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {history?.length ? (
        <div className="fsection">
          <h4>History</h4>
          <p className="fnote" style={{ padding: '0 0 10px' }}>
            Records are never edited. Each change closes the previous one, so a payslip
            from any past month reproduces the figure that applied then.
          </p>
          <ul className="typelist">
            {history.map((c: Compensation) => (
              <li key={c.id}>
                <div className="typemain">
                  <b className="mono">{naira(c.monthlyGross)}</b>
                  <em>
                    {new Date(c.effectiveFrom).toLocaleDateString('en-NG')}
                    {' — '}
                    {c.effectiveTo
                      ? new Date(c.effectiveTo).toLocaleDateString('en-NG')
                      : 'current'}
                    {c.reason ? ` · ${c.reason}` : ''}
                  </em>
                  <div className="typetags">
                    <span className="tag">Package {naira(c.totalPackage)}</span>
                    {Number(c.peculiarAllowance) > 0 ? (
                      <span className="tag">Reimbursable {naira(c.peculiarAllowance)}</span>
                    ) : null}
                    {!c.effectiveTo ? <span className="tag">Current</span> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}