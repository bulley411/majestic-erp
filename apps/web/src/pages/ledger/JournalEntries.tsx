import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJournalEntries, type JournalEntry } from '../../lib/api';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'info',
  POSTED: 'ok',
  REVERSED: 'warn',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  POSTED: 'Posted',
  REVERSED: 'Reversed',
};

const naira = (v: string) =>
  '₦' + Number(v).toLocaleString('en-NG', { minimumFractionDigits: 2 });

function EntryRow({ entry, onSelect }: { entry: JournalEntry; onSelect: (id: string) => void }) {
  const totalDebit = entry.lines.reduce((sum, l) => sum + Number(l.debit), 0);
  const totalCredit = entry.lines.reduce((sum, l) => sum + Number(l.credit), 0);

  return (
    <li
      className="entry-row"
      onClick={() => onSelect(entry.id)}
      tabIndex={0}
      role="button"
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(entry.id); }}
    >
      <div className="entry-main">
        <div className="entry-header">
          <b className="mono">{entry.reference}</b>
          <span className={`tag ${STATUS_COLORS[entry.status] || ''}`}>
            {STATUS_LABELS[entry.status] || entry.status}
          </span>
          <span className="entry-date">
            {new Date(entry.date).toLocaleDateString('en-NG')}
          </span>
        </div>
        <em>{entry.narration}</em>
        <div className="entry-meta">
          <span className="tag info">{entry.sourceType}</span>
          <span className="tag">
            {entry.lines.length} lines
          </span>
          {entry.period ? (
            <span className="tag">
              {entry.period.month}/{entry.period.year}
            </span>
          ) : null}
        </div>
      </div>
      <div className="entry-totals">
        <span className="entry-total">
          <span className="mono">{naira(String(totalDebit))}</span>
          <small>debit</small>
        </span>
        <span className="entry-total">
          <span className="mono">{naira(String(totalCredit))}</span>
          <small>credit</small>
        </span>
      </div>
    </li>
  );
}

export default function JournalEntries({
  onSelect,
}: {
  onSelect: (id: string) => void;
}) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [status, setStatus] = useState('');
  const [sourceType, setSourceType] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['journal-entries', fromDate, toDate, status, sourceType],
    queryFn: () => getJournalEntries({
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      status: status || undefined,
      sourceType: sourceType || undefined,
    }),
  });

  if (isLoading) return <div className="loading">Loading entries…</div>;
  if (error) return <div className="error">Could not load entries.</div>;

  return (
    <>
      <div className="regbar">
        <label className="ffield" style={{ maxWidth: 150 }}>
          <span>From</span>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label className="ffield" style={{ maxWidth: 150 }}>
          <span>To</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <label className="ffield" style={{ maxWidth: 130 }}>
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="DRAFT">Draft</option>
            <option value="POSTED">Posted</option>
            <option value="REVERSED">Reversed</option>
          </select>
        </label>
        <label className="ffield" style={{ maxWidth: 150 }}>
          <span>Source</span>
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
            <option value="">All</option>
            <option value="payroll_run">Payroll</option>
            <option value="voucher">Voucher</option>
            <option value="reversal">Reversal</option>
          </select>
        </label>
        <div className="regmeta">
          <span className="tag">{data?.length || 0} entries</span>
        </div>
      </div>

      <div className="fsection">
        {!data?.length ? (
          <p className="fnote" style={{ padding: 0 }}>No journal entries found.</p>
        ) : (
          <ul className="entry-list">
            {data.map((entry) => (
              <EntryRow key={entry.id} entry={entry} onSelect={onSelect} />
            ))}
          </ul>
        )}
      </div>

      <p className="fnote">
        Posted entries are immutable and cannot be edited. Reversing creates
        a new entry with debits and credits swapped.
      </p>
    </>
  );
}