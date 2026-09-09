import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getIncomeStatement, getBalanceSheet, getPeriods } from '../../lib/api';

const naira = (v: string) =>
  '₦' + Number(v).toLocaleString('en-NG', { minimumFractionDigits: 2 });

function Section({ title, items }: { title: string; items: { code: string; name: string; amount: string }[] }) {
  const total = items.reduce((sum, i) => sum + Number(i.amount), 0);

  if (!items.length) return null;

  return (
    <div className="fin-section">
      <h5>{title}</h5>
      {items.map((item) => (
        <div key={item.code} className="fin-row">
          <span>{item.name}</span>
          <span className="mono">{naira(item.amount)}</span>
        </div>
      ))}
      <div className="fin-total">
        <span><b>Total {title}</b></span>
        <span className="mono"><b>{naira(String(total))}</b></span>
      </div>
    </div>
  );
}

export default function FinancialStatements({ type }: { type: 'income' | 'balance' }) {
  const [periodId, setPeriodId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [asAt, setAsAt] = useState(new Date().toISOString().slice(0, 10));

  const { data: periods } = useQuery({
    queryKey: ['periods'],
    queryFn: () => getPeriods(),
  });

  const incomeQuery = useQuery({
    queryKey: ['income-statement', periodId, fromDate, toDate],
    queryFn: () => getIncomeStatement(fromDate || undefined, toDate || undefined, periodId || undefined),
    enabled: type === 'income',
  });

  const balanceQuery = useQuery({
    queryKey: ['balance-sheet', periodId, asAt],
    queryFn: () => getBalanceSheet(asAt || undefined, periodId || undefined),
    enabled: type === 'balance',
  });

  const isLoading = type === 'income' ? incomeQuery.isLoading : balanceQuery.isLoading;
  const error = type === 'income' ? incomeQuery.error : balanceQuery.error;
  const data = type === 'income' ? incomeQuery.data : balanceQuery.data;

  if (isLoading) return <div className="loading">Loading…</div>;
  if (error) return <div className="error">Could not load statement.</div>;

  // Income Statement
  if (type === 'income' && data) {
    const d = data as any;
    return (
      <>
        <div className="regbar">
          <label className="ffield" style={{ maxWidth: 200 }}>
            <span>Period</span>
            <select
              value={periodId}
              onChange={(e) => { setPeriodId(e.target.value); setFromDate(''); setToDate(''); }}
            >
              <option value="">Custom range</option>
              {periods?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.month}/{p.year} {p.isClosed ? '🔒' : '📂'}
                </option>
              ))}
            </select>
          </label>
          {!periodId ? (
            <>
              <label className="ffield" style={{ maxWidth: 150 }}>
                <span>From</span>
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </label>
              <label className="ffield" style={{ maxWidth: 150 }}>
                <span>To</span>
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </label>
            </>
          ) : null}
        </div>

        <div className="fsection">
          <h4>Income Statement</h4>
          <p className="fnote" style={{ padding: '0 0 12px' }}>Period: {d.period}</p>

          <Section title="Income" items={d.income || []} />

          <div style={{ margin: '16px 0' }} />

          <Section title="Expenses" items={d.expenses || []} />

          <div className="fin-net">
            <span><b>Net Income</b></span>
            <span className={`mono ${Number(d.summary.netIncome) >= 0 ? '' : 'bad'}`}>
              <b>{naira(d.summary.netIncome)}</b>
            </span>
          </div>
        </div>
      </>
    );
  }

  // Balance Sheet
  if (type === 'balance' && data) {
    const d = data as any;
    return (
      <>
        <div className="regbar">
          <label className="ffield" style={{ maxWidth: 200 }}>
            <span>As at date</span>
            <input
              type="date"
              value={asAt}
              onChange={(e) => { setAsAt(e.target.value); setPeriodId(''); }}
            />
          </label>
          <span style={{ color: 'var(--slate-2)', fontSize: 12 }}>OR</span>
          <label className="ffield" style={{ maxWidth: 200 }}>
            <span>Period</span>
            <select
              value={periodId}
              onChange={(e) => { setPeriodId(e.target.value); setAsAt(''); }}
            >
              <option value="">—</option>
              {periods?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.month}/{p.year} {p.isClosed ? '🔒' : '📂'}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="fsection">
          <h4>Balance Sheet</h4>
          <p className="fnote" style={{ padding: '0 0 12px' }}>As at: {d.asAt}</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div>
              <Section title="Assets" items={d.assets || []} />
            </div>
            <div>
              <Section title="Liabilities" items={d.liabilities || []} />
              <div style={{ marginTop: 16 }} />
              <Section title="Equity" items={d.equity || []} />
            </div>
          </div>

          <div className="fin-balance-summary">
            <div>
              <span><b>Total Assets</b></span>
              <span className="mono"><b>{naira(d.summary.totalAssets)}</b></span>
            </div>
            <div>
              <span><b>Total Liabilities + Equity</b></span>
              <span className="mono"><b>{naira(d.summary.totalLiabilitiesAndEquity)}</b></span>
            </div>
          </div>
        </div>
      </>
    );
  }

  return null;
}