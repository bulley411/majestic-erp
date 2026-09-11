import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listBudgets, setBudgetStatus, deleteBudget,
  ApiError, type Budget,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';
import BudgetForm from './budgets/BudgetForm';
import BudgetDetail from './budgets/BudgetDetail';

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
  '₦' + Number(v).toLocaleString('en-NG', { minimumFractionDigits: 2 });

export default function Budgets() {
  const { can } = useAuth();
  const canManage = can('budget.manage');
  const qc = useQueryClient();

  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: budgets, isLoading } = useQuery({
    queryKey: ['budgets', year, status],
    queryFn: () => listBudgets(year, status || undefined),
  });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['budgets'] });
    qc.invalidateQueries({ queryKey: ['budget-summary'] });
    setCreating(false);
    setEditingId(null);
    setError(null);
  };

  const fail = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : 'Something went wrong.');

  const setStatusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: any }) =>
      setBudgetStatus(id, status),
    onSuccess: done,
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: deleteBudget,
    onSuccess: done,
    onError: fail,
  });

  // Show detail view
  if (viewingId) {
    return <BudgetDetail budgetId={viewingId} onClose={() => setViewingId(null)} />;
  }

  // Show create/edit form
  if (creating || editingId) {
    return (
      <BudgetForm
        budgetId={editingId}
        onClose={() => { setCreating(false); setEditingId(null); }}
        onSaved={(b) => {
          done();
          setViewingId(b.id);
        }}
      />
    );
  }

  const activeBudget = budgets?.find((b: Budget) => b.status === 'ACTIVE');

  return (
    <>
      <header className="topbar">
        <div className="crumb">Finance</div>
        <div className="titlerow">
          <h2 className="page">
            Budgets
            <span className="count">
              {isLoading ? 'Loading…' : `${budgets?.length || 0} budget(s)`}
            </span>
          </h2>
          {canManage ? (
            <div className="acts">
              <button className="btn pri" type="button" onClick={() => setCreating(true)}>
                New budget
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="filters">
        <label className="ffield" style={{ maxWidth: 130 }}>
          <span>Year</span>
          <input
            type="number"
            value={year}
            min={2020}
            max={2100}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
        <label className="ffield" style={{ maxWidth: 150 }}>
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
        <div className="regmeta">
          {activeBudget ? (
            <span className="tag ok">Active: {activeBudget.name}</span>
          ) : (
            <span className="tag warn">No active budget for {year}</span>
          )}
        </div>
      </div>

      <div className="body">
        {error ? <div className="dbanner err" style={{ marginBottom: 14 }}>{error}</div> : null}

        {!budgets?.length && !isLoading ? (
          <div className="empty">
            <h3>No budgets found</h3>
            <p>Create a comprehensive budget for the year to start tracking spending.</p>
          </div>
        ) : null}

        {budgets?.length ? (
          <div className="fsection">
            <ul className="typelist">
              {budgets.map((b: Budget) => (
                <li key={b.id} className={b.status !== 'ACTIVE' ? 'inactive' : undefined}>
                  <div className="typemain">
                    <b>
                      {b.name}{' '}
                      <span className="mono" style={{ fontSize: 12, color: 'var(--slate-2)' }}>
                        ({b.year})
                      </span>
                    </b>
                    <em>
                      Total budget: <b className="mono">{naira(b.totalBudget)}</b>
                      {b._count?.lines ? ` · ${b._count.lines} line(s)` : ''}
                    </em>
                    <div className="typetags">
                      <span className={`tag ${STATUS_COLORS[b.status]}`}>
                        {STATUS_LABELS[b.status]}
                      </span>
                    </div>
                  </div>
                  <div className="typeacts">
                    <button
                      className="linkact"
                      type="button"
                      onClick={() => setViewingId(b.id)}
                    >
                      View
                    </button>
                    {canManage && b.status === 'DRAFT' ? (
                      <button
                        className="linkact"
                        type="button"
                        onClick={() => setEditingId(b.id)}
                      >
                        Edit
                      </button>
                    ) : null}
                    {canManage && b.status === 'DRAFT' ? (
                      <button
                        className="linkact"
                        type="button"
                        disabled={setStatusMut.isPending}
                        onClick={() => {
                          if (confirm(`Activate "${b.name}"? This will close any other active budget for ${b.year}.`)) {
                            setStatusMut.mutate({ id: b.id, status: 'ACTIVE' });
                          }
                        }}
                      >
                        Activate
                      </button>
                    ) : null}
                    {canManage && b.status === 'ACTIVE' ? (
                      <button
                        className="linkact"
                        type="button"
                        disabled={setStatusMut.isPending}
                        onClick={() => {
                          if (confirm(`Close "${b.name}"? This will lock it from further edits.`)) {
                            setStatusMut.mutate({ id: b.id, status: 'CLOSED' });
                          }
                        }}
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
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="fnote">
          One comprehensive budget per year. Set up budget lines per category, then activate
          it. Voucher spending will automatically be tracked against the active budget.
        </p>
      </div>
    </>
  );
}