import { AuthProvider, useAuth } from './lib/auth-context';
import Shell from './components/Shell';
import People from './pages/People';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';

function Routed() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="authpage">
        <div className="bootspinner">Loading…</div>
      </div>
    );
  }
  if (!user) return <Login />;
  if (user.mustChangePassword) return <ChangePassword />;

  return (
    <Shell>
      <People />
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
