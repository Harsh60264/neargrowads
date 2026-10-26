import React from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { DEFAULT_SITE_CONTENT, type SiteContent } from '../../data/siteContent';
import { publicText } from '../../data/publicCopy';

interface TermsPageProps {
  onNavigate: (path: string) => void;
  siteContent?: SiteContent;
}

export const TermsPage: React.FC<TermsPageProps> = ({ onNavigate, siteContent = DEFAULT_SITE_CONTENT }) => {
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
            <ShieldCheck className="w-4 h-4" /> NearGrow Ads Legal
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-[#171A17] tracking-tight">{text('legal.terms.title')}</h1>
          <p className="text-xs text-[#626A63]">{text('legal.terms.updated')}</p>
        </div>

        <div className="space-y-8 text-xs sm:text-sm text-[#171A17] leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#171A17]">{text('legal.terms.scopeTitle')}</h2>
            <p className="text-[#626A63]">
              {text('legal.terms.scopeBody')}
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#171A17]">{text('legal.terms.performanceTitle')}</h2>
            <p className="text-[#626A63]">
              {text('legal.terms.performanceBody')}
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#171A17]">{text('legal.terms.budgetTitle')}</h2>
            <p className="text-[#626A63]">
              {text('legal.terms.budgetBody')}
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#171A17]">{text('legal.terms.ownershipTitle')}</h2>
            <p className="text-[#626A63]">
              {text('legal.terms.ownershipBody')}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
