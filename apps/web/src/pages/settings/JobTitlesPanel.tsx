import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listJobTitles, createJobTitle, updateJobTitleApi, deleteJobTitle,
  ApiError, type JobTitle,
} from '../../lib/api';
import SettingsList from '../../components/SettingsList';

export default function JobTitlesPanel({
  manage, showInactive, onError,
}: {
  manage: boolean;
  showInactive: boolean;
  onError: (m: string | null) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [edit, setEdit] = useState('');

  const { data: items } = useQuery({
    queryKey: ['job-titles', showInactive],
    queryFn: () => listJobTitles(showInactive),
  });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['job-titles'] });
    qc.invalidateQueries({ queryKey: ['employee-options'] });
    setDraft(null);
    onError(null);
  };
  const fail = (e: unknown) =>
    onError(e instanceof ApiError ? e.message : 'Something went wrong.');

  const create = useMutation({ mutationFn: createJobTitle, onSuccess: done, onError: fail });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateJobTitleApi(id, data),
    onSuccess: done, onError: fail,
  });
  const remove = useMutation({ mutationFn: deleteJobTitle, onSuccess: done, onError: fail });
  const busy = create.isPending || update.isPending || remove.isPending;

  return (
    <>
      {manage ? (
        draft !== null ? (
          <div className="draftrow">
            <input placeholder="e.g. Pension Administrator" style={{ flex: 1 }} autoFocus
              value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button className="btn pri" type="button"
              disabled={draft.trim().length < 2 || busy}
              onClick={() => create.mutate({ name: draft })}>
              Add
            </button>
            <button className="btn" type="button" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        ) : (
          <button className="btn pri" type="button" style={{ marginBottom: 14 }}
            onClick={() => { setDraft(''); onError(null); }}>
            Add job title
          </button>
        )
      ) : null}

      <SettingsList<JobTitle>
        items={items ?? []}
        manage={manage}
        busy={busy}
        renderMain={(t) => (
          <>
            <b>{t.name}</b>
            <em>{t._count?.employees ? `${t._count.employees} employee(s)` : 'Unassigned'}</em>
            {!t.isActive ? <span className="tag warn">Inactive</span> : null}
          </>
        )}
        renderEdit={(t, close) => (
          <div className="draftrow">
            <input defaultValue={t.name} style={{ flex: 1 }} autoFocus
              onChange={(e) => setEdit(e.target.value)} />
            <button className="btn pri" type="button" disabled={busy}
              onClick={() => {
                update.mutate({ id: t.id, data: { name: edit || t.name } });
                close();
              }}>
              Save
            </button>
            <button className="btn" type="button" onClick={close}>Cancel</button>
          </div>
        )}
        onToggle={(t) => update.mutate({ id: t.id, data: { isActive: !t.isActive } })}
        onDelete={(t) => remove.mutate(t.id)}
        deleteLabel={(t) => `Delete "${t.name}"? This cannot be undone.`}
      />
    </>
  );
}