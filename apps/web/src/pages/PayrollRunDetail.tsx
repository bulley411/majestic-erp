import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPayrollRun, transitionRun, postRunToLedger, discardRun, getPaymentSchedule,
  ApiError, type RunAction, type PayslipRow,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';

const naira = (v: string) =>
  '₦' + Number(v).toLocaleString('en-NG', { minimumFractionDigits: 2 });

const monthName = (m: number) =>
  new Date(Date.UTC(2000, m - 1, 1)).toLocaleString('en-NG', { month: 'long' });

const ACTION_LABEL: Record<RunAction, string> = {
  PREPARE: 'Submit for review',
  REVIEW: 'Sign off as reviewed',
  APPROVE: 'Approve',
  REJECT: 'Reject',
  POST: 'Post to ledger',
  MARK_PAID: 'Mark as paid',
};

/** The chain, shown so everyone can see where a run has reached. */
const STAGES = [
  { key: 'DRAFT', label: 'Prepared', by: 'Accountant' },
  { key: 'PREPARED', label: 'Reviewed', by: 'Head of Finance' },
  { key: 'REVIEWED', label: 'Approved', by: 'Managing Director' },
  { key: 'APPROVED', label: 'Posted', by: 'Accountant' },
  { key: 'POSTED', label: 'Paid', by: 'Accountant' },
];

const ORDER = ['DRAFT', 'PREPARED', 'REVIEWED', 'APPROVED', 'POSTED', 'PAID'];

export default function PayrollRunDetailView({
  runId, onClose,
}: { runId: string; onClose: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'payslips' | 'schedule' | 'trail'>('payslips');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: run, isLoading } = useQuery({
    queryKey: ['payroll-run', runId],
    queryFn: () => getPayrollRun(runId),
  });

  const { data: schedule } = useQuery({
    queryKey: ['payment-schedule', runId],
    queryFn: () => getPaymentSchedule(runId),
    enabled: tab === 'schedule',
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['payroll-run', runId] });
    qc.invalidateQueries({ queryKey: ['payroll-runs'] });
    setError(null);
  };
  const fail = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : 'That action could not be completed.');

  const act = useMutation({
    mutationFn: ({ action, remarks }: { action: RunAction; remarks?: string }) =>
      transitionRun(runId, action, remarks),
    onSuccess: refresh, onError: fail,
  });

  const post = useMutation({
    mutationFn: () => postRunToLedger(runId),
    onSuccess: refresh, onError: fail,
  });

  const drop = useMutation({
    mutationFn: () => discardRun(runId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payroll-runs'] }); onClose(); },
    onError: fail,
  });

  if (isLoading || !run) return <div className="loading">Loading run…</div>;

  const stageIndex = ORDER.indexOf(run.status);
  const busy = act.isPending || post.isPending || drop.isPending;

  const handle = (action: RunAction) => {
    if (action === 'REJECT') {
      const remarks = prompt('Why is this run being rejected?');
      if (!remarks?.trim()) return;
      act.mutate({ action, remarks });
      return;
    }
    if (action === 'APPROVE' &&
        !confirm(`Approve ${run.reference}? Net pay totals ${naira(run.totalNet)}.`)) return;
    act.mutate({ action });
  };

  const totalDeducted = run.payslips
    .reduce((s, p) => s + Number(p.attendanceDeduction), 0);

  return (
    <>
      <header className="topbar">
        <div className="crumb">
          <button className="linkact" type="button" onClick={onClose}>← All runs</button>
        </div>
        <div className="titlerow">
          <div>
            <h2 className="page">{monthName(run.periodMonth)} {run.periodYear}</h2>
            <span className="mono" style={{ fontSize: 12, color: 'var(--slate-2)' }}>
              {run.reference}
            </span>
          </div>
          <div className="acts">
            {run.availableActions.filter((a) => a !== 'POST').map((a) => (
              <button key={a} type="button" disabled={busy}
                className={a === 'REJECT' ? 'btn' : 'btn pri'}
                onClick={() => handle(a)}>
                {ACTION_LABEL[a]}
              </button>
            ))}
            {run.status === 'APPROVED' && can('payroll.post') ? (
              <button className="btn pri" type="button" disabled={busy}
                onClick={() => {
                  if (confirm(
                    'Post to the general ledger? This writes a journal entry that ' +
                    'cannot be edited afterwards — only reversed.',
                  )) post.mutate();
                }}>
                Post to ledger
              </button>
            ) : null}
            {(run.status === 'DRAFT' || run.status === 'REJECTED')
              && can('payroll.prepare') ? (
              <button className="btn" type="button" disabled={busy}
                onClick={() => {
                  if (confirm('Discard this run? The payslips will be deleted.')) drop.mutate();
                }}>
                Discard
              </button>
            ) : null}
          </div>
        </div>
        <nav className="tabs">
          <button type="button" className={`tab${tab === 'payslips' ? ' on' : ''}`}
            onClick={() => setTab('payslips')}>Payslips</button>
          <button type="button" className={`tab${tab === 'schedule' ? ' on' : ''}`}
            onClick={() => setTab('schedule')}>Payment schedule</button>
          <button type="button" className={`tab${tab === 'trail' ? ' on' : ''}`}
            onClick={() => setTab('trail')}>Approval trail</button>
        </nav>
      </header>

      <div className="body">
        {error ? <div className="dbanner err" style={{ marginBottom: 14 }}>{error}</div> : null}

        {run.rejectionReason && run.status === 'REJECTED' ? (
          <div className="dbanner err" style={{ marginBottom: 14 }}>
            <b>Rejected:</b> {run.rejectionReason}
          </div>
        ) : null}

        <div className="stagebar">
          {STAGES.map((s, i) => (
            <div key={s.key}
              className={`stage${i < stageIndex ? ' done' : ''}${i === stageIndex ? ' now' : ''}`}>
              <span className="stagedot" />
              <div>
                <b>{s.label}</b>
                <em>{s.by}</em>
              </div>
            </div>
          ))}
        </div>

        <div className="runsummary">
          <div><span>Gross earned</span><b className="mono">{naira(run.totalGross)}</b></div>
          <div><span>PAYE</span><b className="mono">{naira(run.totalPaye)}</b></div>
          <div><span>Pension (EE + ER)</span><b className="mono">
            {naira(String(Number(run.totalPensionEmployee) + Number(run.totalPensionEmployer)))}
          </b></div>
          <div className="net"><span>Net pay</span><b className="mono">{naira(run.totalNet)}</b></div>
        </div>

        {totalDeducted > 0 ? (
          <p className="fnote">
            {naira(String(totalDeducted))} was withheld for absence across this period.
            Because that reduces gross rather than net, the PAYE and pension above are
            already assessed on what was actually earned.
          </p>
        ) : null}

        {tab === 'payslips' ? (
          <div className="fsection">
            <div className="tablewrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="num">Contracted</th>
                    <th className="num">Absence</th>
                    <th className="num">Earned gross</th>
                    <th className="num">PAYE</th>
                    <th className="num">Pension</th>
                    <th className="num">Net pay</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {run.payslips.map((p: PayslipRow) => (
                    <>
                      <tr key={p.id}>
                        <td>
                          <b>{p.employee.firstName} {p.employee.lastName}</b>
                          <em className="mono">{p.employee.staffId}</em>
                        </td>
                        <td className="num mono">{naira(p.contractedGross)}</td>
                        <td className={`num mono${Number(p.attendanceDeduction) > 0 ? ' bad' : ''}`}>
                          {Number(p.attendanceDeduction) > 0
                            ? `−${naira(p.attendanceDeduction)}`
                            : '—'}
                        </td>
                        <td className="num mono">{naira(p.monthlyGross)}</td>
                        <td className="num mono">{naira(p.paye)}</td>
                        <td className="num mono">{naira(p.pensionEmployee)}</td>
                        <td className="num mono"><b>{naira(p.netPay)}</b></td>
                        <td className="num">
                          <button className="linkact" type="button"
                            onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
                            {expanded === p.id ? 'Hide' : 'Breakdown'}
                          </button>
                        </td>
                      </tr>
                      {expanded === p.id ? (
                        <tr key={`${p.id}-detail`}>
                          <td colSpan={8} className="slipdetail">
                            <div className="slipgrid">
                              <div>
                                <span className="photolabel">Earnings</span>
                                <dl>
                                  <dt>Basic (40%)</dt><dd className="mono">{naira(p.basicSalary)}</dd>
                                  <dt>Housing (25%)</dt><dd className="mono">{naira(p.housingAllowance)}</dd>
                                  <dt>Transport (15%)</dt><dd className="mono">{naira(p.transportAllowance)}</dd>
                                  <dt>Utility (10%)</dt><dd className="mono">{naira(p.utilityAllowance)}</dd>
                                  <dt>Meal (10%)</dt><dd className="mono">{naira(p.mealAllowance)}</dd>
                                </dl>
                              </div>
                              <div>
                                <span className="photolabel">Deductions</span>
                                <dl>
                                  <dt>PAYE</dt><dd className="mono">{naira(p.paye)}</dd>
                                  <dt>Pension 8%</dt><dd className="mono">{naira(p.pensionEmployee)}</dd>
                                  {Number(p.nhf) > 0 ? (
                                    <><dt>NHF 2.5%</dt><dd className="mono">{naira(p.nhf)}</dd></>
                                  ) : null}
                                  <dt><b>Total</b></dt>
                                  <dd className="mono"><b>{naira(p.totalDeductions)}</b></dd>
                                </dl>
                              </div>
                              <div>
                                <span className="photolabel">Attendance</span>
                                <dl>
                                  <dt>Working days</dt><dd className="mono">{p.workingDays}</dd>
                                  <dt>Days absent</dt><dd className="mono">{p.daysAbsent}</dd>
                                  <dt>Days forfeited</dt><dd className="mono">{p.daysForfeited}</dd>
                                  <dt>Deduction</dt>
                                  <dd className="mono">{naira(p.attendanceDeduction)}</dd>
                                </dl>
                              </div>
                              <div>
                                <span className="photolabel">Paid outside payroll</span>
                                <dl>
                                  <dt>Job-related allowance</dt>
                                  <dd className="mono">{naira(p.peculiarAllowance)}</dd>
                                </dl>
                                <p className="fnote" style={{ padding: '8px 0 0' }}>
                                  Not taxed here. Paid as a reimbursement.
                                </p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === 'schedule' ? (
          <div className="fsection">
            <h4>Bank transfer schedule</h4>
            {schedule?.missingBankDetails.length ? (
              <div className="dbanner err" style={{ margin: '0 0 14px' }}>
                <b>Missing bank details:</b> {schedule.missingBankDetails.join(', ')}.
                These cannot be paid until their account is recorded.
              </div>
            ) : null}
            <div className="tablewrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Employee</th><th>Bank</th><th>Account</th>
                    <th className="num">Net pay</th><th className="num">Allowance</th>
                  </tr>
                </thead>
                <tbody>
                  {(schedule?.lines ?? []).map((l) => (
                    <tr key={l.staffId}>
                      <td><b>{l.name}</b><em className="mono">{l.staffId}</em></td>
                      <td>{l.bankName ?? <span className="tag warn">Not set</span>}</td>
                      <td className="mono">{l.accountNumber ?? '—'}</td>
                      <td className="num mono"><b>{naira(l.amount)}</b></td>
                      <td className="num mono">
                        {Number(l.peculiarAllowance) > 0 ? naira(l.peculiarAllowance) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === 'trail' ? (
          <div className="fsection">
            <h4>Approval trail</h4>
            {!run.approvals.length ? (
              <p className="fnote" style={{ padding: 0 }}>Nothing recorded yet.</p>
            ) : (
              <ul className="typelist">
                {run.approvals.map((a) => (
                  <li key={a.id}>
                    <div className="typemain">
                      <b>{a.action.replace('_', ' ').toLowerCase()}</b>
                      <em>
                        {a.actorRole} · {a.fromStatus} → {a.toStatus} ·{' '}
                        {new Date(a.createdAt).toLocaleString('en-NG')}
                      </em>
                      {a.remarks ? (
                        <div className="typetags"><span className="tag">{a.remarks}</span></div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="fnote">
              Each stage must be signed by a different person. Nobody can review
              their own preparation or approve their own review.
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}