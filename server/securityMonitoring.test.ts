import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SECURITY_RULES,
  canAccessSecurityMonitoring,
  detectSecurityIndicators,
  sanitizeSecurityDetails,
  securityMonitoringFailureMessage,
  securityEventPageOffset,
  validateSecurityRules,
  type SecuritySourceEvent,
} from './securityMonitoring';

const now = Date.parse('2026-10-26T04:00:00.000Z');

function event(overrides: Partial<SecuritySourceEvent> = {}): SecuritySourceEvent {
  return {
    id: crypto.randomUUID(),
    eventType: 'auth.login.failed',
    occurredAt: new Date(now - 60_000).toISOString(),
    subjectHash: 'opaque-subject',
    ...overrides,
  };
}

test('sanitizes security metadata and removes credentials and personal details', () => {
  assert.deepEqual(sanitizeSecurityDetails({
    route: 'leads',
    password: 'must-not-persist',
    apiKey: 'must-not-persist',
    email: 'person@example.test',
    phone: '123456',
    recordCount: 24,
  }), { route: 'leads', recordCount: 24 });
});

test('detection thresholds group only recent events and identify indicators, not attack claims', () => {
  const failures = Array.from({ length: DEFAULT_SECURITY_RULES.failedLogins }, () => event());
  const result = detectSecurityIndicators(failures, DEFAULT_SECURITY_RULES, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].ruleId, 'repeated_failed_logins');
  assert.match(result[0].summary, /suspicious indicator, not a confirmed attack/);
  assert.equal(detectSecurityIndicators(
    [event({ occurredAt: new Date(now - 60 * 60_000).toISOString() })],
    DEFAULT_SECURITY_RULES,
    now,
  ).length, 0);
});

test('detects access denial and bulk export signals without treating normal export as suspicious', () => {
  const denied = Array.from({ length: DEFAULT_SECURITY_RULES.restrictedDenials }, () => event({
    eventType: 'api.unauthorized',
    subjectHash: 'same-source',
    statusCode: 403,
    route: 'users',
  }));
  const unauthorized = Array.from({ length: DEFAULT_SECURITY_RULES.unauthorizedRequests }, () => event({
    eventType: 'api.unauthorized',
    subjectHash: 'same-source',
    statusCode: 401,
    route: 'leads',
  }));
  const bulk = event({
    eventType: 'audit',
    action: 'leads.export.generated',
    details: { recordCount: 120 },
  });
  const ordinaryExport = event({
    eventType: 'audit',
    action: 'leads.export.generated',
    details: { recordCount: 20 },
  });
  const results = detectSecurityIndicators([...denied, ...unauthorized, bulk, ordinaryExport], DEFAULT_SECURITY_RULES, now);
  assert.deepEqual(results.map((result) => result.ruleId).sort(), [
    'excessive_unauthorized_requests',
    'repeated_restricted_access_denials',
    'unusual_bulk_lead_export',
  ]);
});

test('raises severity only as thresholds increase and groups failed attempts by pseudonymous source', () => {
  const failed = Array.from({ length: DEFAULT_SECURITY_RULES.failedLogins * 3 }, () => event({
    subjectHash: undefined,
    details: { sourceHash: 'opaque-source' },
  }));
  const results = detectSecurityIndicators(failed, DEFAULT_SECURITY_RULES, now);
  assert.equal(results.length, 1);
  assert.equal(results[0].ruleId, 'repeated_failed_login_source');
  assert.equal(results[0].severity, 'critical');
});

test('surfaces delegated privileged changes only when the audit actor is known non-owner', () => {
  const privileged = (actorIsPrimaryOwner: boolean) => event({
    eventType: 'audit',
    action: 'admin.role.changed',
    actorIsPrimaryOwner,
  });
  const results = detectSecurityIndicators([privileged(false), privileged(true)], DEFAULT_SECURITY_RULES, now);
  const alerts = results.filter((result) => result.ruleId === 'non_owner_privileged_change');
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].summary, /not proof of misuse/);
});

test('requires Primary Owner or explicit view permission, with edit separately required for alert actions', () => {
  assert.equal(canAccessSecurityMonitoring({ isPrimaryOwner: true }, 'edit'), true);
  assert.equal(canAccessSecurityMonitoring({ isPrimaryOwner: false }, 'view'), false);
  assert.equal(canAccessSecurityMonitoring({ isPrimaryOwner: false, permissions: { securityMonitoring: { view: true } } }, 'view'), true);
  assert.equal(canAccessSecurityMonitoring({ isPrimaryOwner: false, permissions: { securityMonitoring: { edit: true } } }, 'edit'), false);
  assert.equal(canAccessSecurityMonitoring({ isPrimaryOwner: false, permissions: { securityMonitoring: { view: true, edit: true } } }, 'edit'), true);
});

test('validates bounded owner-configurable thresholds and paginates safely', () => {
  assert.equal(validateSecurityRules({ ...DEFAULT_SECURITY_RULES, failedLogins: 1 }), undefined);
  assert.equal(validateSecurityRules({ ...DEFAULT_SECURITY_RULES, windowMinutes: 1441 }), undefined);
  assert.deepEqual(validateSecurityRules(DEFAULT_SECURITY_RULES), DEFAULT_SECURITY_RULES);
  assert.equal(securityEventPageOffset(3, 50), 100);
  assert.throws(() => securityEventPageOffset(0, 50));
  assert.throws(() => securityEventPageOffset(1, 101));
});

test('distinguishes missing schema, database grants, expired sessions, and connection errors', () => {
  assert.match(securityMonitoringFailureMessage(404, 'PGRST205'), /configured database.*schema/i);
  assert.match(securityMonitoringFailureMessage(400, '42703'), /does not match/i);
  assert.match(securityMonitoringFailureMessage(500, '42501'), /service-role grants/i);
  assert.match(securityMonitoringFailureMessage(503, '42501'), /service-role grants/i);
  assert.match(securityMonitoringFailureMessage(401), /session has expired/i);
  assert.match(securityMonitoringFailureMessage(403), /permission to access/i);
  assert.match(securityMonitoringFailureMessage(0), /could not be reached/i);
});
