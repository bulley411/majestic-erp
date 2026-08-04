import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listDepartments, createDepartment, updateDepartmentApi, deleteDepartment,
  ApiError, type Department,
} from '../../lib/api';
import SettingsList from '../../components/SettingsList';

export default function DepartmentsPanel({
  manage, showInactive, onError,
}: {
  manage: boolean;
  showInactive: boolean;
  onError: (m: string | null) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<{ code: string; name: string } | null>(null);
  const [edit, setEdit] = useState({ code: '', name: '' });

  const { data: items } = useQuery({
    queryKey: ['departments', showInactive],
    queryFn: () => listDepartments(showInactive),
  });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['departments'] });
    qc.invalidateQueries({ queryKey: ['employee-options'] });
    setDraft(null);
    onError(null);
  };
  const fail = (e: unknown) =>
    onError(e instanceof ApiError ? e.message : 'Something went wrong.');

  const create = useMutation({ mutationFn: createDepartment, onSuccess: done, onError: fail });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateDepartmentApi(id, data),
    onSuccess: done, onError: fail,
  });
  const remove = useMutation({ mutationFn: deleteDepartment, onSuccess: done, onError: fail });
  const busy = create.isPending || update.isPending || remove.isPending;

  return (
    <>
      {manage ? (
        draft ? (
          <div className="draftrow">
            <input placeholder="Code, e.g. FIN" maxLength={12} autoFocus
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} />
            <input placeholder="Name, e.g. Finance" style={{ flex: 2 }}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <button className="btn pri" type="button"
              disabled={draft.code.length < 2 || draft.name.length < 2 || busy}
              onClick={() => create.mutate(draft)}>
              Add
            </button>
            <button className="btn" type="button" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        ) : (
          <button className="btn pri" type="button" style={{ marginBottom: 14 }}
            onClick={() => { setDraft({ code: '', name: '' }); onError(null); }}>
            Add department
          </button>
        )
      ) : null}

      <SettingsList<Department>
        items={items ?? []}
        manage={manage}
        busy={busy}
        renderMain={(d) => (
          <>
            <b>{d.name}</b>
            <em>
              {d.code}
              {d._count?.employees ? ` · ${d._count.employees} employee(s)` : ' · empty'}
            </em>
            {!d.isActive ? <span className="tag warn">Inactive</span> : null}
          </>
        )}
        renderEdit={(d, close) => (
          <div className="draftrow">
            <input defaultValue={d.code} maxLength={12}
              onChange={(e) => setEdit({ code: e.target.value.toUpperCase(), name: edit.name || d.name })} />
            <input defaultValue={d.name} style={{ flex: 2 }}
              onChange={(e) => setEdit({ code: edit.code || d.code, name: e.target.value })} />
            <button className="btn pri" type="button" disabled={busy}
              onClick={() => {
                update.mutate({
                  id: d.id,
                  data: { code: edit.code || d.code, name: edit.name || d.name },
                });
                close();
              }}>
              Save
            </button>
            <button className="btn" type="button" onClick={close}>Cancel</button>
          </div>
        )}
        onToggle={(d) => update.mutate({ id: d.id, data: { isActive: !d.isActive } })}
        onDelete={(d) => remove.mutate(d.id)}
        deleteLabel={(d) => `Delete "${d.name}"? This cannot be undone.`}
      />
    </>
  );
}