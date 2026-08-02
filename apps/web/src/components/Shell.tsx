import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth-context';

const NAV = [
  { group: 'Overview', items: [{ label: 'Dashboard', on: false }] },
  {
    group: 'People',
    items: [
      { label: 'Employees', on: true },
      { label: 'Leave & attendance', on: false },
      { label: 'Employee files', on: false },
    ],
  },
  {
    group: 'Payroll',
    items: [
      { label: 'Monthly runs', on: false },
      { label: 'PAYE & pension', on: false },
    ],
  },
  {
    group: 'Finance',
    items: [
      { label: 'General ledger', on: false },
      { label: 'Vouchers', on: false },
      { label: 'Reports', on: false },
    ],
  },
];

export default function Shell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
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

        {NAV.map((section) => (
          <div className="navgroup" key={section.group}>
            <p>{section.group}</p>
            <nav className="nav">
              {section.items.map((item) => (
                <a href="#" key={item.label} className={item.on ? 'on' : undefined}>
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        ))}

        <div className="railfoot">
          <div className="av">{initials}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <b style={{ textTransform: 'capitalize' }}>{label}</b>
            <small>{user?.roles.join(', ')}</small>
          </div>
          <button className="signout" onClick={() => signOut()} title="Sign out">
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
