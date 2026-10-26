export const AUDIT_EXPORT_TIME_ZONE = 'Asia/Kolkata';
export const AUDIT_EXPORT_PAGE_SIZE = 500;
export const AUDIT_EXPORT_SENSITIVE_MARKER = '[REDACTED]';

export interface AuditDateRange {
  from: string;
  to: string;
  timeZone: string;
  startUtc: string;
  endUtcExclusive: string;
}

export interface RedactionResult {
  value: unknown;
  count: number;
  keys: string[];
}

const SENSITIVE_KEY_PARTS = [
  'password',
  'passwd',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'secret',
  'cookie',
  'authorization',
  'credential',
  'privatekey',
  'clientsecret',
  'servicerolekey',
  'servicekey',
  'signingkey',
  'encryptionkey',
  'jwt',
];

function parseCalendarDate(value: string): [number, number, number] | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return [year, month, day];
}

function zonedMidnightUtc(date: [number, number, number], timeZone: string): Date {
  const [year, month, day] = date;
  const wallTime = Date.UTC(year, month - 1, day);
  let guess = wallTime;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const renderedWallTime = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    guess = wallTime - (renderedWallTime - guess);
  }
  return new Date(guess);
}

export function resolveAuditDateRange(from: string, to: string, timeZone = AUDIT_EXPORT_TIME_ZONE): AuditDateRange {
  const fromDate = parseCalendarDate(from);
  const toDate = parseCalendarDate(to);
  if (!fromDate || !toDate) throw new Error('Choose valid start and end dates.');
  if (from > to) throw new Error('The start date must be on or before the end date.');

  const nextEnd = new Date(Date.UTC(toDate[0], toDate[1] - 1, toDate[2] + 1));
  const endDate: [number, number, number] = [
    nextEnd.getUTCFullYear(),
    nextEnd.getUTCMonth() + 1,
    nextEnd.getUTCDate(),
  ];
  return {
    from,
    to,
    timeZone,
    startUtc: zonedMidnightUtc(fromDate, timeZone).toISOString(),
    endUtcExclusive: zonedMidnightUtc(endDate, timeZone).toISOString(),
  };
}

export function buildAuditLogCursorFilter(createdAt: string, id: string): string {
  return `(created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id}))`;
}

export interface AuditLogCursor {
  createdAt: string;
  id: string;
}

export async function* iterateAuditLogRecords(
  fetchPage: (cursor?: AuditLogCursor) => Promise<Array<Record<string, unknown>>>,
  expectedCount: number,
  pageSize = AUDIT_EXPORT_PAGE_SIZE,
): AsyncGenerator<Record<string, unknown>> {
  let exportedCount = 0;
  let cursor: AuditLogCursor | undefined;
  while (exportedCount < expectedCount) {
    const page = await fetchPage(cursor);
    if (!Array.isArray(page) || page.length > pageSize) throw new Error('The audit export returned an invalid page.');
    if (page.length === 0) break;
    for (const record of page) {
      if (typeof record.created_at !== 'string' || typeof record.id !== 'string') {
        throw new Error('An audit export page was missing its pagination key.');
      }
      if (cursor && (record.created_at > cursor.createdAt ||
        (record.created_at === cursor.createdAt && record.id >= cursor.id))) {
        throw new Error('The audit export pagination cursor did not advance.');
      }
      yield record;
      exportedCount += 1;
      if (exportedCount === expectedCount) break;
    }
    if (exportedCount < expectedCount) {
      if (page.length < pageSize) break;
      const last = page[page.length - 1];
      cursor = { createdAt: last.created_at as string, id: last.id as string };
    }
  }
  if (exportedCount !== expectedCount) {
    throw new Error(`Audit export count mismatch: expected ${expectedCount}, received ${exportedCount}.`);
  }
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

export function redactSensitiveFields(value: unknown): RedactionResult {
  let count = 0;
  const keys = new Set<string>();
  const redact = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(redact);
    if (!entry || typeof entry !== 'object') return entry;
    return Object.fromEntries(Object.entries(entry).map(([key, nested]) => {
      if (isSensitiveKey(key)) {
        count += 1;
        keys.add(key);
        return [key, AUDIT_EXPORT_SENSITIVE_MARKER];
      }
      return [key, redact(nested)];
    }));
  };
  return { value: redact(value), count, keys: [...keys].sort() };
}

export function protectCsvCell(value: unknown): string {
  let text = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  if (/^[\u0000-\u0020\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export const AUDIT_CSV_COLUMNS = [
  'event_id',
  'timestamp_utc',
  'action',
  'actor_id',
  'actor_email_current',
  'target_id',
  'target_email_current',
  'section',
  'metadata_json',
  'additional_fields_json',
  'redacted_field_count',
  'redacted_field_names_json',
] as const;

const KNOWN_RECORD_FIELDS = new Set([
  'id',
  'created_at',
  'action',
  'actor_id',
  'target_id',
  'section',
  'details',
  'actor_email_current',
  'target_email_current',
]);

export interface SanitizedAuditRecord {
  record: Record<string, unknown>;
  redactionCount: number;
  redactedKeys: string[];
}

export function normalizeAuditExportRecord(value: Record<string, unknown>): Record<string, unknown> {
  const actor = value.actor && typeof value.actor === 'object' ? value.actor as Record<string, unknown> : {};
  const target = value.target && typeof value.target === 'object' ? value.target as Record<string, unknown> : {};
  const storedFields = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'actor' && key !== 'target'));
  return {
    ...storedFields,
    actor_email_current: typeof actor.email === 'string' ? actor.email : null,
    target_email_current: typeof target.email === 'string' ? target.email : null,
  };
}

export function sanitizeAuditRecord(value: Record<string, unknown>): SanitizedAuditRecord {
  const redacted = redactSensitiveFields(value.details);
  return {
    record: {
      ...value,
      details: redacted.value,
    },
    redactionCount: redacted.count,
    redactedKeys: redacted.keys,
  };
}

export function serializeAuditRecordCsv(value: SanitizedAuditRecord): string {
  const record = value.record;
  const additionalFields = Object.fromEntries(Object.entries(record).filter(([key]) => !KNOWN_RECORD_FIELDS.has(key)));
  const fields = [
    record.id,
    record.created_at,
    record.action,
    record.actor_id,
    record.actor_email_current,
    record.target_id,
    record.target_email_current,
    record.section,
    JSON.stringify(record.details ?? null),
    JSON.stringify(additionalFields),
    value.redactionCount,
    JSON.stringify(value.redactedKeys),
  ];
  return `${fields.map(protectCsvCell).join(',')}\r\n`;
}
