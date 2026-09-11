import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listExpenseCategories, createExpenseCategory, updateExpenseCategory,
  deleteExpenseCategory, getAccounts, ApiError, type ExpenseCategory,
} from '../../lib/api';
import SettingsList from '../../components/SettingsList';

interface CategoryWithAccount extends ExpenseCategory {
  _count?: { vouchers: number; budgetLines: number };
}

const blank = {
  code: '',
  name: '',
  description: '',
  accountId: '',
  isActive: true,
};

export default function ExpenseCategoriesPanel({
  manage,
  showInactive,
  onError,
}: {
  manage: boolean;
  showInactive: boolean;
  onError: (m: string | null) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<typeof blank | null>(null);

  const { data: categories } = useQuery({
    queryKey: ['expense-categories', showInactive],
    queryFn: () => listExpenseCategories(showInactive),
  });

  const { data: accounts } = useQuery({
    queryKey: ['accounts', false],
    queryFn: () => getAccounts(false),
  });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['expense-categories'] });
    setDraft(null);
    onError(null);
  };
  const fail = (e: unknown) =>
    onError(e instanceof ApiError ? e.message : 'Something went wrong.');

  const create = useMutation({
    mutationFn: (d: typeof blank) =>
      createExpenseCategory({
        code: d.code,
        name: d.name,
        description: d.description || null,
        accountId: d.accountId || null,
        isActive: d.isActive,
      }),
    onSuccess: done,
    onError: fail,
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateExpenseCategory(id, data),
    onSuccess: done,
    onError: fail,
  });

  const remove = useMutation({ mutationFn: deleteExpenseCategory, onSuccess: done, onError: fail });

  const busy = create.isPending || update.isPending || remove.isPending;

  // Only show expense accounts (type EXPENSE)
  const expenseAccounts = (accounts || []).filter((a) => a.type === 'EXPENSE');

  return (
    <>
      <p className="fnote" style={{ padding: '0 0 12px' }}>
        Categories classify expenses for budgeting and reporting. Each category should be
        linked to an expense account from the chart of accounts.
      </p>

      {manage ? (
        draft ? (
          <div className="fsection">
            <h4>New expense category</h4>
            <div className="fgrid">
              <label className="ffield">
                <span>Code <b>*</b></span>
                <input
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. PERS"
                />
              </label>
              <label className="ffield">
                <span>Name <b>*</b></span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Personnel Expenses"
                />
              </label>
              <label className="ffield span2">
                <span>Description</span>
                <input
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </label>
              <label className="ffield span2">
                <span>Linked account (Chart of Accounts)</span>
                <select
                  value={draft.accountId}
                  onChange={(e) => setDraft({ ...draft, accountId: e.target.value })}
                >
                  <option value="">— Not linked —</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name}
                    </option>
                  ))}
                </select>
                <em className="fhint">
                  Links this category to an expense account for the trial balance
                </em>
              </label>
            </div>
            <div className="acts" style={{ marginTop: 14 }}>
              <button
                className="btn pri"
                type="button"
                disabled={busy || !draft.code || !draft.name}
                onClick={() => create.mutate(draft)}
              >
                {create.isPending ? 'Adding…' : 'Add category'}
              </button>
              <button className="btn" type="button" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="btn pri"
            type="button"
            style={{ marginBottom: 14 }}
            onClick={() => { setDraft(blank); onError(null); }}
          >
            Add expense category
          </button>
        )
      ) : null}

      <SettingsList<CategoryWithAccount>
        items={categories ?? []}
        manage={manage}
        busy={busy}
        renderMain={(c) => (
          <>
            <b>{c.name}</b>
            <em>
              <span className="mono">{c.code}</span>
              {c.account ? ` · Linked to ${c.account.code} - ${c.account.name}` : ' · Not linked'}
              {c._count?.vouchers ? ` · ${c._count.vouchers} voucher(s)` : ''}
            </em>
            {c.description ? <em>{c.description}</em> : null}
            {!c.isActive ? <span className="tag warn">Inactive</span> : null}
          </>
        )}
        renderEdit={(c, close) => (
          <div className="draftrow wrap">
            <input
              defaultValue={c.code}
              onChange={(e) =>
                update.mutate({
                  id: c.id,
                  data: { code: e.target.value.toUpperCase() },
                })
              }
              placeholder="Code"
              style={{ width: 100 }}
            />
            <input
              defaultValue={c.name}
              onChange={(e) =>
                update.mutate({ id: c.id, data: { name: e.target.value } })
              }
              style={{ flex: 1 }}
            />
            <select
              defaultValue={c.accountId || ''}
              onChange={(e) =>
                update.mutate({
                  id: c.id,
                  data: { accountId: e.target.value || null },
                })
              }
              style={{ flex: 1 }}
            >
              <option value="">— Not linked —</option>
              {expenseAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} - {a.name}
                </option>
              ))}
            </select>
            <button className="btn" type="button" onClick={close}>
              Close
            </button>
          </div>
        )}
        onToggle={(c) =>
          update.mutate({ id: c.id, data: { isActive: !c.isActive } })
        }
        onDelete={(c) => remove.mutate(c.id)}
        deleteLabel={(c) => `Delete "${c.name}"? This cannot be undone.`}
      />
    </>
  );
}