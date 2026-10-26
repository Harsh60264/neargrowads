import React from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { DEFAULT_SITE_CONTENT, type SiteContent } from '../../data/siteContent';
import { publicText } from '../../data/publicCopy';

interface PrivacyPolicyProps {
  onNavigate: (path: string) => void;
  siteContent?: SiteContent;
}

export const PrivacyPolicy: React.FC<PrivacyPolicyProps> = ({ onNavigate, siteContent = DEFAULT_SITE_CONTENT }) => {
  const text = (key: string) => publicText(siteContent.copy, key);
  return (
    <div className="w-full bg-white py-16 md:py-24">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <button
          onClick={() => onNavigate('/')}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#626A63] hover:text-[#171A17] mb-8"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </button>

        <div className="space-y-4 mb-10 pb-8 border-b border-[#E5E9E4]">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-[#3EA259] uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4" /> NearGrow Ads Legal & Privacy
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-[#171A17] tracking-tight">{text('legal.privacy.title')}</h1>
          <p className="text-xs text-[#626A63]">{text('legal.privacy.updated')}</p>
        </div>

        <div className="space-y-8 text-xs sm:text-sm text-[#171A17] leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#171A17]">{text('legal.privacy.collectTitle')}</h2>
            <p className="text-[#626A63]">
              {text('legal.privacy.collectBody')}
            </p>
            <p className="text-[#626A63]">
              The public website also uses Google Analytics and a first-party activity counter for aggregate page-activity estimates. The counter keeps a random browser identifier in this browser for up to 30 days; the server stores a keyed hash of that identifier, a normalized public page path, a coarse device category, and activity timestamps. An IP-derived rate-limit key is transient and is not stored in activity records. Administrator pages are excluded, and form or chatbot content is not collected. Activity entries are removed in batches after 24 hours. Clearing this site’s local storage replaces the identifier on a future page visit.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#171A17]">{text('legal.privacy.useTitle')}</h2>
            <p className="text-[#626A63]">
              {text('legal.privacy.useBody')}
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#171A17]">{text('legal.privacy.securityTitle')}</h2>
            <p className="text-[#626A63]">
              {text('legal.privacy.securityBody')}
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#171A17]">{text('legal.privacy.thirdPartyTitle')}</h2>
            <p className="text-[#626A63]">
              {text('legal.privacy.thirdPartyBody')}
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#171A17]">{text('legal.privacy.rightsTitle')}</h2>
            <p className="text-[#626A63]">
              {text('legal.privacy.rightsIntro')}{' '}
              <a href={siteContent.footerSettings.emailDestination} className="text-[#3EA259] underline">{siteContent.footerSettings.email}</a>{' '}
              {text('legal.privacy.rightsPhoneIntro')}{' '}
              <a href={siteContent.footerSettings.phoneDestination} className="text-[#3EA259] underline">{siteContent.footerSettings.phone}</a>
              {text('legal.privacy.rightsEnding')}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
