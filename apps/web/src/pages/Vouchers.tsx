import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listVouchers, createVoucher, updateVoucher, transitionVoucher,
  postVoucher, deleteVoucher, getApprovalLimits,
  getVendorOptions, checkVoucherBudget, listExpenseCategories, listBanks,
  ApiError, type Voucher, type BudgetCheckResult,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'info',
  PENDING_APPROVAL: 'warn',
  APPROVED: 'ok',
  POSTED: 'ok',
  PAID: 'ok',
  REJECTED: 'warn',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  POSTED: 'Posted to ledger',
  PAID: 'Paid',
  REJECTED: 'Rejected',
};

const naira = (v: string) =>
  '₦' + Number(v).toLocaleString('en-NG', { minimumFractionDigits: 2 });

const today = () => new Date().toISOString().slice(0, 10);

const blankVoucher = {
  date: today(),
  description: '',
  amount: 0,
  vendorId: '',
  categoryId: '',
  bankId: '',
  beneficiary: '',
  beneficiaryAccountNo: '',
  whtRate: 0,
  notes: '',
};

export default function Vouchers() {
  const { can } = useAuth();
  const canRaise = can('voucher.raise');
  const canApprove = can('voucher.approve');
  const canPost = can('ledger.post');
  const qc = useQueryClient();

  const [status, setStatus] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [draft, setDraft] = useState<typeof blankVoucher | null>(null);
  const [editing, setEditing] = useState<Voucher | null>(null);
  const [selectedVoucher, setSelectedVoucher] = useState<Voucher | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: vouchers, isLoading } = useQuery({
    queryKey: ['vouchers', status, vendorId, fromDate, toDate],
    queryFn: () => listVouchers({
      status: status || undefined,
      vendorId: vendorId || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    }),
  });

  const { data: vendors } = useQuery({
    queryKey: ['vendor-options'],
    queryFn: getVendorOptions,
  });

  const { data: categories } = useQuery({
    queryKey: ['expense-categories-options'],
    queryFn: () => listExpenseCategories(false),
  });

  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: listBanks,
  });

  const { data: limits } = useQuery({
    queryKey: ['approval-limits'],
    queryFn: getApprovalLimits,
  });

  const flashSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  const done = () => {
    qc.invalidateQueries({ queryKey: ['vouchers'] });
    qc.invalidateQueries({ queryKey: ['vendor-options'] });
    setDraft(null);
    setEditing(null);
    setSelectedVoucher(null);
    setError(null);
  };

  const fail = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : 'Something went wrong.');

  const create = useMutation({
    mutationFn: createVoucher,
    onSuccess: (v) => { done(); flashSuccess(`Voucher ${v.voucherNo} created.`); },
    onError: fail,
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateVoucher(id, data),
    onSuccess: () => { done(); flashSuccess('Voucher updated.'); },
    onError: fail,
  });

  const transition = useMutation({
    mutationFn: ({ id, action, remarks }: { id: string; action: string; remarks?: string }) =>
      transitionVoucher(id, action, remarks),
    onSuccess: (v) => { done(); flashSuccess(`Voucher ${v.voucherNo} updated.`); },
    onError: fail,
  });

  const post = useMutation({
    mutationFn: postVoucher,
    onSuccess: () => { done(); flashSuccess('Voucher posted to ledger.'); },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: deleteVoucher,
    onSuccess: () => { done(); flashSuccess('Voucher deleted.'); },
    onError: fail,
  });

  const busy = create.isPending || update.isPending || transition.isPending ||
    post.isPending || remove.isPending;

  // --- Detail View ---
  if (selectedVoucher) {
    return (
      <VoucherDetail
        voucher={selectedVoucher}
        onClose={() => setSelectedVoucher(null)}
        onTransition={(action, remarks) => {
          transition.mutate({ id: selectedVoucher.id, action, remarks });
        }}
        onPost={() => post.mutate(selectedVoucher.id)}
        canApprove={canApprove}
        canPost={canPost}
        busy={busy}
        error={error}
        success={success}
      />
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="crumb">Finance</div>
        <div className="titlerow">
          <h2 className="page">
            Vouchers
            <span className="count">
              {isLoading ? 'Loading…' : `${vouchers?.length || 0} records`}
            </span>
          </h2>
          {canRaise && !draft ? (
            <div className="acts">
              <button className="btn pri" type="button" onClick={() => setDraft(blankVoucher)}>
                New voucher
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="filters">
        <label className="ffield" style={{ maxWidth: 150 }}>
          <span>From</span>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label className="ffield" style={{ maxWidth: 150 }}>
          <span>To</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <label className="ffield" style={{ maxWidth: 150 }}>
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="DRAFT">Draft</option>
            <option value="PENDING_APPROVAL">Pending approval</option>
            <option value="APPROVED">Approved</option>
            <option value="POSTED">Posted</option>
            <option value="PAID">Paid</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </label>
        <label className="ffield" style={{ maxWidth: 200 }}>
          <span>Vendor</span>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">All</option>
            {vendors?.map((v) => (
              <option key={v.id} value={v.id}>{v.code} - {v.name}</option>
            ))}
          </select>
        </label>
        <div className="regmeta">
          <span className="tag">{vouchers?.filter((v) => v.status === 'PENDING_APPROVAL').length || 0} pending</span>
        </div>
      </div>

      <div className="body">
        {error ? <div className="dbanner err" style={{ marginBottom: 14 }}>{error}</div> : null}
        {success ? <div className="dbanner" style={{ marginBottom: 14 }}>{success}</div> : null}

        {/* Create Form */}
        {draft ? (
          <VoucherForm
            draft={draft}
            setDraft={setDraft}
            vendors={vendors || []}
            categories={categories || []}
            banks={banks || []}
            onSave={() => create.mutate(draft)}
            onCancel={() => setDraft(null)}
            busy={busy}
            isEdit={false}
          />
        ) : null}

        {/* Edit Form */}
        {editing ? (
          <VoucherForm
            draft={editing}
            setDraft={(data) => setEditing(data as Voucher)}
            vendors={vendors || []}
            categories={categories || []}
            banks={banks || []}
            onSave={() => {
              const { id, ...data } = editing;
              update.mutate({ id, data });
            }}
            onCancel={() => setEditing(null)}
            busy={busy}
            isEdit={true}
          />
        ) : null}

        {/* Voucher List */}
        <div className="fsection">
          <h4>All vouchers</h4>
          {!vouchers?.length ? (
            <p className="fnote" style={{ padding: 0 }}>No vouchers found.</p>
          ) : (
            <ul className="voucher-list">
              {vouchers.map((v) => (
                <li
                  key={v.id}
                  className="voucher-row"
                  onClick={() => setSelectedVoucher(v)}
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => { if (e.key === 'Enter') setSelectedVoucher(v); }}
                >
                  <div className="voucher-main">
                    <div className="voucher-header">
                      <b className="mono">{v.voucherNo}</b>
                      <span className={`tag ${STATUS_COLORS[v.status]}`}>
                        {STATUS_LABELS[v.status] || v.status}
                      </span>
                      <span className="voucher-date">
                        {new Date(v.date).toLocaleDateString('en-NG')}
                      </span>
                    </div>
                    <em>{v.description}</em>
                    <div className="voucher-meta">
                      {v.vendor ? (
                        <span className="tag">{v.vendor.code} - {v.vendor.name}</span>
                      ) : null}
                      {v.category ? (
                        <span className="tag">{v.category.name}</span>
                      ) : null}
                      <span className="tag">
                        {v.approvals?.length || 0} approval{v.approvals?.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  <div className="voucher-totals">
                    <span className="voucher-amount">
                      <b className="mono">{naira(v.amount)}</b>
                      <small>gross</small>
                    </span>
                    <span className="voucher-amount">
                      <span className="mono">{naira(v.netAmount)}</span>
                      <small>net</small>
                    </span>
                    {Number(v.whtRate) > 0 ? (
                      <span className="voucher-amount" style={{ fontSize: 10, color: 'var(--slate-2)' }}>
                        WHT {v.whtRate}%
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="fnote">
          Vouchers follow an approval workflow: Draft → Pending Approval → Approved → Posted → Paid.
          ED approves up to ₦500,000; MD approves any amount. Spending is tracked against the active budget.
        </p>
      </div>
    </>
  );
}

// --- Voucher Form Component ---

function VoucherForm({
  draft,
  setDraft,
  vendors,
  categories,
  banks,
  onSave,
  onCancel,
  busy,
  isEdit,
}: {
  draft: any;
  setDraft: (data: any) => void;
  vendors: { id: string; code: string; name: string }[];
  categories: { id: string; code: string; name: string }[];
  banks: { id: string; name: string }[];
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  isEdit: boolean;
}) {
  const [budgetCheck, setBudgetCheck] = useState<BudgetCheckResult | null>(null);

  // Check budget when category or amount changes (debounced)
  useEffect(() => {
    if (!draft.categoryId || !draft.amount || draft.amount <= 0 || !draft.date) {
      setBudgetCheck(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      checkVoucherBudget(draft.categoryId, Number(draft.amount), draft.date)
        .then((result) => {
          if (!cancelled) setBudgetCheck(result);
        })
        .catch(() => {
          if (!cancelled) setBudgetCheck(null);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft.categoryId, draft.amount, draft.date]);

  return (
    <div className="fsection">
      <h4>{isEdit ? 'Edit voucher' : 'New voucher'}</h4>
      <div className="fgrid">
        <label className="ffield">
          <span>Date <b>*</b></span>
          <input
            type="date"
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          />
        </label>
        <label className="ffield">
          <span>Amount (₦) <b>*</b></span>
          <input
            type="number"
            step="0.01"
            value={draft.amount}
            onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })}
          />
        </label>
        <label className="ffield span2">
          <span>Description <b>*</b></span>
          <input
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="Brief description of the payment"
          />
        </label>
        <label className="ffield">
          <span>Vendor</span>
          <select
            value={draft.vendorId}
            onChange={(e) => setDraft({ ...draft, vendorId: e.target.value })}
          >
            <option value="">— Select vendor —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.code} - {v.name}</option>
            ))}
          </select>
        </label>
        <label className="ffield">
          <span>Expense category</span>
          <select
            value={draft.categoryId || ''}
            onChange={(e) => setDraft({ ...draft, categoryId: e.target.value || null })}
          >
            <option value="">— Select category —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
            ))}
          </select>
        </label>
        <label className="ffield">
          <span>Bank</span>
          <select
            value={draft.bankId || ''}
            onChange={(e) => setDraft({ ...draft, bankId: e.target.value || null })}
          >
            <option value="">— Select bank —</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
        <label className="ffield">
          <span>Beneficiary <b>*</b></span>
          <input
            value={draft.beneficiary}
            onChange={(e) => setDraft({ ...draft, beneficiary: e.target.value })}
          />
        </label>
        <label className="ffield">
          <span>Beneficiary account</span>
          <input
            value={draft.beneficiaryAccountNo || ''}
            onChange={(e) => setDraft({ ...draft, beneficiaryAccountNo: e.target.value })}
          />
        </label>
        <label className="ffield">
          <span>WHT Rate (%)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            max="10"
            value={draft.whtRate}
            onChange={(e) => setDraft({ ...draft, whtRate: Number(e.target.value) })}
          />
        </label>
        <label className="ffield span2">
          <span>Notes</span>
          <input
            value={draft.notes || ''}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </label>
      </div>

      {/* Budget check banner */}
      {budgetCheck && budgetCheck.hasBudget ? (
        budgetCheck.exceeded ? (
          <div className="dbanner err" style={{ marginTop: 14 }}>
            <b>⚠️ Budget exceeded</b> — This voucher will exceed the remaining budget for
            this category. Remaining:{' '}
            <b className="mono">
              ₦{Number(budgetCheck.remaining).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
            </b>
            {' '}(Budgeted: ₦{Number(budgetCheck.budgeted).toLocaleString('en-NG', { minimumFractionDigits: 0 })},
            Spent: ₦{Number(budgetCheck.spent).toLocaleString('en-NG', { minimumFractionDigits: 0 })},
            Committed: ₦{Number(budgetCheck.committed).toLocaleString('en-NG', { minimumFractionDigits: 0 })}).
            You can still submit, but it will need approval.
          </div>
        ) : (
          <div className="dbanner" style={{ marginTop: 14 }}>
            <b>✓ Within budget</b> — Remaining after this voucher:{' '}
            <b className="mono">
              ₦{(Number(budgetCheck.remaining) - Number(draft.amount || 0)).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
            </b>
          </div>
        )
      ) : null}

      <div className="acts" style={{ marginTop: 14 }}>
        <button
          className="btn pri"
          type="button"
          disabled={busy || !draft.description || !draft.amount || !draft.beneficiary}
          onClick={onSave}
        >
          {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create voucher'}
        </button>
        <button className="btn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// --- Voucher Detail Component ---

function VoucherDetail({
  voucher,
  onClose,
  onTransition,
  onPost,
  canApprove,
  canPost,
  busy,
  error,
  success,
}: {
  voucher: Voucher;
  onClose: () => void;
  onTransition: (action: string, remarks?: string) => void;
  onPost: () => void;
  canApprove: boolean;
  canPost: boolean;
  busy: boolean;
  error: string | null;
  success: string | null;
}) {
  const canSubmit = voucher.status === 'DRAFT';
  const canApproveAction = voucher.status === 'PENDING_APPROVAL' && canApprove;
  const canReject = voucher.status === 'PENDING_APPROVAL' && canApprove;
  const canPostAction = voucher.status === 'APPROVED' && canPost;
  const canDelete = voucher.status === 'DRAFT';

  const handleReject = () => {
    const remarks = prompt('Reason for rejection:');
    if (remarks?.trim()) {
      onTransition('REJECT', remarks);
    }
  };

  return (
    <div className="drawerwrap" role="dialog" aria-modal="true">
      <div className="drawerscrim" onClick={onClose} />
      <div className="drawer" style={{ width: 'min(900px, 100%)' }}>
        <header className="dhead">
          <div>
            <div className="crumb">
              <button className="linkact" type="button" onClick={onClose}>← All vouchers</button>
            </div>
            <h2 className="page">
              {voucher.voucherNo}
              <span className="count">
                <span className={`tag ${STATUS_COLORS[voucher.status]}`}>
                  {STATUS_LABELS[voucher.status] || voucher.status}
                </span>
              </span>
            </h2>
          </div>
          <div className="acts">
            {canSubmit ? (
              <button
                className="btn pri"
                type="button"
                disabled={busy || !voucher.vendorId}
                onClick={() => onTransition('SUBMIT')}
              >
                Submit for approval
              </button>
            ) : null}
            {canApproveAction ? (
              <button
                className="btn pri"
                type="button"
                disabled={busy}
                onClick={() => onTransition('APPROVE')}
              >
                Approve
              </button>
            ) : null}
            {canReject ? (
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={handleReject}
              >
                Reject
              </button>
            ) : null}
            {canPostAction ? (
              <button
                className="btn pri"
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Post ${voucher.voucherNo} to the ledger?`)) {
                    onPost();
                  }
                }}
              >
                Post to ledger
              </button>
            ) : null}
            <button className="btn" type="button" onClick={onClose}>Close</button>
          </div>
        </header>

        {error ? <div className="dbanner err">{error}</div> : null}
        {success ? <div className="dbanner">{success}</div> : null}

        <div className="dbody">
          <div className="fsection">
            <div className="entry-detail-header">
              <div>
                <span className="photolabel">Date</span>
                <b>{new Date(voucher.date).toLocaleDateString('en-NG')}</b>
              </div>
              <div>
                <span className="photolabel">Amount</span>
                <b className="mono">{naira(voucher.amount)}</b>
                {Number(voucher.whtRate) > 0 ? (
                  <em>WHT {voucher.whtRate}% = {naira(voucher.whtAmount)}</em>
                ) : null}
              </div>
              <div>
                <span className="photolabel">Net amount</span>
                <b className="mono">{naira(voucher.netAmount)}</b>
              </div>
              <div>
                <span className="photolabel">Beneficiary</span>
                <b>{voucher.beneficiary}</b>
                {voucher.beneficiaryAccountNo ? (
                  <em className="mono">{voucher.beneficiaryAccountNo}</em>
                ) : null}
              </div>
            </div>

            <div className="entry-narration">
              <span className="photolabel">Description</span>
              <p>{voucher.description}</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 14 }}>
              {voucher.vendor ? (
                <div>
                  <span className="photolabel">Vendor</span>
                  <b>{voucher.vendor.name}</b>
                  <em className="mono">{voucher.vendor.code}</em>
                </div>
              ) : null}
              {voucher.category ? (
                <div>
                  <span className="photolabel">Category</span>
                  <b>{voucher.category.name}</b>
                </div>
              ) : null}
              {voucher.bank ? (
                <div>
                  <span className="photolabel">Bank</span>
                  <b>{voucher.bank.name}</b>
                </div>
              ) : null}
              {voucher.rejectionReason ? (
                <div>
                  <span className="photolabel" style={{ color: 'var(--rose)' }}>Rejection reason</span>
                  <b style={{ color: 'var(--rose)' }}>{voucher.rejectionReason}</b>
                </div>
              ) : null}
            </div>
          </div>

          {voucher.approvals?.length ? (
            <div className="fsection">
              <h4>Approval trail</h4>
              <ul className="typelist">
                {voucher.approvals.map((a) => (
                  <li key={a.id}>
                    <div className="typemain">
                      <b>{a.action}</b>
                      <em>
                        {a.actorRole} · {a.fromStatus} → {a.toStatus} ·{' '}
                        {new Date(a.createdAt).toLocaleString('en-NG')}
                        {a.limitApplied ? ` · Limit: ${naira(a.limitApplied)}` : ''}
                      </em>
                      {a.remarks ? (
                        <div className="typetags"><span className="tag">{a.remarks}</span></div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="fnote">
            Vouchers follow the approval chain: ED up to ₦500,000, MD above.
            The raiser cannot approve their own voucher.
          </p>
        </div>
      </div>
    </div>
  );
}