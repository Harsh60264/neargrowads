import { validateCustomerLocation, type CustomerLocation } from '../src/data/customerLocation.ts';
import type { ServiceOrderInput, ServiceOrderLine } from './serviceOrders.ts';

export const LOCALDROP_WILDCARD_PACKAGE_CODE = 'WILDCARD-BUSINESS-2100';
export const LOCALDROP_WILDCARD_QUANTITY = 2_100;
export const LOCALDROP_WILDCARD_AMOUNT_PAISE = 1_000_000;
export const LOCALDROP_PURCHASE_TERMS_VERSION = 'localdrop-wildcard-business-v1';

export interface LocalDropBusinessPurchase {
  orderInput: ServiceOrderInput;
  lineItems: ServiceOrderLine[];
  amountPaise: number;
  fingerprint: Record<string, unknown>;
  businessAddress: string;
  preferredPromotionAreas: string;
  location?: CustomerLocation;
  termsVersion: typeof LOCALDROP_PURCHASE_TERMS_VERSION;
}

export interface LocalDropBusinessOrderEmail {
  orderReference: string;
  customerName: string;
  customerEmail: string;
  businessName: string;
}

export function isLocalDropWildcardLineItems(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) return false;
  const item = value[0];
  return item.packageCode === LOCALDROP_WILDCARD_PACKAGE_CODE &&
    item.quantity === LOCALDROP_WILDCARD_QUANTITY &&
    item.lineSubtotalInr === LOCALDROP_WILDCARD_AMOUNT_PAISE / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function prepareLocalDropBusinessPurchase(
  value: unknown,
  now = Date.now(),
): LocalDropBusinessPurchase | undefined {
  if (!isRecord(value)) return undefined;
  const customerName = typeof value.fullName === 'string' ? value.fullName.trim() : '';
  const customerEmail = typeof value.email === 'string' ? value.email.trim().toLowerCase() : '';
  const customerPhone = typeof value.mobileNumber === 'string' ? value.mobileNumber.trim() : '';
  const customerBusinessName = typeof value.businessName === 'string' ? value.businessName.trim() : '';
  const businessAddress = typeof value.businessAddress === 'string' ? value.businessAddress.trim() : '';
  const preferredPromotionAreas = typeof value.preferredPromotionAreas === 'string'
    ? value.preferredPromotionAreas.trim()
    : '';
  const onboardingNotes = typeof value.additionalNote === 'string' ? value.additionalNote.trim() : '';

  if (customerName.length < 2 || customerName.length > 120 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customerEmail) || customerEmail.length > 255 ||
    !/^[+0-9().\s-]{7,25}$/.test(customerPhone) ||
    customerBusinessName.length < 2 || customerBusinessName.length > 160 ||
    businessAddress.length < 3 || businessAddress.length > 500 ||
    preferredPromotionAreas.length > 500 || onboardingNotes.length > 2000 ||
    value.consent !== true) return undefined;

  let location: CustomerLocation | undefined;
  if (value.location !== undefined) {
    location = validateCustomerLocation(value.location);
    if (!location || location.accuracyMeters > 50_000 ||
      Date.parse(location.capturedAt) > now + 60_000 ||
      Date.parse(location.capturedAt) < now - 30 * 24 * 60 * 60_000) return undefined;
  }

  const input: ServiceOrderInput = {
    customerName,
    customerEmail,
    customerPhone,
    customerBusinessName,
    onboardingNotes,
    ...(location ? { location } : {}),
    consent: true,
    packages: [],
  };
  const lineItems: ServiceOrderLine[] = [{
    packageId: LOCALDROP_WILDCARD_PACKAGE_CODE,
    packageCode: LOCALDROP_WILDCARD_PACKAGE_CODE,
    title: 'WildCard Business Package',
    billingType: 'one_time',
    billingArrangement: 'one_time',
    quantity: LOCALDROP_WILDCARD_QUANTITY,
    originalPriceInr: LOCALDROP_WILDCARD_AMOUNT_PAISE / 100,
    unitPriceInr: LOCALDROP_WILDCARD_AMOUNT_PAISE / 100 / LOCALDROP_WILDCARD_QUANTITY,
    lineSubtotalInr: LOCALDROP_WILDCARD_AMOUNT_PAISE / 100,
  }];
  const fingerprint = {
    customerName,
    customerEmail,
    customerPhone,
    customerBusinessName,
    businessAddress,
    preferredPromotionAreas,
    onboardingNotes,
    consent: true,
    termsVersion: LOCALDROP_PURCHASE_TERMS_VERSION,
    location: location ?? null,
    packageCode: LOCALDROP_WILDCARD_PACKAGE_CODE,
    quantity: LOCALDROP_WILDCARD_QUANTITY,
    amountPaise: LOCALDROP_WILDCARD_AMOUNT_PAISE,
  };

  return {
    orderInput: input,
    lineItems,
    amountPaise: LOCALDROP_WILDCARD_AMOUNT_PAISE,
    fingerprint,
    businessAddress,
    preferredPromotionAreas,
    ...(location ? { location } : {}),
    termsVersion: LOCALDROP_PURCHASE_TERMS_VERSION,
  };
}

export async function persistLocalDropBusinessOrder(
  serviceOrderId: string,
  purchase: LocalDropBusinessPurchase,
  databaseRequest: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<void> {
  const response = await databaseRequest('rest/v1/rpc/create_localdrop_wildcard_business_order', {
    method: 'POST',
    body: JSON.stringify({
      p_service_order_id: serviceOrderId,
      p_business_address: purchase.businessAddress,
      p_preferred_promotion_areas: purchase.preferredPromotionAreas,
      p_terms_version: purchase.termsVersion,
      p_location_consent: Boolean(purchase.location),
      p_location_latitude: purchase.location?.latitude ?? null,
      p_location_longitude: purchase.location?.longitude ?? null,
      p_location_accuracy_meters: purchase.location?.accuracyMeters ?? null,
      p_location_captured_at: purchase.location?.capturedAt ?? null,
    }),
  });
  if (!response.ok) throw new Error('WildCard business order details could not be saved.');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character);
}

export function buildLocalDropBusinessOrderEmail(order: LocalDropBusinessOrderEmail): {
  subject: string;
  html: string;
  text: string;
} {
  const name = escapeHtml(order.customerName);
  const business = escapeHtml(order.businessName);
  const reference = escapeHtml(order.orderReference);
  return {
    subject: `NearGrow WildCard order ${order.orderReference} confirmed`,
    html: `<!doctype html><html lang="en"><body style="font-family:Arial,Helvetica,sans-serif;color:#071426"><h1>Payment confirmed</h1><p>Hello ${name},</p><p>Your WildCard Business Package for ${business} is confirmed.</p><p><strong>Order:</strong> ${reference}<br><strong>Quantity:</strong> 2,100 WildCards<br><strong>Amount paid:</strong> ₹10,000 INR</p><p>Our team will follow up about fulfilment. Thank you for choosing NearGrow Ads.</p></body></html>`,
    text: [
      'NearGrow WildCard purchase confirmed',
      `Hello ${order.customerName},`,
      `Your WildCard Business Package for ${order.businessName} is confirmed.`,
      `Order: ${order.orderReference}`,
      'Quantity: 2,100 WildCards',
      'Amount paid: INR 10,000',
      'Our team will follow up about fulfilment. Thank you for choosing NearGrow Ads.',
    ].join('\n'),
  };
}

export async function sendLocalDropBusinessOrderConfirmation(
  order: LocalDropBusinessOrderEmail,
  apiKey: string,
  from: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!apiKey || !from || /[\r\n]/.test(from)) {
    throw new Error('WildCard purchase confirmation email is not configured.');
  }
  const response = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `localdrop-business-order-${order.orderReference}`,
    },
    body: JSON.stringify({
      from,
      to: [order.customerEmail],
      ...buildLocalDropBusinessOrderEmail(order),
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    throw new Error('WildCard purchase confirmation email delivery could not be confirmed.');
  });
  if (!response.ok) throw new Error('WildCard purchase confirmation email delivery was rejected.');
}
