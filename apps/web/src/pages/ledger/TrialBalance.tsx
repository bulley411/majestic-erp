import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTrialBalance, getPeriods, type TrialBalanceAccount } from '../../lib/api';

const naira = (v: string) =>
  '₦' + Number(v).toLocaleString('en-NG', { minimumFractionDigits: 2 });

function AccountRow({ account }: { account: TrialBalanceAccount }) {
  const balance = Number(account.balance);
  const isDebit = balance > 0;

  return (
    <tr>
      <td className="mono">{account.code}</td>
      <td>{account.name}</td>
      <td>{account.type}</td>
      <td className="num mono">{naira(account.debit)}</td>
      <td className="num mono">{naira(account.credit)}</td>
      <td className={`num mono${balance !== 0 ? (isDebit ? '' : ' bad') : ''}`}>
        {balance !== 0 ? naira(account.balance) : '—'}
      </td>
    </tr>
  );
}

export default function TrialBalance() {
  const [periodId, setPeriodId] = useState('');
  const [asAt, setAsAt] = useState(new Date().toISOString().slice(0, 10));

  const { data: periods } = useQuery({
    queryKey: ['periods'],
    queryFn: () => getPeriods(),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['trial-balance', periodId, asAt],
    queryFn: () => getTrialBalance(asAt || undefined, periodId || undefined),
  });

  if (isLoading) return <div className="loading">Loading trial balance…</div>;
  if (error) return <div className="error">Could not load trial balance.</div>;

  const isBalanced = data?.summary?.isBalanced;

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
        <div className="regmeta">
          <span className="tag">{data?.accounts?.length || 0} accounts</span>
          {isBalanced !== undefined ? (
            <span className={`tag ${isBalanced ? 'ok' : 'warn'}`}>
              {isBalanced ? 'Balanced ✅' : 'Unbalanced ❌'}
            </span>
          ) : null}
        </div>
      </div>

      {data?.summary ? (
        <div className="runsummary" style={{ marginBottom: 14 }}>
          <div>
            <span>Total Debits</span>
            <b className="mono">{naira(data.summary.totalDebit)}</b>
          </div>
          <div>
            <span>Total Credits</span>
            <b className="mono">{naira(data.summary.totalCredit)}</b>
          </div>
          <div className={data.summary.isBalanced ? 'net' : ''} style={data.summary.isBalanced ? { background: 'var(--emerald)', borderRight: 0 } : { background: 'var(--rose)', borderRight: 0 }}>
            <span>Status</span>
            <b style={{ color: '#fff' }}>
              {data.summary.isBalanced ? 'Balanced ✅' : 'Unbalanced ❌'}
            </b>
          </div>
        </div>
      ) : null}

      <div className="fsection">
        <h4>Trial Balance</h4>
        <div className="tablewrap">
          <table className="dtable">
            <thead>
              <tr>
                <th>Code</th>
                <th>Account</th>
                <th>Type</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {!data?.accounts?.length ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--slate-2)' }}>
                    No entries found for this period.
                  </td>
                </tr>
              ) : (
                data.accounts.map((account) => (
                  <AccountRow key={account.accountId} account={account} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="fnote">
        The trial balance lists all accounts with their debit and credit balances.
        Total debits must equal total credits for the books to be balanced.
      </p>
    </>
  );
}