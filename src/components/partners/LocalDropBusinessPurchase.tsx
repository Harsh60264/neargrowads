import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, CreditCard, LoaderCircle, MapPin, RefreshCw, ShieldCheck } from 'lucide-react';
import type { PartnerLocation, PartnerLocationSubmission } from '../../../shared/partnerLocation';
import {
  cashfreeAvailabilityMode,
  getOrCreateCashfreeAttempt,
  isCashfreeAvailable,
  readCashfreeReturnRecords,
  removeCashfreeReturnRecord,
  writeCashfreeReturnRecord,
  type CashfreeCheckoutMode,
} from '../catalogue/cashfreeCheckout';
import { loadCashfreeCheckout } from '../../data/cashfreeSdk';
import { PartnerLocationCapture } from './PartnerLocationCapture';
import './partnerLocationCapture.css';

const PACKAGE_ID = '00000000-0000-4000-8000-000000000001';
const PACKAGE_QUANTITY = 2_100;
const PACKAGE_AMOUNT_PAISE = 1_000_000;
const BUSINESS_ORDER_RETURN_PARAMETER = 'cashfree_business_order_id';

interface BusinessOrderStatus {
  orderReference: string;
  providerMode: string;
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  cashfreeAttemptStatus: string | null;
  quantity: number;
  amountPaise: number;
  currency: 'INR';
  fulfillmentStatus: string;
  createdAt: string;
  paidAt: string | null;
}

interface ActiveCheckout {
  orderReference: string;
  trackingToken: string;
  paymentSessionId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function customerLocationFrom(value: PartnerLocation | null) {
  if (!value || value.latitude === null || value.longitude === null ||
    value.accuracyMeters === null || value.capturedAt === null) return undefined;
  const locality = value.components?.locality || value.components?.city || undefined;
  return {
    latitude: value.latitude,
    longitude: value.longitude,
    accuracyMeters: value.accuracyMeters,
    capturedAt: value.capturedAt,
    consent: true as const,
    ...(locality ? { locality: locality.slice(0, 160) } : {}),
  };
}

function paymentLabel(order: BusinessOrderStatus): string {
  if (order.paymentStatus !== 'pending') return order.paymentStatus;
  if (order.cashfreeAttemptStatus === 'FAILED') return 'failed';
  if (['CANCELLED', 'USER_DROPPED', 'VOID'].includes(order.cashfreeAttemptStatus || '')) return 'cancelled';
  return 'pending';
}

export function LocalDropBusinessPurchase() {
  const [location, setLocation] = useState<PartnerLocationSubmission | null>(null);
  const [cashfreeMode, setCashfreeMode] = useState<CashfreeCheckoutMode | null>(null);
  const [checkoutAvailable, setCheckoutAvailable] = useState(false);
  const [availabilityChecked, setAvailabilityChecked] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeCheckout, setActiveCheckout] = useState<ActiveCheckout | null>(null);
  const [orderStatus, setOrderStatus] = useState<BusinessOrderStatus | null>(null);
  const returnHandled = useRef(false);

  useEffect(() => {
    let active = true;
    void fetch('/api/catalogue/cashfree/payment-availability', {
      cache: 'no-store',
      credentials: 'same-origin',
    }).then(async (response) => {
      const body: unknown = await response.json().catch(() => ({}));
      if (!active) return;
      const mode = cashfreeAvailabilityMode(body);
      setCashfreeMode(mode || null);
      const available = response.ok && isCashfreeAvailable(body, 'production');
      setCheckoutAvailable(available);
      if (!available) setAvailabilityError('Secure Production checkout is temporarily unavailable. Please try again later.');
    }).catch(() => {
      if (active) {
        setCheckoutAvailable(false);
        setAvailabilityError('Secure payment availability could not be checked. Please retry shortly.');
      }
    }).finally(() => {
      if (active) setAvailabilityChecked(true);
    });
    return () => { active = false; };
  }, []);

  const refreshOrderStatus = useCallback(async (checkout = activeCheckout) => {
    if (!checkout) return;
    setCheckingStatus(true);
    setError('');
    try {
      const response = await fetch(
        `/api/partners/localdrop/orders/${encodeURIComponent(checkout.orderReference)}/track`,
        {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ trackingToken: checkout.trackingToken }),
        },
      );
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok || !isRecord(body) ||
        body.orderReference !== checkout.orderReference ||
        (body.providerMode !== 'live' && body.providerMode !== 'test') ||
        !['pending', 'paid', 'failed', 'refunded'].includes(String(body.paymentStatus)) ||
        body.quantity !== PACKAGE_QUANTITY || body.amountPaise !== PACKAGE_AMOUNT_PAISE ||
        body.currency !== 'INR') {
        throw new Error(isRecord(body) && typeof body.message === 'string'
          ? body.message
          : 'Order status could not be verified.');
      }
      const result: BusinessOrderStatus = {
        orderReference: checkout.orderReference,
        providerMode: body.providerMode,
        paymentStatus: body.paymentStatus as BusinessOrderStatus['paymentStatus'],
        cashfreeAttemptStatus: typeof body.cashfreeAttemptStatus === 'string'
          ? body.cashfreeAttemptStatus
          : null,
        quantity: PACKAGE_QUANTITY,
        amountPaise: PACKAGE_AMOUNT_PAISE,
        currency: 'INR',
        fulfillmentStatus: typeof body.fulfillmentStatus === 'string' ? body.fulfillmentStatus : 'pending',
        createdAt: typeof body.createdAt === 'string' ? body.createdAt : '',
        paidAt: typeof body.paidAt === 'string' ? body.paidAt : null,
      };
      setOrderStatus(result);
      if (result.paymentStatus === 'paid' && result.providerMode === 'live') {
        setNotice('Cashfree has verified your payment. Your order is confirmed.');
        try {
          removeCashfreeReturnRecord(window.sessionStorage, checkout.orderReference, 'production');
        } catch {
          setNotice('Cashfree has verified your payment. Your order is confirmed; keep this page open for your order reference.');
        }
      } else {
        setNotice(`Payment status: ${paymentLabel(result)}. The order remains available for status checks.`);
      }
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Order status could not be verified.');
    } finally {
      setCheckingStatus(false);
    }
  }, [activeCheckout]);

  useEffect(() => {
    if (returnHandled.current || cashfreeMode !== 'production') return;
    const url = new URL(window.location.href);
    const orderReference = url.searchParams.get(BUSINESS_ORDER_RETURN_PARAMETER) || '';
    if (!/^NGO-[A-F0-9]{24}$/.test(orderReference)) return;
    returnHandled.current = true;
    url.searchParams.delete(BUSINESS_ORDER_RETURN_PARAMETER);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    try {
      const record = readCashfreeReturnRecords(window.sessionStorage, 'production')
        .find((entry) => entry.orderReference === orderReference);
      if (!record) {
        setError('This return could not be matched to the checkout in this browser session. Contact NearGrow Ads with your order reference.');
        return;
      }
      const checkout = {
        orderReference,
        trackingToken: record.clientIdempotencyKey,
        paymentSessionId: '',
      };
      setActiveCheckout(checkout);
      void refreshOrderStatus(checkout);
    } catch {
      setError('Saved checkout recovery details could not be read. Contact NearGrow Ads before starting another payment.');
    }
  }, [cashfreeMode, refreshOrderStatus]);

  const openCheckout = useCallback(async (checkout: ActiveCheckout) => {
    if (!cashfreeMode || cashfreeMode !== 'production') {
      setError('Cashfree Production checkout is not available.');
      return;
    }
    if (!checkout.paymentSessionId) {
      setError('The secure checkout session is unavailable. Retry from the original form or check the order status.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await loadCashfreeCheckout();
      if (!window.Cashfree) throw new Error('Cashfree checkout could not be initialized.');
      const checkoutClient = window.Cashfree({ mode: cashfreeMode });
      await checkoutClient.checkout({
        paymentSessionId: checkout.paymentSessionId,
        redirectTarget: '_modal',
      });
      setNotice('Checkout returned. Confirming payment with Cashfree…');
      await refreshOrderStatus(checkout);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error
        ? checkoutError.message
        : 'Cashfree checkout did not complete. Check the order status before retrying.');
      await refreshOrderStatus(checkout);
    } finally {
      setBusy(false);
    }
  }, [cashfreeMode, refreshOrderStatus]);

  const resumeCheckout = useCallback(async () => {
    if (!activeCheckout) return;
    if (activeCheckout.paymentSessionId) {
      await openCheckout(activeCheckout);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/partners/localdrop/orders/${encodeURIComponent(activeCheckout.orderReference)}/checkout-session`,
        {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ trackingToken: activeCheckout.trackingToken }),
        },
      );
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok || !isRecord(body) ||
        body.orderReference !== activeCheckout.orderReference ||
        typeof body.paymentSessionId !== 'string' || !body.paymentSessionId.trim() ||
        body.mode !== 'production' || body.realPaymentsEnabled !== true) {
        throw new Error(isRecord(body) && typeof body.message === 'string'
          ? body.message
          : 'The existing Cashfree checkout could not be resumed.');
      }
      const resumed = { ...activeCheckout, paymentSessionId: body.paymentSessionId };
      setActiveCheckout(resumed);
      await openCheckout(resumed);
    } catch (resumeError) {
      setError(resumeError instanceof Error
        ? resumeError.message
        : 'The existing Cashfree checkout could not be resumed.');
    } finally {
      setBusy(false);
    }
  }, [activeCheckout, openCheckout]);

  const startCheckout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    if (!checkoutAvailable || cashfreeMode !== 'production') {
      setError(availabilityError || 'Cashfree Production checkout is unavailable.');
      return;
    }
    const values = new FormData(form);
    const customerName = String(values.get('fullName') || '').trim();
    const customerEmail = String(values.get('email') || '').trim().toLowerCase();
    const customerPhone = String(values.get('mobileNumber') || '').trim();
    const customerBusinessName = String(values.get('businessName') || '').trim();
    const businessAddress = location?.address.trim() || '';
    const preferredPromotionAreas = String(values.get('preferredPromotionAreas') || '').trim();
    const onboardingNotes = String(values.get('additionalNote') || '').trim();
    const customerLocation = customerLocationFrom(location);
    const snapshot = {
      customerName,
      customerEmail,
      customerPhone,
      customerBusinessName,
      onboardingNotes,
      ...(customerLocation ? { location: customerLocation } : {}),
      packages: [{ packageId: PACKAGE_ID, quantity: 1 }],
    };

    setBusy(true);
    setError('');
    setNotice('');
    setOrderStatus(null);
    try {
      const attempt = await getOrCreateCashfreeAttempt(
        snapshot,
        window.sessionStorage,
        globalThis.crypto,
        'production',
      );
      const response = await fetch('/api/partners/localdrop/cashfree/orders', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Idempotency-Key': attempt.clientIdempotencyKey,
        },
        body: JSON.stringify({
          fullName: customerName,
          businessName: customerBusinessName,
          email: customerEmail,
          mobileNumber: customerPhone,
          businessAddress,
          preferredPromotionAreas,
          additionalNote: onboardingNotes,
          consent: true,
          ...(customerLocation ? { location: customerLocation } : {}),
        }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (response.status === 202 && isRecord(body) && body.pending === true) {
        throw new Error(typeof body.message === 'string'
          ? body.message
          : 'The existing checkout is being reconciled. Retry later using the same details.');
      }
      if (!response.ok || !isRecord(body) ||
        typeof body.orderReference !== 'string' ||
        !/^NGO-[A-F0-9]{24}$/.test(body.orderReference) ||
        body.trackingToken !== attempt.clientIdempotencyKey ||
        typeof body.paymentSessionId !== 'string' || !body.paymentSessionId.trim() ||
        body.amountPaise !== PACKAGE_AMOUNT_PAISE || body.currency !== 'INR' ||
        body.mode !== 'production' || body.realPaymentsEnabled !== true) {
        throw new Error(isRecord(body) && typeof body.message === 'string'
          ? body.message
          : `Cashfree checkout could not be started (${response.status}).`);
      }
      const checkout: ActiveCheckout = {
        orderReference: body.orderReference,
        trackingToken: attempt.clientIdempotencyKey,
        paymentSessionId: body.paymentSessionId,
      };
      writeCashfreeReturnRecord(
        window.sessionStorage,
        { ...attempt, orderReference: checkout.orderReference },
        'production',
      );
      setActiveCheckout(checkout);
      await openCheckout(checkout);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error
        ? checkoutError.message
        : 'Secure Cashfree checkout could not be started.');
    } finally {
      setBusy(false);
    }
  };

  const isPaid = orderStatus?.paymentStatus === 'paid' && orderStatus.providerMode === 'live';

  return (
    <div className="localdrop-business-purchase">
      <article className="localdrop-business-package" aria-label="WildCard Business Package">
        <div>
          <p className="localdrop-kicker">WildCard Business Package</p>
          <h4>Reach more nearby customers</h4>
          <p>2,100 WildCards for local business promotion.</p>
        </div>
        <div className="localdrop-business-price">
          <strong>₹10,000</strong>
          <span>INR · one-time payment</span>
        </div>
      </article>

      {isPaid ? <section className="localdrop-payment-success" role="status" aria-labelledby="localdrop-payment-success-title">
        <CheckCircle2 size={26} aria-hidden="true" />
        <div>
          <h4 id="localdrop-payment-success-title">Payment confirmed</h4>
          <p>Cashfree has verified your payment. Your WildCard Business Package is confirmed.</p>
          <dl>
            <div><dt>Order ID</dt><dd>{orderStatus.orderReference}</dd></div>
            <div><dt>Package quantity</dt><dd>{PACKAGE_QUANTITY.toLocaleString('en-IN')} WildCards</dd></div>
            <div><dt>Amount paid</dt><dd>₹10,000 INR</dd></div>
          </dl>
          <small>A purchase confirmation will be sent to the email address provided.</small>
        </div>
      </section> : <>
        {error && <p className="localdrop-form-error" role="alert">{error}</p>}
        {notice && !isPaid && <p className="localdrop-payment-notice" role="status">{notice}</p>}
        {activeCheckout ? <section className={`localdrop-payment-status localdrop-payment-status--${orderStatus ? paymentLabel(orderStatus) : 'pending'}`} role="status">
          <strong>Order {activeCheckout.orderReference}: {orderStatus ? paymentLabel(orderStatus) : 'status being checked'}</strong>
          <span>{orderStatus?.paymentStatus === 'paid'
            ? 'The payment is recorded outside Production mode. Contact NearGrow Ads for assistance.'
            : orderStatus && paymentLabel(orderStatus) !== 'pending'
              ? 'No successful payment was recorded. You can retry the existing order without creating a second order.'
              : 'We are waiting for Cashfree to confirm payment. Do not start another order.'}</span>
          <div className="localdrop-payment-actions">
            <button type="button" className="localdrop-location-refresh" onClick={() => void refreshOrderStatus()} disabled={checkingStatus}>
              {checkingStatus ? <LoaderCircle size={15} className="localdrop-spin" /> : <RefreshCw size={15} />}
              Check payment status
            </button>
            {orderStatus && ['failed', 'cancelled'].includes(paymentLabel(orderStatus)) && (
              <button type="button" className="localdrop-button localdrop-button-primary" onClick={() => void resumeCheckout()} disabled={busy}>
                {busy ? 'Connecting to Cashfree…' : 'Retry secure checkout'}
              </button>
            )}
          </div>
        </section> : <form className="localdrop-form localdrop-business-form" onSubmit={(event) => void startCheckout(event)}>
          <div className="localdrop-form-grid">
            <label>Full name<input name="fullName" autoComplete="name" required maxLength={120} /></label>
            <label>Business name<input name="businessName" autoComplete="organization" required maxLength={160} /></label>
            <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={255} /></label>
            <label>Mobile number<input name="mobileNumber" type="tel" autoComplete="tel" required minLength={7} maxLength={25} /></label>
          </div>
          <div className="localdrop-business-location">
            <PartnerLocationCapture
              idPrefix="localdrop-business"
              title="Business location"
              addressLabel="Business address"
              addressRequired
              detectButtonLabel="Use My Location"
              refreshButtonLabel="Refresh Location"
              helperText="You can enter the full business address manually. GPS is requested only when you choose Use My Location."
              endpoint="/api/partners/registration-reverse-geocode"
              value={location}
              onChange={(nextLocation) => setLocation(nextLocation)}
            />
          </div>
          <label>Preferred promotion areas (optional)
            <input name="preferredPromotionAreas" maxLength={500} placeholder="e.g. Sector 5, Sector 6" />
          </label>
          <label>Additional note (optional)
            <textarea name="additionalNote" rows={3} maxLength={2000} placeholder="Anything our team should know?" />
          </label>
          <label className="localdrop-consent">
            <input type="checkbox" required />
            <span>I agree to the WildCard business purchase and fulfilment terms. I understand this package contains 2,100 WildCards for ₹10,000 INR, payment is securely processed by Cashfree, and fulfilment starts after payment verification.</span>
          </label>
          {availabilityError && <p className="localdrop-form-error" role="status">{availabilityError}</p>}
          <button
            className="localdrop-button localdrop-button-primary"
            type="submit"
            disabled={busy || !availabilityChecked || !checkoutAvailable}
          >
            {busy
              ? <><LoaderCircle size={17} className="localdrop-spin" /> Connecting to Cashfree…</>
              : <><CreditCard size={17} /> Buy Now — ₹10,000</>}
          </button>
          <p className="localdrop-payment-security"><ShieldCheck size={14} /> Secure Cashfree checkout · No account required</p>
        </form>}
      </>}
    </div>
  );
}
