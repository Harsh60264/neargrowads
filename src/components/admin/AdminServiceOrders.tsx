import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  Filter,
  LoaderCircle,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  XCircle,
} from 'lucide-react';
import { billingTypeLabel, formatServicePrice } from '../../data/serviceCatalogue';
import type { CustomerLocation } from '../../data/customerLocation';
import {
  FulfillmentStatus,
  getOrderMetrics,
  getOrderPackageOptions,
  filterOrders,
  OrderFilter,
  ServiceOrder,
} from './AdminServiceOrdersLogic';

const statusOptions: FulfillmentStatus[] = ['queued', 'in_progress', 'completed', 'cancelled'];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(body.message || `Request failed (${response.status}).`);
  return body as T;
}

function orderDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function badgeTone(order: ServiceOrder): string {
  if (order.payment_status === 'paid') return 'admin-order-badge-paid';
  if (order.payment_status === 'failed' || order.payment_status === 'refunded') return 'admin-order-badge-danger';
  return 'admin-order-badge-pending';
}

function StatusBadge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`admin-order-badge ${className}`}>{children}</span>;
}

function CustomerLocationDetails({ location }: { location?: CustomerLocation }) {
  if (!location) return <p className="admin-order-muted">Customer Location: Not shared</p>;
  const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${location.latitude},${location.longitude}`)}`;
  return <div className="admin-order-location">
    <strong>Customer Location</strong>
    <span>{location.locality || 'Coordinates shared'} · accuracy about {Math.round(location.accuracyMeters)} m</span>
    <a href={mapUrl} target="_blank" rel="noopener noreferrer">View on Map</a>
  </div>;
}

function StatCard({ label, value, tone, icon }: { label: string; value: number; tone: string; icon: ReactNode }) {
  return <article className={`admin-order-stat ${tone}`}><span className="admin-order-stat-icon">{icon}</span><div><p>{label}</p><strong>{value}</strong></div></article>;
}

function PaymentTimeline({ order }: { order: ServiceOrder }) {
  const attempts = order.cashfree_payment_attempts || [];
  return <div className="admin-order-column">
    <h3><Clock3 aria-hidden="true" /> Payment Attempts</h3>
    {attempts.length ? <ol className="admin-payment-timeline">
      {attempts.map((attempt) => <li key={attempt.providerPaymentId}>
        <span className={attempt.status === 'SUCCESS' ? 'admin-payment-dot-success' : 'admin-payment-dot'} />
        <div><strong>{attempt.status}</strong><span>{attempt.currency} {formatServicePrice(attempt.amountPaise / 100)} · {orderDate(attempt.lastSeenAt)}</span><small>{attempt.providerPaymentId}</small></div>
      </li>)}
    </ol> : <p className="admin-order-muted">No provider attempts recorded.</p>}
    {(order.cashfree_webhook_events || []).slice(0, 2).map((event) => <p className="admin-order-webhook" key={`${event.eventType}-${event.receivedAt}`}><CheckCircle2 aria-hidden="true" /> {event.eventType.replaceAll('_', ' ')} · {event.processingStatus}</p>)}
  </div>;
}

function OrderCard({
  order,
  canEdit,
  busyId,
  onFulfillmentChange,
}: {
  order: ServiceOrder;
  canEdit: boolean;
  busyId: string;
  onFulfillmentChange: (order: ServiceOrder, status: FulfillmentStatus) => void;
}) {
  const isLivePaid = order.provider_mode === 'live' && order.payment_status === 'paid';
  return <article className="admin-order-card">
    <header className="admin-order-card-header">
      <div>
        <p className="admin-order-reference"><Package aria-hidden="true" /> {order.order_reference}</p>
        <p className="admin-order-meta"><CalendarDays aria-hidden="true" /> {orderDate(order.created_at)} <span>·</span> <CreditCard aria-hidden="true" /> {order.provider === 'cashfree' ? `Cashfree ${order.provider_mode === 'live' ? 'Production' : 'Sandbox'}` : order.provider}</p>
      </div>
      <div className="admin-order-badges">
        <StatusBadge className={badgeTone(order)}>Payment {order.payment_status}</StatusBadge>
        <StatusBadge className={order.fulfillment_status === 'cancelled' ? 'admin-order-badge-danger' : 'admin-order-badge-neutral'}>{order.fulfillment_status.replaceAll('_', ' ')}</StatusBadge>
        {order.provider_mode === 'test' && <StatusBadge className="admin-order-badge-test">TEST — NO REAL FUNDS</StatusBadge>}
        {order.cashfree_reconciliation_required && <StatusBadge className="admin-order-badge-danger">Reconciliation needed</StatusBadge>}
      </div>
    </header>
    <div className="admin-order-grid">
      <div className="admin-order-column">
        <h3><UserRound aria-hidden="true" /> Customer Details</h3>
        <dl className="admin-order-details"><div><dt>Name</dt><dd>{order.customer_name}</dd></div>{order.customer_business_name && <div><dt>Business</dt><dd>{order.customer_business_name}</dd></div>}<div><dt>Email</dt><dd><a href={`mailto:${encodeURIComponent(order.customer_email)}`}>{order.customer_email}</a></dd></div><div><dt>Phone</dt><dd>{order.customer_phone}</dd></div></dl>
        {order.customer_onboarding_notes && <p className="admin-order-note">{order.customer_onboarding_notes}</p>}
        <CustomerLocationDetails location={order.location} />
      </div>
      <div className="admin-order-column">
        <h3><Package aria-hidden="true" /> Package / Service</h3>
        {order.line_items.map((item, index) => <div className="admin-order-line-item" key={`${item.packageCode}-${index}`}><span>{item.title}<small>{item.billingArrangement === 'single_cycle' ? 'Single monthly cycle' : item.billingArrangement === 'single_session' ? 'Single session' : billingTypeLabel[item.billingType]}</small></span><strong>{formatServicePrice(item.lineSubtotalInr)}</strong></div>)}
      </div>
      <div className="admin-order-column">
        <h3><ShieldCheck aria-hidden="true" /> Payment Verification</h3>
        <><p className="admin-order-verified">{order.payment_status === 'paid' ? 'Provider payment verified' : `Provider status: ${order.payment_status}`}</p>{order.provider_order_id && <p className="admin-order-reference-text">Merchant order reference<br /><strong>{order.provider_order_id}</strong></p>}{order.cashfree_order_id && <p className="admin-order-reference-text">Cashfree order reference<br /><strong>{order.cashfree_order_id}</strong></p>}{order.provider_payment_id && <p className="admin-order-reference-text">Verified payment reference<br /><strong>{order.provider_payment_id}</strong></p>}</>
      </div>
      <PaymentTimeline order={order} />
      <div className="admin-order-total-column">
        <h3>Order Total</h3>
        <strong className="admin-order-total">{formatServicePrice(order.total_amount_paise / 100)}</strong>
        <label className="admin-order-fulfillment"><span>Fulfilment Status</span><select disabled={!canEdit || !isLivePaid || busyId === order.id} value={order.fulfillment_status} onChange={(event) => onFulfillmentChange(order, event.target.value as FulfillmentStatus)}>{['awaiting_payment', ...statusOptions].filter((status, index, list) => list.indexOf(status) === index).map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label>
      </div>
    </div>
    <footer className="admin-order-card-footer">{order.provider_mode === 'test' ? <p className="admin-order-warning">TEST — NO REAL FUNDS. This order must not be fulfilled as a paid customer order.</p> : <p><ShieldCheck aria-hidden="true" /> Payment state comes only from server-side provider verification.</p>}{!isLivePaid && <span className="admin-order-locked">Fulfilment locked</span>}</footer>
  </article>;
}

export function AdminServiceOrders({ canEdit }: { canEdit: boolean }) {
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<OrderFilter>('all');
  const [packageCode, setPackageCode] = useState('all');
  const [date, setDate] = useState<'all' | 'today' | '7d' | '30d'>('all');
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

  const metrics = useMemo(() => getOrderMetrics(orders), [orders]);
  const packageOptions = useMemo(() => getOrderPackageOptions(orders), [orders]);
  const visibleOrders = useMemo(() => filterOrders(orders, { query, status, packageCode, date, sort }), [date, orders, packageCode, query, sort, status]);

  const updateFulfillment = async (order: ServiceOrder, fulfillmentStatus: FulfillmentStatus) => {
    setBusyId(order.id);
    setError('');
    setNotice('');
    try {
      await api(`/api/admin/orders/${encodeURIComponent(order.id)}/fulfillment`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fulfillmentStatus }) });
      setNotice(`Fulfilment status updated for ${order.order_reference}.`);
      await loadOrders();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Fulfilment status could not be changed.');
    } finally {
      setBusyId('');
    }
  };

  return <section className="admin-orders">
    <header className="admin-orders-header">
      <div><p className="admin-orders-eyebrow">Service Store / Operations</p><h2><Package aria-hidden="true" /> Orders &amp; Fulfilment</h2><p>Payment status is set only after server-side provider verification of the payment, amount, and INR currency.</p></div>
      <div className="admin-orders-actions"><button type="button" onClick={() => void loadOrders()} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh</button></div>
    </header>
    <div className="admin-order-stats">
      <StatCard label="Total Orders" value={metrics.total} tone="admin-order-stat-total" icon={<Package aria-hidden="true" />} />
      <StatCard label="Real Paid Orders" value={metrics.paid} tone="admin-order-stat-paid" icon={<CheckCircle2 aria-hidden="true" />} />
      <StatCard label="Queued" value={metrics.queued} tone="admin-order-stat-queued" icon={<Clock3 aria-hidden="true" />} />
      <StatCard label="Cancelled" value={metrics.cancelled} tone="admin-order-stat-cancelled" icon={<XCircle aria-hidden="true" />} />
      <StatCard label="Test Orders" value={metrics.test} tone="admin-order-stat-test" icon={<CreditCard aria-hidden="true" />} />
    </div>
    <div className="admin-order-filters">
      <label className="admin-order-search"><Search aria-hidden="true" /><span className="sr-only">Search orders</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by Order ID, email, or reference..." /></label>
      <label><CalendarDays aria-hidden="true" /><span className="sr-only">Date filter</span><select value={date} onChange={(event) => setDate(event.target.value as typeof date)}><option value="all">All Dates</option><option value="today">Today</option><option value="7d">Last 7 Days</option><option value="30d">Last 30 Days</option></select></label>
      <label><Package aria-hidden="true" /><span className="sr-only">Package filter</span><select value={packageCode} onChange={(event) => setPackageCode(event.target.value)}><option value="all">All Packages</option>{packageOptions.map((option) => <option value={option} key={option}>{option}</option>)}</select></label>
      <label><Filter aria-hidden="true" /><span className="sr-only">Status filter</span><select value={status} onChange={(event) => setStatus(event.target.value as OrderFilter)}><option value="all">All Status</option><option value="paid">Payment Paid</option><option value="pending">Payment Pending</option><option value="queued">Queued</option><option value="in_progress">In Progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
      <label className="admin-order-sort"><span className="sr-only">Sort orders</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="newest">Newest First</option><option value="oldest">Oldest First</option><option value="amount">Highest Amount</option></select></label>
    </div>
    {error && <p role="alert" className="admin-orders-alert admin-orders-error">{error}</p>}
    {notice && <p role="status" className="admin-orders-alert admin-orders-notice">{notice}</p>}
    {loading ? <div className="admin-orders-empty"><LoaderCircle className="animate-spin" /> Loading orders…</div> : visibleOrders.length === 0 ? <div className="admin-orders-empty"><Package aria-hidden="true" /><strong>{orders.length ? 'No orders match these filters' : 'No checkout orders yet'}</strong><span>{orders.length ? 'Try another search or filter.' : 'Enquiry requests remain available in the Enquiry Requests tab.'}</span></div> : <div className="admin-order-list">{visibleOrders.map((order) => <OrderCard key={order.id} order={order} canEdit={canEdit} busyId={busyId} onFulfillmentChange={(nextOrder, nextStatus) => void updateFulfillment(nextOrder, nextStatus)} />)}</div>}
  </section>;
}
