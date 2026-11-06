import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const adminDirectory = resolve(import.meta.dirname);
const dashboard = readFileSync(resolve(adminDirectory, 'AdminSecurityMonitoring.tsx'), 'utf8');
const adminPage = readFileSync(resolve(adminDirectory, 'AdminPage.tsx'), 'utf8');

test('security overview and visualizations render values from monitoring APIs', () => {
  for (const counter of ['totalEvents', 'failedLogins', 'unauthorizedRequests', 'suspiciousAlerts', 'activeSessions']) {
    assert.ok(dashboard.includes(`counters?.${counter}`), `expected dashboard to render ${counter}`);
  }
  assert.match(dashboard, /value: websiteActivity\?\.activeVisitors/);
  assert.match(dashboard, /websiteActivity\.pages\.slice\(0, 5\)/);
  assert.match(dashboard, /websiteActivity\.devices\.(?:mobile|desktop|tablet)/);
  assert.match(dashboard, /data\.timelineDaily\.map/);
  assert.match(dashboard, /page\.count\.toLocaleString/);
  assert.doesNotMatch(dashboard, /\b(?:\d+)%\s*(?:increase|decrease|trend)/i);
});

test('refresh and event filters continue to use existing authenticated data endpoints', () => {
  assert.match(dashboard, /onClick=\{\(\) => void load\(\)\}/);
  assert.match(dashboard, /fetch\(`\/api\/admin\/security-monitoring\?\$\{query\}`/);
  assert.match(dashboard, /eventSearch,\s*eventSeverity/);
  assert.match(dashboard, /setEventSearch\(searchInput\.trim\(\)\)/);
  assert.match(dashboard, /fetch\('\/api\/admin\/security-monitoring\/website-activity'/);
  assert.match(dashboard, /setInterval\(\(\) => \{ void refreshWebsiteActivity\(\); \}, 30_000\)/);
});

test('detection rules retain owner-only editing, restore defaults and persisted save behavior', () => {
  assert.match(dashboard, /\{isPrimaryOwner && \([\s\S]*?Detection rules/);
  assert.match(dashboard, /onClick=\{\(\) => setRulesDraft\(DEFAULT_SECURITY_RULES\)\}/);
  assert.match(dashboard, /fetch\('\/api\/admin\/security-monitoring\/rules'/);
  assert.match(dashboard, /method: 'PUT'/);
  assert.match(dashboard, /body: JSON\.stringify\(rulesDraft\)/);
  assert.match(dashboard, /canManageAlerts && alert\.status !== 'resolved'/);
  assert.match(adminPage, /canViewSecurityMonitoring/);
});

test('events, severity badges and empty alert states render backend records without fixture data', () => {
  assert.match(dashboard, /\(data\?\.events \|\| \[\]\)\.map/);
  assert.match(dashboard, /severityStyle\[event\.severity\]/);
  assert.match(dashboard, /\(data\?\.alerts \|\| \[\]\)\.map/);
  assert.match(dashboard, /No suspicious indicators recorded/);
  assert.match(dashboard, /data\.eventTotal/);
  assert.match(dashboard, /role="alert"/);
});

test('dashboard redesign is scoped and leaves the existing CMS modes intact', () => {
  const styles = readFileSync(resolve(adminDirectory, '..', '..', 'index.css'), 'utf8');
  assert.match(dashboard, /admin-security-monitoring/);
  assert.match(styles, /html\[data-theme='light'\] \.admin-portal \.admin-security-monitoring/);
  assert.match(dashboard, /bg-\[#19241D\]/);
  assert.match(dashboard, /grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6/);
  assert.match(dashboard, /security-events-table mt-4 overflow-x-auto/);
  assert.match(dashboard, /data\.timelineDaily\.every\(\(day\) => day\.count === 0\)/);
  assert.match(dashboard, /No security events recorded in the chart window/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});
