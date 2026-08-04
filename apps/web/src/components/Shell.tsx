import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth-context';

const NAV: { group: string; items: { label: string; key: string; perm?: string }[] }[] = [
  { group: 'Overview', items: [{ label: 'Dashboard', key: 'dashboard' }] },
  {
    group: 'People',
    items: [
      { label: 'Employees', key: 'people' },
      { label: 'Leave & attendance', key: 'leave' },
    ],
  },
  {
    group: 'Payroll',
    items: [
      { label: 'Monthly runs', key: 'payroll' },
      { label: 'PAYE & pension', key: 'statutory' },
    ],
  },
  {
    group: 'Finance',
    items: [
      { label: 'General ledger', key: 'ledger' },
      { label: 'Vouchers', key: 'vouchers' },
      { label: 'Reports', key: 'reports' },
    ],
  },
  {
    group: 'Settings',
    items: [{ label: 'Document types', key: 'hr-settings', perm: 'employee.read' }],
  },
];

export default function Shell({ children, page, onNavigate }: {
  children: ReactNode;
  page: string;
  onNavigate: (page: string) => void;
}) {
  const { user, signOut, can } = useAuth();
  const label = user?.email.split('@')[0] ?? '';
  const initials = label.slice(0, 2).toUpperCase();

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">
          <div className="crest">M</div>
          <div>
            <h1>Majestic APA</h1>
            <span>Limited</span>
          </div>
        </div>

        {NAV.map((section) => {
          const items = section.items.filter((i) => !i.perm || can(i.perm));
          if (!items.length) return null;
          return (
            <div className="navgroup" key={section.group}>
              <p>{section.group}</p>
              <nav className="nav">
                {items.map((item) => {
                  const active = page === item.key;
                  return (
                    <button key={item.key} type="button"
                      className={active ? 'navitem on' : 'navitem'}
                      onClick={() => onNavigate(item.key)}>
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </div>
          );
        })}

        <div className="railfoot">
          <div className="av">{initials}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <b style={{ textTransform: 'capitalize' }}>{label}</b>
            <small>{user?.roles?.join(', ')}</small>
          </div>
          <button className="signout" type="button" onClick={() => signOut()} title="Sign out">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </button>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}