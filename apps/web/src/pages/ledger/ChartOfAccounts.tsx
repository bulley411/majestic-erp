import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAccountTree, getAccounts, api, ApiError, type Account } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

const TYPE_COLORS: Record<string, string> = {
  ASSET: '#0E7C5A',
  LIABILITY: '#9A6B08',
  EQUITY: '#1D4266',
  INCOME: '#2D6FB8',
  EXPENSE: '#A8352C',
};

const TYPE_LABELS: Record<string, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expenses',
};

const ACCOUNT_TYPES = [
  { value: 'ASSET', label: 'Asset' },
  { value: 'LIABILITY', label: 'Liability' },
  { value: 'EQUITY', label: 'Equity' },
  { value: 'INCOME', label: 'Income' },
  { value: 'EXPENSE', label: 'Expense' },
];

// --- Account Node Component ---

function AccountNode({ 
  account, 
  depth = 0, 
  onEdit, 
  onToggle, 
  onDelete, 
  canManage 
}: { 
  account: Account; 
  depth?: number; 
  onEdit: (account: Account) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  canManage: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = account.children && account.children.length > 0;
  const color = TYPE_COLORS[account.type] || '#5D7085';

  return (
    <div className="acc-node" style={{ paddingLeft: depth * 20 }}>
      <div className="acc-row" onClick={() => hasChildren && setExpanded(!expanded)}>
        {hasChildren ? (
          <span className="acc-toggle">{expanded ? '▼' : '▶'}</span>
        ) : (
          <span className="acc-toggle" style={{ opacity: 0.3 }}>•</span>
        )}
        <span className="acc-code">{account.code}</span>
        <span className="acc-name">{account.name}</span>
        <span className="acc-type" style={{ color }}>
          {TYPE_LABELS[account.type] || account.type}
        </span>
        {!account.isActive ? (
          <span className="tag warn" style={{ fontSize: 9 }}>Inactive</span>
        ) : null}
        {account._count?.lines !== undefined ? (
          <span className="acc-count">{account._count.lines} entries</span>
        ) : null}
        {canManage ? (
          <div className="acc-actions" onClick={(e) => e.stopPropagation()}>
            <button 
              className="linkact" 
              type="button" 
              onClick={() => onEdit(account)}
              style={{ fontSize: 11 }}
            >
              Edit
            </button>
            <button 
              className="linkact" 
              type="button" 
              onClick={() => onToggle(account.id)}
              style={{ fontSize: 11 }}
            >
              {account.isActive ? 'Deactivate' : 'Activate'}
            </button>
            {!account._count?.lines ? (
              <button 
                className="linkact danger" 
                type="button" 
                onClick={() => {
                  if (confirm(`Delete account "${account.code} - ${account.name}"? This cannot be undone.`)) {
                    onDelete(account.id);
                  }
                }}
                style={{ fontSize: 11 }}
              >
                Delete
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {hasChildren && expanded ? (
        <div className="acc-children">
          {account.children!.map((child) => (
            <AccountNode 
              key={child.id} 
              account={child} 
              depth={depth + 1}
              onEdit={onEdit}
              onToggle={onToggle}
              onDelete={onDelete}
              canManage={canManage}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// --- Main Component ---

export default function ChartOfAccounts() {
  const { can } = useAuth();
  const canManage = can('ledger.post');
  const qc = useQueryClient();
  
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [draftAccount, setDraftAccount] = useState<{
    code: string;
    name: string;
    type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
    parentId: string | null;
  } | null>(null);

  // Get all accounts for parent dropdown
  const { data: allAccounts } = useQuery({
    queryKey: ['accounts', showInactive],
    queryFn: () => getAccounts(showInactive),
  });

  // Get account tree
  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ['account-tree', showInactive],
    queryFn: () => getAccountTree(showInactive),
  });

  // --- Mutations ---

  const createAccount = useMutation({
    mutationFn: async (data: any) => {
      return api<Account>('/ledger/accounts', { 
        method: 'POST', 
        body: JSON.stringify(data) 
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account-tree'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setDraftAccount(null);
      setError(null);
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : 'Could not create account.');
    },
  });

  const updateAccount = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return api<Account>(`/ledger/accounts/${id}`, { 
        method: 'PATCH', 
        body: JSON.stringify(data) 
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account-tree'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setEditingAccount(null);
      setError(null);
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : 'Could not update account.');
    },
  });

  const deleteAccount = useMutation({
    mutationFn: async (id: string) => {
      return api<{ ok: boolean }>(`/ledger/accounts/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account-tree'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setError(null);
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : 'Could not delete account.');
    },
  });

  const toggleAccount = useMutation({
    mutationFn: async (id: string) => {
      return api<Account>(`/ledger/accounts/${id}/toggle`, { method: 'PATCH' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account-tree'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setError(null);
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : 'Could not toggle account status.');
    },
  });

  if (isLoading) return <div className="loading">Loading chart of accounts…</div>;
  if (queryError) return <div className="error">Could not load accounts.</div>;

  const busy = createAccount.isPending || updateAccount.isPending || deleteAccount.isPending || toggleAccount.isPending;

  return (
    <>
      {error ? <div className="dbanner err" style={{ marginBottom: 14 }}>{error}</div> : null}

      <div className="regbar">
        <div className="regmeta">
          <span className="tag">{data?.length || 0} root accounts</span>
        </div>
        <label className="inlinecheck">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
        {canManage && !draftAccount ? (
          <button 
            className="btn pri" 
            type="button" 
            onClick={() => setDraftAccount({ code: '', name: '', type: 'ASSET', parentId: null })}
          >
            Add account
          </button>
        ) : null}
      </div>

      {/* Create Account Form */}
      {draftAccount ? (
        <div className="fsection">
          <h4>New account</h4>
          <div className="fgrid">
            <label className="ffield">
              <span>Code <b>*</b></span>
              <input
                value={draftAccount.code}
                onChange={(e) => setDraftAccount({ ...draftAccount, code: e.target.value.toUpperCase() })}
                placeholder="e.g. 1150"
              />
            </label>
            <label className="ffield">
              <span>Name <b>*</b></span>
              <input
                value={draftAccount.name}
                onChange={(e) => setDraftAccount({ ...draftAccount, name: e.target.value })}
                placeholder="e.g. Petty Cash"
              />
            </label>
            <label className="ffield">
              <span>Type <b>*</b></span>
              <select
                value={draftAccount.type}
                onChange={(e) => setDraftAccount({ ...draftAccount, type: e.target.value as any })}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="ffield">
              <span>Parent account</span>
              <select
                value={draftAccount.parentId || ''}
                onChange={(e) => setDraftAccount({ ...draftAccount, parentId: e.target.value || null })}
              >
                <option value="">— Root account —</option>
                {(allAccounts || []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} - {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="acts" style={{ marginTop: 14 }}>
            <button
              className="btn pri"
              type="button"
              disabled={busy || !draftAccount.code || !draftAccount.name}
              onClick={() => createAccount.mutate(draftAccount)}
            >
              {createAccount.isPending ? 'Adding…' : 'Add account'}
            </button>
            <button className="btn" type="button" onClick={() => setDraftAccount(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {/* Edit Account Form */}
      {editingAccount ? (
        <div className="fsection">
          <h4>Edit account</h4>
          <div className="fgrid">
            <label className="ffield">
              <span>Code <b>*</b></span>
              <input
                value={editingAccount.code}
                onChange={(e) => setEditingAccount({ ...editingAccount, code: e.target.value.toUpperCase() })}
              />
            </label>
            <label className="ffield">
              <span>Name <b>*</b></span>
              <input
                value={editingAccount.name}
                onChange={(e) => setEditingAccount({ ...editingAccount, name: e.target.value })}
              />
            </label>
            <label className="ffield">
              <span>Type <b>*</b></span>
              <select
                value={editingAccount.type}
                onChange={(e) => setEditingAccount({ ...editingAccount, type: e.target.value as any })}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="ffield">
              <span>Parent account</span>
              <select
                value={editingAccount.parentId || ''}
                onChange={(e) => setEditingAccount({ ...editingAccount, parentId: e.target.value || null })}
              >
                <option value="">— Root account —</option>
                {(allAccounts || [])
                  .filter((a) => a.id !== editingAccount.id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="ffield">
              <span>Active</span>
              <input
                type="checkbox"
                checked={editingAccount.isActive}
                onChange={(e) => setEditingAccount({ ...editingAccount, isActive: e.target.checked })}
              />
            </label>
          </div>
          <div className="acts" style={{ marginTop: 14 }}>
            <button
              className="btn pri"
              type="button"
              disabled={busy || !editingAccount.code || !editingAccount.name}
              onClick={() => {
                const { id, code, name, type, parentId, isActive } = editingAccount;
                updateAccount.mutate({ id, data: { code, name, type, parentId, isActive } });
              }}
            >
              {updateAccount.isPending ? 'Saving…' : 'Save changes'}
            </button>
            <button className="btn" type="button" onClick={() => setEditingAccount(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {/* Account Tree */}
      <div className="fsection">
        <div className="account-tree">
          {!data?.length ? (
            <p className="fnote" style={{ padding: 0 }}>No accounts found.</p>
          ) : (
            data.map((account) => (
              <AccountNode 
                key={account.id} 
                account={account} 
                onEdit={setEditingAccount}
                onToggle={toggleAccount.mutate}
                onDelete={deleteAccount.mutate}
                canManage={canManage}
              />
            ))
          )}
        </div>
      </div>

      <p className="fnote">
        Accounts are organized in a tree structure. Asset and expense accounts
        normally carry debit balances; liability, equity and income accounts
        carry credit balances. Inactive accounts cannot be selected for new entries.
      </p>
    </>
  );
}