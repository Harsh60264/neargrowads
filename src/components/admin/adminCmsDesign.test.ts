import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminPageSource = readFileSync(new URL('./AdminPage.tsx', import.meta.url), 'utf8');
const ordersSource = readFileSync(new URL('./AdminServiceOrders.tsx', import.meta.url), 'utf8');
const stylesheet = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

test('admin theme follows the selected CMS theme without changing public routes', () => {
  assert.match(adminPageSource, /className="admin-portal min-h-screen" data-admin-theme=\{theme\}/);
  assert.match(adminPageSource, /data-admin-theme-preset=\{themePreset\}/);
  assert.match(stylesheet, /\.admin-portal\[data-admin-theme='light'\]/);
  assert.match(stylesheet, /\.admin-portal\[data-admin-theme='dark'\]/);
});

test('premium CMS presets are selectable independently from public website themes', () => {
  assert.match(adminPageSource, /themePreset\?: string/);
  assert.match(adminPageSource, /AdminPremiumModuleFrame/);
  assert.match(ordersSource, /premium-order-card/);
  assert.match(stylesheet, /data-admin-theme-preset='premium-cms-light'/);
  assert.match(stylesheet, /data-admin-theme-preset='premium-cms-dark'/);
});

test('orders keep payment, fulfilment, test-mode and webhook states distinct', () => {
  assert.match(ordersSource, /order\.payment_status === 'paid'/);
  assert.match(ordersSource, /order\.fulfillment_status/);
  assert.match(ordersSource, /provider_mode === 'test'/);
  assert.match(ordersSource, /cashfree_webhook_events/);
  assert.match(ordersSource, /TEST · NO REAL FUNDS/);
  assert.match(ordersSource, /Fulfilment locked/);
});

test('orders expose responsive cards and a verification timeline', () => {
  assert.match(ordersSource, /premium-order-card/);
  assert.match(ordersSource, /Payment attempts/);
  assert.match(ordersSource, /grid gap-5 lg:grid-cols-\[1\.05fr_1\.15fr_1\.1fr_1fr\]/);
  assert.match(stylesheet, /\.premium-order-card/);
});

test('CMS modules receive the selected theme and light-mode overrides cover legacy controls', () => {
  assert.match(adminPageSource, /AdminTeamManager[\s\S]*theme=\{theme\}/);
  assert.match(adminPageSource, /AdminContentManager[\s\S]*theme=\{theme\}/);
  assert.match(adminPageSource, /premiumModuleMeta/);
  assert.match(stylesheet, /\.premium-module-header/);
  assert.match(stylesheet, /admin-portal\[data-admin-theme='light'\] \.admin-content-manager input/);
  assert.match(stylesheet, /admin-portal\[data-admin-theme='light'\] \.admin-team-manager h1/);
});

test('every CMS section receives a premium component frame', () => {
  for (const section of ['leads', 'serviceStore', 'content', 'mascot', 'caseStudies', 'servicesManagement', 'categories', 'blog', 'securityMonitoring', 'settings']) {
    assert.match(adminPageSource, new RegExp(`${section}: \\{`));
  }
  assert.match(stylesheet, /\.premium-module-frame/);
  assert.match(stylesheet, /\.premium-module-header/);
});
