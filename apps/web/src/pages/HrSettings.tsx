import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listDocumentTypes, createDocumentType, updateDocumentType, deleteDocumentType,
  ApiError, type DocumentType,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';
import DepartmentsPanel from './settings/DepartmentsPanel';
import JobTitlesPanel from './settings/JobTitlesPanel';
import GradeLevelsPanel from './settings/GradeLevelsPanel';

const TABS = [
  { id: 'documents', label: 'Document types' },
  { id: 'departments', label: 'Departments' },
  { id: 'titles', label: 'Job titles' },
  { id: 'grades', label: 'Grade levels' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const CATEGORIES = [
  { value: 'PRE_EMPLOYMENT', label: 'A. Pre-employment / recruitment' },
  { value: 'ONBOARDING', label: 'B. Employment and onboarding' },
  { value: 'LIFECYCLE', label: 'C. Employment lifecycle' },
  { value: 'EXIT', label: 'D. Exit / cessation' },
];

const blankDoc = {
  name: '', category: 'ONBOARDING', description: '',
  required: true, allowMultiple: false,
};

function DocumentTypesPanel({
  manage, showInactive, onError,
}: {
  manage: boolean;
  showInactive: boolean;
  onError: (m: string | null) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<typeof blankDoc | null>(null);
  const [editing, setEditing] = useState<DocumentType | null>(null);

  const { data: types } = useQuery({
    queryKey: ['document-types', showInactive],
    queryFn: () => listDocumentTypes(showInactive),
  });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['document-types'] });
    qc.invalidateQueries({ queryKey: ['employees'] });
    setDraft(null);
    setEditing(null);
    onError(null);
  };
  const fail = (e: unknown) =>
    onError(e instanceof ApiError ? e.message : 'Something went wrong.');

  const create = useMutation({ mutationFn: createDocumentType, onSuccess: done, onError: fail });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateDocumentType(id, data),
    onSuccess: done, onError: fail,
  });
  const remove = useMutation({ mutationFn: deleteDocumentType, onSuccess: done, onError: fail });

  const grouped = CATEGORIES.map((c) => ({
    ...c,
    items: (types ?? []).filter((t) => t.category === c.value),
  }));

  return (
    <>
      {manage && !draft ? (
        <button className="btn pri" type="button" style={{ marginBottom: 14 }}
          onClick={() => { setDraft(blankDoc); onError(null); }}>
          Add document type
        </button>
      ) : null}

      {draft ? (
        <div className="fsection">
          <h4>New document type</h4>
          <div className="fgrid">
            <label className="ffield span2">
              <span>Name<b> *</b></span>
              <input value={draft.name} autoFocus
                placeholder="e.g. Professional Certification"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="ffield">
              <span>Section<b> *</b></span>
              <select value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="ffield span2">
              <span>Description</span>
              <input value={draft.description}
                placeholder="Optional note shown to whoever uploads"
                onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </label>
            <label className="ffield">
              <span>Required</span>
              <input type="checkbox" checked={draft.required}
                onChange={(e) => setDraft({ ...draft, required: e.target.checked })} />
              <em className="fhint">Counts toward file completeness</em>
            </label>
            <label className="ffield">
              <span>Allow multiple files</span>
              <input type="checkbox" checked={draft.allowMultiple}
                onChange={(e) => setDraft({ ...draft, allowMultiple: e.target.checked })} />
              <em className="fhint">e.g. training records, appraisals</em>
            </label>
          </div>
          <div className="acts" style={{ marginTop: 14 }}>
            <button className="btn pri" type="button"
              disabled={draft.name.trim().length < 2 || create.isPending}
              onClick={() => create.mutate(draft)}>
              {create.isPending ? 'Adding…' : 'Add'}
            </button>
            <button className="btn" type="button"
              onClick={() => { setDraft(null); onError(null); }}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {grouped.map((group) => (
        <div className="fsection" key={group.value}>
          <h4>{group.label}</h4>
          {!group.items.length ? (
            <p className="fnote" style={{ padding: 0 }}>Nothing defined in this section.</p>
          ) : (
            <ul className="typelist">
              {group.items.map((t) => (
                <li key={t.id} className={t.isActive ? undefined : 'inactive'}>
                  {editing?.id === t.id ? (
                    <div className="draftrow">
                      <input value={editing.name} style={{ flex: 1 }} autoFocus
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                      <button className="btn pri" type="button" disabled={update.isPending}
                        onClick={() => update.mutate({ id: t.id, data: { name: editing.name } })}>
                        Save
                      </button>
                      <button className="btn" type="button"
                        onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div className="typemain">
                        <b>{t.name}</b>
                        {t.description ? <em>{t.description}</em> : null}
                        <div className="typetags">
                          {t.required ? <span className="tag">Required</span> : null}
                          {t.allowMultiple ? <span className="tag">Multiple</span> : null}
                          {!t.isActive ? <span className="tag warn">Inactive</span> : null}
                          {t._count?.documents ? (
                            <span className="tag">{t._count.documents} filed</span>
                          ) : null}
                        </div>
                      </div>
                      {manage ? (
                        <div className="typeacts">
                          <button className="linkact" type="button"
                            onClick={() => setEditing(t)}>Rename</button>
                          <button className="linkact" type="button"
                            onClick={() =>
                              update.mutate({ id: t.id, data: { isActive: !t.isActive } })}>
                            {t.isActive ? 'Deactivate' : 'Reactivate'}
                          </button>
                          {!t._count?.documents ? (
                            <button className="linkact danger" type="button"
                              onClick={() => {
                                if (confirm(`Delete "${t.name}"? This cannot be undone.`)) {
                                  remove.mutate(t.id);
                                }
                              }}>
                              Delete
                            </button>
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
      ))}
    </>
  );
}

export default function HrSettings() {
  const { can } = useAuth();
  const manage = can('settings.manage');
  const [tab, setTab] = useState<TabId>('documents');
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panelProps = { manage, showInactive, onError: setError };

  return (
    <>
      <header className="topbar">
        <div className="crumb">Settings</div>
        <div className="titlerow">
          <h2 className="page">HR settings</h2>
          <div className="acts">
            <label className="inlinecheck">
              <input type="checkbox" checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)} />
              Show inactive
            </label>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} type="button"
              className={`tab${tab === t.id ? ' on' : ''}`}
              onClick={() => { setTab(t.id); setError(null); }}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="body">
        {error ? <div className="dbanner err" style={{ marginBottom: 14 }}>{error}</div> : null}

        {tab === 'documents' ? <DocumentTypesPanel {...panelProps} /> : null}
        {tab === 'departments' ? (
          <div className="fsection"><h4>Departments</h4>
            <DepartmentsPanel {...panelProps} />
          </div>
        ) : null}
        {tab === 'titles' ? (
          <div className="fsection"><h4>Job titles</h4>
            <JobTitlesPanel {...panelProps} />
          </div>
        ) : null}
        {tab === 'grades' ? (
          <div className="fsection"><h4>Grade levels</h4>
            <GradeLevelsPanel {...panelProps} />
          </div>
        ) : null}
      </div>
    </>
  );
}