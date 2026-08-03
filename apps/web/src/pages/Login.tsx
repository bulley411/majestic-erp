import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth-context';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="authpage">
      <div className="authpanel">
        <div className="authbrand">
          <div className="crest">M</div>
          <div>
            <h1>Majestic APA</h1>
            <span>Limited</span>
          </div>
        </div>

        <h2 className="authtitle">Sign in</h2>
        <p className="authsub">Enterprise resource planning</p>

        <form onSubmit={submit} noValidate>
          <label className="field">
            <span>Email address</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error ? (
            <div className="autherr" role="alert">
              {error}
            </div>
          ) : null}

          <button className="btn pri authbtn" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="authfoot">
          Confidential system. Access is logged.
        </p>
      </div>
    </div>
  );
}
