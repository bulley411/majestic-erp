import { useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth-context';
import Shell from './components/Shell';
import People from './pages/People';
import HrSettings from './pages/HrSettings';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Users from './pages/Users';
import Attendance from './pages/Attendance';

function Placeholder({ title }: { title: string }) {
  return (
    <>
      <header className="topbar">
        <div className="crumb">Coming soon</div>
        <div className="titlerow"><h2 className="page">{title}</h2></div>
      </header>
      <div className="body">
        <div className="empty">
          <h3>Not built yet</h3>
          <p>This module is next in line.</p>
        </div>
      </div>
    </>
  );
}

const TITLES: Record<string, string> = {
  dashboard: 'Dashboard', leave: 'Leave & attendance', payroll: 'Monthly payroll runs',
  statutory: 'PAYE & pension', ledger: 'General ledger', vouchers: 'Vouchers', reports: 'Reports',
};

function Routed() {
  const { user, loading } = useAuth();
  const [page, setPage] = useState('people');

  if (loading) {
    return <div className="authpage"><div className="bootspinner">Loading…</div></div>;
  }
  if (!user) return <Login />;
  if (user.mustChangePassword) return <ChangePassword />;

  return (
    <Shell page={page} onNavigate={setPage}>
      {page === 'people' ? <People />
        : page === 'attendance' ? <Attendance />
        : page === 'hr-settings' ? <HrSettings />
        : page === 'users' ? <Users />
        : <Placeholder title={TITLES[page] ?? 'Module'} />}
    </Shell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routed />
    </AuthProvider>
  );
}