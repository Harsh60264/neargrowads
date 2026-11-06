import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Filter, LoaderCircle, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { billingTypeLabel, formatServicePrice } from '../../data/serviceCatalogue';
import { AdminPremiumBadge, AdminPremiumStat } from './AdminPremiumPrimitives';

interface ServiceOrder {
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
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded';
  fulfillment_status: 'awaiting_payment' | 'queued' | 'in_progress' | 'completed' | 'cancelled';
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
}

type OrderFilter = 'all' | ServiceOrder['payment_status'] | ServiceOrder['fulfillment_status'];
const statusOptions: ServiceOrder['fulfillment_status'][] = ['queued', 'in_progress', 'completed', 'cancelled'];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(body.message || `Request failed (${response.status}).`);
  return body as T;
}

function orderDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function paymentTone(status: ServiceOrder['payment_status']): 'success' | 'warning' | 'danger' | 'neutral' {
  return status === 'paid' ? 'success' : status === 'pending' ? 'warning' : status === 'failed' ? 'danger' : 'neutral';
}

export function AdminServiceOrders({ canEdit }: { canEdit: boolean }) {
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'amount'>('newest');

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api<{ orders: ServiceOrder[] }>('/api/admin/orders');
      setOrders(result.orders);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Orders could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadOrders(); }, [loadOrders]);

  const metrics = useMemo(() => ({
    total: orders.length,
    paid: orders.filter((order) => order.payment_status === 'paid' && order.provider_mode === 'live').length,
    pending: orders.filter((order) => order.payment_status === 'pending' || order.fulfillment_status === 'queued').length,
    completed: orders.filter((order) => order.fulfillment_status === 'completed').length,
    test: orders.filter((order) => order.provider_mode === 'test').length,
  }), [orders]);

  const visibleOrders = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return orders
      .filter((order) => {
        const matchesQuery = !normalizedQuery || [
          order.order_reference,
          order.customer_name,
          order.customer_email,
          order.customer_business_name,
        ].some((value) => value.toLowerCase().includes(normalizedQuery));
        const matchesFilter = filter === 'all' || order.payment_status === filter || order.fulfillment_status === filter;
        return matchesQuery && matchesFilter;
      })
      .sort((left, right) => sort === 'amount'
        ? right.total_amount_paise - left.total_amount_paise
        : sort === 'oldest'
          ? new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
          : new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
  }, [filter, orders, query, sort]);

  const updateFulfillment = async (order: ServiceOrder, fulfillmentStatus: ServiceOrder['fulfillment_status']) => {
    setBusyId(order.id);
    setError('');
    setNotice('');
    try {
      await api(`/api/admin/orders/${encodeURIComponent(order.id)}/fulfillment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fulfillmentStatus }),
      });
      setNotice(`Fulfilment status updated for ${order.order_reference}.`);
      await loadOrders();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Fulfilment status could not be changed.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="premium-orders overflow-hidden rounded-3xl border border-[#DDE8DD] bg-white shadow-[0_18px_48px_-32px_rgba(27,79,44,.4)]">
      <header className="border-b border-[#E8EEE7] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#3D8A50]">Service Store / Operations</p>
            <h2 className="mt-2 text-xl font-bold tracking-tight text-[#183322]">Orders &amp; Fulfilment</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#66776B]">Provider-verified payment state and fulfilment controls stay separate, so the team can act confidently without treating attempts as revenue.</p>
          </div>
          <button type="button" onClick={() => void loadOrders()} disabled={loading} className="premium-control inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#CFE0D0] px-3 text-xs font-semibold text-[#245B35] disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          <AdminPremiumStat label="All orders" value={metrics.total} detail="provider records" />
          <AdminPremiumStat label="Paid live" value={metrics.paid} detail="verified only" tone="success" />
          <AdminPremiumStat label="Needs attention" value={metrics.pending} detail="pending or queued" tone="warning" />
          <AdminPremiumStat label="Completed" value={metrics.completed} detail="fulfilled orders" tone="accent" />
          <AdminPremiumStat label="Test gateway" value={metrics.test} detail="no real funds" />
        </div>
        <div className="mt-6 flex flex-col gap-3 lg:flex-row">
          <label className="premium-search relative min-w-0 flex-1">
            <span className="sr-only">Search orders</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#78907D]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, business or order reference" className="premium-control h-11 w-full rounded-xl border border-[#D7E4D7] bg-[#FAFCF9] pl-10 pr-3 text-sm text-[#183322] outline-none focus:border-[#3D8A50]" />
          </label>
          <label className="relative">
            <span className="sr-only">Filter orders</span>
            <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#78907D]" />
            <select value={filter} onChange={(event) => setFilter(event.target.value as OrderFilter)} className="premium-control h-11 min-w-44 rounded-xl border border-[#D7E4D7] bg-[#FAFCF9] pl-10 pr-8 text-sm text-[#183322]">
              <option value="all">All statuses</option>
              <option value="paid">Payment paid</option>
              <option value="pending">Payment pending</option>
              <option value="queued">Queued fulfilment</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Sort orders</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="premium-control h-11 min-w-36 rounded-xl border border-[#D7E4D7] bg-[#FAFCF9] px-3 text-sm text-[#183322]">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="amount">Highest amount</option>
            </select>
          </label>
        </div>
      </header>
      {error && <p role="alert" className="m-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {notice && <p role="status" className="m-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}
      {loading ? <div className="grid min-h-48 place-items-center text-sm text-[#66776B]"><LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" /> Loading verified orders…</div> : visibleOrders.length === 0
        ? <div className="premium-empty-state m-5 rounded-2xl border border-dashed border-[#CFE0D0] bg-[#FAFCF9] p-10 text-center"><p className="font-semibold text-[#183322]">{orders.length ? 'No orders match these filters' : 'No checkout orders yet'}</p><p className="mt-2 text-sm text-[#66776B]">{orders.length ? 'Try a different search or status.' : 'Enquiry requests remain available in the Enquiry Requests tab.'}</p></div>
        : <div className="space-y-4 p-4 sm:p-6">
          {visibleOrders.map((order) => {
            const isTest = order.provider_mode === 'test';
            const attempts = order.cashfree_payment_attempts || [];
            return <article key={order.id} className="premium-order-card rounded-2xl border border-[#DDE8DD] bg-[#FCFEFC] p-4 sm:p-5">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E7EFE6] pb-4">
                <div><p className="text-sm font-bold text-[#183322]">{order.order_reference}</p><p className="mt-1 text-xs text-[#718174]">{orderDate(order.created_at)} · {order.provider === 'cashfree' ? `Cashfree ${isTest ? 'Sandbox' : 'Production'}` : order.provider}</p></div>
                <div className="flex flex-wrap gap-2">
                  <AdminPremiumBadge tone={paymentTone(order.payment_status)}>Payment {order.payment_status}</AdminPremiumBadge>
                  <AdminPremiumBadge tone={order.fulfillment_status === 'completed' ? 'success' : 'neutral'}>{order.fulfillment_status.replaceAll('_', ' ')}</AdminPremiumBadge>
                  {isTest && <AdminPremiumBadge tone="info">TEST · NO REAL FUNDS</AdminPremiumBadge>}
                  {order.cashfree_reconciliation_required && <AdminPremiumBadge tone="danger">Reconciliation needed</AdminPremiumBadge>}
                </div>
              </header>
              <div className="mt-5 grid gap-5 lg:grid-cols-[1.05fr_1.15fr_1.1fr_1fr]">
                <div><p className="premium-order-label">Customer</p><p className="mt-2 font-semibold text-[#183322]">{order.customer_name}</p>{order.customer_business_name && <p className="mt-1 text-sm text-[#66776B]">{order.customer_business_name}</p>}<a className="mt-2 block break-all text-sm text-[#28753C]" href={`mailto:${encodeURIComponent(order.customer_email)}`}>{order.customer_email}</a><a className="mt-1 block text-sm text-[#66776B]" href={`tel:${encodeURIComponent(order.customer_phone)}`}>{order.customer_phone}</a>{order.customer_onboarding_notes && <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-[#718174]">{order.customer_onboarding_notes}</p>}</div>
                <div><p className="premium-order-label">Package &amp; amount</p>{order.line_items.map((item, index) => <div key={`${item.packageCode}-${index}`} className="mt-2 flex justify-between gap-3 text-sm text-[#425548]"><span>{item.title}{item.quantity > 1 ? ` × ${item.quantity}` : ''}<span className="block text-xs text-[#718174]">{item.billingArrangement === 'single_cycle' ? 'Single monthly cycle' : item.billingArrangement === 'single_session' ? 'Single session' : billingTypeLabel[item.billingType]}</span></span><span className="shrink-0 font-semibold">{formatServicePrice(item.lineSubtotalInr)}</span></div>)}<p className="mt-3 border-t border-[#E7EFE6] pt-3 font-bold text-[#183322]">Total {formatServicePrice(order.total_amount_paise / 100)}</p></div>
                <div><p className="premium-order-label"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" /> Provider verification</p><p className="mt-2 text-sm font-semibold text-[#183322]">{order.provider_snapshot?.settlementVerified ? 'Settlement verified' : 'Verification state recorded'}</p>{order.provider_payment_id && <p className="mt-1 break-all text-xs text-[#718174]">Payment: {order.provider_payment_id}</p>}{order.provider_order_id && <p className="mt-1 break-all text-xs text-[#718174]">Order: {order.provider_order_id}</p>}{isTest && <p className="mt-3 rounded-lg bg-[#EAF5FF] px-3 py-2 text-xs font-semibold text-[#1E638A]">NO REAL FUNDS. Do not treat this as paid revenue.</p>}</div>
                <div><p className="premium-order-label">Payment attempts</p>{attempts.length ? <ol className="mt-2 space-y-3">{attempts.slice(0, 3).map((attempt) => <li key={attempt.providerPaymentId} className="relative pl-6 text-xs text-[#66776B]"><Clock3 className="absolute left-0 top-0.5 h-3.5 w-3.5 text-[#4A9A5A]" /><span className="font-semibold text-[#304936]">{attempt.status}</span><span className="block">{attempt.currency} {formatServicePrice(attempt.amountPaise / 100)} · {orderDate(attempt.lastSeenAt)}</span></li>)}</ol> : <p className="mt-2 text-sm text-[#718174]">No provider attempts recorded.</p>}{order.cashfree_webhook_events?.slice(0, 2).map((event) => <p key={`${event.eventType}-${event.receivedAt}`} className="mt-2 text-xs text-[#718174]"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-[#4A9A5A]" />{event.eventType.replaceAll('_', ' ')} · {event.processingStatus}</p>)}</div>
              </div>
              <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#E7EFE6] pt-4"><p className="text-xs text-[#718174]">{isTest ? 'Test gateway order: fulfilment is intentionally unavailable.' : order.payment_status === 'paid' ? 'Live payment verified by the provider.' : 'Fulfilment unlocks after provider verification.'}</p>{canEdit && !isTest && order.provider_mode === 'live' && order.payment_status === 'paid' ? <label className="flex items-center gap-2 text-xs font-semibold text-[#304936]">Fulfilment<select disabled={busyId === order.id} value={order.fulfillment_status} onChange={(event) => void updateFulfillment(order, event.target.value as ServiceOrder['fulfillment_status'])} className="premium-control min-h-9 rounded-lg border border-[#CFE0D0] bg-white px-2 text-xs"><option value="awaiting_payment">Awaiting payment</option>{statusOptions.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label> : <span className="text-xs font-semibold text-[#8A9A8D]">Fulfilment locked</span>}</footer>
            </article>;
          })}
        </div>}
    </section>
  );
}
