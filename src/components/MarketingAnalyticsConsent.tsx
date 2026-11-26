import { useEffect, useRef } from 'react';
import {
  getPublicMarketingPagePath,
  type MarketingAnalyticsConsent as Consent,
  updateGoogleConsent,
} from '../data/marketingAnalytics';

interface MarketingAnalyticsConsentProps {
  consent: Consent;
  enabled: boolean;
  onConsentChange: (consent: Exclude<Consent, null>) => void;
  onCloseSettings: () => void;
  pathname: string;
  settingsOpen: boolean;
}

export function MarketingAnalyticsConsent({
  consent,
  enabled,
  onConsentChange,
  onCloseSettings,
  pathname,
  settingsOpen,
}: MarketingAnalyticsConsentProps) {
  const lastTrackedPath = useRef<string | null>(null);
  const publicPath = getPublicMarketingPagePath(pathname);
  const trackingEnabled = enabled && Boolean(publicPath) && consent === 'accepted';

  useEffect(() => {
    updateGoogleConsent(trackingEnabled ? 'accepted' : 'rejected');
    if (!trackingEnabled || !publicPath) {
      lastTrackedPath.current = null;
      return;
    }

    window.gtag?.('set', {
      page_location: `${window.location.origin}${publicPath}`,
      page_path: publicPath,
    });
    const tagManagerScript = document.getElementById('neargrow-gtm-script');
    if (!tagManagerScript) {
      window.neargrowLoadTagManager?.();
      lastTrackedPath.current = publicPath;
      return;
    }
    if (!window.neargrowGtmLoaded) {
      lastTrackedPath.current = publicPath;
      return;
    }
    if (lastTrackedPath.current === publicPath) return;
    window.gtag?.('event', 'page_view', {
      page_location: `${window.location.origin}${publicPath}`,
      page_path: publicPath,
    });
    lastTrackedPath.current = publicPath;
  }, [publicPath, trackingEnabled]);

  if (!enabled || !publicPath || (consent !== null && !settingsOpen)) return null;

  const chooseConsent = (choice: Exclude<Consent, null>) => {
    onConsentChange(choice);
    onCloseSettings();
  };

  return (
    <div
      className={settingsOpen
        ? 'fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4'
        : 'fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-3xl sm:inset-x-6 sm:bottom-6'}
    >
      {settingsOpen && (
        <button
          type="button"
          aria-label="Close cookie settings"
          onClick={onCloseSettings}
          className="absolute inset-0 cursor-default"
        />
      )}
      <section
        role="dialog"
        aria-modal={settingsOpen ? true : undefined}
        aria-labelledby="analytics-consent-title"
        aria-describedby="analytics-consent-description"
        className={`relative w-full rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface)] p-4 text-[var(--brand-text)] shadow-2xl sm:p-5 ${settingsOpen ? 'z-10 max-w-md' : 'max-w-3xl'}`}
      >
        <h2 id="analytics-consent-title" className="text-sm font-bold">
          {settingsOpen ? 'Cookie Settings' : 'Your privacy choices'}
        </h2>
        <p id="analytics-consent-description" className="mt-1 text-xs leading-relaxed text-[var(--brand-text-muted)]">
          Optional analytics help us understand visits to public pages. We do not send form contents or private account data.
          {settingsOpen
            ? ` Current choice: ${consent === 'accepted' ? 'accepted' : consent === 'rejected' ? 'rejected' : 'not set'}.`
            : ' You can change this choice later in Cookie Settings.'}{' '}
          <a href="/privacy-policy" className="font-semibold text-[var(--brand-green)] underline">Privacy policy</a>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => chooseConsent('accepted')}
            className="rounded-lg bg-[#216F3D] px-3 py-2 text-xs font-bold text-white hover:bg-[#18552D]"
          >
            Accept analytics
          </button>
          <button
            type="button"
            onClick={() => chooseConsent('rejected')}
            className="rounded-lg border border-[var(--brand-border)] px-3 py-2 text-xs font-bold text-[var(--brand-text)] hover:bg-[var(--brand-bg)]"
          >
            {settingsOpen && consent === 'accepted' ? 'Withdraw analytics consent' : 'Reject optional analytics'}
          </button>
          {settingsOpen && (
            <button
              type="button"
              onClick={onCloseSettings}
              className="ml-auto rounded-lg px-3 py-2 text-xs font-bold text-[var(--brand-text-muted)] hover:bg-[var(--brand-bg)]"
            >
              Close
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
