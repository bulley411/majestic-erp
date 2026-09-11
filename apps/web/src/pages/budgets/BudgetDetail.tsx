import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getBudget, getBudgetVsActual, getMonthlyAnalysis } from '../../lib/api';

const naira = (v: string | number) =>
  '₦' + Number(v).toLocaleString('en-NG', { minimumFractionDigits: 2 });

const pct = (v: string | number) => Number(v).toFixed(1) + '%';

export default function BudgetDetail({
  budgetId,
  onClose,
}: {
  budgetId: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'overview' | 'variance' | 'monthly'>('overview');

  const { data: budget, isLoading } = useQuery({
    queryKey: ['budget', budgetId],
    queryFn: () => getBudget(budgetId),
  });

  const { data: vsActual } = useQuery({
    queryKey: ['budget-vs-actual', budgetId],
    queryFn: () => getBudgetVsActual(budgetId),
    enabled: tab === 'variance' || tab === 'overview',
  });

  const { data: monthly } = useQuery({
    queryKey: ['budget-monthly', budget?.year],
    queryFn: () => getMonthlyAnalysis(budget?.year),
    enabled: tab === 'monthly' && !!budget,
  });

  if (isLoading || !budget) return <div className="loading">Loading budget…</div>;

  const totals = vsActual?.totals;
  const lines = vsActual?.lines ?? [];

  return (
    <>
      <header className="topbar">
        <div className="crumb">
          <button className="linkact" type="button" onClick={onClose}>← Budgets</button>
        </div>
        <div className="titlerow">
          <div>
            <h2 className="page">{budget.name}</h2>
            <span className="mono" style={{ fontSize: 12, color: 'var(--slate-2)' }}>
              {budget.year} · {budget.status}
            </span>
          </div>
        </div>
        <nav className="tabs">
          <button
            type="button"
            className={`tab${tab === 'overview' ? ' on' : ''}`}
            onClick={() => setTab('overview')}
          >
            Overview
          </button>
          <button
            type="button"
            className={`tab${tab === 'variance' ? ' on' : ''}`}
            onClick={() => setTab('variance')}
          >
            Budget vs Actual
          </button>
          <button
            type="button"
            className={`tab${tab === 'monthly' ? ' on' : ''}`}
            onClick={() => setTab('monthly')}
          >
            Monthly Analysis
          </button>
        </nav>
      </header>

      <div className="body">
        {tab === 'overview' && totals ? (
          <>
            <div className="runsummary">
              <div>
                <span>Total Budget</span>
                <b className="mono">{naira(totals.budgeted)}</b>
              </div>
              <div>
                <span>Spent</span>
                <b className="mono">{naira(totals.spent)}</b>
              </div>
              <div>
                <span>Committed</span>
                <b className="mono">{naira(totals.committed)}</b>
              </div>
              <div className="net">
                <span>Remaining</span>
                <b className="mono">{naira(totals.remaining)}</b>
              </div>
            </div>

            <div className="fsection">
              <h4>Budget utilisation</h4>
              <p className="fnote" style={{ padding: '0 0 12px' }}>
                {pct(totals.percentUsed)} of the total budget has been spent.
              </p>
              <div className="budget-bar">
                <div
                  className={`budget-bar-fill${Number(totals.percentUsed) > 100 ? ' over' : ''}`}
                  style={{
                    width: Math.min(Number(totals.percentUsed), 100) + '%',
                  }}
                />
              </div>
            </div>
          </>
        ) : null}

        {tab === 'variance' && totals ? (
          <div className="fsection">
            <h4>Budget vs Actual — by category</h4>
            <div className="tablewrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Account</th>
                    <th className="num">Budgeted</th>
                    <th className="num">Spent</th>
                    <th className="num">Committed</th>
                    <th className="num">Remaining</th>
                    <th className="num">Used</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <b>{l.itemName}</b>
                        <em className="mono">{l.categoryName}</em>
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {l.accountCode ? `${l.accountCode} - ${l.accountName}` : '—'}
                      </td>
                      <td className="num mono">{naira(l.budgeted)}</td>
                      <td className={`num mono${l.isOverBudget ? ' bad' : ''}`}>
                        {naira(l.spent)}
                      </td>
                      <td className="num mono">{naira(l.committed)}</td>
                      <td className="num mono">{naira(l.remaining)}</td>
                      <td className={`num mono${l.isOverBudget ? ' bad' : ''}`}>
                        {pct(l.percentUsed)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}><b>Total</b></td>
                    <td className="num mono"><b>{naira(totals.budgeted)}</b></td>
                    <td className="num mono"><b>{naira(totals.spent)}</b></td>
                    <td className="num mono"><b>{naira(totals.committed)}</b></td>
                    <td className="num mono"><b>{naira(totals.remaining)}</b></td>
                    <td className="num mono"><b>{pct(totals.percentUsed)}</b></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : null}

        {tab === 'monthly' && monthly ? (
          <div className="fsection">
            <h4>Monthly spending — {monthly.year}</h4>
            <div className="tablewrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">Vouchers</th>
                    <th className="num">Amount spent</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.months.map((m: any) => (
                    <tr key={m.month}>
                      <td>{m.monthName}</td>
                      <td className="num">{m.count}</td>
                      <td className="num mono">{naira(m.spent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}