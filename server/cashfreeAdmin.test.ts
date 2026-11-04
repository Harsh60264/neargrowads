import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enrichCashfreeAdminOrders,
  isCashfreeProductionReadyForActivation,
  isCashfreeProductionCheckoutReady,
  readCashfreeGatewayReadiness,
} from './cashfreeAdmin.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const readyFlags = {
  credentialsConfigured: true,
  environmentEnabled: true,
  providerConfigurationConfirmed: true,
  webhookConfigured: true,
};

test('Cashfree readiness distinguishes configuration, migration, ready and enabled states', async () => {
  const paths: string[] = [];
  let enabled = false;
  const databaseRequest = async (path: string) => {
    paths.push(path);
    if (path.includes('cashfree_gateway_readiness')) return jsonResponse(true);
    if (path.includes('service_store_payment_settings')) {
      return jsonResponse([{ cashfree_test_enabled: enabled }]);
    }
    return jsonResponse([]);
  };

  assert.equal((await readCashfreeGatewayReadiness({
    ...readyFlags,
    credentialsConfigured: false,
  }, databaseRequest)).status, 'not_configured');
  assert.equal((await readCashfreeGatewayReadiness({
    ...readyFlags,
    webhookConfigured: false,
  }, databaseRequest)).status, 'sandbox_configured');
  const migrationMissing = await readCashfreeGatewayReadiness(readyFlags, async (path) =>
    jsonResponse({}, path.includes('cashfree_payment_attempts') ? 404 : 200));
  assert.equal(migrationMissing.status, 'database_migration_missing');
  assert.equal(migrationMissing.enabled, false);
  assert.equal((await readCashfreeGatewayReadiness(readyFlags, databaseRequest)).status, 'ready_for_testing');
  enabled = true;
  assert.equal((await readCashfreeGatewayReadiness(readyFlags, databaseRequest)).status, 'enabled');
  assert.equal(paths.some((path) => path.includes('payment_session_id')), true);
});

test('Cashfree readiness fails closed when the readiness RPC is missing, false, or malformed', async () => {
  for (const response of [
    new Response('function missing', { status: 404 }),
    jsonResponse(false),
    jsonResponse({ ready: true }),
  ]) {
    const readiness = await readCashfreeGatewayReadiness(readyFlags, async (path) =>
      path.includes('cashfree_gateway_readiness') ? response : jsonResponse([]));
    assert.equal(readiness.status, 'database_migration_missing');
    assert.equal(readiness.migrationReady, false);
    assert.equal(readiness.enabled, false);
  }
});

test('Production readiness uses isolated settings, RPC and live activation state', async () => {
  const paths: string[] = [];
  let enabled = false;
  const readiness = await readCashfreeGatewayReadiness(readyFlags, async (path) => {
    paths.push(path);
    if (path.endsWith('/cashfree_production_gateway_readiness')) return jsonResponse(true);
    if (path.includes('service_store_payment_settings')) {
      return jsonResponse([{ cashfree_production_enabled: enabled }]);
    }
    return jsonResponse([]);
  }, 'production');
  assert.equal(readiness.mode, 'production');
  assert.equal(readiness.status, 'ready_for_live');
  assert.equal(isCashfreeProductionReadyForActivation(readiness), true);
  assert.equal(isCashfreeProductionCheckoutReady(readiness), false);
  assert.equal(paths.some((path) => path.includes('cashfree_production_enabled')), true);
  assert.equal(paths.some((path) => path.endsWith('/cashfree_production_gateway_readiness')), true);
  assert.equal(paths.some((path) => path.includes('cashfree_test_enabled')), false);

  enabled = true;
  const active = await readCashfreeGatewayReadiness(readyFlags, async (path) => {
    if (path.endsWith('/cashfree_production_gateway_readiness')) return jsonResponse(true);
    if (path.includes('service_store_payment_settings')) return jsonResponse([{ cashfree_production_enabled: true }]);
    return jsonResponse([]);
  }, 'production');
  assert.equal(active.status, 'enabled');
  assert.equal(isCashfreeProductionCheckoutReady(active), true);
});

test('Cashfree order enrichment shows audit-safe references and reconciliation without sessions or payloads', async () => {
  const requested: string[] = [];
  const orders = [{
    id: 'service-order-id',
    provider: 'cashfree',
    payment_status: 'pending',
    provider_order_id: 'merchant-order-reference',
    payment_session_id: 'session-secret-canary',
  }, {
    id: 'razorpay-order-id',
    provider: 'razorpay',
    payment_status: 'paid',
  }];
  const enriched = await enrichCashfreeAdminOrders(orders, async (path) => {
    requested.push(path);
    if (path.includes('cashfree_payment_attempts')) {
      return jsonResponse([{
        service_order_id: 'service-order-id',
        provider_payment_id: 'provider-payment-reference',
        payment_status: 'SUCCESS',
        payment_amount_paise: 12500,
        currency: 'INR',
        last_seen_at: '2026-01-01T00:00:00Z',
      }]);
    }
    if (path.includes('cashfree_webhook_events')) {
      return jsonResponse([{
        service_order_id: 'service-order-id',
        event_type: 'PAYMENT_SUCCESS_WEBHOOK',
        processing_status: 'failed',
        received_at: '2026-01-01T00:00:01Z',
        raw_body: 'must-not-be-selected',
      }]);
    }
    return jsonResponse([{ id: 'service-order-id', cashfree_order_id: 'cashfree-order-reference' }]);
  });
  const cashfree = enriched[0];
  assert.equal(cashfree.cashfree_order_id, 'cashfree-order-reference');
  assert.equal(cashfree.cashfree_reconciliation_required, true);
  assert.deepEqual(cashfree.cashfree_reconciliation_reasons, ['webhook_processing_failed', 'successful_attempt_not_confirmed']);
  assert.deepEqual(cashfree.cashfree_payment_attempts, [{
    providerPaymentId: 'provider-payment-reference',
    status: 'SUCCESS',
    amountPaise: 12500,
    currency: 'INR',
    lastSeenAt: '2026-01-01T00:00:00Z',
  }]);
  assert.equal(enriched[1], orders[1]);
  assert.doesNotMatch(JSON.stringify(enriched), /session-secret-canary|must-not-be-selected|payment_session_id|raw_body/);
  assert.equal(requested.some((path) => /select=[^&]*(?:payment_session_id|raw_body)/.test(path)), false);
});

test('Cashfree order enrichment explicitly fails if the required admin ledger is unavailable', async () => {
  await assert.rejects(() => enrichCashfreeAdminOrders([{
    id: 'service-order-id',
    provider: 'cashfree',
    payment_status: 'pending',
  }], async () => jsonResponse({ message: 'migration missing' }, 404)), /Cashfree admin reconciliation query failed/);
});
