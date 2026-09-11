import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPayrollMappings, setPayrollMapping, getAccounts,
  ApiError, type PayrollMapping,
} from '../../lib/api';

export default function PayrollAccountsPanel({
  manage,
  onError,
}: {
  manage: boolean;
  onError: (m: string | null) => void;
}) {
  const qc = useQueryClient();

  const { data: mappings, isLoading } = useQuery({
    queryKey: ['payroll-mappings'],
    queryFn: getPayrollMappings,
  });

  const { data: accounts } = useQuery({
    queryKey: ['accounts', false],
    queryFn: () => getAccounts(false),
  });

  const update = useMutation({
    mutationFn: ({ key, accountId }: { key: string; accountId: string }) =>
      setPayrollMapping(key, accountId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-mappings'] });
      onError(null);
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : 'Could not save.'),
  });

  if (isLoading) return <div className="loading">Loading payroll account mappings…</div>;

  const byType = (type: string) =>
    (accounts || []).filter((a) => a.type === type);

  const list = Object.values(mappings || {}) as PayrollMapping[];

  const expenseKeys = list.filter((m) => m.meta.expectedType === 'EXPENSE');
  const liabilityKeys = list.filter((m) => m.meta.expectedType === 'LIABILITY');

  return (
    <>
      <p className="fnote" style={{ padding: '0 0 14px' }}>
        Choose which chart-of-accounts account each payroll component posts to. Defaults
        match the seeded chart of accounts — change these if your account codes differ
        or if you want payroll to hit different accounts.
      </p>

      {update.isPending ? (
        <div className="dbanner" style={{ marginBottom: 14 }}>Saving…</div>
      ) : null}

      <div className="fsection">
        <h4>Expense accounts (debits)</h4>
        <p className="fnote" style={{ padding: '0 0 10px' }}>
          These are debited when payroll is posted. They represent the cost to the company.
        </p>
        <ul className="typelist">
          {expenseKeys.map((m) => (
            <li key={m.key}>
              <div className="typemain">
                <b>{m.meta.label}</b>
                <em>{m.meta.description}</em>
                <div className="typetags">
                  <span className="tag">{m.meta.expectedType.toLowerCase()}</span>
                  {m.isDefault ? (
                    <span className="tag info">Using default</span>
                  ) : (
                    <span className="tag ok">Custom</span>
                  )}
                </div>
              </div>
              <div className="typeacts">
                {manage ? (
                  <select
                    value={m.accountId || ''}
                    onChange={(e) =>
                      update.mutate({ key: m.key, accountId: e.target.value })
                    }
                    className="linkselect"
                    style={{ minWidth: 260 }}
                    disabled={update.isPending}
                  >
                    <option value="">— Select account —</option>
                    {byType(m.meta.expectedType).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} - {a.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="mono">
                    {m.accountCode} - {m.accountName}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="fsection">
        <h4>Liability accounts (credits)</h4>
        <p className="fnote" style={{ padding: '0 0 10px' }}>
          These are credited when payroll is posted. They represent amounts owed to
          employees, tax authorities, and pension administrators.
        </p>
        <ul className="typelist">
          {liabilityKeys.map((m) => (
            <li key={m.key}>
              <div className="typemain">
                <b>{m.meta.label}</b>
                <em>{m.meta.description}</em>
                <div className="typetags">
                  <span className="tag">{m.meta.expectedType.toLowerCase()}</span>
                  {m.isDefault ? (
                    <span className="tag info">Using default</span>
                  ) : (
                    <span className="tag ok">Custom</span>
                  )}
                </div>
              </div>
              <div className="typeacts">
                {manage ? (
                  <select
                    value={m.accountId || ''}
                    onChange={(e) =>
                      update.mutate({ key: m.key, accountId: e.target.value })
                    }
                    className="linkselect"
                    style={{ minWidth: 260 }}
                    disabled={update.isPending}
                  >
                    <option value="">— Select account —</option>
                    {byType(m.meta.expectedType).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} - {a.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="mono">
                    {m.accountCode} - {m.accountName}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="fnote">
        Payroll posting validates that each mapped account exists, is active, and is
        the correct type (expense or liability). If a mapping is missing, payroll
        falls back to the seeded defaults. Changes are logged in the audit trail.
      </p>
    </>
  );
}