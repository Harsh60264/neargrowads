import type { CustomerLocation } from '../src/data/customerLocation';
import { readCustomerLocation } from './customerLocationSerialization';

export type ServiceBillingType = 'monthly' | 'one_time' | 'per_session';

export interface ServiceEnquiryRequest {
  id: string;
  requestReference: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerBusinessName: string;
  serviceInterest: string;
  selectedPackages: {
    packageId: string;
    packageCode: string;
    title: string;
    priceInr: number;
    originalPriceInr: number;
    discountedPriceInr: number | null;
    billingType: ServiceBillingType;
    quantity: number;
    lineSubtotalInr: number;
  }[];
  requestNote: string;
  location?: CustomerLocation;
  status: 'received' | 'in_progress' | 'closed';
  createdAt: string;
}

export function fromSupabaseServiceEnquiry(row: Record<string, unknown>): ServiceEnquiryRequest {
  const location = readCustomerLocation(row);
  const selectedPackages = Array.isArray(row.selected_packages)
    ? row.selected_packages.filter((entry): entry is ServiceEnquiryRequest['selectedPackages'][number] =>
      Boolean(entry && typeof entry === 'object' &&
        typeof (entry as Record<string, unknown>).packageId === 'string' &&
        typeof (entry as Record<string, unknown>).title === 'string'))
    : [];
  const status = row.status === 'in_progress' || row.status === 'closed' ? row.status : 'received';
  return {
    id: String(row.id),
    requestReference: String(row.request_reference),
    customerName: String(row.customer_name),
    customerEmail: String(row.customer_email || ''),
    customerPhone: String(row.customer_phone || ''),
    customerBusinessName: String(row.customer_business_name || ''),
    serviceInterest: String(row.service_interest || ''),
    selectedPackages,
    requestNote: String(row.request_note || ''),
    ...(location ? { location } : {}),
    status,
    createdAt: String(row.created_at),
  };
}
