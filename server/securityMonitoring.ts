export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical';
export type SecurityAlertStatus = 'new' | 'investigating' | 'resolved';

export interface SecurityRuleSettings {
  windowMinutes: number;
  failedLogins: number;
  unauthorizedRequests: number;
  restrictedDenials: number;
  bulkLeadExportRecords: number;
  alertNonOwnerPrivilegeChanges: boolean;
}

export interface SecuritySourceEvent {
  id: string;
  eventType: string;
  occurredAt: string;
  actorId?: string | null;
  subjectHash?: string | null;
  route?: string | null;
  statusCode?: number | null;
  action?: string | null;
  details?: Record<string, unknown> | null;
  actorIsPrimaryOwner?: boolean;
}

export interface SecurityAccessDescriptor {
  isPrimaryOwner: boolean;
  permissions?: {
    securityMonitoring?: {
      view?: boolean;
      edit?: boolean;
    };
  };
}

export interface SecurityIndicator {
  ruleId: string;
  fingerprint: string;
  severity: SecuritySeverity;
  title: string;
  summary: string;
  eventIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export const DEFAULT_SECURITY_RULES: SecurityRuleSettings = Object.freeze({
  windowMinutes: 15,
  failedLogins: 5,
  unauthorizedRequests: 15,
  restrictedDenials: 5,
  bulkLeadExportRecords: 100,
  alertNonOwnerPrivilegeChanges: true,
});

export function securityMonitoringFailureMessage(status?: number, code?: string): string {
  if (code === 'PGRST205' || code === '42P01') {
    return 'The configured database does not expose the Security Monitoring schema. Verify the Supabase project and apply supabase/migrations/20261027130000_create_security_monitoring.sql, or refresh the PostgREST schema cache if it was already applied.';
  }
  if (code === 'PGRST204' || code === '42703') {
    return 'The Security Monitoring database schema does not match this application version. Review the applied monitoring migration and database schema.';
  }
  if (code === '42501') {
    return 'The server database role cannot read the Security Monitoring data. Verify the service-role grants and database access configuration.';
  }
  if (status === 401) return 'Your admin session has expired. Sign in again to access Security Monitoring.';
  if (status === 403) return 'Your account does not have permission to access Security Monitoring.';
  if (status === 0) return 'The monitoring database could not be reached. Check the server database connection and retry.';
  return 'Security Monitoring data is unavailable. Check the server database connection, schema and access configuration, then retry.';
}

const SECRET_KEY = /password|passwd|token|secret|api.?key|credential|cookie|authorization|jwt/i;
const PII_KEY = /email|phone|mobile|address|name|message|contact/i;

export function sanitizeSecurityDetails(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key) || PII_KEY.test(key)) continue;
    if (typeof raw === 'string') safe[key.slice(0, 48)] = raw.slice(0, 160);
    else if (typeof raw === 'number' && Number.isFinite(raw)) safe[key.slice(0, 48)] = raw;
    else if (typeof raw === 'boolean' || raw === null) safe[key.slice(0, 48)] = raw;
  }
  return safe;
}

export function validateSecurityRules(value: unknown): SecurityRuleSettings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const integerWithin = (key: keyof SecurityRuleSettings, min: number, max: number) =>
    Number.isInteger(candidate[key]) && Number(candidate[key]) >= min && Number(candidate[key]) <= max;
  if (!integerWithin('windowMinutes', 1, 1440) ||
    !integerWithin('failedLogins', 2, 100) ||
    !integerWithin('unauthorizedRequests', 3, 500) ||
    !integerWithin('restrictedDenials', 2, 100) ||
    !integerWithin('bulkLeadExportRecords', 10, 100_000) ||
    typeof candidate.alertNonOwnerPrivilegeChanges !== 'boolean') return undefined;
  return {
    windowMinutes: Number(candidate.windowMinutes),
    failedLogins: Number(candidate.failedLogins),
    unauthorizedRequests: Number(candidate.unauthorizedRequests),
    restrictedDenials: Number(candidate.restrictedDenials),
    bulkLeadExportRecords: Number(candidate.bulkLeadExportRecords),
    alertNonOwnerPrivilegeChanges: candidate.alertNonOwnerPrivilegeChanges,
  };
}

function eventTime(event: SecuritySourceEvent): number {
  const timestamp = Date.parse(event.occurredAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function indicator(
  ruleId: string,
  fingerprint: string,
  severity: SecuritySeverity,
  title: string,
  summary: string,
  events: SecuritySourceEvent[],
): SecurityIndicator {
  const ordered = [...events].sort((a, b) => eventTime(a) - eventTime(b));
  return {
    ruleId,
    fingerprint,
    severity,
    title,
    summary,
    eventIds: ordered.map((event) => event.id),
    firstSeenAt: ordered[0]?.occurredAt || new Date(0).toISOString(),
    lastSeenAt: ordered.at(-1)?.occurredAt || new Date(0).toISOString(),
  };
}

export function detectSecurityIndicators(
  sourceEvents: readonly SecuritySourceEvent[],
  rules: SecurityRuleSettings,
  now = Date.now(),
): SecurityIndicator[] {
  const windowStart = now - rules.windowMinutes * 60_000;
  const recent = sourceEvents.filter((event) => eventTime(event) >= windowStart && eventTime(event) <= now);
  const indicators: SecurityIndicator[] = [];
  const groupBy = (events: SecuritySourceEvent[], keyOf: (event: SecuritySourceEvent) => string | undefined) => {
    const groups = new Map<string, SecuritySourceEvent[]>();
    events.forEach((event) => {
      const key = keyOf(event);
      if (!key) return;
      groups.set(key, [...(groups.get(key) || []), event]);
    });
    return groups;
  };

  for (const [subject, events] of groupBy(
    recent.filter((event) => event.eventType === 'auth.login.failed'),
    (event) => event.subjectHash || undefined,
  )) {
    if (events.length >= rules.failedLogins) indicators.push(indicator(
      'repeated_failed_logins', subject, events.length >= rules.failedLogins * 3 ? 'critical' : events.length >= rules.failedLogins * 2 ? 'high' : 'medium',
      'Repeated authentication failures', `${events.length} failed login attempts for one pseudonymous account identifier in ${rules.windowMinutes} minutes. This is a suspicious indicator, not a confirmed attack.`,
      events,
    ));
  }
  for (const [source, events] of groupBy(
    recent.filter((event) => event.eventType === 'auth.login.failed'),
    (event) => typeof event.details?.sourceHash === 'string' ? event.details.sourceHash : undefined,
  )) {
    if (events.length >= rules.failedLogins) indicators.push(indicator(
      'repeated_failed_login_source',
      `source:${source}`,
      events.length >= rules.failedLogins * 3 ? 'critical' : events.length >= rules.failedLogins * 2 ? 'high' : 'medium',
      'Repeated sign-in failures from one source',
      `${events.length} failed login attempts from one pseudonymous source in ${rules.windowMinutes} minutes. This may also reflect a shared network or user error.`,
      events,
    ));
  }

  for (const [subject, events] of groupBy(
    recent.filter((event) => event.eventType === 'api.unauthorized'),
    (event) => event.subjectHash || event.actorId || undefined,
  )) {
    if (events.length >= rules.unauthorizedRequests) indicators.push(indicator(
      'excessive_unauthorized_requests', subject, events.length >= rules.unauthorizedRequests * 3 ? 'critical' : events.length >= rules.unauthorizedRequests * 2 ? 'high' : 'medium',
      'Excessive unauthorized API requests', `${events.length} unauthorized API requests from one pseudonymous source in ${rules.windowMinutes} minutes. This may also reflect a stale session or misconfigured client.`,
      events,
    ));
  }

  for (const [subject, events] of groupBy(
    recent.filter((event) => event.eventType === 'api.unauthorized' && event.statusCode === 403),
    (event) => `${event.subjectHash || event.actorId || 'unknown'}:${event.route || 'unknown'}`,
  )) {
    if (events.length >= rules.restrictedDenials) indicators.push(indicator(
      'repeated_restricted_access_denials', subject, events.length >= rules.restrictedDenials * 3 ? 'critical' : events.length >= rules.restrictedDenials * 2 ? 'high' : 'medium',
      'Repeated restricted-module denials', `${events.length} access denials for the same module in ${rules.windowMinutes} minutes. This is a suspicious indicator, not a confirmed attack.`,
      events,
    ));
  }

  for (const event of recent.filter((candidate) =>
    candidate.action === 'leads.export.generated' &&
    Number(candidate.details?.recordCount) >= rules.bulkLeadExportRecords)) {
    indicators.push(indicator(
      'unusual_bulk_lead_export', event.id,
      Number(event.details?.recordCount) >= rules.bulkLeadExportRecords * 5 ? 'critical' : 'high',
      'Unusually large lead export', `A single export included ${Number(event.details?.recordCount)} records, meeting the configured ${rules.bulkLeadExportRecords}-record threshold.`,
      [event],
    ));
  }

  if (rules.alertNonOwnerPrivilegeChanges) {
    const privilegedActions = new Set([
      'admin.created_with_temporary_password',
      'admin.invited',
      'admin.role.changed',
      'admin.permissions.updated',
      'admin.disabled',
      'admin.removed',
      'admin.access.updated',
    ]);
    for (const event of recent.filter((candidate) =>
      candidate.action && privilegedActions.has(candidate.action) && candidate.actorIsPrimaryOwner === false)) {
      indicators.push(indicator(
        'non_owner_privileged_change', event.id,
        event.details?.role === 'owner' ? 'critical' : 'high',
        'Privileged account change by delegated administrator',
        'A sensitive administrator-account change was made by an actor who is not the Primary Owner. Review the associated audit event; this is not proof of misuse.',
        [event],
      ));
    }
  }
  return indicators;
}

export function canAccessSecurityMonitoring(
  identity: SecurityAccessDescriptor,
  action: 'view' | 'edit',
): boolean {
  return identity.isPrimaryOwner || (
    identity.permissions?.securityMonitoring?.view === true &&
    (action === 'view' || identity.permissions.securityMonitoring.edit === true)
  );
}

export function securityEventPageOffset(page: number, pageSize: number): number {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('Invalid security event pagination.');
  }
  return (page - 1) * pageSize;
}
