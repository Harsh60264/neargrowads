import React from 'react';
import { ArrowLeft, MessageSquare, CheckCircle2 } from 'lucide-react';
import { NearGrowMascot } from '../mascot/NearGrowMascot';
import { publicText } from '../../data/publicCopy';
import type { SiteContent } from '../../data/siteContent';
import { getCtaDestination } from '../../data/publicLinks';

interface ThankYouPageProps {
  onNavigate: (path: string) => void;
  siteContent: SiteContent;
}

export const ThankYouPage: React.FC<ThankYouPageProps> = ({ onNavigate, siteContent }) => {
  return (
    <div className="w-full bg-[#F7F9F6] py-20 md:py-28 min-h-[75vh] flex items-center justify-center">
      <div className="max-w-md w-full mx-4 p-8 bg-white border border-[#E5E9E4] rounded-3xl text-center space-y-6 shadow-sm">
        <NearGrowMascot size="lg" mood="celebrating" interactive={true} />

        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#3EA259] uppercase tracking-wider">
            <CheckCircle2 className="w-4 h-4" /> {publicText(siteContent.copy, 'thankYou.eyebrow')}
          </div>
          <h1 className="text-2xl font-extrabold text-[#171A17]">{publicText(siteContent.copy, 'thankYou.title')}</h1>
          <p className="text-xs text-[#626A63] leading-relaxed">
            {publicText(siteContent.copy, 'thankYou.description')}
          </p>
        </div>

        <div className="p-4 bg-[#F7F9F6] border border-[#E5E9E4] rounded-2xl text-xs text-[#626A63] space-y-2">
          <div className="font-semibold text-[#171A17]">{publicText(siteContent.copy, 'thankYou.more.title')}</div>
          <p>{publicText(siteContent.copy, 'thankYou.more.description')}</p>
          <a
            href={getCtaDestination(siteContent, 'thankYou.whatsapp', 'https://wa.me/919289810149?text=Hi%20NearGrow%20Ads%2C%20I%20just%20submitted%20a%20consultation%20form.')}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#3EA259] hover:bg-[#216F3D] text-white font-semibold rounded-lg transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" /> {publicText(siteContent.copy, 'thankYou.whatsapp')}
          </a>
        </div>

        <div className="pt-2">
          <button
            onClick={() => onNavigate('/')}
            className="inline-flex items-center gap-2 text-xs font-semibold text-[#626A63] hover:text-[#171A17] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> {publicText(siteContent.copy, 'thankYou.home')}
          </button>
        </div>
      </div>
    </div>
  );
};
