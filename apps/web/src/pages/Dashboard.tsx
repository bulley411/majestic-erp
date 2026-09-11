import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth-context';
import {
  getBudgetSummary, listVouchers, listPayrollRuns, listEmployees,
} from '../lib/api';

const naira = (v: string | number) =>
  '₦' + Number(v).toLocaleString('en-NG', { minimumFractionDigits: 0 });

const pct = (v: string | number) => Number(v).toFixed(1) + '%';

export default function Dashboard() {
  const { user } = useAuth();
  const year = new Date().getUTCFullYear();

  const { data: budget } = useQuery({
    queryKey: ['budget-summary', year],
    queryFn: () => getBudgetSummary(year),
  });

  const { data: vouchers } = useQuery({
    queryKey: ['vouchers', '', '', '', ''],
    queryFn: () => listVouchers({}),
  });

  const { data: payrollRuns } = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: listPayrollRuns,
  });

  const { data: employees } = useQuery({
    queryKey: ['employees', ''],
    queryFn: () => listEmployees(''),
  });

  const pendingVouchers = (vouchers ?? []).filter((v) => v.status === 'PENDING_APPROVAL');
  const activeEmployees = (employees ?? []).filter((e) => e.status === 'ACTIVE').length;

  return (
    <>
      <header className="topbar">
        <div className="crumb">Overview</div>
        <div className="titlerow">
          <h2 className="page">
            Dashboard
            <span className="count">
              Welcome back, {user?.email.split('@')[0]}
            </span>
          </h2>
        </div>
      </header>

      <div className="body">
        {/* Budget summary */}
        {budget?.budget ? (
          <div className="dash-section">
            <div className="dash-header">
              <h4>Budget — {budget.year}</h4>
              <span className={`tag ${budget.budget.status === 'ACTIVE' ? 'ok' : 'info'}`}>
                {budget.budget.status}
              </span>
            </div>

            <div className="runsummary">
              <div>
                <span>Total Budget</span>
                <b className="mono">{naira(budget.budget.totalBudget)}</b>
              </div>
              <div>
                <span>Spent</span>
                <b className="mono">{naira(budget.budget.totalSpent)}</b>
              </div>
              <div>
                <span>Committed</span>
                <b className="mono">{naira(budget.budget.totalCommitted)}</b>
              </div>
              <div className="net">
                <span>Remaining</span>
                <b className="mono">{naira(budget.budget.totalRemaining)}</b>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="photolabel">Utilisation</span>
                <span className="mono" style={{ fontSize: 12 }}>
                  {pct(budget.budget.percentUsed)}
                </span>
              </div>
              <div className="budget-bar">
                <div
                  className={`budget-bar-fill${Number(budget.budget.percentUsed) > 100 ? ' over' : ''}`}
                  style={{ width: Math.min(Number(budget.budget.percentUsed), 100) + '%' }}
                />
              </div>
            </div>

            {/* Top 5 categories */}
            {budget.lines ? (
              <div className="tablewrap" style={{ marginTop: 16 }}>
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th className="num">Budgeted</th>
                      <th className="num">Spent</th>
                      <th className="num">Remaining</th>
                      <th className="num">Used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {budget.lines.slice(0, 5).map((l) => (
                      <tr key={l.id}>
                        <td><b>{l.itemName}</b></td>
                        <td className="num mono">{naira(l.budgeted)}</td>
                        <td className={`num mono${l.isOverBudget ? ' bad' : ''}`}>
                          {naira(l.spent)}
                        </td>
                        <td className="num mono">{naira(l.remaining)}</td>
                        <td className={`num mono${l.isOverBudget ? ' bad' : ''}`}>
                          {pct(l.percentUsed)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="empty">
            <h3>No active budget</h3>
            <p>Create a budget for {year} to start tracking spending.</p>
          </div>
        )}

        {/* KPI cards */}
        <div className="dash-grid">
          <div className="dash-card">
            <span className="dash-label">Active employees</span>
            <b className="dash-value">{activeEmployees}</b>
          </div>

          <div className="dash-card">
            <span className="dash-label">Pending vouchers</span>
            <b className="dash-value">{pendingVouchers.length}</b>
            {pendingVouchers.length > 0 ? (
              <em className="dash-sub">
                Total: {naira(pendingVouchers.reduce((s, v) => s + Number(v.amount), 0))}
              </em>
            ) : null}
          </div>

          <div className="dash-card">
            <span className="dash-label">Payroll runs</span>
            <b className="dash-value">{payrollRuns?.length ?? 0}</b>
          </div>

          <div className="dash-card">
            <span className="dash-label">Total vouchers</span>
            <b className="dash-value">{vouchers?.length ?? 0}</b>
          </div>
        </div>
      </div>
    </>
  );
}