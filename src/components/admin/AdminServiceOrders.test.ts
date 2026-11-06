import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEMO_ORDERS,
  filterOrders,
  getOrderMetrics,
  isDemoPreviewAllowed,
  ServiceOrder,
} from './AdminServiceOrdersLogic';

const source = readFileSync(new URL('./AdminServiceOrders.tsx', import.meta.url), 'utf8');
const stylesheet = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

const order = (overrides: Partial<ServiceOrder> = {}): ServiceOrder => ({
  id: 'real-1',
  order_reference: 'NGO-REAL-001',
  customer_name: 'Real Customer',
  customer_email: 'real@example.com',
  customer_phone: '+91 90000 00001',
  customer_business_name: 'Real Business',
  customer_onboarding_notes: '',
  line_items: [{
    title: 'Search package',
    packageCode: 'SEARCH-001',
    billingType: 'one_time',
    billingArrangement: 'one_time',
    quantity: 1,
    originalPriceInr: 100,
    unitPriceInr: 100,
    lineSubtotalInr: 100,
  }],
  total_amount_paise: 10000,
  provider: 'cashfree',
  provider_mode: 'live',
  provider_order_id: 'provider-order-1',
  provider_payment_id: 'provider-payment-1',
  payment_status: 'paid',
  fulfillment_status: 'queued',
  provider_snapshot: { settlementVerified: true },
  paid_at: '2026-11-05T20:30:00.000Z',
  created_at: '2026-11-05T20:30:00.000Z',
  ...overrides,
});

test('real order metrics exclude sandbox payments from real paid orders and remain demo-independent', () => {
  assert.deepEqual(getOrderMetrics([
    order(),
    order({ id: 'test-1', provider_mode: 'test', payment_status: 'paid', fulfillment_status: 'cancelled' }),
    order({ id: 'pending-1', payment_status: 'pending', fulfillment_status: 'awaiting_payment' }),
  ]), {
    total: 3,
    paid: 1,
    queued: 1,
    cancelled: 1,
    test: 1,
  });
  assert.equal(DEMO_ORDERS.every((demo) => demo.isDemo), true);
});

test('order search matches order, customer and payment references and status/package filters', () => {
  const orders = [
    order(),
    order({
      id: 'real-2',
      order_reference: 'NGO-REAL-002',
      customer_name: 'Other Customer',
      provider_payment_id: 'payment-search-target',
      fulfillment_status: 'completed',
      line_items: [{ ...order().line_items[0], title: 'Maps package', packageCode: 'MAPS-002' }],
    }),
  ];
  assert.equal(filterOrders(orders, { query: 'payment-search-target' }).map((item) => item.id).join(','), 'real-2');
  assert.equal(filterOrders(orders, { status: 'completed' }).map((item) => item.id).join(','), 'real-2');
  assert.equal(filterOrders(orders, { packageCode: 'MAPS-002' }).map((item) => item.id).join(','), 'real-2');
});

test('demo mode requires the preview deployment and exact staging origin', () => {
  assert.equal(isDemoPreviewAllowed('preview', 'https://staging.neargrowads.com'), true);
  assert.equal(isDemoPreviewAllowed('production', 'https://staging.neargrowads.com'), false);
  assert.equal(isDemoPreviewAllowed('preview', 'https://www.neargrowads.com'), false);
  assert.match(source, /if \('isDemo' in order && order\.isDemo\) return/);
  assert.match(source, /VITE_VERCEL_ENV/);
  assert.match(source, /VITE_SITE_URL/);
  assert.match(source, /disabled=\{!canEdit \|\| !isLivePaid/);
});

test('orders use one scoped layout in both original CMS modes without premium theme selectors', () => {
  assert.match(stylesheet, /\.admin-orders \{/);
  assert.match(stylesheet, /html\[data-theme='light'\] \.admin-orders/);
  assert.match(stylesheet, /\.admin-order-grid/);
  assert.match(stylesheet, /\.admin-order-stat/);
  assert.doesNotMatch(source, /premium-cms/);
});
