import React from 'react';
import { NearGrowLeafMark } from './NearGrowLeafMark';

interface NearGrowLogoProps {
  variant?: 'light' | 'dark' | 'icon-only';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showTagline?: boolean;
}

export const NearGrowLogo: React.FC<NearGrowLogoProps> = ({
  variant = 'light',
  size = 'md',
  className = '',
  showTagline = false,
}) => {
  // Dimension scales
  const iconSizes = {
    sm: 'w-6 h-auto',
    md: 'w-8 h-auto',
    lg: 'w-10 h-auto',
    xl: 'w-14 h-auto',
  };

  const textSizes = {
    sm: 'text-base',
    md: 'text-xl',
    lg: 'text-2xl',
    xl: 'text-3xl',
  };

  // Colors based on variant:
  // "Near" is white in dark mode, charcoal (#171A17) in light mode
  // "Grow" is always vibrant green (#3EA259)
  // "Ads" is always warm amber/orange (#F59E0B)
  const nearTextColor = variant === 'dark' ? 'text-white' : 'text-[#171A17]';

  return (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      {/* Official 3-Leaf Sprout Icon Mark */}
      <NearGrowLeafMark className={`${iconSizes[size]} shrink-0 transition-transform duration-200 hover:scale-105`} />

      {/* Typography: NearGrow Ads */}
      {variant !== 'icon-only' && (
        <div className="flex flex-col">
          <div className={`font-bold tracking-tight leading-none ${textSizes[size]}`}>
            <span className={nearTextColor}>Near</span>
            <span className="text-[#3EA259]">Grow</span>{' '}
            <span className="text-[#F59E0B]">Ads</span>
          </div>
          {showTagline && (
            <span className="text-[10px] tracking-wider uppercase font-semibold text-[#626A63] mt-0.5">
              Building Brands Together
            </span>
          )}
        </div>
      )}
    </div>
  );
};
