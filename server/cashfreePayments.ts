import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const CASHFREE_SANDBOX_API_BASE_URL = 'https://sandbox.cashfree.com/pg';
export const CASHFREE_PRODUCTION_API_BASE_URL = 'https://api.cashfree.com/pg';
export const CASHFREE_API_VERSION = '2026-01-01';

export type CashfreePaymentMode = 'sandbox' | 'production';

export interface CashfreeEnvironmentConfig {
  mode: CashfreePaymentMode;
  apiBaseUrl: string;
  clientId?: string;
  clientSecret?: string;
  enabled: boolean;
  providerConfigured: boolean;
  webhookConfigured: boolean;
}

export interface CashfreeEnvironmentDiagnostics {
  reason:
    | 'none'
    | 'production_mode_required'
    | 'invalid_mode'
    | 'deployment_mode_mismatch'
    | 'mixed_environment_configuration'
    | 'invalid_client_id'
    | 'invalid_client_secret';
  requestedMode: CashfreePaymentMode | 'missing' | 'invalid';
  mode: CashfreePaymentMode | 'unconfigured';
  productionDeployment: boolean;
  credentialsConfigured: boolean;
  clientIdConfigured: boolean;
  clientIdValid: boolean;
  clientSecretConfigured: boolean;
  clientSecretValid: boolean;
  environmentEnabled: boolean;
  providerConfigurationConfirmed: boolean;
  webhookConfigured: boolean;
  sandboxCredentialsPresent: boolean;
  sandboxFlagsEnabled: boolean;
}

function isConfigured(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function inspectCashfreeEnvironment(
  environment: NodeJS.ProcessEnv,
): CashfreeEnvironmentDiagnostics {
  const rawMode = environment.CASHFREE_MODE;
  const mode = rawMode === undefined || rawMode === ''
    ? environment.VERCEL_ENV === 'production' ? undefined : 'sandbox'
    : rawMode;
  const sandboxCredentialsPresent =
    isConfigured(environment.CASHFREE_SANDBOX_CLIENT_ID) ||
    isConfigured(environment.CASHFREE_SANDBOX_CLIENT_SECRET);
  const productionCredentialsPresent =
    isConfigured(environment.CASHFREE_PRODUCTION_CLIENT_ID) ||
    isConfigured(environment.CASHFREE_PRODUCTION_CLIENT_SECRET);
  const sandboxAttested = environment.CASHFREE_SANDBOX_ENABLED === 'true' ||
    environment.CASHFREE_SANDBOX_PROVIDER_CONFIGURED === 'true' ||
    environment.CASHFREE_SANDBOX_WEBHOOK_CONFIGURED === 'true';
  const productionAttested = environment.CASHFREE_PRODUCTION_ENABLED === 'true' ||
    environment.CASHFREE_PRODUCTION_PROVIDER_CONFIGURED === 'true' ||
    environment.CASHFREE_PRODUCTION_WEBHOOK_CONFIGURED === 'true';
  const resolvedMode = mode === 'sandbox' || mode === 'production' ? mode : 'unconfigured';
  const production = resolvedMode === 'production' ||
    (resolvedMode === 'unconfigured' && environment.VERCEL_ENV === 'production');
  const clientId = (production
    ? environment.CASHFREE_PRODUCTION_CLIENT_ID
    : environment.CASHFREE_SANDBOX_CLIENT_ID)?.trim();
  const clientSecret = production
    ? environment.CASHFREE_PRODUCTION_CLIENT_SECRET
    : environment.CASHFREE_SANDBOX_CLIENT_SECRET;
  const clientIdConfigured = isConfigured(clientId);
  const clientSecretConfigured = Boolean(clientSecret);
  const clientIdValid = !clientId || (clientId.length <= 255 && !/\s/.test(clientId));
  const clientSecretValid = !clientSecret || clientSecret.length >= 8;
  const requestedMode = mode === 'sandbox' || mode === 'production'
    ? mode
    : mode === undefined ? 'missing' : 'invalid';
  const credentialsConfigured = clientIdConfigured && clientSecretConfigured;

  let reason: CashfreeEnvironmentDiagnostics['reason'] = 'none';
  if (mode === undefined) reason = 'production_mode_required';
  else if (mode !== 'sandbox' && mode !== 'production') reason = 'invalid_mode';
  else if ((environment.VERCEL_ENV === 'production' && mode !== 'production') ||
    (mode === 'production' && environment.VERCEL_ENV !== 'production')) {
    reason = 'deployment_mode_mismatch';
  } else if ((mode === 'production' && (sandboxCredentialsPresent || sandboxAttested)) ||
    (mode === 'sandbox' && (productionCredentialsPresent || productionAttested))) {
    reason = 'mixed_environment_configuration';
  } else if (!clientIdValid) reason = 'invalid_client_id';
  else if (!clientSecretValid) reason = 'invalid_client_secret';

  return {
    reason,
    requestedMode,
    mode: resolvedMode,
    productionDeployment: environment.VERCEL_ENV === 'production',
    credentialsConfigured,
    clientIdConfigured,
    clientIdValid,
    clientSecretConfigured,
    clientSecretValid,
    environmentEnabled: environment[production ? 'CASHFREE_PRODUCTION_ENABLED' : 'CASHFREE_SANDBOX_ENABLED'] === 'true',
    providerConfigurationConfirmed: environment[production
      ? 'CASHFREE_PRODUCTION_PROVIDER_CONFIGURED'
      : 'CASHFREE_SANDBOX_PROVIDER_CONFIGURED'] === 'true',
    webhookConfigured: environment[production
      ? 'CASHFREE_PRODUCTION_WEBHOOK_CONFIGURED'
      : 'CASHFREE_SANDBOX_WEBHOOK_CONFIGURED'] === 'true',
    sandboxCredentialsPresent,
    sandboxFlagsEnabled: sandboxAttested,
  };
}

export function resolveCashfreeEnvironment(
  environment: NodeJS.ProcessEnv,
): CashfreeEnvironmentConfig | undefined {
  const diagnostics = inspectCashfreeEnvironment(environment);
  if (diagnostics.reason !== 'none' || diagnostics.mode === 'unconfigured') return undefined;
  const production = diagnostics.mode === 'production';
  const clientId = (production
    ? environment.CASHFREE_PRODUCTION_CLIENT_ID
    : environment.CASHFREE_SANDBOX_CLIENT_ID)?.trim();
  const clientSecret = production
    ? environment.CASHFREE_PRODUCTION_CLIENT_SECRET
    : environment.CASHFREE_SANDBOX_CLIENT_SECRET;
  return {
    mode: diagnostics.mode,
    apiBaseUrl: production ? CASHFREE_PRODUCTION_API_BASE_URL : CASHFREE_SANDBOX_API_BASE_URL,
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {}),
    enabled: environment[production ? 'CASHFREE_PRODUCTION_ENABLED' : 'CASHFREE_SANDBOX_ENABLED'] === 'true',
    providerConfigured: environment[production
      ? 'CASHFREE_PRODUCTION_PROVIDER_CONFIGURED'
      : 'CASHFREE_SANDBOX_PROVIDER_CONFIGURED'] === 'true',
    webhookConfigured: environment[production
      ? 'CASHFREE_PRODUCTION_WEBHOOK_CONFIGURED'
      : 'CASHFREE_SANDBOX_WEBHOOK_CONFIGURED'] === 'true',
  };
}

export interface CashfreeWebhookEvent {
  eventType: string;
  providerOrderId: string;
  providerPaymentId: string;
}

export interface CashfreeVerifiedPayment {
  providerPaymentId: string;
  status: string;
  amountPaise: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

export function isCashfreeWebhookTimestamp(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && Number.isFinite(new Date(timestamp).getTime());
}

export function verifyCashfreeWebhookSignature(
  rawBody: Buffer,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  if (!rawBody.length || !secret || !isCashfreeWebhookTimestamp(timestamp) ||
    !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;

  const expected = createHmac('sha256', secret).update(timestamp).update(rawBody).digest();
  const supplied = Buffer.from(signature, 'base64');
  return supplied.length === expected.length &&
    supplied.toString('base64') === signature &&
    timingSafeEqual(supplied, expected);
}

export function cashfreeWebhookFingerprint(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

export function cashfreeEnvironmentWebhookFingerprint(
  mode: CashfreePaymentMode,
  rawBody: Buffer,
): string {
  return createHash('sha256').update(mode).update('\0').update(rawBody).digest('hex');
}

export function parseCashfreeWebhook(value: unknown): CashfreeWebhookEvent | undefined {
  if (!isRecord(value) || typeof value.type !== 'string' ||
    !/^PAYMENT_[A-Z0-9_]{1,112}$/.test(value.type) || !isRecord(value.data) ||
    !isRecord(value.data.order) || !isRecord(value.data.payment)) return undefined;

  const providerOrderId = value.data.order.order_id;
  const providerPaymentId = value.data.payment.cf_payment_id;
  if (!isIdentifier(providerOrderId) || !isIdentifier(providerPaymentId)) return undefined;
  return { eventType: value.type, providerOrderId, providerPaymentId };
}

export function cashfreeRupeesToPaise(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  const paise = Math.round(value * 100);
  if (!Number.isSafeInteger(paise) || paise <= 0 || Math.abs(value * 100 - paise) > 1e-7) return undefined;
  return paise;
}

export function verifyCashfreePayment(
  value: unknown,
  expected: { providerOrderId: string; providerPaymentId: string; amountPaise: number },
): CashfreeVerifiedPayment | undefined {
  if (!isRecord(value) || value.order_id !== expected.providerOrderId ||
    value.cf_payment_id !== expected.providerPaymentId ||
    value.order_currency !== 'INR' || value.payment_currency !== 'INR' ||
    value.order_amount === undefined || value.payment_amount === undefined ||
    typeof value.is_captured !== 'boolean' || typeof value.payment_status !== 'string') return undefined;

  const orderAmountPaise = cashfreeRupeesToPaise(value.order_amount);
  const paymentAmountPaise = cashfreeRupeesToPaise(value.payment_amount);
  const documentedStatuses = new Set([
    'SUCCESS', 'NOT_ATTEMPTED', 'FAILED', 'USER_DROPPED', 'VOID', 'CANCELLED', 'PENDING',
  ]);
  if (orderAmountPaise !== expected.amountPaise || paymentAmountPaise !== expected.amountPaise ||
    !documentedStatuses.has(value.payment_status) ||
    value.is_captured !== (value.payment_status === 'SUCCESS')) return undefined;

  return {
    providerPaymentId: expected.providerPaymentId,
    status: value.payment_status,
    amountPaise: paymentAmountPaise,
  };
}
