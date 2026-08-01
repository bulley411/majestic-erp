import type { ReactNode } from 'react';

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
          <div className="av">SM</div>
          <div>
            <b>Suleiman</b>
            <small>Administrator</small>
          </div>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}
