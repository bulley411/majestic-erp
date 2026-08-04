import { useState, type ReactNode } from 'react';

export interface ListItem {
  id: string;
  isActive: boolean;
  _count?: { employees: number };
}

/**
 * Shared list for HR reference data. Each type supplies how to render a
 * row and what the edit form contains; the surrounding behaviour —
 * activate, deactivate, delete-if-unused — is identical for all three.
 */
export default function SettingsList<T extends ListItem>({
  items, manage, busy, renderMain, renderEdit, onToggle, onDelete, deleteLabel,
}: {
  items: T[];
  manage: boolean;
  busy: boolean;
  renderMain: (item: T) => ReactNode;
  renderEdit: (item: T, done: () => void) => ReactNode;
  onToggle: (item: T) => void;
  onDelete: (item: T) => void;
  deleteLabel: (item: T) => string;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  if (!items.length) {
    return <p className="fnote" style={{ padding: 0 }}>Nothing defined yet.</p>;
  }

  return (
    <ul className="typelist">
      {items.map((item) => {
        const inUse = (item._count?.employees ?? 0) > 0;
        return (
          <li key={item.id} className={item.isActive ? undefined : 'inactive'}>
            {editing === item.id ? (
              renderEdit(item, () => setEditing(null))
            ) : (
              <>
                <div className="typemain">{renderMain(item)}</div>
                {manage ? (
                  <div className="typeacts">
                    <button className="linkact" type="button" disabled={busy}
                      onClick={() => setEditing(item.id)}>
                      Edit
                    </button>
                    <button className="linkact" type="button" disabled={busy}
                      onClick={() => onToggle(item)}>
                      {item.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                    {!inUse ? (
                      <button className="linkact danger" type="button" disabled={busy}
                        onClick={() => {
                          if (confirm(deleteLabel(item))) onDelete(item);
                        }}>
                        Delete
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}