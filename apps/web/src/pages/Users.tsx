import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listUsers, getUserOptions, createUser, setUserRoles, setUserActive,
  setUserEmployee, resetUserPassword, ApiError, type SystemUser,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';

const blank = { email: '', roleIds: [] as string[], employeeId: '' };

/**
 * A temporary password is shown once and never stored in clear, so it has
 * to stay on screen until deliberately dismissed rather than disappearing
 * on the next render.
 */
function PasswordNotice({
  email, password, onDismiss,
}: { email: string; password: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="pwnotice">
      <div>
        <span className="photolabel">Temporary password for {email}</span>
        <b className="mono">{password}</b>
        <em>
          Shown once and not recoverable. Send it to them securely; they must
          change it at first sign in.
        </em>
      </div>
      <div className="acts">
        <button className="btn" type="button"
          onClick={() => {
            navigator.clipboard?.writeText(password);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button className="btn pri" type="button" onClick={onDismiss}>Done</button>
      </div>
    </div>
  );
}

export default function Users() {
  const { can, user: me } = useAuth();
  const manage = can('user.manage');
  const qc = useQueryClient();

  const [draft, setDraft] = useState<typeof blank | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: users, isLoading } = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const { data: options } = useQuery({ queryKey: ['user-options'], queryFn: getUserOptions });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['users'] });
    qc.invalidateQueries({ queryKey: ['user-options'] });
    setDraft(null);
    setEditing(null);
    setError(null);
  };
  const fail = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : 'Something went wrong.');

  const create = useMutation({
    mutationFn: () =>
      createUser({
        email: draft!.email,
        roleIds: draft!.roleIds,
        employeeId: draft!.employeeId || undefined,
      }),
    onSuccess: (r) => { setNotice({ email: r.email, password: r.temporaryPassword }); done(); },
    onError: fail,
  });

  const roles = useMutation({
    mutationFn: ({ id, roleIds }: { id: string; roleIds: string[] }) => setUserRoles(id, roleIds),
    onSuccess: done, onError: fail,
  });

  const active = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => setUserActive(id, isActive),
    onSuccess: done, onError: fail,
  });

  const link = useMutation({
    mutationFn: ({ id, employeeId }: { id: string; employeeId: string | null }) =>
      setUserEmployee(id, employeeId),
    onSuccess: done, onError: fail,
  });

  const reset = useMutation({
    mutationFn: (u: SystemUser) => resetUserPassword(u.id).then((r) => ({ ...r, email: u.email })),
    onSuccess: (r) => { setNotice({ email: r.email, password: r.temporaryPassword }); done(); },
    onError: fail,
  });

  const busy = create.isPending || roles.isPending || active.isPending
    || link.isPending || reset.isPending;

  const toggleRole = (id: string, list: string[], set: (v: string[]) => void) =>
    set(list.includes(id) ? list.filter((r) => r !== id) : [...list, id]);

  return (
    <>
      <header className="topbar">
        <div className="crumb">Settings</div>
        <div className="titlerow">
          <h2 className="page">
            Users
            <span className="count">
              {isLoading ? 'Loading…' : `${users?.length ?? 0} accounts`}
            </span>
          </h2>
          {manage && !draft ? (
            <div className="acts">
              <button className="btn pri" type="button"
                onClick={() => { setDraft(blank); setError(null); }}>
                Add user
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="body">
        {error ? <div className="dbanner err" style={{ marginBottom: 14 }}>{error}</div> : null}

        {notice ? (
          <PasswordNotice email={notice.email} password={notice.password}
            onDismiss={() => setNotice(null)} />
        ) : null}

        {draft ? (
          <div className="fsection">
            <h4>New user</h4>
            <div className="fgrid">
              <label className="ffield span2">
                <span>Email address<b> *</b></span>
                <input type="email" value={draft.email} autoFocus
                  placeholder="name@majesticpensionagent.com"
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              </label>
              <label className="ffield span2">
                <span>Link to employee record</span>
                <select value={draft.employeeId}
                  onChange={(e) => setDraft({ ...draft, employeeId: e.target.value })}>
                  <option value="">Not linked</option>
                  {(options?.employees ?? []).map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.firstName} {emp.lastName} ({emp.staffId})
                    </option>
                  ))}
                </select>
                <em className="fhint">Only employees without an account are listed</em>
              </label>
            </div>

            <div style={{ marginTop: 14 }}>
              <span className="photolabel">Roles<b style={{ color: 'var(--rose)' }}> *</b></span>
              <div className="rolegrid">
                {(options?.roles ?? []).map((r) => (
                  <label key={r.id} className="rolecard">
                    <input type="checkbox" checked={draft.roleIds.includes(r.id)}
                      onChange={() =>
                        toggleRole(r.id, draft.roleIds,
                          (v) => setDraft({ ...draft, roleIds: v }))} />
                    <div>
                      <b>{r.name}</b>
                      <em>
                        {r.permissions.length
                          ? `${r.permissions.length} permissions`
                          : 'No permissions'}
                      </em>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="acts" style={{ marginTop: 14 }}>
              <button className="btn pri" type="button"
                disabled={busy || !draft.email.includes('@') || !draft.roleIds.length}
                onClick={() => create.mutate()}>
                {create.isPending ? 'Creating…' : 'Create user'}
              </button>
              <button className="btn" type="button"
                onClick={() => { setDraft(null); setError(null); }}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="fsection">
          <h4>Accounts</h4>
          {!users?.length ? (
            <p className="fnote" style={{ padding: 0 }}>No accounts yet.</p>
          ) : (
            <ul className="typelist">
              {users.map((u) => (
                <li key={u.id} className={u.isActive ? undefined : 'inactive'}>
                  {editing === u.id ? (
                    <div style={{ width: '100%' }}>
                      <span className="photolabel">Roles for {u.email}</span>
                      <div className="rolegrid" style={{ marginBottom: 12 }}>
                        {(options?.roles ?? []).map((r) => (
                          <label key={r.id} className="rolecard">
                            <input type="checkbox"
                              checked={pending.includes(r.id)}
                              onChange={() => toggleRole(r.id, pending, setPending)} />
                            <div>
                              <b>{r.name}</b>
                              <em>{r.permissions.length} permissions</em>
                            </div>
                          </label>
                        ))}
                      </div>
                      <div className="acts">
                        <button className="btn pri" type="button"
                          disabled={busy || !pending.length}
                          onClick={() => roles.mutate({ id: u.id, roleIds: pending })}>
                          Save roles
                        </button>
                        <button className="btn" type="button"
                          onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                      <p className="fnote" style={{ padding: '10px 0 0' }}>
                        Changing roles signs this user out, since permissions are carried
                        in their session token.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="typemain">
                        <b>{u.email}{u.id === me?.id ? ' (you)' : ''}</b>
                        <em>
                          {u.employee
                            ? `${u.employee.firstName} ${u.employee.lastName} · ${u.employee.staffId}`
                            : 'Not linked to an employee'}
                          {u.lastLoginAt
                            ? ` · last signed in ${new Date(u.lastLoginAt).toLocaleDateString('en-NG')}`
                            : ' · never signed in'}
                        </em>
                        <div className="typetags">
                          {u.roles.map((r) => (
                            <span className="tag" key={r.id}>{r.name}</span>
                          ))}
                          {!u.isActive ? <span className="tag warn">Deactivated</span> : null}
                          {u.mustChangePassword ? (
                            <span className="tag warn">Password change pending</span>
                          ) : null}
                        </div>
                      </div>
                      {manage ? (
                        <div className="typeacts">
                          <button className="linkact" type="button" disabled={busy}
                            onClick={() => {
                              setEditing(u.id);
                              setPending(u.roles.map((r) => r.id));
                              setError(null);
                            }}>
                            Roles
                          </button>
                          <button className="linkact" type="button" disabled={busy}
                            onClick={() => {
                              if (confirm(`Reset the password for ${u.email}?`)) reset.mutate(u);
                            }}>
                            Reset password
                          </button>
                          <button className="linkact" type="button" disabled={busy}
                            onClick={() => active.mutate({ id: u.id, isActive: !u.isActive })}>
                            {u.isActive ? 'Deactivate' : 'Reactivate'}
                          </button>
                          {!u.employee && options?.employees.length ? (
                            <select className="linkselect" disabled={busy}
                              onChange={(e) =>
                                e.target.value &&
                                link.mutate({ id: u.id, employeeId: e.target.value })}>
                              <option value="">Link employee…</option>
                              {options.employees.map((emp) => (
                                <option key={emp.id} value={emp.id}>
                                  {emp.firstName} {emp.lastName}
                                </option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="fnote">
          Accounts are deactivated rather than deleted, so their audit history stays
          attributable. You cannot grant a role carrying permissions you do not hold
          yourself, and you cannot remove your own administrator access.
        </p>
      </div>
    </>
  );
}