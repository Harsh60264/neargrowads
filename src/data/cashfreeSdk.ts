export type CashfreeCheckoutMode = 'sandbox' | 'production';

export interface CashfreeCheckoutResult {
  error?: { message?: string };
  redirect?: boolean;
  paymentDetails?: Record<string, unknown>;
}

export interface CashfreeCheckoutClient {
  checkout(options: { paymentSessionId: string; redirectTarget: '_modal' }): Promise<CashfreeCheckoutResult>;
}

declare global {
  interface Window {
    Cashfree?: (options: { mode: CashfreeCheckoutMode }) => CashfreeCheckoutClient;
  }
}

let cashfreeScriptPromise: Promise<void> | null = null;

export function loadCashfreeCheckout(): Promise<void> {
  if (window.Cashfree) return Promise.resolve();
  if (cashfreeScriptPromise) return cashfreeScriptPromise;
  const loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
    script.async = true;
    script.onload = () => window.Cashfree
      ? resolve()
      : reject(new Error('Cashfree checkout did not initialize.'));
    script.onerror = () => reject(new Error('Cashfree checkout could not be loaded. Please try again.'));
    document.head.append(script);
  });
  cashfreeScriptPromise = loading.catch((error: unknown) => {
    cashfreeScriptPromise = null;
    throw error;
  });
  return cashfreeScriptPromise;
}
