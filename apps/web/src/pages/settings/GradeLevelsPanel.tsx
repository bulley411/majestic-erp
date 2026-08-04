import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listGradeLevels, createGradeLevel, updateGradeLevelApi, deleteGradeLevel,
  ApiError, type GradeLevel,
} from '../../lib/api';
import SettingsList from '../../components/SettingsList';

const naira = (v: string | null) =>
  v == null ? null : '₦' + Number(v).toLocaleString('en-NG', { maximumFractionDigits: 0 });

const blank = { code: '', name: '', rank: 5, defaultGross: '' };

export default function GradeLevelsPanel({
  manage, showInactive, onError,
}: {
  manage: boolean;
  showInactive: boolean;
  onError: (m: string | null) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<typeof blank | null>(null);

  const { data: items } = useQuery({
    queryKey: ['grade-levels', showInactive],
    queryFn: () => listGradeLevels(showInactive),
  });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['grade-levels'] });
    qc.invalidateQueries({ queryKey: ['employee-options'] });
    setDraft(null);
    onError(null);
  };
  const fail = (e: unknown) =>
    onError(e instanceof ApiError ? e.message : 'Something went wrong.');

  const create = useMutation({ mutationFn: createGradeLevel, onSuccess: done, onError: fail });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateGradeLevelApi(id, data),
    onSuccess: done, onError: fail,
  });
  const remove = useMutation({ mutationFn: deleteGradeLevel, onSuccess: done, onError: fail });
  const busy = create.isPending || update.isPending || remove.isPending;

  const [edit, setEdit] = useState<Record<string, string>>({});

  return (
    <>
      <p className="fnote" style={{ padding: '0 0 12px' }}>
        Rank orders seniority — higher is more senior. The default gross is only a
        suggestion when setting salary; each employee's actual figure is recorded
        on their Salary tab.
      </p>

      {manage ? (
        draft ? (
          <div className="draftrow wrap">
            <input placeholder="Code, e.g. DM_2" maxLength={12} autoFocus
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} />
            <input placeholder="Name, e.g. Deputy Manager 2" style={{ flex: 2 }}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input type="number" placeholder="Rank" style={{ width: 80 }}
              value={draft.rank}
              onChange={(e) => setDraft({ ...draft, rank: Number(e.target.value) })} />
            <input type="number" placeholder="Default gross" style={{ width: 140 }}
              value={draft.defaultGross}
              onChange={(e) => setDraft({ ...draft, defaultGross: e.target.value })} />
            <button className="btn pri" type="button"
              disabled={draft.code.length < 1 || draft.name.length < 2 || busy}
              onClick={() => create.mutate({
                code: draft.code,
                name: draft.name,
                rank: draft.rank,
                defaultGross: draft.defaultGross ? Number(draft.defaultGross) : undefined,
              })}>
              Add
            </button>
            <button className="btn" type="button" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        ) : (
          <button className="btn pri" type="button" style={{ marginBottom: 14 }}
            onClick={() => { setDraft(blank); onError(null); }}>
            Add grade level
          </button>
        )
      ) : null}

      <SettingsList<GradeLevel>
        items={items ?? []}
        manage={manage}
        busy={busy}
        renderMain={(g) => (
          <>
            <b>
              <span className="mono">{g.code}</span> — {g.name}
            </b>
            <em>
              Rank {g.rank}
              {naira(g.defaultGross) ? ` · default ${naira(g.defaultGross)}` : ''}
              {g._count?.employees ? ` · ${g._count.employees} employee(s)` : ''}
            </em>
            {!g.isActive ? <span className="tag warn">Inactive</span> : null}
          </>
        )}
        renderEdit={(g, close) => (
          <div className="draftrow wrap">
            <input defaultValue={g.code} maxLength={12}
              onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} />
            <input defaultValue={g.name} style={{ flex: 2 }}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <input type="number" defaultValue={g.rank} style={{ width: 80 }}
              onChange={(e) => setEdit({ ...edit, rank: e.target.value })} />
            <input type="number" defaultValue={g.defaultGross ?? ''} style={{ width: 140 }}
              placeholder="Default gross"
              onChange={(e) => setEdit({ ...edit, defaultGross: e.target.value })} />
            <button className="btn pri" type="button" disabled={busy}
              onClick={() => {
                update.mutate({
                  id: g.id,
                  data: {
                    code: edit.code || g.code,
                    name: edit.name || g.name,
                    rank: Number(edit.rank || g.rank),
                    defaultGross: edit.defaultGross
                      ? Number(edit.defaultGross)
                      : g.defaultGross ? Number(g.defaultGross) : undefined,
                  },
                });
                setEdit({});
                close();
              }}>
              Save
            </button>
            <button className="btn" type="button"
              onClick={() => { setEdit({}); close(); }}>
              Cancel
            </button>
          </div>
        )}
        onToggle={(g) => update.mutate({ id: g.id, data: { isActive: !g.isActive } })}
        onDelete={(g) => remove.mutate(g.id)}
        deleteLabel={(g) => `Delete grade ${g.code}? This cannot be undone.`}
      />
    </>
  );
}