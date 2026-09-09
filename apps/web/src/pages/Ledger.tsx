import { useState } from 'react';
import { useAuth } from '../lib/auth-context';
import ChartOfAccounts from './ledger/ChartOfAccounts';
import JournalEntries from './ledger/JournalEntries';
import JournalEntryDetail from './ledger/JournalEntryDetail';
import TrialBalance from './ledger/TrialBalance';
import FinancialStatements from './ledger/FinancialStatements';
import GeneralLedger from './ledger/GeneralLedger';

const TABS = [
  { id: 'chart', label: 'Chart of Accounts' },
  { id: 'entries', label: 'Journal Entries' },
  { id: 'trial', label: 'Trial Balance' },
  { id: 'income', label: 'Income Statement' },
  { id: 'balance', label: 'Balance Sheet' },
  { id: 'ledger', label: 'General Ledger' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function Ledger() {
  const { can } = useAuth();
  const [tab, setTab] = useState<TabId>('chart');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  // If viewing a specific entry, show detail
  if (selectedEntryId) {
    return (
      <JournalEntryDetail
        entryId={selectedEntryId}
        onClose={() => setSelectedEntryId(null)}
      />
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="crumb">Finance</div>
        <div className="titlerow">
          <h2 className="page">General Ledger</h2>
          <div className="acts">
            {can('ledger.close_period') ? (
              <button className="btn" type="button">
                Periods
              </button>
            ) : null}
          </div>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab${tab === t.id ? ' on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="body">
        {tab === 'chart' ? <ChartOfAccounts /> : null}
        {tab === 'entries' ? <JournalEntries onSelect={setSelectedEntryId} /> : null}
        {tab === 'trial' ? <TrialBalance /> : null}
        {tab === 'income' ? <FinancialStatements type="income" /> : null}
        {tab === 'balance' ? <FinancialStatements type="balance" /> : null}
        {tab === 'ledger' ? <GeneralLedger /> : null}
      </div>
    </>
  );
}