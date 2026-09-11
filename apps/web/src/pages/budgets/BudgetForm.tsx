import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getBudget, createBudget, updateBudget, listExpenseCategories,
  ApiError, type ExpenseCategory,
} from '../../lib/api';

const naira = (v: number | string) =>
  '₦' + Number(v).toLocaleString('en-NG', { minimumFractionDigits: 2 });

interface LineDraft {
  categoryId: string;
  itemName: string;
  amountBudgeted: string;
  notes: string;
}

export default function BudgetForm({
  budgetId,
  onClose,
  onSaved,
}: {
  budgetId: string | null;
  onClose: () => void;
  onSaved: (budget: { id: string }) => void;
}) {
  const isEdit = !!budgetId;
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(`${new Date().getUTCFullYear()} Operating Budget`);
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);

  const { data: categories, isLoading: loadingCategories, error: categoriesError } = useQuery({
    queryKey: ['expense-categories', false],
    queryFn: () => listExpenseCategories(false),
  });

  const { data: existing } = useQuery({
    queryKey: ['budget', budgetId],
    queryFn: () => getBudget(budgetId!),
    enabled: isEdit,
  });

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setYear(existing.year);
      setNotes(existing.notes || '');
      setLines(
        (existing.lines || []).map((l: any) => ({
          categoryId: l.categoryId,
          itemName: l.itemName,
          amountBudgeted: String(l.amountBudgeted),
          notes: l.notes || '',
        })),
      );
    }
  }, [existing]);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        year,
        notes: notes || null,
        lines: lines
          .filter((l) => l.categoryId && l.amountBudgeted)
          .map((l) => ({
            categoryId: l.categoryId,
            itemName: l.itemName,
            amountBudgeted: Number(l.amountBudgeted),
            notes: l.notes || null,
          })),
      };
      return isEdit ? updateBudget(budgetId!, payload) : createBudget(payload);
    },
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['budget', budgetId] });
      onSaved(b);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save.'),
  });

  const addLine = (cat?: ExpenseCategory) => {
    setLines([
      ...lines,
      {
        categoryId: cat?.id || '',
        itemName: cat?.name || '',
        amountBudgeted: '0',
        notes: '',
      },
    ]);
  };

  const removeLine = (i: number) => {
    setLines(lines.filter((_, idx) => idx !== i));
  };

  const updateLine = (i: number, patch: Partial<LineDraft>) => {
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const onCategoryChange = (i: number, categoryId: string) => {
    const cat = categories?.find((c) => c.id === categoryId);
    updateLine(i, {
      categoryId,
      itemName: cat?.name || '',
    });
  };

  const total = lines.reduce((s, l) => s + Number(l.amountBudgeted || 0), 0);
  const usedCategoryIds = new Set(lines.map((l) => l.categoryId));
  const availableCategories = (categories || []).filter((c) => !usedCategoryIds.has(c.id));

  return (
    <>
      <header className="topbar">
        <div className="crumb">
          <button className="linkact" type="button" onClick={onClose}>← Budgets</button>
        </div>
        <div className="titlerow">
          <h2 className="page">{isEdit ? 'Edit budget' : 'New budget'}</h2>
          <div className="acts">
            <button
              className="btn pri"
              type="button"
              disabled={save.isPending || !name || lines.length === 0}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create budget'}
            </button>
            <button className="btn" type="button" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </header>

      <div className="body">
        {error ? <div className="dbanner err" style={{ marginBottom: 14 }}>{error}</div> : null}
        {categoriesError ? (
          <div className="dbanner err" style={{ marginBottom: 14 }}>
            Could not load expense categories. Please create categories first.
          </div>
        ) : null}

        <div className="fsection">
          <h4>Budget details</h4>
          <div className="fgrid">
            <label className="ffield span2">
              <span>Budget name <b>*</b></span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 2026 Operating Budget"
              />
            </label>
            <label className="ffield">
              <span>Year <b>*</b></span>
              <input
                type="number"
                value={year}
                min={2020}
                max={2100}
                disabled={isEdit}
                onChange={(e) => setYear(Number(e.target.value))}
              />
              {isEdit ? <em className="fhint">Year cannot be changed after creation</em> : null}
            </label>
            <label className="ffield">
              <span>Total budget</span>
              <input value={naira(total)} readOnly style={{ background: 'var(--paper)' }} />
            </label>
            <label className="ffield span2">
              <span>Notes</span>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="fsection">
          <h4>Budget lines</h4>

          {loadingCategories ? (
            <p className="fnote" style={{ padding: 0 }}>Loading categories…</p>
          ) : !categories?.length ? (
            <div className="dbanner err" style={{ marginBottom: 14 }}>
              <b>No expense categories defined.</b>
              <p style={{ marginTop: 6 }}>
                Please create expense categories first in{' '}
                <b>Settings → Finance settings → Expense categories</b>.
              </p>
            </div>
          ) : null}

          {lines.length === 0 ? (
            <p className="fnote" style={{ padding: '0 0 12px' }}>
              No lines added yet. Click "Add line" or use "Quick add category" below.
            </p>
          ) : (
            <div className="tablewrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Item name</th>
                    <th className="num">Amount budgeted (₦)</th>
                    <th>Notes</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={i}>
                      <td>
                        <select
                          value={line.categoryId}
                          onChange={(e) => onCategoryChange(i, e.target.value)}
                          style={{ width: '100%' }}
                        >
                          <option value="">— Select category —</option>
                          {(categories || [])
                            .filter(
                              (c) =>
                                !usedCategoryIds.has(c.id) || c.id === line.categoryId,
                            )
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.code} - {c.name}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td>
                        <input
                          value={line.itemName}
                          onChange={(e) => updateLine(i, { itemName: e.target.value })}
                          placeholder="Item display name"
                          style={{ width: '100%' }}
                        />
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          step="0.01"
                          value={line.amountBudgeted}
                          onChange={(e) => updateLine(i, { amountBudgeted: e.target.value })}
                          style={{ width: 140, textAlign: 'right' }}
                        />
                      </td>
                      <td>
                        <input
                          value={line.notes}
                          onChange={(e) => updateLine(i, { notes: e.target.value })}
                          placeholder="Optional"
                          style={{ width: '100%' }}
                        />
                      </td>
                      <td className="num">
                        <button
                          className="linkact danger"
                          type="button"
                          onClick={() => removeLine(i)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}><b>Total</b></td>
                    <td className="num mono"><b>{naira(total)}</b></td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="acts" style={{ marginTop: 14, display: 'flex', gap: 10 }}>
            <button className="btn" type="button" onClick={() => addLine()}>
              + Add line
            </button>

            {availableCategories.length > 0 ? (
              <select
                className="linkselect"
                onChange={(e) => {
                  const cat = availableCategories.find((c) => c.id === e.target.value);
                  if (cat) addLine(cat);
                  e.target.value = '';
                }}
                style={{ padding: '7px 12px' }}
              >
                <option value="">Quick add category…</option>
                {availableCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                ))}
              </select>
            ) : null}

            {lines.length > 0 && availableCategories.length > 0 ? (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  const newLines = [...lines];
                  for (const cat of availableCategories) {
                    newLines.push({
                      categoryId: cat.id,
                      itemName: cat.name,
                      amountBudgeted: '0',
                      notes: '',
                    });
                  }
                  setLines(newLines);
                }}
              >
                Add all remaining categories
              </button>
            ) : null}
          </div>
        </div>

        <p className="fnote">
          Each budget line maps to an expense category. When vouchers are raised for that
          category, the budget will be automatically updated.
        </p>
      </div>
    </>
  );
}