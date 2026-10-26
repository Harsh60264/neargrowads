import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
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
  paid_at: string | null;
  created_at: string;
}

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

export function AdminServiceOrders({ canEdit }: { canEdit: boolean }) {
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
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

  return <section className="overflow-hidden rounded-2xl border border-[#304135] bg-[#19241D]">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#304135] p-5">
      <div><h2 className="font-semibold text-[#ECF3EE]">Orders &amp; Fulfilment</h2><p className="mt-1 text-xs text-[#A9B8AD]">Payment status is set only after Razorpay reports a captured, amount-matched payment.</p></div>
      <button type="button" onClick={() => void loadOrders()} disabled={loading} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-[#33453A] px-3 text-xs text-[#C8D4CB] disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
    </header>
    {error && <p role="alert" className="m-4 rounded-xl border border-rose-400/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">{error}</p>}
    {notice && <p role="status" className="m-4 rounded-xl border border-emerald-400/25 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-200">{notice}</p>}
    {loading ? <div className="grid min-h-48 place-items-center text-sm text-[#A9B8AD]"><LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" /> Loading orders…</div> : orders.length === 0
      ? <p className="p-10 text-center text-sm text-[#A9B8AD]">No checkout orders yet. Enquiry requests remain available in the Enquiry Requests tab.</p>
      : <div className="divide-y divide-[#304135]">
        {orders.map((order) => <article key={order.id} className="space-y-4 p-4 sm:p-5">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-[#ECF3EE]">{order.order_reference}</p>
              <p className="mt-1 text-[11px] text-[#91A195]">{orderDate(order.created_at)} · {order.provider} · TEST MODE</p>
            </div>
            <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase">
              <span className={`rounded-full px-2.5 py-1 ${order.payment_status === 'paid' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-200'}`}>Payment {order.payment_status}</span>
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-[#C8D4CB]">{order.fulfillment_status.replaceAll('_', ' ')}</span>
              <span className="rounded-full bg-sky-400/10 px-2.5 py-1 text-sky-200">Test · no real funds</span>
            </div>
          </header>
          <div className="grid gap-4 sm:grid-cols-[1fr_1.3fr_auto]">
            <div className="text-xs text-[#C8D4CB]">
              <p className="font-semibold text-[#ECF3EE]">{order.customer_name}</p>
              {order.customer_business_name && <p className="mt-1">{order.customer_business_name}</p>}
              <a className="mt-1 block break-all text-[#9FD9A9]" href={`mailto:${encodeURIComponent(order.customer_email)}`}>{order.customer_email}</a>
              <a className="mt-1 block text-[#A9B8AD]" href={`tel:${encodeURIComponent(order.customer_phone)}`}>{order.customer_phone}</a>
              {order.customer_onboarding_notes && <p className="mt-2 whitespace-pre-wrap text-[#A9B8AD]">Onboarding: {order.customer_onboarding_notes}</p>}
            </div>
            <div className="space-y-1 text-xs text-[#C8D4CB]">
              {order.line_items.map((item, index) => <div key={`${item.packageCode}-${index}`} className="flex justify-between gap-4">
                <span>{item.title}{item.packageCode ? ` (${item.packageCode})` : ''}{item.quantity > 1 ? ` × ${item.quantity}` : ''} · {item.billingArrangement === 'single_cycle' ? 'single monthly cycle' : item.billingArrangement === 'single_session' ? 'single session' : billingTypeLabel[item.billingType].toLowerCase()}</span>
                <span className="shrink-0">{formatServicePrice(item.lineSubtotalInr)}</span>
              </div>)}
              <p className="border-t border-[#304135] pt-2 font-bold text-[#ECF3EE]">Test total: {formatServicePrice(order.total_amount_paise / 100)}</p>
              {order.provider_order_id && <p className="break-all text-[10px] text-[#91A195]">Razorpay order: {order.provider_order_id}</p>}
              {order.provider_payment_id && <p className="break-all text-[10px] text-[#91A195]">Test payment: {order.provider_payment_id}</p>}
            </div>
            {canEdit && order.provider_mode === 'live' && order.payment_status === 'paid' && <label className="text-[10px] font-semibold uppercase text-[#91A195]">Fulfilment status
              <select disabled={busyId === order.id} value={order.fulfillment_status} onChange={(event) => void updateFulfillment(order, event.target.value as ServiceOrder['fulfillment_status'])} className="mt-1.5 min-h-10 rounded-lg border border-[#33453A] bg-[#101913] px-3 text-xs normal-case text-[#ECF3EE]">
                {statusOptions.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
              </select>
            </label>}
          </div>
          <p className="text-[10px] leading-5 text-[#91A195]">This order is from the Test gateway. It represents no real payment and must not be fulfilled as a paid customer order.</p>
        </article>)}
      </div>}
  </section>;
}
