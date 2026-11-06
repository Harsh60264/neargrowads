import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDollarSign, Clock3, LoaderCircle, PackageCheck, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import { billingTypeLabel, formatServicePrice } from '../../data/serviceCatalogue';

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

const statusOptions: ServiceOrder['fulfillment_status'][] = ['queued', 'in_progress', 'completed', 'cancelled'];
const stagingDemoEnabled = import.meta.env.VERCEL_ENV === 'preview' && import.meta.env.VITE_SITE_URL === 'https://staging.neargrowads.com';
const previewOrder: ServiceOrder = {
  id: 'preview-order-only',
  order_reference: 'DEMO-ORDER-001',
  customer_name: 'Preview Customer',
  customer_email: 'preview.customer@example.invalid',
  customer_phone: '+91 90000 00000',
  customer_business_name: 'Demo Business · Preview only',
  customer_onboarding_notes: 'This local fixture is never sent to the order API.',
  line_items: [{
    title: 'Google Ads Growth Sprint',
    packageCode: 'DEMO-GADS',
    billingType: 'one_time',
    billingArrangement: 'one_time',
    quantity: 1,
    originalPriceInr: 25000,
    unitPriceInr: 25000,
    lineSubtotalInr: 25000,
  }],
  total_amount_paise: 2500000,
  provider: 'cashfree',
  provider_mode: 'test',
  provider_order_id: 'demo_cf_order_not_real',
  provider_payment_id: 'demo_cf_payment_not_real',
  payment_status: 'paid',
  fulfillment_status: 'queued',
  provider_snapshot: { merchantName: 'Staging Preview', settlementVerified: false },
  cashfree_payment_attempts: [{ providerPaymentId: 'demo_attempt_not_real', status: 'SUCCESS (DEMO)', amountPaise: 2500000, currency: 'INR', lastSeenAt: '2026-11-06T08:00:00.000Z' }],
  cashfree_webhook_events: [{ eventType: 'PAYMENT_SUCCESS (DEMO)', processingStatus: 'preview only', receivedAt: '2026-11-06T08:00:00.000Z' }],
  paid_at: '2026-11-06T08:00:00.000Z',
  created_at: '2026-11-06T07:55:00.000Z',
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(body.message || `Request failed (${response.status}).`);
  return body as T;
}

function orderDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function AdminServiceOrders({ canEdit }: { canEdit: boolean }) {
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [showPreviewOrder, setShowPreviewOrder] = useState(stagingDemoEnabled);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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
      setNotice(`Fulfillment status updated for ${order.order_reference}.`);
      await loadOrders();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Fulfillment status could not be changed.');
    } finally {
      setBusyId('');
    }
  };

  const paidCount = orders.filter((order) => order.payment_status === 'paid').length;
  const liveCount = orders.filter((order) => order.provider_mode === 'live').length;
  const awaitingCount = orders.filter((order) => order.fulfillment_status === 'awaiting_payment').length;
  const previewOrders = stagingDemoEnabled && showPreviewOrder ? [previewOrder] : [];

  return <section className="admin-orders space-y-5">
    <header className="admin-module-header flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="admin-eyebrow">Service Store · Operations</p>
        <h2 className="admin-page-title">Orders &amp; Fulfilment</h2>
        <p className="admin-page-subtitle">Review provider-verified payments and move eligible live orders through fulfilment.</p>
      </div>
      <button type="button" onClick={() => void loadOrders()} disabled={loading} className="admin-button-secondary inline-flex min-h-10 items-center gap-2">
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh orders
      </button>
    </header>
    <div className="admin-order-kpis grid gap-3 sm:grid-cols-3">
      <div className="admin-kpi-card"><span className="admin-kpi-icon admin-kpi-icon-green"><PackageCheck /></span><span><strong>{orders.length}</strong><small>Total orders</small></span></div>
      <div className="admin-kpi-card"><span className="admin-kpi-icon admin-kpi-icon-blue"><CircleDollarSign /></span><span><strong>{paidCount}</strong><small>Provider-verified paid</small></span></div>
      <div className="admin-kpi-card"><span className="admin-kpi-icon admin-kpi-icon-amber"><Clock3 /></span><span><strong>{liveCount - awaitingCount < 0 ? 0 : liveCount - awaitingCount}</strong><small>Live orders in fulfilment</small></span></div>
    </div>
    <div className="admin-order-integrity"><ShieldCheck className="h-4 w-4" /><span><strong>Payment integrity:</strong> payment status is set only after server-side provider verification of amount and INR currency. Test gateway records are never treated as revenue.</span></div>
    {stagingDemoEnabled && <div className="admin-demo-toolbar"><div><strong>Preview sample order</strong><span>Staging-only local fixture. Real counts and orders above remain unchanged.</span></div><label><input type="checkbox" checked={showPreviewOrder} onChange={(event) => setShowPreviewOrder(event.target.checked)} /> Show demo</label></div>}
    {error && <p role="alert" className="admin-alert admin-alert-error">{error}</p>}
    {notice && <p role="status" className="admin-alert admin-alert-success">{notice}</p>}
    {loading ? <div className="admin-empty-state"><LoaderCircle className="h-5 w-5 animate-spin" /> Loading orders…</div> : orders.length === 0 && previewOrders.length === 0
      ? <div className="admin-empty-state"><PackageCheck className="h-8 w-8" /><strong>No checkout orders yet</strong><span>Enquiry requests remain available in the Enquiry Requests tab.</span></div>
      : <div className="admin-order-list">
        {previewOrders.map((order) => {
          const isTest = true;
          return <article key={order.id} className="admin-order-card admin-order-card-demo">
            <div className="admin-demo-banner">DEMO — NOT A REAL ORDER / NO PAYMENT</div>
            <header className="admin-order-card-header">
              <div><p className="admin-order-reference">{order.order_reference}</p><p className="admin-muted">{orderDate(order.created_at)} · Cashfree Sandbox · local fixture</p></div>
              <div className="admin-badge-row"><span className="admin-status-badge is-info">Preview only</span><span className="admin-status-badge is-warning">No payment</span></div>
            </header>
            <div className="admin-order-grid">
              <section className="admin-order-panel"><p className="admin-panel-label"><UserRound /> Customer</p><p className="admin-order-customer">{order.customer_name}</p><p className="admin-muted">{order.customer_business_name}</p><p className="admin-muted">{order.customer_email}</p></section>
              <section className="admin-order-panel"><p className="admin-panel-label"><PackageCheck /> Package details</p>{order.line_items.map((item, index) => <div key={`${item.packageCode}-${index}`} className="admin-line-item"><span>{item.title}<small>Preview package</small></span><strong>{formatServicePrice(item.lineSubtotalInr)}</strong></div>)}<div className="admin-order-total"><span>Demo total</span><strong>{formatServicePrice(order.total_amount_paise / 100)}</strong></div></section>
              <section className="admin-order-panel admin-order-fulfilment"><p className="admin-panel-label"><ShieldCheck /> Fulfilment control</p><p className="admin-muted">Disabled for demo orders. No changes are persisted.</p><select disabled value={order.fulfillment_status} onChange={() => undefined} aria-label="Demo fulfilment status">{statusOptions.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></section>
            </div>
            <details className="admin-order-timeline" open><summary>Demo payment timeline (not verified)</summary><div className="admin-timeline"><p><Clock3 /> Payment attempt · SUCCESS (DEMO) · INR 25,000</p><p><ShieldCheck /> PAYMENT_SUCCESS (DEMO) · preview only</p></div></details>
          </article>;
        })}
        {orders.map((order) => {
          const isTest = order.provider_mode !== 'live';
          const canFulfil = canEdit && !isTest && order.payment_status === 'paid';
          return <article key={order.id} className="admin-order-card">
            <header className="admin-order-card-header">
              <div><p className="admin-order-reference">{order.order_reference}</p><p className="admin-muted">{orderDate(order.created_at)} · {order.provider === 'cashfree' ? `Cashfree ${isTest ? 'Sandbox' : 'Production'}` : `${order.provider} · Test mode`}</p></div>
              <div className="admin-badge-row">
                <span className={`admin-status-badge ${order.payment_status === 'paid' ? 'is-success' : order.payment_status === 'failed' ? 'is-danger' : 'is-warning'}`}>{order.payment_status === 'paid' ? <CheckCircle2 /> : <Clock3 />} Payment {order.payment_status}</span>
                <span className="admin-status-badge is-neutral"><PackageCheck /> {order.fulfillment_status.replaceAll('_', ' ')}</span>
                <span className={`admin-status-badge ${isTest ? 'is-info' : 'is-success'}`}>{isTest ? 'Test · no real funds' : 'Live gateway'}</span>
                {order.provider === 'cashfree' && order.cashfree_reconciliation_required && <span className="admin-status-badge is-danger"><AlertTriangle /> Reconciliation needed</span>}
              </div>
            </header>
            <div className="admin-order-grid">
              <section className="admin-order-panel"><p className="admin-panel-label"><UserRound /> Customer</p><p className="admin-order-customer">{order.customer_name}</p>{order.customer_business_name && <p className="admin-muted">{order.customer_business_name}</p>}<a href={`mailto:${encodeURIComponent(order.customer_email)}`}>{order.customer_email}</a><a href={`tel:${encodeURIComponent(order.customer_phone)}`}>{order.customer_phone}</a>{order.customer_onboarding_notes && <p className="admin-muted admin-order-notes">{order.customer_onboarding_notes}</p>}</section>
              <section className="admin-order-panel"><p className="admin-panel-label"><PackageCheck /> Package details</p>{order.line_items.map((item, index) => <div key={`${item.packageCode}-${index}`} className="admin-line-item"><span>{item.title}{item.packageCode ? ` (${item.packageCode})` : ''}{item.quantity > 1 ? ` × ${item.quantity}` : ''}<small>{item.billingArrangement === 'single_cycle' ? 'Single monthly cycle' : item.billingArrangement === 'single_session' ? 'Single session' : billingTypeLabel[item.billingType]}</small></span><strong>{formatServicePrice(item.lineSubtotalInr)}</strong></div>)}<div className="admin-order-total"><span>Order total</span><strong>{formatServicePrice(order.total_amount_paise / 100)}</strong></div></section>
              <section className="admin-order-panel admin-order-fulfilment"><p className="admin-panel-label"><ShieldCheck /> Fulfilment control</p>{canFulfil ? <label>Current status<select disabled={busyId === order.id} value={order.fulfillment_status} onChange={(event) => void updateFulfillment(order, event.target.value as ServiceOrder['fulfillment_status'])}>{statusOptions.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label> : <p className="admin-muted">{isTest ? 'Test orders cannot be fulfilled.' : order.payment_status !== 'paid' ? 'Awaiting provider-verified payment.' : 'Fulfilment changes require edit permission.'}</p>}</section>
            </div>
            <details className="admin-order-timeline"><summary>Payment verification &amp; webhook activity</summary><div className="admin-timeline">{order.provider_payment_id && <p><CheckCircle2 /> Verified payment reference: <code>{order.provider_payment_id}</code></p>}{order.provider === 'cashfree' && order.cashfree_payment_attempts?.map((attempt) => <p key={attempt.providerPaymentId}><Clock3 /> Payment attempt · {attempt.status} · {attempt.currency} {formatServicePrice(attempt.amountPaise / 100)} · {orderDate(attempt.lastSeenAt)}</p>)}{order.provider === 'cashfree' && order.cashfree_webhook_events?.map((event) => <p key={`${event.eventType}-${event.receivedAt}`}><ShieldCheck /> {event.eventType.replaceAll('_', ' ')} · {event.processingStatus} · {orderDate(event.receivedAt)}</p>)}{!order.provider_payment_id && !order.cashfree_payment_attempts?.length && !order.cashfree_webhook_events?.length && <p className="admin-muted">No provider payment or webhook activity recorded.</p>}</div></details>
          </article>;
        })}
      </div>}
  </section>;
}
