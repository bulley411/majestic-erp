import { useState } from 'react';
import { useAuth } from '../lib/auth-context';
import ExpenseCategoriesPanel from './settings/ExpenseCategoriesPanel';
import BanksPanel from './settings/BanksPanel';
import PayrollAccountsPanel from './settings/PayrollAccountsPanel';

const TABS = [
  { id: 'expense-categories', label: 'Expense categories' },
  { id: 'banks', label: 'Banks' },
  { id: 'payroll-accounts', label: 'Payroll accounts' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function FinanceSettings() {
  const { can } = useAuth();
  const manage = can('settings.manage');
  const [tab, setTab] = useState<TabId>('expense-categories');
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panelProps = { manage, showInactive, onError: setError };

  return (
    <>
      <header className="topbar">
        <div className="crumb">Settings</div>
        <div className="titlerow">
          <h2 className="page">Finance settings</h2>
          <div className="acts">
            {tab !== 'payroll-accounts' ? (
              <label className="inlinecheck">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                />
                Show inactive
              </label>
            ) : null}
          </div>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab${tab === t.id ? ' on' : ''}`}
              onClick={() => { setTab(t.id); setError(null); }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="body">
        {error ? <div className="dbanner err" style={{ marginBottom: 14 }}>{error}</div> : null}

        {tab === 'expense-categories' ? <ExpenseCategoriesPanel {...panelProps} /> : null}
        {tab === 'banks' ? <BanksPanel {...panelProps} /> : null}
        {tab === 'payroll-accounts' ? (
          <PayrollAccountsPanel manage={manage} onError={setError} />
        ) : null}
      </div>
    </>
  );
}