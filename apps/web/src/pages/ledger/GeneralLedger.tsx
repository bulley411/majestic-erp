import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getGeneralLedger, getAccounts, type GeneralLedgerEntry } from '../../lib/api';

const naira = (v: string) =>
  '₦' + Number(v).toLocaleString('en-NG', { minimumFractionDigits: 2 });

export default function GeneralLedger() {
  const [accountId, setAccountId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => getAccounts(false),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['general-ledger', accountId, fromDate, toDate],
    queryFn: () => getGeneralLedger(accountId || undefined, fromDate || undefined, toDate || undefined),
  });

  if (isLoading) return <div className="loading">Loading general ledger…</div>;
  if (error) return <div className="error">Could not load general ledger.</div>;

  let runningBalance = 0;

  return (
    <>
      <div className="regbar">
        <label className="ffield" style={{ maxWidth: 250 }}>
          <span>Account</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">All accounts</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} - {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ffield" style={{ maxWidth: 150 }}>
          <span>From</span>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label className="ffield" style={{ maxWidth: 150 }}>
          <span>To</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <div className="regmeta">
          <span className="tag">{data?.count || 0} entries</span>
        </div>
      </div>

      <div className="fsection">
        <div className="tablewrap">
          <table className="dtable">
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference</th>
                <th>Narration</th>
                <th>Account</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {!data?.entries?.length ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--slate-2)' }}>
                    No entries found.
                  </td>
                </tr>
              ) : (
                data.entries.map((entry, i) => {
                  const amount = Number(entry.debit) - Number(entry.credit);
                  runningBalance += amount;
                  const isDebit = Number(entry.debit) > 0;

                  return (
                    <tr key={i}>
                      <td>{new Date(entry.date).toLocaleDateString('en-NG')}</td>
                      <td className="mono">{entry.reference}</td>
                      <td>{entry.narration}</td>
                      <td>
                        <span className="mono">{entry.accountCode}</span>
                        <br />
                        <span style={{ fontSize: 11, color: 'var(--slate-2)' }}>{entry.accountName}</span>
                      </td>
                      <td className="num mono">{isDebit ? naira(entry.debit) : ''}</td>
                      <td className="num mono">{!isDebit ? naira(entry.credit) : ''}</td>
                      <td className="num mono">{naira(String(runningBalance))}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="fnote">
        The general ledger shows all transactions for the selected account(s)
        with a running balance.
      </p>
    </>
  );
}