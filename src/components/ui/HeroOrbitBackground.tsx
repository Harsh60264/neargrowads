import React from 'react';
import type { AnimationSettings } from '../../data/siteContent';

interface HeroOrbitBackgroundProps {
  ambient?: boolean;
  settings?: AnimationSettings;
}

export const HeroOrbitBackground: React.FC<HeroOrbitBackgroundProps> = ({ ambient = false, settings }) => {
  const speed = settings ? settings.heroSpeed / 100 : 1;
  const style = settings ? {
    '--ng-hero-nebula-duration': `${18 / speed}s`,
    '--ng-hero-stars-duration': `${46 / speed}s, 4.8s`,
    '--ng-hero-stars-reverse-duration': `${68 / speed}s, 3.3s`,
    '--ng-hero-planet-duration': `${24 / speed}s`,
    '--ng-hero-orbit-duration': `${38 / speed}s`,
    '--ng-hero-surface-duration': `${22 / speed}s`,
  } as React.CSSProperties : undefined;

  return (
    <div
      className={`ng-cosmic-scene absolute inset-0 pointer-events-none${ambient ? ' ng-cosmic-scene--ambient' : ''}${settings && !settings.heroEnabled ? ' ng-cosmic-scene--motion-disabled' : ''}`}
      aria-hidden="true"
      style={style}
    >
      {ambient ? (
        <div className="ng-cosmic-ambient-effects">
          <div className="ng-cosmic-nebula" />
          <div className="ng-cosmic-stars" />
        </div>
      ) : (
        <>
          <div className="ng-cosmic-nebula" />
          <div className="ng-cosmic-stars" />
        </>
      )}
      <div className="ng-cosmic-planet">
        <div className="ng-cosmic-planet-surface" />
      </div>
      {!ambient && <div className="ng-home-hero-grid absolute inset-0" />}
    </div>
  );
};
