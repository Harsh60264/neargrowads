import React, { useId } from 'react';

interface NearGrowLeafMarkProps {
  animated?: boolean;
  className?: string;
}

export const NearGrowLeafMark: React.FC<NearGrowLeafMarkProps> = ({ animated = false, className = '' }) => {
  const id = useId().replace(/:/g, '');
  const filterId = `${id}-black-key`;

  const logoImage = (
    <image
      href="/neargrow-mark.jpg"
      x="-30"
      y="-40"
      width="160"
      height="160"
      preserveAspectRatio="none"
      filter={`url(#${filterId})`}
    />
  );

  return (
    <svg
      className={className}
      viewBox={animated ? '0 0 447 447' : '0 0 100 80'}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {animated ? (
        <>
          <g className="ng-transition-leaf ng-transition-leaf-center">
            <image href="/images/brand/neargrow-leaf-center.png" x="0" y="0" width="447" height="447" />
          </g>
          <g className="ng-transition-leaf ng-transition-leaf-left">
            <image href="/images/brand/neargrow-leaf-left.png" x="0" y="0" width="447" height="447" />
          </g>
          <g className="ng-transition-leaf ng-transition-leaf-orange">
            <image href="/images/brand/neargrow-leaf-orange.png" x="0" y="0" width="447" height="447" />
          </g>
          <image
            className="ng-transition-original"
            href="/images/brand/neargrow-mark.png"
            x="0"
            y="0"
            width="447"
            height="447"
          />
        </>
      ) : (
        <>
          <defs>
            <filter id={filterId} x="-30" y="-40" width="160" height="160" colorInterpolationFilters="sRGB">
              <feColorMatrix
                type="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 4 0 0 -0.9"
              />
            </filter>
          </defs>
          {logoImage}
        </>
      )}
    </svg>
  );
};