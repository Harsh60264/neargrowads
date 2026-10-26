import { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText, LoaderCircle, X } from 'lucide-react';
import { LEAD_EXPORT_COLUMNS, type LeadExportColumn, type LeadExportScope } from '../../../server/leadExport';

interface LeadExportOptions {
  statuses: { value: string; label: string }[];
  sources: string[];
  services: string[];
}

interface Props {
  search: string;
  statusFilter: string;
  selectedIds: string[];
}

const inputClass = 'min-h-10 w-full rounded-lg border border-[#DCE4DC] bg-white px-3 text-sm text-[#26352A] outline-none focus:border-[#70A77A]';

function todayInKolkata(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function AdminLeadExport({ search, statusFilter, selectedIds }: Props) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<LeadExportOptions | null>(null);
  const [scope, setScope] = useState<LeadExportScope>('all');
  const [status, setStatus] = useState('all');
  const [source, setSource] = useState('');
  const [service, setService] = useState('');
  const [from, setFrom] = useState(todayInKolkata);
  const [to, setTo] = useState(todayInKolkata);
  const [format, setFormat] = useState<'csv' | 'xlsx'>('xlsx');
  const [columns, setColumns] = useState<LeadExportColumn[]>(
    LEAD_EXPORT_COLUMNS.filter((column) => !column.required).map((column) => column.key),
  );
  const [recordCount, setRecordCount] = useState<number | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedCount = selectedIds.length;
  const payload = useMemo(() => ({
    scope,
    status,
    source,
    service,
    search: scope === 'filtered' ? search.trim() : '',
    selectedIds: scope === 'selected' ? selectedIds : [],
    ...(scope === 'custom' ? { from, to } : {}),
  }), [scope, status, source, service, search, selectedIds, from, to]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoadingOptions(true);
    setError('');
    fetch('/api/admin/leads/export/options', { credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        const result = await response.json().catch(() => ({})) as LeadExportOptions & { message?: string };
        if (!response.ok) throw new Error(result.message || `Could not load export options (${response.status}).`);
        setOptions(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load export options.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingOptions(false);
      });
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open || (scope === 'selected' && selectedIds.length === 0)) {
      setRecordCount(scope === 'selected' ? 0 : null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPreviewing(true);
      setError('');
      fetch('/api/admin/leads/export/preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
        .then(async (response) => {
          const result = await response.json().catch(() => ({})) as { recordCount?: number; message?: string };
          if (!response.ok) throw new Error(result.message || `Could not count matching leads (${response.status}).`);
          setRecordCount(typeof result.recordCount === 'number' ? result.recordCount : 0);
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) {
            setRecordCount(null);
            setError(reason instanceof Error ? reason.message : 'Could not count matching leads.');
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreviewing(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, payload, scope, selectedIds.length]);

  const showModal = () => {
    const hasCurrentFilters = Boolean(search.trim()) || statusFilter !== 'all';
    setScope(hasCurrentFilters ? 'filtered' : 'all');
    setStatus(hasCurrentFilters ? statusFilter : 'all');
    setRecordCount(null);
    setError('');
    setNotice('');
    setOpen(true);
  };

  const generateExport = async () => {
    if (scope === 'selected' && selectedIds.length === 0) {
      setError('Select at least one lead in the table first.');
      return;
    }
    if (recordCount === 0) {
      setError('No leads found for the selected filters.');
      return;
    }
    setGenerating(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/leads/export', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, format, columns }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(result.message || `Export failed (${response.status}).`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const filename = /filename="([^"]+)"/i.exec(disposition)?.[1] || `NearGrowAds_Leads.${format}`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setNotice(`${recordCount ?? 'Your'} lead${recordCount === 1 ? '' : 's'} exported successfully.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The lead export failed. Retry the export.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <button type="button" onClick={showModal} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#C9D9CB] bg-[#F4FAF4] px-3 text-xs font-semibold text-[#286D3B] hover:bg-[#EAF5EB]">
        <Download className="h-4 w-4" /> Export Leads
      </button>
      {open && <div className="admin-overlay fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-[#101B13]/55 p-3 backdrop-blur-sm sm:p-5" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !generating) setOpen(false);
      }}>
        <section role="dialog" aria-modal="true" aria-labelledby="lead-export-title" className="w-full max-w-2xl rounded-2xl border border-[#E1E7E0] bg-white p-5 text-[#29372C] shadow-2xl sm:p-7">
          <header className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#328148]">Lead management</p>
              <h2 id="lead-export-title" className="mt-1 text-xl font-bold">Export Leads</h2>
              <p className="mt-1 text-xs text-[#788379]">Export matching records securely. Dates are interpreted in Asia/Kolkata.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} disabled={generating} aria-label="Close export dialog" className="rounded-lg p-2 text-[#7B877D] hover:bg-[#F1F5F0] disabled:opacity-50"><X className="h-4 w-4" /></button>
          </header>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold text-[#59665B]">Lead range
              <select className={`${inputClass} mt-1.5`} value={scope} onChange={(event) => setScope(event.target.value as LeadExportScope)}>
                <option value="all">All Leads</option>
                <option value="filtered">Currently Filtered Leads</option>
                <option value="selected">Selected Leads ({selectedCount})</option>
                <option value="today">Today</option>
                <option value="last7">Last 7 Days</option>
                <option value="last30">Last 30 Days</option>
                <option value="thisMonth">This Month</option>
                <option value="custom">Custom Date Range</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-[#59665B]">Status
              <select className={`${inputClass} mt-1.5`} value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="all">All statuses</option>
                {(options?.statuses || []).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-[#59665B]">Lead source
              <select className={`${inputClass} mt-1.5`} value={source} onChange={(event) => setSource(event.target.value)} disabled={loadingOptions}>
                <option value="">All sources</option>
                {(options?.sources || []).map((item) => <option key={item} value={item}>{item === 'NEO Chatbot' ? item : item === '/contact' ? 'Contact Form' : item === '/get-started' ? 'Consultation' : item}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-[#59665B]">Interested service
              <select className={`${inputClass} mt-1.5`} value={service} onChange={(event) => setService(event.target.value)} disabled={loadingOptions}>
                <option value="">All services</option>
                {(options?.services || []).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            {scope === 'custom' && <>
              <label className="text-xs font-semibold text-[#59665B]">From date
                <input className={`${inputClass} mt-1.5`} type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
              </label>
              <label className="text-xs font-semibold text-[#59665B]">To date
                <input className={`${inputClass} mt-1.5`} type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
              </label>
            </>}
          </div>
          {scope === 'filtered' && <p className="mt-3 text-[11px] text-[#7D887F]">Search: {search.trim() || 'none'} · Current table status filter is applied unless changed above.</p>}
          {scope === 'selected' && <p className="mt-3 text-[11px] text-[#7D887F]">{selectedCount} lead{selectedCount === 1 ? '' : 's'} selected across visited table pages.</p>}

          <fieldset className="mt-5 rounded-xl border border-[#E1E7E0] p-4">
            <legend className="px-1 text-xs font-semibold text-[#465349]">File format</legend>
            <div className="flex flex-wrap gap-3">
              <label className="flex min-h-10 items-center gap-2 rounded-lg border border-[#E1E7E0] px-3 text-xs"><input type="radio" name="lead-export-format" checked={format === 'csv'} onChange={() => setFormat('csv')} /><FileText className="h-4 w-4 text-[#328148]" /> CSV (Excel-compatible)</label>
              <label className="flex min-h-10 items-center gap-2 rounded-lg border border-[#E1E7E0] px-3 text-xs"><input type="radio" name="lead-export-format" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} /><FileSpreadsheet className="h-4 w-4 text-[#328148]" /> Excel (.xlsx)</label>
            </div>
          </fieldset>

          <fieldset className="mt-4 rounded-xl border border-[#E1E7E0] p-4">
            <legend className="px-1 text-xs font-semibold text-[#465349]">Optional columns</legend>
            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {LEAD_EXPORT_COLUMNS.filter((column) => !column.required).map((column) => (
                <label key={column.key} className="flex items-center gap-2 text-xs text-[#59665B]">
                  <input type="checkbox" checked={columns.includes(column.key)} onChange={(event) => setColumns((current) => event.target.checked
                    ? [...current, column.key]
                    : current.filter((item) => item !== column.key))} />
                  {column.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-[#879188]">Lead ID, business name, interested service, status and received date are always included.</p>
          </fieldset>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#F5F8F4] px-4 py-3">
            <p role="status" className="text-xs font-medium text-[#59665B]">
              {previewing ? 'Counting matching leads…' : recordCount === null ? 'Record count unavailable' : recordCount === 0 ? 'No leads found for the selected filters.' : `${recordCount.toLocaleString()} lead${recordCount === 1 ? '' : 's'} will be exported.`}
            </p>
            {error && <p role="alert" className="w-full text-xs text-rose-700">{error}</p>}
            {notice && <p role="status" className="w-full text-xs text-emerald-700">{notice}</p>}
          </div>

          <footer className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} disabled={generating} className="min-h-10 rounded-lg border border-[#DCE4DC] px-4 text-xs font-semibold text-[#59665B] disabled:opacity-50">Close</button>
            <button type="button" onClick={() => void generateExport()} disabled={generating || previewing || recordCount === null || recordCount === 0 || (scope === 'selected' && selectedCount === 0)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#286D3B] px-4 text-xs font-semibold text-white hover:bg-[#347E49] disabled:cursor-not-allowed disabled:opacity-50">
              {generating ? <><LoaderCircle className="h-4 w-4 animate-spin" /> Generating export…</> : <><Download className="h-4 w-4" /> Generate Export</>}
            </button>
          </footer>
        </section>
      </div>}
    </>
  );
}
