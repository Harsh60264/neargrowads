export type ServiceBillingType = 'monthly' | 'one_time' | 'per_session';
import { validateCustomerLocation, type CustomerLocation } from '../src/data/customerLocation';

export interface ServiceOrderInput {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerBusinessName: string;
  onboardingNotes: string;
  location?: CustomerLocation;
  consent: true;
  packages: { packageId: string; quantity: number }[];
}

export interface ServiceOrderLine {
  packageId: string;
  packageCode: string;
  title: string;
  billingType: ServiceBillingType;
  billingArrangement: 'one_time' | 'single_cycle' | 'single_session';
  quantity: number;
  originalPriceInr: number;
  unitPriceInr: number;
  lineSubtotalInr: number;
}

export interface ServiceOrderPackage {
  id: string;
  packageCode: string;
  title: string;
  billingType: ServiceBillingType;
  priceInr: number;
  discountedPriceInr: number | null;
  quantitySupported: boolean;
}

export class InvalidServiceEnquiryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidServiceEnquiryError';
  }
}

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function validateServiceOrder(value: unknown): ServiceOrderInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const customerName = typeof input.customerName === 'string' ? input.customerName.trim() : '';
  const customerEmail = typeof input.customerEmail === 'string' ? input.customerEmail.trim().toLowerCase() : '';
  const customerPhone = typeof input.customerPhone === 'string' ? input.customerPhone.trim() : '';
  const customerBusinessName = typeof input.customerBusinessName === 'string' ? input.customerBusinessName.trim() : '';
  const onboardingNotes = typeof input.onboardingNotes === 'string' ? input.onboardingNotes.trim() : '';
  if (customerName.length < 2 || customerName.length > 120 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customerEmail) || customerEmail.length > 255 ||
    !/^[+0-9().\s-]{7,25}$/.test(customerPhone) || customerBusinessName.length > 160 ||
    onboardingNotes.length > 2000 || input.consent !== true ||
    !Array.isArray(input.packages) || input.packages.length < 1 || input.packages.length > 12) return undefined;

  const packages: ServiceOrderInput['packages'] = [];
  const seenIds = new Set<string>();
  for (const entry of input.packages) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const item = entry as Record<string, unknown>;
    if (typeof item.packageId !== 'string' || !isUuid(item.packageId) ||
      !Number.isInteger(item.quantity) || (item.quantity as number) < 1 || (item.quantity as number) > 50 ||
      seenIds.has(item.packageId)) return undefined;
    seenIds.add(item.packageId);
    packages.push({ packageId: item.packageId, quantity: item.quantity as number });
  }
  const location = input.location === undefined ? undefined : validateCustomerLocation(input.location);
  if (input.location !== undefined && !location) return undefined;
  return { customerName, customerEmail, customerPhone, customerBusinessName, onboardingNotes, consent: true, packages, location };
}

export function buildServiceOrderLines(
  input: ServiceOrderInput,
  packages: ServiceOrderPackage[],
): ServiceOrderLine[] {
  const lines: ServiceOrderLine[] = [];
  let billingArrangement: ServiceOrderLine['billingArrangement'] | undefined;
  for (const requested of input.packages) {
    const servicePackage = packages.find((item) => item.id === requested.packageId);
    if (!servicePackage) throw new InvalidServiceEnquiryError('A selected service package is no longer available.');
    if (!servicePackage.quantitySupported && requested.quantity !== 1) {
      throw new InvalidServiceEnquiryError('This service package does not support a quantity greater than one.');
    }
    const arrangement: ServiceOrderLine['billingArrangement'] = servicePackage.billingType === 'monthly'
      ? 'single_cycle'
      : servicePackage.billingType === 'per_session' ? 'single_session' : 'one_time';
    if (billingArrangement && billingArrangement !== arrangement) {
      throw new InvalidServiceEnquiryError('Purchase monthly, one-time, and per-session services in separate checkouts.');
    }
    billingArrangement = arrangement;
    const unitPriceInr = servicePackage.discountedPriceInr ?? servicePackage.priceInr;
    lines.push({
      packageId: servicePackage.id,
      packageCode: servicePackage.packageCode,
      title: servicePackage.title,
      billingType: servicePackage.billingType,
      billingArrangement: arrangement,
      quantity: requested.quantity,
      originalPriceInr: servicePackage.priceInr,
      unitPriceInr,
      lineSubtotalInr: Math.round(unitPriceInr * requested.quantity * 100) / 100,
    });
  }
  return lines;
}
