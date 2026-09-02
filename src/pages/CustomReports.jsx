import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { unwrapInvoke, invokeFailure } from '@/lib/invokeResult';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Play, Save, Download, Plus, X, Loader2, Table2, Trash2, Lock, Users,
} from 'lucide-react';
import { toast } from 'sonner';

/**
 * Build a report, run it, save it.
 *
 * Everything on this page is a DEFINITION, never SQL. The definition goes to
 * run_report(), which validates every identifier against the report_field registry
 * before compiling — so this component cannot express a query the server has not
 * already agreed to, and there is nothing here to sanitise.
 *
 * run_report is SECURITY INVOKER, so the rows a report returns are the rows the
 * person running it could see anywhere else in the app. That is why saved reports
 * can be shared freely: sharing a report shares the QUESTION, not the answer.
 */

const OPERATORS = [
  { key: 'eq',       label: 'is',            needsValue: true },
  { key: 'neq',      label: 'is not',        needsValue: true },
  { key: 'contains', label: 'contains',      needsValue: true },
  { key: 'gt',       label: 'is after / >',  needsValue: true },
  { key: 'gte',      label: 'is on or after / ≥', needsValue: true },
  { key: 'lt',       label: 'is before / <', needsValue: true },
  { key: 'lte',      label: 'is on or before / ≤', needsValue: true },
  { key: 'not_null', label: 'is set',        needsValue: false },
  { key: 'is_null',  label: 'is empty',      needsValue: false },
];

const AGG_FNS = ['count', 'sum', 'avg', 'min', 'max'];

const emptyDef = (subject) => ({
  subject, columns: [], filters: [], group_by: [], aggregates: [], order_by: [], row_limit: 500,
});

function toCsv(rows) {
  if (!rows?.length) return '';
  const cols = Object.keys(rows[0]);
  // Quote everything and double interior quotes. Excel opens a value beginning
  // with = as a formula, so anything that looks like one is prefixed — a lead
  // named "=Smith" should not execute in someone's spreadsheet.
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [cols.map(cell).join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
}

export default function CustomReports() {
  const qc = useQueryClient();
  const { user } = useAuth();

  const [def, setDef] = useState(null);
  const [rows, setRows] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [loadedId, setLoadedId] = useState(null);
  const [visibility, setVisibility] = useState('private');

  const { data: subjects = [] } = useQuery({
    queryKey: ['reportSubjects'],
    queryFn: () => base44.entities.ReportSubject.filter({ is_active: true }, 'sort_order'),
  });

  const { data: allFields = [] } = useQuery({
    queryKey: ['reportFields'],
    queryFn: () => base44.entities.ReportField.list('sort_order', 1000),
  });

  const { data: saved = [] } = useQuery({
    queryKey: ['savedReports'],
    queryFn: () => base44.entities.Report.list('-updated_date', 200),
  });

  const fields = useMemo(
    () => allFields.filter((f) => f.subject_key === def?.subject),
    [allFields, def?.subject],
  );
  const fieldByKey = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f])), [fields]);

  const patch = (p) => setDef((d) => ({ ...d, ...p }));

  const pickSubject = (key) => {
    // Columns, filters and grouping all name fields of the old subject, so they
    // cannot survive the switch — carrying them over would produce "Unknown field"
    // from the server and read as a bug rather than a choice.
    setDef(emptyDef(key));
    setRows(null);
    setError('');
    setLoadedId(null);
    setName('');
  };

  const run = async (overrides = {}) => {
    setRunning(true);
    setError('');
    try {
      const payload = { ...def, ...overrides };
      const res = await base44.functions.invoke('runReport', { definition: payload });
      const failed = invokeFailure(res);
      if (failed) { setError(failed); setRows(null); return null; }
      const out = unwrapInvoke(res) ?? [];
      setRows(out);
      return out;
    } finally {
      setRunning(false);
    }
  };

  const download = async () => {
    // Re-run at the ceiling rather than exporting what is on screen. Someone who
    // builds a list, downloads it and never learns it was the first 500 rows has
    // been given a confidently wrong answer.
    const out = await run({ row_limit: 50000 });
    if (!out?.length) { toast.error('Nothing to export'); return; }
    const blob = new Blob([toCsv(out)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(name || def.subject).replace(/[^\w-]+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Exported ${out.length.toLocaleString()} rows`);
  };

  const save = async () => {
    if (!name.trim()) { toast.error('Give the report a name'); return; }
    const record = {
      name: name.trim(), subject_key: def.subject, columns: def.columns,
      filters: def.filters, group_by: def.group_by, aggregates: def.aggregates,
      order_by: def.order_by, row_limit: def.row_limit, visibility,
      owner_id: user?.id ?? null,
    };
    if (loadedId) await base44.entities.Report.update(loadedId, record);
    else {
      const created = await base44.entities.Report.create(record);
      setLoadedId(created?.id ?? created?.[0]?.id ?? null);
    }
    qc.invalidateQueries({ queryKey: ['savedReports'] });
    toast.success('Saved');
  };

  const load = (r) => {
    setDef({
      subject: r.subject_key, columns: r.columns || [], filters: r.filters || [],
      group_by: r.group_by || [], aggregates: r.aggregates || [],
      order_by: r.order_by || [], row_limit: r.row_limit ?? 500,
    });
    setName(r.name);
    setVisibility(r.visibility);
    setLoadedId(r.id);
    setRows(null);
    setError('');
  };

  const remove = async (r) => {
    await base44.entities.Report.delete(r.id);
    if (loadedId === r.id) { setDef(null); setLoadedId(null); setName(''); setRows(null); }
    qc.invalidateQueries({ queryKey: ['savedReports'] });
    toast.success('Deleted');
  };

  const toggleColumn = (key) =>
    patch({ columns: def.columns.includes(key) ? def.columns.filter((c) => c !== key) : [...def.columns, key] });

  const card = 'rounded-xl border border-border bg-card p-4';

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        eyebrow="Reports"
        title="Custom Reports"
        subtitle="Build a report, save it, share it. You only ever see the records you already have access to."
        actions={
          def && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={download} disabled={running} className="gap-2">
                <Download className="h-4 w-4" /> Download CSV
              </Button>
              <Button variant="accent" onClick={() => run()} disabled={running} className="gap-2">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run
              </Button>
            </div>
          )
        }
      />

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        {/* Saved reports */}
        <aside className="space-y-3">
          <div className={card}>
            <h2 className="font-display text-sm font-bold">Start a report</h2>
            <div className="mt-3 space-y-1.5">
              {subjects.map((s) => (
                <button
                  key={s.key}
                  onClick={() => pickSubject(s.key)}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                    def?.subject === s.key && !loadedId
                      ? 'border-brand-pink bg-accent'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  <span className="font-medium text-foreground">{s.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{s.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={card}>
            <h2 className="font-display text-sm font-bold">Saved</h2>
            {!saved.length && <p className="mt-2 text-sm text-muted-foreground">Nothing saved yet.</p>}
            <ul className="mt-3 space-y-1">
              {saved.map((r) => (
                <li key={r.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => load(r)}
                    className={cn(
                      'min-w-0 flex-1 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
                      loadedId === r.id && 'bg-accent',
                    )}
                  >
                    <span className="flex items-center gap-1.5 truncate font-medium text-foreground">
                      {r.visibility === 'shared'
                        ? <Users className="h-3 w-3 shrink-0 text-muted-foreground" />
                        : <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      {r.name}
                    </span>
                  </button>
                  <button
                    onClick={() => remove(r)}
                    className="shrink-0 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-crit group-hover:opacity-100"
                    aria-label={`Delete ${r.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Builder */}
        <main className="space-y-4">
          {!def && (
            <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
              <Table2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="font-medium text-foreground">Pick something to report on</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose a subject on the left, then tick the columns you want.
              </p>
            </div>
          )}

          {def && (
            <>
              <div className={card}>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[200px] flex-1">
                    <Label htmlFor="rname" className="text-xs">Report name</Label>
                    <Input id="rname" value={name} onChange={(e) => setName(e.target.value)}
                           placeholder="e.g. Leads with no appointment" className="mt-1" />
                  </div>
                  <div className="w-40">
                    <Label className="text-xs">Who can see it</Label>
                    <Select value={visibility} onValueChange={setVisibility}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="private">Only me</SelectItem>
                        <SelectItem value="shared">Everyone</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={save} className="gap-2"><Save className="h-4 w-4" /> Save</Button>
                </div>
                {visibility === 'shared' && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Sharing a report shares the question, not the answer — everyone still
                    sees only the records they already have access to.
                  </p>
                )}
              </div>

              {/* Columns */}
              <div className={card}>
                <h3 className="font-display text-sm font-bold">Columns</h3>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {fields.map((f) => (
                    <button
                      key={f.key}
                      onClick={() => toggleColumn(f.key)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors',
                        def.columns.includes(f.key)
                          ? 'border-brand-pink bg-brand-pink text-white'
                          : 'border-border text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                {!def.columns.length && (
                  <p className="mt-2 text-xs text-muted-foreground">Nothing ticked — every column will be returned.</p>
                )}
              </div>

              {/* Filters */}
              <div className={card}>
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-bold">Filters</h3>
                  <Button size="sm" variant="outline" className="gap-1.5"
                          onClick={() => patch({ filters: [...def.filters, { field: fields[0]?.key, op: 'eq', value: '' }] })}>
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </div>
                {!def.filters.length && <p className="mt-2 text-sm text-muted-foreground">No filters — all rows.</p>}
                <div className="mt-3 space-y-2">
                  {def.filters.map((f, i) => {
                    const op = OPERATORS.find((o) => o.key === f.op);
                    const set = (p) => patch({ filters: def.filters.map((x, j) => (i === j ? { ...x, ...p } : x)) });
                    return (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <Select value={f.field} onValueChange={(v) => set({ field: v })}>
                          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {fields.filter((x) => x.filterable).map((x) => (
                              <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={f.op} onValueChange={(v) => set({ op: v })}>
                          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {OPERATORS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {op?.needsValue !== false && (
                          <Input className="w-56" value={f.value ?? ''} onChange={(e) => set({ value: e.target.value })}
                                 placeholder={fieldByKey[f.field]?.data_type === 'date' ? 'YYYY-MM-DD' : 'value'} />
                        )}
                        <button onClick={() => patch({ filters: def.filters.filter((_, j) => j !== i) })}
                                className="rounded p-1.5 text-muted-foreground hover:text-crit" aria-label="Remove filter">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Summarise */}
              <div className={card}>
                <h3 className="font-display text-sm font-bold">Summarise</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Group rows together and count or total them. Leave empty for a plain list.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Group by</Label>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {fields.filter((f) => f.groupable).map((f) => (
                        <button
                          key={f.key}
                          onClick={() => patch({
                            group_by: def.group_by.includes(f.key)
                              ? def.group_by.filter((g) => g !== f.key)
                              : [...def.group_by, f.key],
                          })}
                          className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors',
                            def.group_by.includes(f.key)
                              ? 'border-info bg-info/12 text-info'
                              : 'border-border text-muted-foreground hover:bg-muted')}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Then calculate</Label>
                    <div className="mt-1.5 space-y-2">
                      {def.aggregates.map((a, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Select value={a.fn} onValueChange={(v) => patch({
                            aggregates: def.aggregates.map((x, j) => (i === j ? { ...x, fn: v } : x)),
                          })}>
                            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {AGG_FNS.map((fn) => <SelectItem key={fn} value={fn}>{fn}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Select value={a.field ?? '__count__'} onValueChange={(v) => patch({
                            aggregates: def.aggregates.map((x, j) => (i === j ? { ...x, field: v === '__count__' ? '' : v } : x)),
                          })}>
                            <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__count__">rows</SelectItem>
                              {fields.filter((f) => f.aggregatable).map((f) => (
                                <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <button onClick={() => patch({ aggregates: def.aggregates.filter((_, j) => j !== i) })}
                                  className="rounded p-1.5 text-muted-foreground hover:text-crit" aria-label="Remove">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      <Button size="sm" variant="outline" className="gap-1.5"
                              onClick={() => patch({ aggregates: [...def.aggregates, { fn: 'count', field: '' }] })}>
                        <Plus className="h-3.5 w-3.5" /> Add
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Results */}
              {error && (
                <div className="rounded-xl border border-crit/30 bg-crit/10 p-4 text-sm text-foreground">{error}</div>
              )}
              {rows && !error && (
                <div className="rounded-xl border border-border bg-card">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                    <span className="text-sm font-medium text-foreground">
                      {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'}
                    </span>
                    {rows.length >= def.row_limit && (
                      <span className="text-xs text-warn">
                        Showing the first {def.row_limit.toLocaleString()} — Download CSV gets them all
                      </span>
                    )}
                  </div>
                  <div className="max-h-[520px] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted">
                        <tr>
                          {Object.keys(rows[0] ?? {}).map((c) => (
                            <th key={c} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {c.replace(/_/g, ' ')}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className="border-t border-border">
                            {Object.keys(rows[0]).map((c) => (
                              <td key={c} className={cn('whitespace-nowrap px-3 py-1.5',
                                typeof r[c] === 'number' && 'text-right tabular-nums')}>
                                {r[c] === null || r[c] === undefined ? <span className="text-muted-foreground/60">—</span> : String(r[c])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
