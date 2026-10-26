import React, { useState } from 'react';
import { NeoMascot } from './NeoMascot';
import { Eye, EyeOff } from 'lucide-react';
import type { MascotSettings } from '../../data/siteContent';

export const FloatingAssistant: React.FC<{
  sizeSettings: MascotSettings;
  chatOpen: boolean;
  onOpenChat: () => void;
}> = ({ sizeSettings, chatOpen, onOpenChat }) => {
  const [isHidden, setIsHidden] = useState(() => {
    try {
      return window.localStorage.getItem('neargrow-neo-hidden') === 'true';
    } catch (error) {
      console.error('[NearGrow Ads] Could not load the Neo visibility preference.', error);
      return false;
    }
  });

  const toggleVisibility = () => {
    setIsHidden((hidden) => {
      const next = !hidden;
      try {
        window.localStorage.setItem('neargrow-neo-hidden', String(next));
      } catch (error) {
        console.error('[NearGrow Ads] Could not save the Neo visibility preference.', error);
      }
      return next;
    });
  };

  return (
    <>
      {!isHidden && <NeoMascot sizeSettings={sizeSettings} chatOpen={chatOpen} onOpenChat={onOpenChat} />}

      <button
        type="button"
        onClick={toggleVisibility}
        className="ng-mascot-visibility-toggle fixed bottom-0 left-4 z-[60] inline-flex items-center gap-2 rounded-full border border-white/15 bg-[#101824]/95 px-3 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur transition hover:border-[#C7F36B]/50 hover:text-[#C7F36B]"
        aria-pressed={isHidden}
        aria-label={isHidden ? 'Show Neo mascot' : 'Hide Neo mascot'}
      >
        {isHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        {isHidden ? 'Show Neo' : 'Hide Neo'}
      </button>
    </>
  );
};
