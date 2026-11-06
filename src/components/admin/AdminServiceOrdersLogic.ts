import type { CustomerLocation } from '../../data/customerLocation';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type FulfillmentStatus = 'awaiting_payment' | 'queued' | 'in_progress' | 'completed' | 'cancelled';

export interface ServiceOrder {
  id: string;
  order_reference: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_business_name: string;
  customer_onboarding_notes: string;
  line_items: {
    title: string;
    packageCode: string;
    billingType: 'monthly' | 'one_time' | 'per_session';
    billingArrangement: 'one_time' | 'single_cycle' | 'single_session';
    quantity: number;
    originalPriceInr: number;
    unitPriceInr: number;
    lineSubtotalInr: number;
  }[];
  total_amount_paise: number;
  provider: string;
  provider_mode: 'test' | 'live';
  provider_order_id: string | null;
  provider_payment_id: string | null;
  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;
  provider_snapshot: { merchantName?: string; settlementVerified?: boolean };
  cashfree_order_id?: string | null;
  cashfree_payment_attempts?: {
    providerPaymentId: string;
    status: string;
    amountPaise: number;
    currency: 'INR';
    lastSeenAt: string;
  }[];
  cashfree_webhook_events?: {
    eventType: string;
    processingStatus: string;
    receivedAt: string;
  }[];
  cashfree_reconciliation_required?: boolean;
  cashfree_reconciliation_reasons?: string[];
  paid_at: string | null;
  created_at: string;
  location?: CustomerLocation;
}

export type OrderFilter = 'all' | PaymentStatus | FulfillmentStatus;
export type OrderSort = 'newest' | 'oldest' | 'amount';

export interface OrderMetrics {
  total: number;
  paid: number;
  queued: number;
  cancelled: number;
  test: number;
}

export function getOrderMetrics(orders: readonly ServiceOrder[]): OrderMetrics {
  return {
    total: orders.length,
    paid: orders.filter((order) => order.payment_status === 'paid' && order.provider_mode === 'live').length,
    queued: orders.filter((order) => order.fulfillment_status === 'queued').length,
    cancelled: orders.filter((order) => order.fulfillment_status === 'cancelled').length,
    test: orders.filter((order) => order.provider_mode === 'test').length,
  };
}

export function getOrderPackageOptions(orders: readonly ServiceOrder[]): string[] {
  return [...new Set(orders.flatMap((order) => order.line_items.map((item) => item.packageCode || item.title)).filter(Boolean))].sort();
}

export function filterOrders(
  orders: readonly ServiceOrder[],
  {
    query = '',
    status = 'all',
    packageCode = 'all',
    date = 'all',
    sort = 'newest',
  }: {
    query?: string;
    status?: OrderFilter;
    packageCode?: string;
    date?: 'all' | 'today' | '7d' | '30d';
    sort?: OrderSort;
  },
  now = Date.now(),
): ServiceOrder[] {
  const normalizedQuery = query.trim().toLowerCase();
  const dateCutoff = date === 'today'
    ? new Date(new Date(now).setHours(0, 0, 0, 0)).getTime()
    : date === '7d'
      ? now - 7 * 24 * 60 * 60 * 1000
      : date === '30d'
        ? now - 30 * 24 * 60 * 60 * 1000
        : 0;
  return orders
    .filter((order) => {
      const searchable = [
        order.order_reference,
        order.customer_name,
        order.customer_email,
        order.customer_business_name,
        order.provider_order_id || '',
        order.provider_payment_id || '',
        order.cashfree_order_id || '',
        ...(order.cashfree_payment_attempts || []).map((attempt) => attempt.providerPaymentId),
      ].join(' ').toLowerCase();
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      const matchesStatus = status === 'all' || order.payment_status === status || order.fulfillment_status === status;
      const matchesPackage = packageCode === 'all' || order.line_items.some((item) => (item.packageCode || item.title) === packageCode);
      const matchesDate = !dateCutoff || new Date(order.created_at).getTime() >= dateCutoff;
      return matchesQuery && matchesStatus && matchesPackage && matchesDate;
    })
    .sort((left, right) => sort === 'amount'
      ? right.total_amount_paise - left.total_amount_paise
      : sort === 'oldest'
        ? new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
        : new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
}
