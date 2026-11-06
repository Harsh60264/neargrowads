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
  assert.match(ordersSource, /admin-order-card/);
  assert.match(stylesheet, /data-admin-theme-preset='premium-cms-light'/);
  assert.match(stylesheet, /data-admin-theme-preset='premium-cms-dark'/);
});

test('orders keep payment, fulfilment, test-mode and webhook states distinct', () => {
  assert.match(ordersSource, /order\.payment_status === 'paid'/);
  assert.match(ordersSource, /order\.fulfillment_status/);
  assert.match(ordersSource, /provider_mode !== 'live'/);
  assert.match(ordersSource, /cashfree_webhook_events/);
  assert.match(ordersSource, /Test · no real funds/);
  assert.match(ordersSource, /canFulfil/);
});

test('orders expose responsive cards and a verification timeline', () => {
  assert.match(ordersSource, /admin-order-card/);
  assert.match(ordersSource, /admin-order-grid/);
  assert.match(ordersSource, /admin-order-timeline/);
  assert.match(stylesheet, /@media \(max-width: 640px\)[\s\S]*\.admin-order-grid/);
});

test('demo order is staging-only, visibly isolated, and cannot mutate data', () => {
  assert.match(ordersSource, /import\.meta\.env\.VERCEL_ENV === 'preview'/);
  assert.match(ordersSource, /import\.meta\.env\.VITE_SITE_URL === 'https:\/\/staging\.neargrowads\.com'/);
  assert.match(ordersSource, /DEMO — NOT A REAL ORDER \/ NO PAYMENT/);
  assert.match(ordersSource, /disabled value=\{order\.fulfillment_status\}/);
  assert.match(ordersSource, /Real counts and orders above remain unchanged/);
  assert.match(ordersSource, /preview-order-only/);
});

test('CMS modules receive the selected theme and light-mode overrides cover legacy controls', () => {
  assert.match(adminPageSource, /AdminTeamManager[\s\S]*theme=\{theme\}/);
  assert.match(adminPageSource, /AdminContentManager[\s\S]*theme=\{theme\}/);
  assert.match(ordersSource, /admin-demo-toolbar/);
  assert.match(stylesheet, /admin-portal\[data-admin-theme='light'\] \.admin-content-manager input/);
  assert.match(stylesheet, /admin-portal\[data-admin-theme='light'\] \.admin-team-manager h1/);
});
