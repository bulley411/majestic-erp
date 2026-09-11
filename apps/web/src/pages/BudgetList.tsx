import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listBudgets, setBudgetStatus, deleteBudget, getBudgetVsActual,
  ApiError, type Budget, type BudgetSummary,
} from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'info',
  ACTIVE: 'ok',
  CLOSED: 'warn',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  CLOSED: 'Closed',
};

const naira = (v: string) =>
  '₦' + Number(v).toLocaleString('en-NG', { maximumFractionDigits: 0 });

const pct = (v: string) => Number(v).toFixed(1) + '%';

export default function BudgetList({ onEdit }: { onEdit: (id: string) => void }) {
  const { can } = useAuth();
  const canManage = can('budget.manage');
  const qc = useQueryClient();
  const [selectedYear, setSelectedYear] = useState<number | undefined>(undefined);
  const [status, setStatus] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: budgets, isLoading } = useQuery({
    queryKey: ['budgets', selectedYear, status],
    queryFn: () => listBudgets(selectedYear, status || undefined),
  });

  const { data: vsActual } = useQuery({
    queryKey: ['budget-vs-actual', expandedId],
    queryFn: () => getBudgetVsActual(expandedId!),
    enabled: !!expandedId,
  });

  const setStatusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'DRAFT' | 'ACTIVE' | 'CLOSED' }) =>
      setBudgetStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] });
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed'),
  });

  const remove = useMutation({
    mutationFn: deleteBudget,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] });
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed'),
  });

  const currentYear = new Date().getUTCFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear + 1 - i);

  if (isLoading) return <div className="loading">Loading budgets…</div>;

  return (
    <>
      {error ? <div className="dbanner err" style={{ marginBottom: 14 }}>{error}</div> : null}

      <div className="regbar">
        <label className="ffield" style={{ maxWidth: 130 }}>
          <span>Year</span>
          <select
            value={selectedYear || ''}
            onChange={(e) => setSelectedYear(e.target.value ? Number(e.target.value) : undefined)}
          >
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <label className="ffield" style={{ maxWidth: 130 }}>
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
        <div className="regmeta">
          <span className="tag">{budgets?.length || 0} budget(s)</span>
        </div>
        {canManage ? (
          <button className="btn pri" type="button" onClick={() => onEdit('new')}>
            New budget
          </button>
        ) : null}
      </div>

      {!budgets?.length ? (
        <div className="empty">
          <h3>No budgets yet</h3>
          <p>Create a budget to track spending against your allocations.</p>
        </div>
      ) : (
        <ul className="budget-list">
          {budgets.map((b) => {
            const isExpanded = expandedId === b.id;
            const summary: BudgetSummary | undefined = isExpanded ? vsActual : undefined;
            const totals = summary?.totals;
            const percentUsed = totals ? Number(totals.percentUsed) : 0;
            const isOver = percentUsed > 100;

            return (
              <li key={b.id} className="budget-card">
                <div className="budget-header">
                  <div className="budget-main">
                    <div className="budget-title">
                      <b>{b.name}</b>
                      <span className={`tag ${STATUS_COLORS[b.status]}`}>
                        {STATUS_LABELS[b.status]}
                      </span>
                      <span className="budget-year">{b.year}</span>
                    </div>
                    <em>{b._count?.lines || 0} line items</em>
                  </div>
                  <div className="budget-totals">
                    <span className="budget-total">
                      <b className="mono">{naira(b.totalBudget)}</b>
                      <small>budget</small>
                    </span>
                  </div>
                  <div className="typeacts">
                    <button
                      className="linkact"
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : b.id)}
                    >
                      {isExpanded ? 'Hide' : 'View'}
                    </button>
                    {canManage && b.status !== 'CLOSED' ? (
                      <button className="linkact" type="button" onClick={() => onEdit(b.id)}>
                        Edit
                      </button>
                    ) : null}
                    {canManage && b.status === 'DRAFT' ? (
                      <button
                        className="linkact"
                        type="button"
                        onClick={() => setStatusMut.mutate({ id: b.id, status: 'ACTIVE' })}
                      >
                        Activate
                      </button>
                    ) : null}
                    {canManage && b.status === 'ACTIVE' ? (
                      <button
                        className="linkact"
                        type="button"
                        onClick={() => setStatusMut.mutate({ id: b.id, status: 'CLOSED' })}
                      >
                        Close
                      </button>
                    ) : null}
                    {canManage && b.status === 'DRAFT' ? (
                      <button
                        className="linkact danger"
                        type="button"
                        onClick={() => {
                          if (confirm(`Delete "${b.name}"? This cannot be undone.`)) {
                            remove.mutate(b.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>

                {isExpanded && totals ? (
                  <div className="budget-expanded">
                    <div className="runsummary">
                      <div>
                        <span>Budgeted</span>
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
                      <div
                        className="net"
                        style={
                          isOver
                            ? { background: 'var(--rose)', borderRight: 0 }
                            : { background: 'var(--emerald)', borderRight: 0 }
                        }
                      >
                        <span>Remaining</span>
                        <b style={{ color: '#fff' }} className="mono">
                          {naira(totals.remaining)}
                        </b>
                      </div>
                    </div>

                    <div className="budget-progress">
                      <div className="budget-progress-bar">
                        <div
                          className="budget-progress-fill"
                          style={{
                            width: `${Math.min(percentUsed, 100)}%`,
                            background: isOver ? 'var(--rose)' : 'var(--emerald)',
                          }}
                        />
                      </div>
                      <span className="budget-progress-label">{pct(totals.percentUsed)} used</span>
                    </div>

                    <div className="tablewrap" style={{ marginTop: 14 }}>
                      <table className="dtable">
                        <thead>
                          <tr>
                            <th>Item</th>
                            <th>Category</th>
                            <th className="num">Budgeted</th>
                            <th className="num">Spent</th>
                            <th className="num">Committed</th>
                            <th className="num">Remaining</th>
                            <th className="num">% Used</th>
                          </tr>
                        </thead>
                        <tbody>
                          {summary?.lines?.map((line) => (
                            <tr key={line.id}>
                              <td><b>{line.itemName}</b></td>
                              <td><em>{line.categoryName}</em></td>
                              <td className="num mono">{naira(line.budgeted)}</td>
                              <td className="num mono">{naira(line.spent)}</td>
                              <td className="num mono">{naira(line.committed)}</td>
                              <td className={`num mono${line.isOverBudget ? ' bad' : ''}`}>
                                {naira(line.remaining)}
                              </td>
                              <td className={`num mono${line.isOverBudget ? ' bad' : ''}`}>
                                {pct(line.percentUsed)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="fnote">
        Budgets track spending against allocations. Only one active budget per year.
        Vouchers check against the active budget before submission.
      </p>
    </>
  );
}