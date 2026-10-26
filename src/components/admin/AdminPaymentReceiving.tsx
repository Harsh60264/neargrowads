import { useCallback, useEffect, useState } from 'react';
import { Check, ExternalLink, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';

interface PaymentSettingsResponse {
  settings: {
    businessName: string;
    paymentContactPhone: string;
    testGatewayEnabled: boolean;
    testCredentialsVerified: boolean;
    testCredentialsVerifiedAt: string | null;
    testKeyIdMasked: string;
    updatedBy: string | null;
    updatedAt: string | null;
  };
  provider: {
    name: string;
    mode: 'test';
    credentialsConfigured: boolean;
    webhookConfigured: boolean;
    directUpiSupported: false;
    livePaymentsSupported: false;
    settlementVerified: false;
  };
  lastUpdatedBy: string | null;
}

interface PaymentAuditEntry {
  id: string;
  actor_id: string | null;
  action: string;
  field_name: string;
  old_value_masked: string;
  new_value_masked: string;
  verification_result: string;
  activation_status: string;
  created_at: string;
}

const inputClass = 'min-h-11 w-full rounded-xl border border-[#33453A] bg-[#101913] px-3.5 py-2.5 text-sm text-[#EAF1EB] outline-none placeholder:text-[#76867B] focus:border-[#67D8B7] focus:ring-2 focus:ring-[#67D8B7]/15';
const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#286D3B] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#347E49] disabled:cursor-not-allowed disabled:opacity-50';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(body.message || `Request failed (${response.status}).`);
  return body as T;
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function AdminPaymentReceiving() {
  const [overview, setOverview] = useState<PaymentSettingsResponse | null>(null);
  const [history, setHistory] = useState<PaymentAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [paymentContactPhone, setPaymentContactPhone] = useState('');
  const [confirmOldPhone, setConfirmOldPhone] = useState('');
  const [confirmNewPhone, setConfirmNewPhone] = useState('');
  const [password, setPassword] = useState('');
  const [settlementPassword, setSettlementPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [settlementHandoffUrl, setSettlementHandoffUrl] = useState('');

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api<PaymentSettingsResponse>('/api/admin/payment-settings');
      setOverview(result);
      setBusinessName(result.settings.businessName);
      setPaymentContactPhone(result.settings.paymentContactPhone);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Payment settings could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  const saveContact = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ settings: PaymentSettingsResponse['settings'] }>('/api/admin/payment-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, businessName, paymentContactPhone, confirmOldPhone, confirmNewPhone }),
      });
      setOverview((current) => current ? { ...current, settings: result.settings } : current);
      setEditing(false);
      setPassword('');
      setConfirmOldPhone('');
      setConfirmNewPhone('');
      setNotice('Payment contact information was updated. It does not change the Razorpay settlement destination.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Payment contact information could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const verifyProvider = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ message: string }>('/api/admin/payment-settings/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      setPassword('');
      setNotice(result.message);
      await loadSettings();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Gateway verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const setTestMode = async (enable: boolean) => {
    if (enable && !window.confirm('Enable Razorpay Test mode? These are simulated payments only; no real funds or settlement will occur.')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/api/admin/payment-settings/gateway', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, enable, confirmMode: 'test' }),
      });
      setPassword('');
      setNotice(enable ? 'Razorpay Test mode enabled. Live payments remain disabled.' : 'Razorpay Test mode disabled.');
      await loadSettings();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Gateway status could not be changed.');
    } finally {
      setBusy(false);
    }
  };

  const requestSettlementChange = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ message: string; url: string }>('/api/admin/payment-settings/settlement-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: settlementPassword, confirmProvider: 'Razorpay dashboard' }),
      });
      setSettlementPassword('');
      setNotice(result.message);
      setSettlementHandoffUrl(result.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The provider handoff could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  const toggleHistory = async () => {
    if (!showHistory) {
      setError('');
      try {
        const result = await api<{ history: PaymentAuditEntry[] }>('/api/admin/payment-settings/history');
        setHistory(result.history);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Configuration history could not be loaded.');
        return;
      }
    }
    setShowHistory((visible) => !visible);
  };

  if (loading && !overview) {
    return <div className="grid min-h-48 place-items-center rounded-2xl border border-[#304135] bg-[#19241D] text-sm text-[#A9B8AD]"><LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" /> Loading payment settings…</div>;
  }

  if (!overview) {
    return <section className="space-y-4 rounded-2xl border border-[#304135] bg-[#19241D] p-5 text-sm text-[#A9B8AD]">
      <p role="alert">{error || 'Payment settings are unavailable.'}</p>
      <button type="button" onClick={() => void loadSettings()} className={buttonClass}><RefreshCw className="h-4 w-4" /> Retry</button>
    </section>;
  }

  const settings = overview.settings;
  return <div className="space-y-5">
    {error && <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-400/25 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-200">{notice}</div>}

    <section className="space-y-5 rounded-2xl border border-[#304135] bg-[#19241D] p-5 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#8DD39D]"><ShieldCheck className="h-4 w-4" /> Primary Owner controls</p>
          <h2 className="mt-2 text-lg font-bold text-[#ECF3EE]">Payment Receiving</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[#A9B8AD]">Razorpay settlement destinations are controlled and verified by Razorpay. This CMS only supports Razorpay Test checkout; it cannot redirect real funds or change settlement bank details.</p>
        </div>
        <button type="button" onClick={() => void loadSettings()} disabled={loading} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-[#33453A] px-3 text-xs text-[#C8D4CB] disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ['Active Payment Gateway', settings.testGatewayEnabled ? 'Razorpay · Test' : 'None · payments unavailable'],
          ['Receiving Merchant Name', settings.businessName || 'Not configured · display metadata only'],
          ['Razorpay Test Key ID (masked)', settings.testKeyIdMasked || 'Not configured'],
          ['Payment Contact Number', settings.paymentContactPhone || 'Not configured'],
          ['Supported UPI ID', 'Unavailable · no verified direct UPI flow'],
          ['Verified Settlement Destination', 'Not verified in CMS · provider-managed'],
          ['Mode', 'Test only · no real funds'],
          ['Last Configuration Update', dateLabel(settings.updatedAt)],
          ['Last Updated By', overview.lastUpdatedBy || 'Not recorded'],
          ['Verification Status', settings.testCredentialsVerified ? `Test API accepted · ${dateLabel(settings.testCredentialsVerifiedAt)}` : 'Not verified'],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-[#304135] bg-[#101913] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#91A195]">{label}</p>
          <p className="mt-2 break-words text-sm font-semibold text-[#ECF3EE]">{value}</p>
        </div>)}
      </div>

      <div className="rounded-xl border border-amber-300/20 bg-amber-950/20 p-4 text-xs leading-5 text-amber-100/90">
        <p className="font-semibold">What these settings do — and do not do</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Business display name and phone are contact metadata only; changing them never changes money routing.</li>
          <li>Only verified Razorpay Test credentials can be enabled here. Live payments are not implemented.</li>
          <li>Settlement bank account changes must be completed and verified in the official Razorpay Dashboard.</li>
          <li>Direct UPI payments, payment screenshots, and customer-return callbacks are not accepted as payment proof.</li>
        </ul>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { setEditing((value) => !value); setError(''); }} className={buttonClass}>Edit Payment Settings</button>
        <button type="button" onClick={() => void requestSettlementChange()} disabled={busy || !settlementPassword} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#47594C] px-4 py-2 text-xs font-semibold text-[#D7E3D9] disabled:opacity-50">Request Settlement Account Change</button>
        {settlementHandoffUrl && <a href={settlementHandoffUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#47594C] px-4 py-2 text-xs font-semibold text-[#D7E3D9]">Open Razorpay Dashboard <ExternalLink className="h-3.5 w-3.5" /></a>}
        <button type="button" onClick={() => void verifyProvider()} disabled={busy || !overview.provider.credentialsConfigured || !overview.provider.webhookConfigured} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#47594C] px-4 py-2 text-xs font-semibold text-[#D7E3D9] disabled:opacity-50">Verify Configuration</button>
        <button type="button" onClick={() => void toggleHistory()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#47594C] px-4 py-2 text-xs font-semibold text-[#D7E3D9]">{showHistory ? 'Hide Change History' : 'View Change History'}</button>
      </div>

      <label className="block max-w-xl text-xs font-medium text-[#B8C7BC]">Primary Owner password to request provider handoff
        <input className={`${inputClass} mt-1.5`} type="password" autoComplete="current-password" value={settlementPassword} onChange={(event) => setSettlementPassword(event.target.value)} />
      </label>

      <div className="rounded-xl border border-[#304135] bg-[#101913] p-4">
        <p className="text-xs font-semibold text-[#ECF3EE]">Gateway readiness</p>
        <p className="mt-1 text-xs leading-5 text-[#A9B8AD]">
          {overview.provider.credentialsConfigured
            ? overview.provider.webhookConfigured
              ? 'Razorpay Test credentials are present on the server. Verify them here before enabling test checkout.'
              : 'Razorpay Test API credentials are present, but the webhook secret is missing; checkout remains disabled.'
            : 'Razorpay Test credentials are not configured in the server environment. Checkout remains disabled.'}
        </p>
        {settings.testCredentialsVerified && <p className="mt-2 text-xs font-semibold text-emerald-300"><Check className="mr-1 inline h-3.5 w-3.5" /> Test credentials verified</p>}
      </div>

      {editing && <section className="space-y-4 rounded-xl border border-[#405344] p-4">
        <div>
          <h3 className="text-sm font-semibold text-[#ECF3EE]">Contact metadata — not a payment destination</h3>
          <p className="mt-1 text-xs leading-5 text-[#A9B8AD]">Confirm the existing and proposed phone values, then re-enter the Primary Owner password. These details do not control Razorpay settlement routing.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-[#B8C7BC]">Business display name
            <input className={`${inputClass} mt-1.5`} maxLength={120} value={businessName} onChange={(event) => setBusinessName(event.target.value)} />
          </label>
          <label className="text-xs font-medium text-[#B8C7BC]">Payment contact phone
            <input className={`${inputClass} mt-1.5`} type="tel" maxLength={25} value={paymentContactPhone} onChange={(event) => setPaymentContactPhone(event.target.value)} />
          </label>
          <label className="text-xs font-medium text-[#B8C7BC]">Confirm current phone {settings.paymentContactPhone ? '' : '(none currently configured)'}
            <input className={`${inputClass} mt-1.5`} type="tel" autoComplete="off" value={confirmOldPhone} onChange={(event) => setConfirmOldPhone(event.target.value)} placeholder={settings.paymentContactPhone ? '' : 'Leave blank to confirm no current phone'} />
          </label>
          <label className="text-xs font-medium text-[#B8C7BC]">Confirm proposed phone
            <input className={`${inputClass} mt-1.5`} type="tel" autoComplete="off" value={confirmNewPhone} onChange={(event) => setConfirmNewPhone(event.target.value)} />
          </label>
        </div>
        <label className="block text-xs font-medium text-[#B8C7BC]">Primary Owner password
          <input className={`${inputClass} mt-1.5`} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || !password || (Boolean(settings.paymentContactPhone) && !confirmOldPhone) || !confirmNewPhone} onClick={() => void saveContact()} className={buttonClass}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null} Save Changes</button>
          <button type="button" onClick={() => { setEditing(false); setPassword(''); }} className="inline-flex min-h-10 items-center rounded-xl border border-[#47594C] px-4 text-xs font-semibold text-[#D7E3D9]">Cancel</button>
        </div>
      </section>}

      {(overview.provider.credentialsConfigured && overview.provider.webhookConfigured) && <section className="space-y-3 rounded-xl border border-[#405344] p-4">
        <h3 className="text-sm font-semibold text-[#ECF3EE]">Razorpay Test mode</h3>
        <p className="text-xs leading-5 text-[#A9B8AD]">The server obtains credentials only from secret environment variables. The key secret is never sent to the browser. Test mode simulates checkout and cannot receive live settlements.</p>
        <label className="block text-xs font-medium text-[#B8C7BC]">Primary Owner password
          <input className={`${inputClass} mt-1.5`} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void setTestMode(true)} disabled={busy || !password || !settings.testCredentialsVerified || settings.testGatewayEnabled} className={buttonClass}>Enable Test Mode</button>
          <button type="button" onClick={() => void setTestMode(false)} disabled={busy || !password || !settings.testGatewayEnabled} className="inline-flex min-h-10 items-center rounded-xl border border-[#47594C] px-4 text-xs font-semibold text-[#D7E3D9]">Disable Test Mode</button>
        </div>
      </section>}
    </section>

    {showHistory && <section className="overflow-hidden rounded-2xl border border-[#304135] bg-[#19241D]">
      <div className="border-b border-[#304135] p-5"><h3 className="font-semibold text-[#ECF3EE]">Payment configuration history</h3><p className="mt-1 text-xs text-[#A9B8AD]">Masked values only; secrets and complete banking details are never recorded.</p></div>
      {history.length === 0 ? <p className="p-5 text-sm text-[#A9B8AD]">No configuration changes recorded.</p> : <div className="divide-y divide-[#304135]">
        {history.map((entry) => <article key={entry.id} className="grid gap-2 p-4 text-xs sm:grid-cols-[1.2fr_1fr_1.5fr] sm:px-5">
          <div><p className="font-semibold text-[#ECF3EE]">{entry.action.replaceAll('_', ' ')}</p><p className="mt-1 text-[#91A195]">{dateLabel(entry.created_at)} · actor {entry.actor_id || 'removed'}</p></div>
          <div className="text-[#C8D4CB]">{entry.field_name.replaceAll('_', ' ')}: {entry.old_value_masked || '—'} → {entry.new_value_masked || '—'}</div>
          <div className="text-[#A9B8AD]">{entry.verification_result.replaceAll('_', ' ')} · {entry.activation_status.replaceAll('_', ' ')}</div>
        </article>)}
      </div>}
    </section>}
  </div>;
}
