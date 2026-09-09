import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getJournalEntry, reverseJournalEntry, ApiError, type JournalLine } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

const naira = (v: string) =>
  '₦' + Number(v).toLocaleString('en-NG', { minimumFractionDigits: 2 });

function LineRow({ line, index }: { line: JournalLine; index: number }) {
  const amount = Number(line.debit) > 0 ? line.debit : line.credit;
  const isDebit = Number(line.debit) > 0;

  return (
    <tr>
      <td className="num">{index + 1}</td>
      <td className="mono">{line.account.code}</td>
      <td>{line.account.name}</td>
      <td className="num mono">
        {isDebit ? naira(amount) : ''}
      </td>
      <td className="num mono">
        {!isDebit ? naira(amount) : ''}
      </td>
      <td>{line.narration || '—'}</td>
    </tr>
  );
}

export default function JournalEntryDetail({
  entryId,
  onClose,
}: {
  entryId: string;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: entry, isLoading } = useQuery({
    queryKey: ['journal-entry', entryId],
    queryFn: () => getJournalEntry(entryId),
  });

  const reverse = useMutation({
    mutationFn: () => reverseJournalEntry(entryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal-entry', entryId] });
      qc.invalidateQueries({ queryKey: ['journal-entries'] });
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not reverse entry.'),
  });

  if (isLoading || !entry) return <div className="loading">Loading entry…</div>;

  const totalDebit = entry.lines.reduce((sum, l) => sum + Number(l.debit), 0);
  const totalCredit = entry.lines.reduce((sum, l) => sum + Number(l.credit), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const canReverse = can('ledger.post') && entry.status === 'POSTED';

  return (
    <div className="drawerwrap" role="dialog" aria-modal="true">
      <div className="drawerscrim" onClick={onClose} />
      <div className="drawer" style={{ width: 'min(900px, 100%)' }}>
        <header className="dhead">
          <div>
            <div className="crumb">
              <button className="linkact" type="button" onClick={onClose}>← All entries</button>
            </div>
            <h2 className="page">
              {entry.reference}
              <span className="count">
                <span className={`tag ${entry.status === 'POSTED' ? 'ok' : entry.status === 'REVERSED' ? 'warn' : 'info'}`}>
                  {entry.status}
                </span>
              </span>
            </h2>
          </div>
          <div className="acts">
            {canReverse ? (
              <button
                className="btn pri"
                type="button"
                disabled={reverse.isPending}
                onClick={() => {
                  if (confirm(`Reverse ${entry.reference}? This cannot be undone.`)) {
                    reverse.mutate();
                  }
                }}
              >
                {reverse.isPending ? 'Reversing…' : 'Reverse entry'}
              </button>
            ) : null}
            <button className="btn" type="button" onClick={onClose}>Close</button>
          </div>
        </header>

        {error ? <div className="dbanner err">{error}</div> : null}

        <div className="dbody">
          <div className="fsection">
            <div className="entry-detail-header">
              <div>
                <span className="photolabel">Date</span>
                <b>{new Date(entry.date).toLocaleDateString('en-NG')}</b>
              </div>
              <div>
                <span className="photolabel">Period</span>
                <b>{entry.period ? `${entry.period.month}/${entry.period.year}` : '—'}</b>
              </div>
              <div>
                <span className="photolabel">Source</span>
                <b>{entry.sourceType}</b>
                {entry.sourceId ? (
                  <em className="mono">{entry.sourceId}</em>
                ) : null}
              </div>
              <div>
                <span className="photolabel">Posted</span>
                <b>{entry.postedAt ? new Date(entry.postedAt).toLocaleString('en-NG') : '—'}</b>
              </div>
            </div>

            <div className="entry-narration">
              <span className="photolabel">Narration</span>
              <p>{entry.narration}</p>
            </div>
          </div>

          <div className="fsection">
            <h4>Journal Lines</h4>
            <div className="tablewrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Account</th>
                    <th>Name</th>
                    <th className="num">Debit</th>
                    <th className="num">Credit</th>
                    <th>Narration</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.lines.map((line, i) => (
                    <LineRow key={line.id} line={line} index={i} />
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}><b>Totals</b></td>
                    <td className="num mono"><b>{naira(String(totalDebit))}</b></td>
                    <td className="num mono"><b>{naira(String(totalCredit))}</b></td>
                    <td>
                      {isBalanced ? (
                        <span className="tag ok">Balanced ✅</span>
                      ) : (
                        <span className="tag warn">Unbalanced ❌</span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

    {entry.reversesId ? (
  <div className="fsection" style={{ borderLeft: '3px solid var(--brass)' }}>
    <h4>Reversal</h4>
    <p className="fnote" style={{ padding: 0 }}>
      This entry was reversed. The reversal ID is <b className="mono">{entry.reversesId}</b>.
    </p>
  </div>
) : null}

          <p className="fnote">
            Posted entries are immutable and cannot be edited. Use the reverse button
            to create a correcting entry.
          </p>
        </div>
      </div>
    </div>
  );
}