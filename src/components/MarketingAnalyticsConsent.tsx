import { useEffect, useRef, useState } from 'react';
import {
  getPublicMarketingPagePath,
  type MarketingAnalyticsConsent as Consent,
  updateGoogleConsent,
} from '../data/marketingAnalytics';

interface MarketingAnalyticsConsentProps {
  consent: Consent;
  enabled: boolean;
  onConsentChange: (consent: Exclude<Consent, null>) => void;
  pathname: string;
}

export function MarketingAnalyticsConsent({
  consent,
  enabled,
  onConsentChange,
  pathname,
}: MarketingAnalyticsConsentProps) {
  const lastTrackedPath = useRef<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  if (!enabled || !publicPath) return null;

  const chooseConsent = (choice: Exclude<Consent, null>) => {
    onConsentChange(choice);
    setSettingsOpen(false);
  };

  return (
    <aside className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-3xl rounded-2xl border border-[#DDE5DD] bg-white p-4 text-[#171A17] shadow-2xl sm:inset-x-6 sm:bottom-6 sm:p-5">
      {consent === null || settingsOpen ? (
        <div role="dialog" aria-labelledby="analytics-consent-title" aria-describedby="analytics-consent-description">
          <h2 id="analytics-consent-title" className="text-sm font-bold">Your privacy choices</h2>
          <p id="analytics-consent-description" className="mt-1 text-xs leading-relaxed text-[#626A63]">
            Optional analytics help us understand visits to public pages. We do not send form contents or private account data.
            You can change this choice later.{' '}
            <a href="/privacy-policy" className="font-semibold text-[#216F3D] underline">Privacy policy</a>
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
              className="rounded-lg border border-[#DDE5DD] px-3 py-2 text-xs font-bold text-[#3A453B] hover:bg-[#F5F8F5]"
            >
              Reject optional analytics
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-[#626A63]">
            Optional analytics {consent === 'accepted' ? 'enabled' : 'disabled'}.
          </p>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="shrink-0 rounded-lg border border-[#DDE5DD] px-3 py-2 text-xs font-bold text-[#3A453B] hover:bg-[#F5F8F5]"
          >
            Cookie settings
          </button>
        </div>
      )}
    </aside>
  );
}
