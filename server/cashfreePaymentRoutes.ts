import { createHash, randomUUID } from 'node:crypto';
import {
  isCashfreeSandboxReadyForActivation,
  isCashfreeSandboxCheckoutReady,
  isCashfreeProductionReadyForActivation,
  isCashfreeProductionCheckoutReady,
  type CashfreeGatewayReadiness,
} from './cashfreeAdmin.ts';
import {
  CASHFREE_API_VERSION,
  cashfreeEnvironmentWebhookFingerprint,
  cashfreeRupeesToPaise,
  cashfreeWebhookFingerprint,
  parseCashfreeWebhook,
  verifyCashfreePayment,
  verifyCashfreeWebhookSignature,
  type CashfreeEnvironmentDiagnostics,
  type CashfreePaymentMode,
} from './cashfreePayments.ts';
import {
  buildServiceOrderLines,
  InvalidServiceEnquiryError,
  validateServiceOrder,
  type ServiceOrderInput,
  type ServiceOrderPackage,
} from './serviceOrders.ts';

export interface CashfreeHttpRequest {
  body?: unknown;
  rawBody?: Buffer;
  ip?: string;
  socket?: { remoteAddress?: string };
  header(name: string): string | undefined;
}

export interface CashfreeHttpResponse {
  status(code: number): this;
  json(body: unknown): this;
  setHeader(name: string, value: string): this;
}

export type CashfreeHttpHandler = (
  req: CashfreeHttpRequest,
  res: CashfreeHttpResponse,
) => void | Promise<void>;

export interface CashfreeServerConfig {
  mode?: CashfreePaymentMode;
  apiBaseUrl?: string;
  clientId: string;
  clientSecret: string;
}

export interface CashfreeOrderDependencies {
  getConfig(): CashfreeServerConfig | undefined;
  getReadiness(): Promise<CashfreeGatewayReadiness>;
  getReturnUrl(orderReference: string): string;
  readPublishedPackages(): Promise<ServiceOrderPackage[]>;
  databaseRequest(path: string, init?: RequestInit): Promise<globalThis.Response>;
  allowOrder(req: CashfreeHttpRequest, res: CashfreeHttpResponse): boolean;
  fetcher?: typeof fetch;
  createId?: () => string;
  now?: () => number;
}

export interface CashfreeAvailabilityDependencies {
  getReadiness(): Promise<CashfreeGatewayReadiness>;
  getMode?(): CashfreePaymentMode | 'unconfigured';
}

export interface CashfreeWebhookDependencies {
  mode?: CashfreePaymentMode;
  getConfig(): CashfreeServerConfig | undefined;
  databaseRequest(path: string, init?: RequestInit): Promise<globalThis.Response>;
  fetcher?: typeof fetch;
}

export interface CashfreeActivationDependencies {
  mode?: CashfreePaymentMode;
  requireOwner(req: CashfreeHttpRequest, res: CashfreeHttpResponse): boolean;
  isSameOrigin(req: CashfreeHttpRequest): boolean;
  currentAdmin(req: CashfreeHttpRequest, res: CashfreeHttpResponse): { id: string } | undefined;
  reauthenticate(
    req: CashfreeHttpRequest,
    res: CashfreeHttpResponse,
    identity: { id: string },
    password: unknown,
    message: string,
  ): Promise<boolean>;
  getReadiness(): Promise<CashfreeGatewayReadiness>;
  setGateway(actorId: string, enable: boolean, mode: CashfreePaymentMode): Promise<boolean>;
  recordChange(actorId: string, enable: boolean): void;
}

export interface CashfreeAdminReadinessDependencies {
  requireOwner(req: CashfreeHttpRequest, res: CashfreeHttpResponse): boolean;
  getReadiness(): Promise<CashfreeGatewayReadiness>;
  getMode?(): CashfreePaymentMode | 'unconfigured';
  getEnvironmentDiagnostics?(): CashfreeEnvironmentDiagnostics;
}

async function jsonResponse<T>(response: globalThis.Response): Promise<T> {
  if (!response.ok) throw new Error(`Cashfree route storage request failed (${response.status}).`);
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

function inrAmount(lineItems: Array<{ lineSubtotalInr: number }>): number | undefined {
  const amountPaise = Math.round(lineItems.reduce((sum, line) => sum + line.lineSubtotalInr, 0) * 100);
  return Number.isSafeInteger(amountPaise) && amountPaise >= 100 ? amountPaise : undefined;
}

interface CashfreeIntent {
  status: 'missing' | 'claimed' | 'busy' | 'conflict' | 'completed' | 'expired' | 'manual_reconciliation';
  action?: 'create' | 'reconcile';
  intent_id?: string;
  service_order_id?: string;
  order_reference?: string;
  provider_idempotency_key?: string;
  claim_token?: string;
  create_attempt_count?: number;
  payment_session_id?: string;
  cashfree_order_id?: string;
  total_amount_paise?: number;
  currency?: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  expires_at?: unknown;
}

function parseCashfreeIntentExpiry(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return undefined;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, zone, zoneSign, zoneHourText, zoneMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = month === 2
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : ([4, 6, 9, 11].includes(month) ? 30 : 31);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth ||
    hour > 23 || minute > 59 || second > 59) return undefined;
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const zoneHour = Number(zoneHourText);
    const zoneMinute = Number(zoneMinuteText);
    if (zoneHour > 14 || zoneMinute > 59 || (zoneHour === 14 && zoneMinute !== 0)) return undefined;
    offsetMinutes = (zoneHour * 60 + zoneMinute) * (zoneSign === '+' ? 1 : -1);
  }
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, Number((fraction || '').padEnd(3, '0').slice(0, 3)));
  const timestamp = date.getTime() - offsetMinutes * 60_000;
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function isCashfreeOrder(value: unknown, expected: {
  orderReference: string;
  amountPaise: number;
  lookup: boolean;
}): { cashfreeOrderId: string; paymentSessionId: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const order = value as Record<string, unknown>;
  const cashfreeOrderId = typeof order.cf_order_id === 'number' && Number.isSafeInteger(order.cf_order_id)
    ? String(order.cf_order_id)
    : order.cf_order_id;
  if (order.order_id !== expected.orderReference ||
    typeof cashfreeOrderId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(cashfreeOrderId) ||
    cashfreeRupeesToPaise(order.order_amount) !== expected.amountPaise ||
    order.order_currency !== 'INR' ||
    (expected.lookup
      ? order.order_status !== 'ACTIVE' && order.order_status !== 'PAID'
      : order.order_status !== 'ACTIVE') ||
    typeof order.payment_session_id !== 'string' ||
    !order.payment_session_id.trim() || order.payment_session_id.length > 4096) return undefined;
  return { cashfreeOrderId, paymentSessionId: order.payment_session_id };
}

export function createCashfreeOrderHandler(deps: CashfreeOrderDependencies): CashfreeHttpHandler {
  const fetcher = deps.fetcher || globalThis.fetch;
  const createId = deps.createId || randomUUID;
  const now = deps.now || Date.now;
  return async (req, res): Promise<void> => {
    if (!deps.allowOrder(req, res)) return;
    const input = validateServiceOrder(req.body);
    if (!input) {
      res.status(400).json({ message: 'Enter valid customer details, select eligible published packages, and accept the privacy notice.' });
      return;
    }
    const clientIdempotencyKey = req.header('idempotency-key') || '';
    if (!/^[A-Za-z0-9_-]{32,100}$/.test(clientIdempotencyKey)) {
      res.status(400).json({ message: 'A valid checkout idempotency key is required.' });
      return;
    }

    try {
      const config = deps.getConfig();
      if (!config) {
        res.status(503).json({ message: 'Online payment currently unavailable. Cashfree is not explicitly configured.' });
        return;
      }
      const mode = config.mode || 'sandbox';
      const readiness = await deps.getReadiness();
      const ready = mode === 'sandbox'
        ? isCashfreeSandboxCheckoutReady(readiness)
        : isCashfreeProductionCheckoutReady(readiness);
      if (!ready || (readiness.mode && readiness.mode !== mode)) {
        res.status(503).json({ message: 'Online payment currently unavailable. Cashfree readiness is incomplete.' });
        return;
      }

      const phoneDigits = input.customerPhone.replace(/\D/g, '');
      if (phoneDigits.length < 7 || phoneDigits.length > 15) {
        res.status(400).json({ message: 'Enter a valid phone number to continue with Cashfree checkout.' });
        return;
      }
      const requestFingerprint = createHash('sha256')
        .update(mode === 'production' ? 'cashfree-production\0' : '')
        .update(JSON.stringify({
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        customerBusinessName: input.customerBusinessName,
        onboardingNotes: input.onboardingNotes,
        cart: input.packages,
      })).digest('hex');
      const clientIdempotencyHash = createHash('sha256')
        .update(mode === 'production' ? 'cashfree-production\0' : '')
        .update(clientIdempotencyKey)
        .digest('hex');
      const trackingTokenHash = createHash('sha256').update(clientIdempotencyKey).digest('hex');
      const claimIntent = async (snapshot?: {
        lines: ReturnType<typeof buildServiceOrderLines>;
        amountPaise: number;
      }): Promise<CashfreeIntent> => jsonResponse<CashfreeIntent>(
        await deps.databaseRequest(`rest/v1/rpc/${(config.mode || 'sandbox') === 'production'
          ? 'claim_cashfree_checkout_intent_for_mode'
          : 'claim_cashfree_checkout_intent'}`, {
          method: 'POST',
          body: JSON.stringify({
            p_client_idempotency_hash: clientIdempotencyHash,
            p_request_fingerprint: requestFingerprint,
            p_order_reference: snapshot
              ? `NGO-${createId().replace(/-/g, '').slice(0, 24).toUpperCase()}`
              : null,
            p_provider_idempotency_key: snapshot ? createId() : null,
            p_tracking_token_hash: trackingTokenHash,
            p_customer_name: input.customerName,
            p_customer_email: input.customerEmail,
            p_customer_phone: input.customerPhone,
            p_customer_business_name: input.customerBusinessName,
            p_customer_onboarding_notes: input.onboardingNotes,
            p_line_items: snapshot?.lines ?? null,
            p_total_amount_paise: snapshot?.amountPaise ?? null,
            p_currency: 'INR',
            p_create_if_missing: Boolean(snapshot),
            ...((config.mode || 'sandbox') === 'production' ? { p_checkout_mode: 'production' } : {}),
          }),
        }),
      );
      let claim = await claimIntent();
      if (claim.status === 'missing') {
        const packages = await deps.readPublishedPackages();
        const lines = buildServiceOrderLines(input, packages);
        const amountPaise = inrAmount(lines);
        if (!amountPaise) {
          res.status(400).json({ message: 'The checkout total must be at least ₹1.00.' });
          return;
        }
        claim = await claimIntent({ lines, amountPaise });
      }

      if (claim.status === 'conflict') {
        res.status(409).json({ message: 'This checkout idempotency key was already used for different checkout details.' });
        return;
      }
      if (claim.status === 'busy') {
        res.status(202).json({ pending: true, message: 'Checkout creation is still being reconciled. Retry with the same idempotency key.' });
        return;
      }
      if (claim.status === 'expired') {
        res.status(410).json({ message: 'This checkout intent expired before an order could be recovered. Start a new checkout.' });
        return;
      }
      if (claim.status === 'manual_reconciliation') {
        res.status(503).json({ pending: true, message: 'This checkout requires reconciliation. Retry later using the same idempotency key.' });
        return;
      }
      const amountPaise = Number(claim.total_amount_paise);
      if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || claim.currency !== 'INR') {
        throw new Error('Cashfree checkout intent has an invalid INR amount.');
      }
      if (claim.status === 'completed') {
        if (!claim.service_order_id || !claim.order_reference || !claim.payment_session_id) {
          res.status(503).json({ pending: true, message: 'The completed checkout requires reconciliation.' });
          return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({
          id: claim.service_order_id,
          orderReference: claim.order_reference,
          trackingToken: clientIdempotencyKey,
          providerOrderId: claim.order_reference,
          paymentSessionId: claim.payment_session_id,
          amountPaise,
          currency: 'INR',
          mode,
          realPaymentsEnabled: mode === 'production',
        });
        return;
      }
      if (claim.status !== 'claimed' || !claim.intent_id || !claim.service_order_id ||
        !claim.order_reference || !claim.provider_idempotency_key || !claim.claim_token ||
        typeof claim.customer_name !== 'string' || typeof claim.customer_email !== 'string' ||
        (claim.action !== 'create' && claim.action !== 'reconcile')) {
        throw new Error('Cashfree checkout intent claim is invalid.');
      }

      const claimedCustomerPhone = claim.customer_phone;
      const claimedPhoneDigits = typeof claimedCustomerPhone === 'string'
        ? claimedCustomerPhone.replace(/\D/g, '')
        : '';
      if (claimedPhoneDigits.length < 7 || claimedPhoneDigits.length > 15) {
        res.status(503).json({ pending: true, message: 'Cashfree checkout details could not be verified. Retry with the same idempotency key.' });
        return;
      }

      const intent = {
        id: claim.intent_id,
        serviceOrderId: claim.service_order_id,
        orderReference: claim.order_reference,
        providerIdempotencyKey: claim.provider_idempotency_key,
        claimToken: claim.claim_token,
        createAttemptCount: Number(claim.create_attempt_count || 0),
      };
      const markAmbiguous = async (failureKind: 'provider_outcome_unknown' | 'manual_reconciliation_required' = 'provider_outcome_unknown'): Promise<void> => {
        const response = await deps.databaseRequest('rest/v1/rpc/mark_cashfree_checkout_intent_ambiguous', {
          method: 'POST',
          body: JSON.stringify({
            p_intent_id: intent.id,
            p_claim_token: intent.claimToken,
            p_failure_kind: failureKind,
          }),
        });
        if (!response.ok) throw new Error('Cashfree checkout recovery state could not be saved.');
      };
      const complete = async (providerOrder: { cashfreeOrderId: string; paymentSessionId: string }): Promise<void> => {
        const response = await jsonResponse<CashfreeIntent>(
          await deps.databaseRequest(`rest/v1/rpc/${(config.mode || 'sandbox') === 'production'
            ? 'complete_cashfree_checkout_intent_for_mode'
            : 'complete_cashfree_checkout_intent'}`, {
            method: 'POST',
            body: JSON.stringify({
              p_intent_id: intent.id,
              p_claim_token: intent.claimToken,
              p_cashfree_order_id: providerOrder.cashfreeOrderId,
              p_payment_session_id: providerOrder.paymentSessionId,
              p_total_amount_paise: amountPaise,
              p_currency: 'INR',
              ...((config.mode || 'sandbox') === 'production' ? { p_checkout_mode: 'production' } : {}),
            }),
          }),
        );
        if (response.status !== 'completed' || !response.payment_session_id) {
          throw new Error('Cashfree checkout completion was not confirmed.');
        }
        res.setHeader('Cache-Control', 'no-store');
        res.status(201).json({
          id: intent.serviceOrderId,
          orderReference: intent.orderReference,
          trackingToken: clientIdempotencyKey,
          providerOrderId: intent.orderReference,
          paymentSessionId: response.payment_session_id,
          amountPaise,
          currency: 'INR',
          mode,
          realPaymentsEnabled: mode === 'production',
        });
      };
      const prepareCreate = async (): Promise<boolean> => {
        const response = await jsonResponse<boolean>(
          await deps.databaseRequest('rest/v1/rpc/prepare_cashfree_checkout_create', {
            method: 'POST',
            body: JSON.stringify({
              p_intent_id: intent.id,
              p_claim_token: intent.claimToken,
            }),
          }),
        );
        return response === true;
      };
      const createProviderOrder = async (): Promise<void> => {
        const returnUrl = deps.getReturnUrl(intent.orderReference);
        let parsedReturnUrl: URL;
        try {
          parsedReturnUrl = new URL(returnUrl);
          const localHttpOrigin = parsedReturnUrl.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(parsedReturnUrl.hostname);
          if ((parsedReturnUrl.protocol !== 'https:' && !localHttpOrigin) ||
            parsedReturnUrl.username || parsedReturnUrl.password ||
            parsedReturnUrl.pathname !== '/catalogue' ||
            parsedReturnUrl.searchParams.size !== 1 ||
            parsedReturnUrl.hash !== '' ||
            parsedReturnUrl.searchParams.get('cashfree_order_id') !== intent.orderReference) {
            throw new Error('Invalid Cashfree return URL.');
          }
        } catch {
          res.status(503).json({ pending: true, message: 'Cashfree checkout return URL is not configured safely.' });
          return;
        }
        if (!await prepareCreate()) {
          await markAmbiguous();
          res.status(503).json({ pending: true, message: 'This checkout reached its automatic recovery limit. Retry later for reconciliation.' });
          return;
        }
        try {
          const providerResponse = await fetcher(`${config.apiBaseUrl || 'https://sandbox.cashfree.com/pg'}/orders`, {
            method: 'POST',
            headers: {
              'x-client-id': config.clientId,
              'x-client-secret': config.clientSecret,
              'x-api-version': CASHFREE_API_VERSION,
              'x-idempotency-key': intent.providerIdempotencyKey,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              order_id: intent.orderReference,
              order_amount: amountPaise / 100,
              order_currency: 'INR',
              customer_details: {
                customer_id: intent.orderReference,
                customer_name: claim.customer_name,
                customer_email: claim.customer_email,
                customer_phone: claimedPhoneDigits,
              },
              order_meta: { return_url: parsedReturnUrl.toString() },
              order_note: 'NearGrow Ads service order',
            }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!providerResponse.ok) {
            await markAmbiguous();
            res.status(503).json({ pending: true, message: 'Cashfree order outcome is unknown. Retry with the same idempotency key to reconcile.' });
            return;
          }
          const providerOrder = isCashfreeOrder(await providerResponse.json(), {
            orderReference: intent.orderReference,
            amountPaise,
            lookup: false,
          });
          if (!providerOrder) {
            await markAmbiguous();
            res.status(503).json({ pending: true, message: 'Cashfree order response requires reconciliation. Retry with the same idempotency key.' });
            return;
          }
          await complete(providerOrder);
        } catch {
          await markAmbiguous();
          res.status(503).json({ pending: true, message: 'Cashfree order outcome is unknown. Retry with the same idempotency key to reconcile.' });
        }
      };

      if (claim.action === 'reconcile') {
        let providerOrderResponse: globalThis.Response;
        try {
          providerOrderResponse = await fetcher(
            `${config.apiBaseUrl || 'https://sandbox.cashfree.com/pg'}/orders/${encodeURIComponent(intent.orderReference)}`,
            {
              headers: {
                'x-client-id': config.clientId,
                'x-client-secret': config.clientSecret,
                'x-api-version': CASHFREE_API_VERSION,
                Accept: 'application/json',
              },
              signal: AbortSignal.timeout(10_000),
            },
          );
        } catch {
          await markAmbiguous();
          res.status(503).json({ pending: true, message: 'Cashfree order state is unknown. Retry later with the same idempotency key.' });
          return;
        }
        if (providerOrderResponse.ok) {
          const providerOrder = isCashfreeOrder(await providerOrderResponse.json(), {
            orderReference: intent.orderReference,
            amountPaise,
            lookup: true,
          });
          if (!providerOrder) {
            await markAmbiguous();
            res.status(503).json({ pending: true, message: 'Cashfree order details do not match this checkout. Manual reconciliation is required.' });
            return;
          }
          await complete(providerOrder);
          return;
        }
        if (providerOrderResponse.status !== 404) {
          await markAmbiguous();
          res.status(503).json({ pending: true, message: 'Cashfree order state is unknown. Retry later with the same idempotency key.' });
          return;
        }
        const intentExpiry = parseCashfreeIntentExpiry(claim.expires_at);
        if (intentExpiry === undefined || now() >= intentExpiry || intent.createAttemptCount >= 3) {
          await markAmbiguous('manual_reconciliation_required');
          res.status(503).json({ pending: true, message: 'No Cashfree order was found before the checkout recovery limit. Manual reconciliation is required.' });
          return;
        }
      }

      await createProviderOrder();
    } catch (error) {
      if (error instanceof InvalidServiceEnquiryError) {
        res.status(400).json({ message: error.message });
        return;
      }
      console.error('[NearGrow Ads] Cashfree service order creation failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Cashfree checkout could not be started. No payment session was issued.' });
    }
  };
}

export function createCashfreeAvailabilityHandler(deps: CashfreeAvailabilityDependencies): CashfreeHttpHandler {
  return async (_req, res): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const readiness = await deps.getReadiness();
      const production = readiness.mode === 'production';
      const available = production
        ? isCashfreeProductionCheckoutReady(readiness)
        : isCashfreeSandboxCheckoutReady(readiness);
      res.json({
        available,
        migrationReady: readiness.migrationReady,
        provider: 'cashfree',
        mode: readiness.mode || 'sandbox',
        realPaymentsEnabled: production && available,
      });
    } catch (error) {
      console.error('[NearGrow Ads] Cashfree availability check failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({
        available: false,
        migrationReady: false,
        provider: 'cashfree',
        mode: deps.getMode?.() || 'sandbox',
        realPaymentsEnabled: false,
      });
    }
  };
}

export function createCashfreeAdminReadinessHandler(deps: CashfreeAdminReadinessDependencies): CashfreeHttpHandler {
  return async (req, res): Promise<void> => {
    if (!deps.requireOwner(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    try {
      const readiness = await deps.getReadiness();
      const production = readiness.mode === 'production';
      res.json({
        status: readiness.status,
        credentialsConfigured: readiness.credentialsConfigured,
        environmentEnabled: readiness.environmentEnabled,
        providerConfigurationConfirmed: readiness.providerConfigurationConfirmed,
        webhookConfigured: readiness.webhookConfigured,
        migrationReady: readiness.migrationReady,
        enabled: readiness.enabled,
        provider: 'cashfree',
        mode: readiness.mode || 'sandbox',
        realPaymentsEnabled: production && isCashfreeProductionCheckoutReady(readiness),
        environmentDiagnostics: deps.getEnvironmentDiagnostics?.(),
      });
    } catch (error) {
      console.error('[NearGrow Ads] Admin Cashfree readiness check failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({
        status: 'database_migration_missing',
        credentialsConfigured: false,
        environmentEnabled: false,
        providerConfigurationConfirmed: false,
        webhookConfigured: false,
        migrationReady: false,
        enabled: false,
        provider: 'cashfree',
        mode: deps.getMode?.() || 'sandbox',
        realPaymentsEnabled: false,
        environmentDiagnostics: deps.getEnvironmentDiagnostics?.(),
      });
    }
  };
}

export function createCashfreeWebhookHandler(deps: CashfreeWebhookDependencies): CashfreeHttpHandler {
  const fetcher = deps.fetcher || globalThis.fetch;
  return async (req, res): Promise<void> => {
    const config = deps.getConfig();
    const rawBody = req.rawBody;
    const timestamp = req.header('x-webhook-timestamp') || '';
    const signature = req.header('x-webhook-signature') || '';
    if (!config || (deps.mode && config.mode !== deps.mode) || !rawBody ||
      !verifyCashfreeWebhookSignature(rawBody, timestamp, signature, config.clientSecret)) {
      res.status(400).json({ message: 'Webhook verification failed.' });
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.status(400).json({ message: 'Webhook event is invalid.' });
      return;
    }
    const event = parseCashfreeWebhook(body);
    if (!event) {
      res.status(400).json({ message: 'Webhook event is invalid.' });
      return;
    }

    try {
      const orderQuery = new URLSearchParams({
        select: 'id,provider_order_id,cashfree_order_id,total_amount_paise,currency,provider_mode',
        provider: 'eq.cashfree',
        provider_order_id: `eq.${event.providerOrderId}`,
        limit: '1',
      });
      const orders = await jsonResponse<Array<Record<string, unknown>>>(
        await deps.databaseRequest(`rest/v1/service_orders?${orderQuery}`),
      );
      const order = orders[0];
      if (!order) {
        res.status(200).json({ received: true });
        return;
      }
      if (order.provider_order_id !== event.providerOrderId || order.currency !== 'INR' ||
        !Number.isSafeInteger(Number(order.total_amount_paise)) ||
        (order.provider_mode ?? 'test') !== ((config.mode || 'sandbox') === 'production' ? 'live' : 'test')) {
        res.status(503).json({ message: 'Cashfree order details are not ready for webhook verification.' });
        return;
      }
      if (typeof order.cashfree_order_id !== 'string') {
        res.status(503).json({ message: 'Cashfree order creation is still being reconciled.' });
        return;
      }

      const paymentsResponse = await fetcher(
        `${config.apiBaseUrl || 'https://sandbox.cashfree.com/pg'}/orders/${encodeURIComponent(event.providerOrderId)}/payments`,
        {
          headers: {
            'x-client-id': config.clientId,
            'x-client-secret': config.clientSecret,
            'x-api-version': CASHFREE_API_VERSION,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!paymentsResponse.ok) throw new Error('cashfree_payment_lookup_failed');
      const providerPayments: unknown = await paymentsResponse.json();
      const payment = Array.isArray(providerPayments)
        ? providerPayments.find((candidate) =>
          candidate !== null && typeof candidate === 'object' &&
          (candidate as Record<string, unknown>).cf_payment_id === event.providerPaymentId)
        : undefined;
      const verifiedPayment = verifyCashfreePayment(payment, {
        providerOrderId: event.providerOrderId,
        providerPaymentId: event.providerPaymentId,
        amountPaise: Number(order.total_amount_paise),
      });
      if (!verifiedPayment) throw new Error('cashfree_payment_state_mismatch');

      const mode = config.mode || 'sandbox';
      const processResponse = await deps.databaseRequest(`rest/v1/rpc/${mode === 'production'
        ? 'process_cashfree_webhook_event_for_mode'
        : 'process_cashfree_webhook_event'}`, {
        method: 'POST',
        body: JSON.stringify({
          p_event_fingerprint: mode === 'sandbox'
            ? cashfreeWebhookFingerprint(rawBody)
            : cashfreeEnvironmentWebhookFingerprint(mode, rawBody),
          p_event_type: event.eventType,
          p_provider_order_id: event.providerOrderId,
          p_cashfree_order_id: order.cashfree_order_id,
          p_provider_payment_id: verifiedPayment.providerPaymentId,
          p_payment_status: verifiedPayment.status,
          p_payment_amount_paise: verifiedPayment.amountPaise,
          p_currency: 'INR',
          p_is_captured: verifiedPayment.status === 'SUCCESS',
          ...(mode === 'production' ? { p_checkout_mode: 'production' } : {}),
        }),
      });
      const result = await jsonResponse<string>(processResponse);
      if (![
        'paid', 'already_paid', 'additional_successful_attempt', 'recorded',
        'unmatched_order', 'amount_mismatch', 'payment_identifier_conflict', 'confirmation_rejected',
      ].includes(result)) throw new Error('cashfree_webhook_processing_failed');
      if (['amount_mismatch', 'payment_identifier_conflict', 'confirmation_rejected'].includes(result)) {
        console.error(`[NearGrow Ads] Cashfree ${config?.mode || 'sandbox'} webhook requires reconciliation.`, { result });
      }
      res.status(200).json({ received: true });
    } catch (error) {
      console.error(`[NearGrow Ads] Cashfree ${config?.mode || 'sandbox'} webhook processing failed.`, {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Webhook processing failed.' });
    }
  };
}

export function createCashfreeActivationHandler(deps: CashfreeActivationDependencies): CashfreeHttpHandler {
  return async (req, res): Promise<void> => {
    if (!deps.requireOwner(req, res)) return;
    if (!deps.isSameOrigin(req)) {
      res.status(403).json({ message: 'Payment settings can only be changed from this website.' });
      return;
    }
    const identity = deps.currentAdmin(req, res);
    const body = req.body as { password?: unknown; enable?: unknown; confirmMode?: unknown } | undefined;
    const mode = deps.mode || 'sandbox';
    const expectedConfirmation = mode === 'production' ? 'production' : 'test';
    if (!identity || typeof body?.enable !== 'boolean' || body.confirmMode !== expectedConfirmation) {
      res.status(400).json({ message: `Confirm Cashfree ${mode} mode explicitly.` });
      return;
    }
    if (body.enable) {
      let readiness: CashfreeGatewayReadiness;
      try {
        readiness = await deps.getReadiness();
      } catch {
        res.status(503).json({ message: `Cashfree ${mode} readiness could not be verified. Checkout remains disabled.` });
        return;
      }
      const ready = mode === 'production'
        ? isCashfreeProductionReadyForActivation(readiness)
        : isCashfreeSandboxReadyForActivation(readiness);
      if (!ready || (readiness.mode && readiness.mode !== mode)) {
        res.status(503).json({ message: `Cashfree ${mode} requires server credentials, provider and webhook confirmation, and the complete database migration before activation.` });
        return;
      }
    }
    if (!await deps.reauthenticate(
      req, res, identity, body.password,
      `Re-enter the Primary Owner password to change Cashfree ${mode} status.`,
    )) return;
    try {
      if (!await deps.setGateway(identity.id, body.enable, mode)) {
        res.status(409).json({ message: 'Primary Owner authorization could not be recorded.' });
        return;
      }
      deps.recordChange(identity.id, body.enable);
      res.json({ success: true, enabled: body.enable, mode: mode === 'production' ? 'production' : 'test' });
    } catch (error) {
      console.error(`[NearGrow Ads] Cashfree ${mode} gateway status update failed.`, {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: `Cashfree ${mode} status could not be updated.` });
    }
  };
}
