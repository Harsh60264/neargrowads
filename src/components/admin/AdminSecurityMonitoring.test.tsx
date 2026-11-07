import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminSecurityMonitoring } from './AdminSecurityMonitoring';

const source = readFileSync(new URL('./AdminSecurityMonitoring.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

test('security monitoring renders the six metrics and responsive dashboard sections', () => {
  const markup = renderToStaticMarkup(
    <AdminSecurityMonitoring isPrimaryOwner canManageAlerts />,
  );

  for (const label of [
    'Security Monitoring Center',
    'Active Visitors',
    'Security Events',
    'Failed Logins',
    'Unauthorized API',
    'Suspicious Indicators',
    'Active Admin Sessions',
    'Security Event Timeline',
    'Most-Viewed Active Pages',
    'Active Visitor Devices',
    'Detection Rules',
    'Suspicious Activity Indicators',
    'Security Events',
  ]) {
    assert.ok(markup.includes(label), `expected dashboard to render ${label}`);
  }

  assert.equal((markup.match(/class="smc-metric-card/g) || []).length, 6);
  assert.match(markup, /role="img" aria-label="Daily security event counts/);
  assert.match(markup, /Restore Defaults/);
  assert.match(source, /Save detection rules/);
  assert.match(markup, /security-event-severity/);
});

test('overview pairs the timeline with compact activity and keeps visual bars tied to real counts', () => {
  const markup = renderToStaticMarkup(
    <AdminSecurityMonitoring isPrimaryOwner canManageAlerts />,
  );

  assert.match(markup, /class="smc-overview-grid"/);
  assert.match(markup, /class="smc-timeline-scale"/);
  assert.match(source, /const height = day\.count \? \(day\.count \/ timelineScaleMaximum\) \* 100 : 0/);
  assert.match(source, /className="smc-timeline-count">\{day\.count\}/);
  assert.match(source, /page\.count \/ highestPageCount/);
  assert.doesNotMatch(source, /Math\.max\(3,/);
  assert.doesNotMatch(source, /deviceTotal|smc-device-track/);
  assert.match(styles, /\.admin-security-monitoring \{\s*--smc-surface: #19251e/);
  assert.match(styles, /html\[data-theme='light'\] \.admin-portal \.admin-security-monitoring \{\s*--smc-surface: #fff/);
  assert.match(styles, /\.smc-overview-grid \{\s*display: grid;\s*grid-template-columns: minmax\(0, 3fr\) minmax\(18rem, 2fr\)/);
  assert.match(styles, /@media \(max-width: 900px\) \{\s*\.smc-overview-grid \{\s*grid-template-columns: minmax\(0, 1fr\)/);
});

test('detection rules remain hidden for delegated admins', () => {
  const markup = renderToStaticMarkup(
    <AdminSecurityMonitoring isPrimaryOwner={false} canManageAlerts={false} />,
  );

  assert.doesNotMatch(markup, /Detection Rules|Restore Defaults|Save detection rules/);
  assert.match(markup, /Detection rules are configured by the Primary Owner/);
});

test('existing refresh, filters, detection-rule saves, alert permissions, and alert updates remain wired', () => {
  assert.match(source, /fetch\(`\/api\/admin\/security-monitoring\?\$\{query\}`/);
  assert.match(source, /fetch\('\/api\/admin\/security-monitoring\/website-activity'/);
  assert.match(source, /setEventSearch\('api\.unauthorized'\)/);
  assert.match(source, /method: 'PUT'[\s\S]*body: JSON\.stringify\(rulesDraft\)/);
  assert.match(source, /canManageAlerts && alert\.status !== 'resolved'/);
  assert.match(source, /method: 'PATCH'[\s\S]*body: JSON\.stringify\(\{ status \}\)/);
  assert.match(source, /onClick=\{\(\) => \{ void load\(\); void refreshWebsiteActivity\(\); \}\}/);
});
