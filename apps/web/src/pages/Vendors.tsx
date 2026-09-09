import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listVendors, createVendor, updateVendor, deleteVendor, toggleVendorActive,
  ApiError, type Vendor,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';

const TYPE_LABELS: Record<string, string> = {
  SUPPLIER: 'Supplier',
  CUSTOMER: 'Customer',
  CONSULTANT: 'Consultant',
  OTHER: 'Other',
};

const TYPE_COLORS: Record<string, string> = {
  SUPPLIER: 'ok',
  CUSTOMER: 'info',
  CONSULTANT: '',
  OTHER: 'warn',
};

const blankVendor = {
  code: '',
  name: '',
  type: 'SUPPLIER' as const,
  contactPerson: '',
  email: '',
  phone: '',
  address: '',
  taxId: '',
  accountNumber: '',
  bankName: '',
  accountId: null,
  notes: '',
};

export default function Vendors() {
  const { can } = useAuth();
  const canManage = can('voucher.raise');
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [draft, setDraft] = useState<typeof blankVendor | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: vendors, isLoading } = useQuery({
    queryKey: ['vendors', search, type, showInactive],
    queryFn: () => listVendors(search || undefined, type || undefined, showInactive),
  });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['vendors'] });
    qc.invalidateQueries({ queryKey: ['vendor-options'] });
    setEditing(null);
    setDraft(null);
    setError(null);
  };

  const fail = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : 'Something went wrong.');

  const create = useMutation({ mutationFn: createVendor, onSuccess: done, onError: fail });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateVendor(id, data),
    onSuccess: done,
    onError: fail,
  });
  const remove = useMutation({ mutationFn: deleteVendor, onSuccess: done, onError: fail });
  const toggle = useMutation({ mutationFn: toggleVendorActive, onSuccess: done, onError: fail });

  const busy = create.isPending || update.isPending || remove.isPending || toggle.isPending;

  return (
    <>
      <header className="topbar">
        <div className="crumb">Finance</div>
        <div className="titlerow">
          <h2 className="page">
            Vendors
            <span className="count">
              {isLoading ? 'Loading…' : `${vendors?.length || 0} on record`}
            </span>
          </h2>
          {canManage && !draft ? (
            <div className="acts">
              <button className="btn pri" type="button" onClick={() => setDraft(blankVendor)}>
                Add vendor
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="filters">
        <div className="search">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, code, contact…"
            style={{ paddingLeft: 11 }}
          />
        </div>
        <select
          className="chip"
          value={type}
          onChange={(e) => setType(e.target.value)}
          style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: '20px', padding: '5px 12px' }}
        >
          <option value="">All types</option>
          <option value="SUPPLIER">Suppliers</option>
          <option value="CUSTOMER">Customers</option>
          <option value="CONSULTANT">Consultants</option>
          <option value="OTHER">Other</option>
        </select>
        <label className="inlinecheck">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
        <div className="spacer" />
        <span className="tag">{vendors?.filter((v) => v.isActive).length || 0} active</span>
      </div>

      <div className="body">
        {error ? <div className="dbanner err" style={{ marginBottom: 14 }}>{error}</div> : null}

        {/* Create Form */}
        {draft ? (
          <div className="fsection">
            <h4>New vendor</h4>
            <div className="fgrid">
              <label className="ffield">
                <span>Code <b>*</b></span>
                <input
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. VEN-001"
                />
              </label>
              <label className="ffield">
                <span>Name <b>*</b></span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Lagos Supplies Ltd"
                />
              </label>
              <label className="ffield">
                <span>Type</span>
                <select
                  value={draft.type}
                  onChange={(e) => setDraft({ ...draft, type: e.target.value as any })}
                >
                  <option value="SUPPLIER">Supplier</option>
                  <option value="CUSTOMER">Customer</option>
                  <option value="CONSULTANT">Consultant</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              <label className="ffield">
                <span>Contact person</span>
                <input
                  value={draft.contactPerson}
                  onChange={(e) => setDraft({ ...draft, contactPerson: e.target.value })}
                />
              </label>
              <label className="ffield">
                <span>Email</span>
                <input
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
              </label>
              <label className="ffield">
                <span>Phone</span>
                <input
                  value={draft.phone}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                />
              </label>
              <label className="ffield span2">
                <span>Address</span>
                <input
                  value={draft.address}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                />
              </label>
              <label className="ffield">
                <span>Tax ID</span>
                <input
                  value={draft.taxId}
                  onChange={(e) => setDraft({ ...draft, taxId: e.target.value })}
                />
              </label>
              <label className="ffield">
                <span>Bank name</span>
                <input
                  value={draft.bankName}
                  onChange={(e) => setDraft({ ...draft, bankName: e.target.value })}
                />
              </label>
              <label className="ffield">
                <span>Account number</span>
                <input
                  value={draft.accountNumber}
                  onChange={(e) => setDraft({ ...draft, accountNumber: e.target.value })}
                />
              </label>
              <label className="ffield span2">
                <span>Notes</span>
                <input
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </label>
            </div>
            <div className="acts" style={{ marginTop: 14 }}>
              <button
                className="btn pri"
                type="button"
                disabled={busy || !draft.code || !draft.name}
                onClick={() => create.mutate(draft)}
              >
                {create.isPending ? 'Adding…' : 'Add vendor'}
              </button>
              <button className="btn" type="button" onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </div>
        ) : null}

        {/* Vendor List */}
        <div className="fsection">
          <h4>All vendors</h4>
          {!vendors?.length ? (
            <p className="fnote" style={{ padding: 0 }}>No vendors found.</p>
          ) : (
            <ul className="typelist">
              {vendors.map((v) => (
                <li key={v.id} className={v.isActive ? undefined : 'inactive'}>
                  {editing?.id === v.id ? (
                    <div style={{ width: '100%' }}>
                      <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                        <label className="ffield">
                          <span>Name</span>
                          <input
                            defaultValue={v.name}
                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                          />
                        </label>
                        <label className="ffield">
                          <span>Code</span>
                          <input
                            defaultValue={v.code}
                            onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })}
                          />
                        </label>
                        <label className="ffield">
                          <span>Contact person</span>
                          <input
                            defaultValue={v.contactPerson || ''}
                            onChange={(e) => setEditing({ ...editing, contactPerson: e.target.value })}
                          />
                        </label>
                        <label className="ffield">
                          <span>Email</span>
                          <input
                            defaultValue={v.email || ''}
                            onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                          />
                        </label>
                        <label className="ffield">
                          <span>Phone</span>
                          <input
                            defaultValue={v.phone || ''}
                            onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                          />
                        </label>
                        <label className="ffield">
                          <span>Type</span>
                          <select
                            defaultValue={v.type}
                            onChange={(e) => setEditing({ ...editing, type: e.target.value as any })}
                          >
                            <option value="SUPPLIER">Supplier</option>
                            <option value="CUSTOMER">Customer</option>
                            <option value="CONSULTANT">Consultant</option>
                            <option value="OTHER">Other</option>
                          </select>
                        </label>
                      </div>
                      <div className="acts" style={{ marginTop: 14 }}>
                        <button
                          className="btn pri"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            const { id, ...data } = editing;
                            update.mutate({ id, data });
                          }}
                        >
                          Save
                        </button>
                        <button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="typemain">
                        <b>{v.code} — {v.name}</b>
                        <em>
                          {v.contactPerson ? `Contact: ${v.contactPerson}` : 'No contact'}
                          {v.email ? ` · ${v.email}` : ''}
                          {v.phone ? ` · ${v.phone}` : ''}
                        </em>
                        <div className="typetags">
                          <span className={`tag ${TYPE_COLORS[v.type]}`}>
                            {TYPE_LABELS[v.type] || v.type}
                          </span>
                          {v._count?.vouchers ? (
                            <span className="tag">{v._count.vouchers} vouchers</span>
                          ) : null}
                          {!v.isActive ? <span className="tag warn">Inactive</span> : null}
                        </div>
                      </div>
                      {canManage ? (
                        <div className="typeacts">
                          <button className="linkact" type="button" onClick={() => setEditing(v)}>
                            Edit
                          </button>
                          <button
                            className="linkact"
                            type="button"
                            disabled={busy}
                            onClick={() => toggle.mutate(v.id)}
                          >
                            {v.isActive ? 'Deactivate' : 'Reactivate'}
                          </button>
                          {!v._count?.vouchers ? (
                            <button
                              className="linkact danger"
                              type="button"
                              onClick={() => {
                                if (confirm(`Delete "${v.name}"? This cannot be undone.`)) {
                                  remove.mutate(v.id);
                                }
                              }}
                            >
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
      </div>
    </>
  );
}