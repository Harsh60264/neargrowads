import type { CSSProperties } from 'react';
import type { CaseStudy } from '../../data/caseStudiesData';
import type { PublicImageTheme } from '../../data/themeImages';

interface CaseStudyImageProps {
  study: Pick<CaseStudy, 'imageUrl' | 'imageAlt' | 'imagePlacement' | 'imageOpacity' | 'imagePositionX' | 'imagePositionY' | 'imageSize'>;
  theme: PublicImageTheme;
  className?: string;
}

export function CaseStudyImage({ study, theme, className = '' }: CaseStudyImageProps) {
  if (!study.imageUrl) return null;
  const position = `${study.imagePositionX ?? 50}% ${study.imagePositionY ?? 50}%`;
  const imageStyle: CSSProperties = { objectPosition: position };

  if (study.imagePlacement === 'background-cover' || study.imagePlacement === 'background-watermark') {
    const watermark = study.imagePlacement === 'background-watermark';
    const imageOpacity = (study.imageOpacity ?? (watermark ? 18 : 100)) / 100;
    return (
      <>
        <img
          src={study.imageUrl}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
          style={{
            ...imageStyle,
            objectFit: study.imageSize === 'contain' ? 'contain' : 'cover',
            opacity: imageOpacity,
          }}
          onError={(event) => { event.currentTarget.style.display = 'none'; }}
        />
        <div
          aria-hidden="true"
          data-case-study-theme={theme}
          data-case-study-placement={study.imagePlacement}
          className="case-study-background-overlay pointer-events-none absolute inset-0 z-0"
        />
      </>
    );
  }

  return (
    <div className={`mt-8 aspect-video w-full overflow-hidden rounded-2xl border border-[#E5E9E4] bg-[#F7F9F6] ${className}`}>
      <img
        src={study.imageUrl}
        alt={study.imageAlt || ''}
        loading="lazy"
        decoding="async"
        className="h-full w-full"
        style={{ ...imageStyle, objectFit: study.imageSize === 'contain' ? 'contain' : 'cover' }}
        onError={(event) => { event.currentTarget.style.display = 'none'; }}
      />
    </div>
  );
}
