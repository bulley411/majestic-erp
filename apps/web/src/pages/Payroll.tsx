import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listPayrollRuns, createPayrollRun, ApiError,
  type PayrollRunSummary, type RunStatus,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';
import PayrollRunDetailView from './PayrollRunDetail';

const naira = (v: string) =>
  '₦' + Number(v).toLocaleString('en-NG', { minimumFractionDigits: 2 });

const monthName = (m: number) =>
  new Date(Date.UTC(2000, m - 1, 1)).toLocaleString('en-NG', { month: 'long' });

/** Colour carries meaning here: posted is final, rejected needs attention. */
const STATUS_TONE: Record<RunStatus, string> = {
  DRAFT: '', PREPARED: 'info', REVIEWED: 'info', APPROVED: 'ok',
  POSTED: 'ok', PAID: 'ok', REJECTED: 'warn',
};

const STATUS_LABEL: Record<RunStatus, string> = {
  DRAFT: 'Draft',
  PREPARED: 'Awaiting review',
  REVIEWED: 'Awaiting MD approval',
  APPROVED: 'Approved — ready to post',
  POSTED: 'Posted to ledger',
  PAID: 'Paid',
  REJECTED: 'Rejected',
};

export default function Payroll() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const now = new Date();

  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [error, setError] = useState<string | null>(null);

  const { data: runs, isLoading } = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: listPayrollRuns,
  });

  const create = useMutation({
    mutationFn: () => createPayrollRun(year, month),
    onSuccess: (run) => {
      setCreating(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      setOpen(run.id);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not create the run.'),
  });

  if (open) {
    return <PayrollRunDetailView runId={open} onClose={() => setOpen(null)} />;
  }

  return (
    <>
      <header className="topbar">
        <div className="crumb">Payroll</div>
        <div className="titlerow">
          <h2 className="page">
            Monthly runs
            <span className="count">
              {isLoading ? 'Loading…' : `${runs?.length ?? 0} recorded`}
            </span>
          </h2>
          {can('payroll.prepare') && !creating ? (
            <div className="acts">
              <button className="btn pri" type="button"
                onClick={() => { setCreating(true); setError(null); }}>
                New payroll run
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="body">
        {error ? <div className="dbanner err" style={{ marginBottom: 14 }}>{error}</div> : null}

        {creating ? (
          <div className="fsection">
            <h4>New run</h4>
            <p className="fnote" style={{ padding: '0 0 12px' }}>
              Payslips are computed from each employee's salary as at the end of the
              period and their attendance for that month. Check the register is complete
              before preparing.
            </p>
            <div className="regbar" style={{ marginBottom: 0 }}>
              <label className="ffield" style={{ maxWidth: 150 }}>
                <span>Month</span>
                <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>{monthName(i + 1)}</option>
                  ))}
                </select>
              </label>
              <label className="ffield" style={{ maxWidth: 110 }}>
                <span>Year</span>
                <input type="number" value={year} min={2020} max={2100}
                  onChange={(e) => setYear(Number(e.target.value))} />
              </label>
              <button className="btn pri" type="button" disabled={create.isPending}
                onClick={() => create.mutate()}>
                {create.isPending ? 'Computing…' : 'Create draft'}
              </button>
              <button className="btn" type="button"
                onClick={() => { setCreating(false); setError(null); }}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {!runs?.length && !isLoading ? (
          <div className="empty">
            <h3>No payroll runs yet</h3>
            <p>Create one for a period to compute payslips from salaries and attendance.</p>
          </div>
        ) : null}

        {runs?.length ? (
          <div className="fsection">
            <ul className="runlist">
              {runs.map((r: PayrollRunSummary) => (
                <li key={r.id} onClick={() => setOpen(r.id)} tabIndex={0} role="button"
                  onKeyDown={(e) => { if (e.key === 'Enter') setOpen(r.id); }}>
                  <div className="runmain">
                    <b>{monthName(r.periodMonth)} {r.periodYear}</b>
                    <em className="mono">
                      {r.reference} · {r._count?.payslips ?? 0} payslips
                    </em>
                    <div className="typetags">
                      <span className={`tag ${STATUS_TONE[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </div>
                  </div>
                  <div className="runtotals">
                    <span>Net <b className="mono">{naira(r.totalNet)}</b></span>
                    <span>PAYE <b className="mono">{naira(r.totalPaye)}</b></span>
                    <span>Pension <b className="mono">
                      {naira(String(Number(r.totalPensionEmployee) + Number(r.totalPensionEmployer)))}
                    </b></span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </>
  );
}