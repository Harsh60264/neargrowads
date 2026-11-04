export interface CashfreeAdminPaymentAttempt {
  providerPaymentId: string;
  status: string;
  amountPaise: number;
  currency: 'INR';
  lastSeenAt: string;
}

export interface CashfreeAdminWebhookEvent {
  eventType: string;
  processingStatus: string;
  receivedAt: string;
}

export interface CashfreeAdminOrder extends Record<string, unknown> {
  id: string;
  provider: string;
  payment_status: string;
  provider_order_id: string | null;
  cashfree_order_id?: string | null;
  payment_session_id?: never;
}

export interface CashfreeGatewayReadiness {
  status: 'not_configured' | 'sandbox_configured' | 'production_configured' | 'database_migration_missing' |
    'ready_for_testing' | 'ready_for_live' | 'enabled';
  mode?: CashfreePaymentMode | 'unconfigured';
  credentialsConfigured: boolean;
  environmentEnabled: boolean;
  providerConfigurationConfirmed: boolean;
  webhookConfigured: boolean;
  migrationReady: boolean;
  enabled: boolean;
}

export function isCashfreeSandboxReadyForActivation(readiness: CashfreeGatewayReadiness): boolean {
  return readiness.mode !== 'production' &&
    (readiness.status === 'ready_for_testing' || readiness.status === 'enabled') &&
    readiness.credentialsConfigured &&
    readiness.environmentEnabled &&
    readiness.providerConfigurationConfirmed &&
    readiness.webhookConfigured &&
    readiness.migrationReady;
}

export function isCashfreeSandboxCheckoutReady(readiness: CashfreeGatewayReadiness): boolean {
  return isCashfreeSandboxReadyForActivation(readiness) &&
    readiness.status === 'enabled' &&
    readiness.enabled;
}

export function isCashfreeProductionReadyForActivation(readiness: CashfreeGatewayReadiness): boolean {
  return readiness.mode === 'production' &&
    readiness.status === 'ready_for_live' &&
    readiness.credentialsConfigured &&
    readiness.environmentEnabled &&
    readiness.providerConfigurationConfirmed &&
    readiness.webhookConfigured &&
    readiness.migrationReady;
}

export function isCashfreeProductionCheckoutReady(readiness: CashfreeGatewayReadiness): boolean {
  return readiness.mode === 'production' &&
    readiness.status === 'enabled' &&
    readiness.enabled &&
    readiness.credentialsConfigured &&
    readiness.environmentEnabled &&
    readiness.providerConfigurationConfirmed &&
    readiness.webhookConfigured &&
    readiness.migrationReady;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Cashfree admin reconciliation query failed (${response.status}).`);
  return await response.json() as T;
}

export async function readCashfreeGatewayReadiness(
  options: {
    credentialsConfigured: boolean;
    environmentEnabled: boolean;
    providerConfigurationConfirmed: boolean;
    webhookConfigured: boolean;
  },
  databaseRequest: (path: string, init?: RequestInit) => Promise<Response>,
  mode: CashfreePaymentMode = 'sandbox',
): Promise<CashfreeGatewayReadiness> {
  const production = mode === 'production';
  const [settingsResponse, ...schemaResponses] = await Promise.all([
    databaseRequest(`rest/v1/service_store_payment_settings?select=${production ? 'cashfree_production_enabled' : 'cashfree_test_enabled'}&id=eq.true&limit=1`),
    databaseRequest('rest/v1/service_orders?select=payment_session_id,cashfree_order_id,total_amount_inr_paise&limit=0'),
    databaseRequest('rest/v1/cashfree_checkout_intents?select=client_idempotency_hash&limit=0'),
    databaseRequest('rest/v1/cashfree_payment_attempts?select=provider_payment_id&limit=0'),
    databaseRequest('rest/v1/cashfree_webhook_events?select=event_fingerprint&limit=0'),
    databaseRequest(`rest/v1/rpc/${production ? 'cashfree_production_gateway_readiness' : 'cashfree_gateway_readiness'}`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  ]);
  let migrationReady = settingsResponse.ok && schemaResponses.every((response) => response.ok);
  if (migrationReady) {
    try {
      const readinessRpc = await schemaResponses[schemaResponses.length - 1].json();
      migrationReady = readinessRpc === true;
    } catch {
      migrationReady = false;
    }
  }
  let enabled = false;
  if (migrationReady) {
    const settings = await readJson<Array<{
      cashfree_test_enabled?: unknown;
      cashfree_production_enabled?: unknown;
    }>>(settingsResponse);
    enabled = Array.isArray(settings) && settings[0]?.[
      production ? 'cashfree_production_enabled' : 'cashfree_test_enabled'
    ] === true;
  }
  const fullyConfigured = options.credentialsConfigured &&
    options.environmentEnabled &&
    options.providerConfigurationConfirmed &&
    options.webhookConfigured &&
    migrationReady;
  const status: CashfreeGatewayReadiness['status'] = !migrationReady
    ? 'database_migration_missing'
    : !options.credentialsConfigured
      ? 'not_configured'
      : fullyConfigured
        ? enabled ? 'enabled' : 'ready_for_testing'
        : 'sandbox_configured';
  return {
    status: production
      ? status === 'ready_for_testing'
        ? 'ready_for_live'
        : status === 'sandbox_configured' ? 'production_configured' : status
      : status,
    mode,
    credentialsConfigured: options.credentialsConfigured,
    environmentEnabled: options.environmentEnabled,
    providerConfigurationConfirmed: options.providerConfigurationConfirmed,
    webhookConfigured: options.webhookConfigured,
    migrationReady,
    enabled,
  };
}

export async function enrichCashfreeAdminOrders(
  orders: Record<string, unknown>[],
  databaseRequest: (path: string) => Promise<Response>,
): Promise<Record<string, unknown>[]> {
  const cashfreeOrders = orders.filter((order) => order.provider === 'cashfree' && typeof order.id === 'string');
  if (!cashfreeOrders.length) return orders;
  const orderIds = [...new Set(cashfreeOrders.map((order) => String(order.id)))];
  const orderIdFilter = `in.(${orderIds.join(',')})`;
  const attemptsParams = new URLSearchParams({
    select: 'service_order_id,provider_payment_id,payment_status,payment_amount_paise,currency,last_seen_at',
    service_order_id: orderIdFilter,
    order: 'last_seen_at.desc',
  });
  const eventsParams = new URLSearchParams({
    select: 'service_order_id,event_type,processing_status,received_at',
    service_order_id: orderIdFilter,
    order: 'received_at.desc',
  });
  const [attemptRows, eventRows] = await Promise.all([
    readJson<Record<string, unknown>[]>(await databaseRequest(`rest/v1/cashfree_payment_attempts?${attemptsParams}`)),
    readJson<Record<string, unknown>[]>(await databaseRequest(`rest/v1/cashfree_webhook_events?${eventsParams}`)),
  ]);
  const providerOrderParams = new URLSearchParams({
    select: 'id,cashfree_order_id',
    id: orderIdFilter,
  });
  const providerOrderRows = await readJson<Record<string, unknown>[]>(
    await databaseRequest(`rest/v1/service_orders?${providerOrderParams}`),
  );
  const providerOrderIds = new Map(
    providerOrderRows
      .filter((row): row is { id: string; cashfree_order_id: string | null } =>
        typeof row.id === 'string' &&
        (typeof row.cashfree_order_id === 'string' || row.cashfree_order_id === null))
      .map((row) => [row.id, row.cashfree_order_id]),
  );
  const attemptsByOrder = new Map<string, CashfreeAdminPaymentAttempt[]>();
  const eventsByOrder = new Map<string, CashfreeAdminWebhookEvent[]>();

  for (const row of attemptRows) {
    if (typeof row.service_order_id !== 'string' ||
      typeof row.provider_payment_id !== 'string' ||
      typeof row.payment_status !== 'string' ||
      !Number.isSafeInteger(Number(row.payment_amount_paise)) ||
      row.currency !== 'INR' ||
      typeof row.last_seen_at !== 'string') continue;
    const items = attemptsByOrder.get(row.service_order_id) || [];
    items.push({
      providerPaymentId: row.provider_payment_id,
      status: row.payment_status,
      amountPaise: Number(row.payment_amount_paise),
      currency: 'INR',
      lastSeenAt: row.last_seen_at,
    });
    attemptsByOrder.set(row.service_order_id, items);
  }

  for (const row of eventRows) {
    if (typeof row.service_order_id !== 'string' ||
      typeof row.event_type !== 'string' ||
      typeof row.processing_status !== 'string' ||
      typeof row.received_at !== 'string') continue;
    const items = eventsByOrder.get(row.service_order_id) || [];
    items.push({
      eventType: row.event_type,
      processingStatus: row.processing_status,
      receivedAt: row.received_at,
    });
    eventsByOrder.set(row.service_order_id, items);
  }

  return orders.map((order) => {
    if (order.provider !== 'cashfree' || typeof order.id !== 'string') return order;
    const safeOrder = { ...order };
    delete safeOrder.payment_session_id;
    const cashfreeOrderId = providerOrderIds.get(order.id);
    const attempts = attemptsByOrder.get(order.id) || [];
    const events = eventsByOrder.get(order.id) || [];
    const reasons: string[] = [];
    if (order.payment_status === 'pending' &&
      (typeof order.provider_order_id !== 'string' || typeof cashfreeOrderId !== 'string')) {
      reasons.push('provider_order_persistence_incomplete');
    }
    if (events.some((event) => event.processingStatus === 'failed')) reasons.push('webhook_processing_failed');
    if (order.payment_status === 'pending' && attempts.some((attempt) => attempt.status === 'SUCCESS')) {
      reasons.push('successful_attempt_not_confirmed');
    }
    return {
      ...safeOrder,
      cashfree_order_id: cashfreeOrderId ?? null,
      cashfree_payment_attempts: attempts,
      cashfree_webhook_events: events,
      cashfree_reconciliation_required: reasons.length > 0,
      cashfree_reconciliation_reasons: reasons,
    };
  });
}
import type { CashfreePaymentMode } from './cashfreePayments.ts';
