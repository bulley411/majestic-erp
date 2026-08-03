import { useState, type FormEvent } from 'react';
import { changePassword } from '../lib/api';
import { useAuth } from '../lib/auth-context';

/** Rules mirror checkPasswordStrength on the server. */
function weakness(p: string): string | null {
  if (p.length < 12) return 'At least 12 characters.';
  if (!/[a-z]/.test(p)) return 'Include a lowercase letter.';
  if (!/[A-Z]/.test(p)) return 'Include an uppercase letter.';
  if (!/[0-9]/.test(p)) return 'Include a number.';
  const weak = ['password','majestic','majesticapa','mapa','welcome','qwerty','123456','letmein','admin','nigeria','lagos','abuja'];
  if (weak.some((w) => p.toLowerCase().includes(w))) return 'Avoid common or guessable words.';
  return null;
}

export default function ChangePassword() {
  const { refresh, signOut } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const localIssue = next ? weakness(next) : null;
  const mismatch = confirm.length > 0 && next !== confirm;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (localIssue || mismatch) return;
    setBusy(true);
    try {
      await changePassword(current, next);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password.');
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

        <h2 className="authtitle">Set a new password</h2>
        <p className="authsub">Required before you can continue.</p>

        <form onSubmit={submit} noValidate>
          <label className="field">
            <span>Current password</span>
            <input type="password" value={current} autoComplete="current-password"
              onChange={(e) => setCurrent(e.target.value)} required autoFocus />
          </label>

          <label className="field">
            <span>New password</span>
            <input type="password" value={next} autoComplete="new-password"
              onChange={(e) => setNext(e.target.value)} required />
            {localIssue ? <em className="hint warn">{localIssue}</em>
              : next ? <em className="hint good">Looks good.</em> : null}
          </label>

          <label className="field">
            <span>Confirm new password</span>
            <input type="password" value={confirm} autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)} required />
            {mismatch ? <em className="hint warn">Passwords do not match.</em> : null}
          </label>

          {error ? <div className="autherr" role="alert">{error}</div> : null}

          <button className="btn pri authbtn" type="submit"
            disabled={busy || !!localIssue || mismatch || !current}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </form>

        <button className="linkbtn" onClick={() => signOut()}>Sign out instead</button>
      </div>
    </div>
  );
}
