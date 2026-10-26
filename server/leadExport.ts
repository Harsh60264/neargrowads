import { resolveAuditDateRange } from './auditLogExport';

export const LEAD_EXPORT_TIME_ZONE = 'Asia/Kolkata';
export const LEAD_EXPORT_PAGE_SIZE = 500;

export type LeadExportScope =
  | 'all'
  | 'filtered'
  | 'selected'
  | 'today'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'custom';

export type LeadExportFormat = 'csv' | 'xlsx';

export const LEAD_EXPORT_COLUMNS = [
  { key: 'id', label: 'Lead ID', required: true },
  { key: 'businessName', label: 'Business / Customer Name', required: true },
  { key: 'name', label: 'Contact Person', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'phone', label: 'Phone / WhatsApp', required: false },
  { key: 'serviceInterest', label: 'Interested Service', required: true },
  { key: 'sourcePage', label: 'Lead Source', required: false },
  { key: 'message', label: 'Enquiry Message', required: false },
  { key: 'status', label: 'Status', required: true },
  { key: 'createdAt', label: 'Received Date & Time (Asia/Kolkata)', required: true },
  { key: 'updatedAt', label: 'Last Updated Date (Asia/Kolkata)', required: false },
] as const;

export type LeadExportColumn = typeof LEAD_EXPORT_COLUMNS[number]['key'];

export interface LeadExportFilters {
  scope: LeadExportScope;
  status: 'all' | 'new' | 'reviewed' | 'contacted';
  source: string;
  service: string;
  search: string;
  selectedIds: string[];
  from?: string;
  to?: string;
}

function dateInKolkata(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LEAD_EXPORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftCalendarDate(value: string, offset: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offset));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

export function leadExportDateRange(
  filters: Pick<LeadExportFilters, 'scope' | 'from' | 'to'>,
  now = new Date(),
): ReturnType<typeof resolveAuditDateRange> | undefined {
  if (filters.scope === 'all' || filters.scope === 'filtered' || filters.scope === 'selected') return undefined;
  const today = dateInKolkata(now);
  if (filters.scope === 'custom') {
    if (!filters.from || !filters.to) throw new Error('Choose both dates for the custom date range.');
    return resolveAuditDateRange(filters.from, filters.to, LEAD_EXPORT_TIME_ZONE);
  }
  if (filters.scope === 'today') return resolveAuditDateRange(today, today, LEAD_EXPORT_TIME_ZONE);
  if (filters.scope === 'last7') return resolveAuditDateRange(shiftCalendarDate(today, -6), today, LEAD_EXPORT_TIME_ZONE);
  if (filters.scope === 'last30') return resolveAuditDateRange(shiftCalendarDate(today, -29), today, LEAD_EXPORT_TIME_ZONE);
  const monthStart = `${today.slice(0, 7)}-01`;
  return resolveAuditDateRange(monthStart, today, LEAD_EXPORT_TIME_ZONE);
}

export function protectLeadCsvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\u0000-\u0020\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function formatLeadExportDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: LEAD_EXPORT_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

export function leadSourceLabel(sourcePage: string): string {
  if (sourcePage === 'NEO Chatbot') return 'NEO Chatbot';
  if (sourcePage === '/contact') return 'Contact Form';
  if (sourcePage === '/get-started') return 'Consultation';
  return sourcePage;
}
