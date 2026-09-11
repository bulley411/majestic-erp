import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listBanks, createBank, updateBank, deleteBank,
  getAccounts, ApiError, type Bank,
} from '../../lib/api';
import SettingsList from '../../components/SettingsList';

const blank = { name: '', accountNumber: '', accountId: '' };

export default function BanksPanel({
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

  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: () => listBanks(),
  });

  const { data: accounts } = useQuery({
    queryKey: ['accounts', false],
    queryFn: () => getAccounts(false),
  });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['banks'] });
    setDraft(null);
    onError(null);
  };
  const fail = (e: unknown) =>
    onError(e instanceof ApiError ? e.message : 'Something went wrong.');

  const create = useMutation({ mutationFn: createBank, onSuccess: done, onError: fail });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateBank(id, data),
    onSuccess: done,
    onError: fail,
  });
  const remove = useMutation({ mutationFn: deleteBank, onSuccess: done, onError: fail });
  const busy = create.isPending || update.isPending || remove.isPending;

  // Only asset accounts (banks are assets)
  const assetAccounts = (accounts || []).filter((a) => a.type === 'ASSET');

  return (
    <>
      <p className="fnote" style={{ padding: '0 0 12px' }}>
        Banks are linked to asset accounts in the chart of accounts. When a voucher is
        paid, it credits the selected bank's account.
      </p>

      {manage ? (
        draft ? (
          <div className="fsection">
            <h4>New bank</h4>
            <div className="fgrid">
              <label className="ffield">
                <span>Bank name <b>*</b></span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Access Bank"
                />
              </label>
              <label className="ffield">
                <span>Account number</span>
                <input
                  value={draft.accountNumber}
                  onChange={(e) => setDraft({ ...draft, accountNumber: e.target.value })}
                  placeholder="0123456789"
                />
              </label>
              <label className="ffield span2">
                <span>Linked account (Chart of Accounts) <b>*</b></span>
                <select
                  value={draft.accountId}
                  onChange={(e) => setDraft({ ...draft, accountId: e.target.value })}
                >
                  <option value="">— Select account —</option>
                  {assetAccounts.map((a) => (
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
                disabled={busy || !draft.name || !draft.accountId}
                onClick={() => create.mutate(draft)}
              >
                {create.isPending ? 'Adding…' : 'Add bank'}
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
            Add bank
          </button>
        )
      ) : null}

      <SettingsList<Bank>
        items={(banks ?? []).map((b) => ({ ...b, isActive: true }))}
        manage={manage}
        busy={busy}
        renderMain={(b) => (
          <>
            <b>{b.name}</b>
            <em>
              {b.accountNumber ? `${b.accountNumber} · ` : ''}
              {b.account ? `Linked to ${b.account.code} - ${b.account.name}` : 'Not linked'}
            </em>
          </>
        )}
        renderEdit={(b, close) => (
          <div className="draftrow wrap">
            <input
              defaultValue={b.name}
              onChange={(e) => update.mutate({ id: b.id, data: { name: e.target.value } })}
              style={{ flex: 1 }}
            />
            <input
              defaultValue={b.accountNumber || ''}
              onChange={(e) =>
                update.mutate({ id: b.id, data: { accountNumber: e.target.value } })
              }
              placeholder="Account number"
              style={{ flex: 1 }}
            />
            <button className="btn" type="button" onClick={close}>Close</button>
          </div>
        )}
        onToggle={() => {}}
        onDelete={(b) => remove.mutate(b.id)}
        deleteLabel={(b) => `Delete "${b.name}"? This cannot be undone.`}
      />
    </>
  );
}