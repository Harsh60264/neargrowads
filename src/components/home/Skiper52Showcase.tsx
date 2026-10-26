import type { FC } from 'react';
import { ArrowRight } from 'lucide-react';
import type { CaseStudy } from '../../data/caseStudiesData';
import { publicMedia } from '../../data/publicMedia';
import type { HeroVideoTheme } from '../../data/heroVideo';
import type { SiteContent } from '../../data/siteContent';
import storefrontImage from '../../assets/images/local_business_storefront_1792080226091.jpg';
import workspaceImage from '../../assets/images/hero_agency_workspace_1792080209028.jpg';

const visuals = [
  { image: storefrontImage, alt: 'Local retail storefront' },
  { image: workspaceImage, alt: 'Digital marketing team planning a campaign' },
  { image: 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=1200&q=85', alt: 'Modern healthcare clinic interior' },
];

interface Skiper52ShowcaseProps {
  onNavigate: (path: string) => void;
  media: SiteContent['media'];
  studies: CaseStudy[];
  theme: HeroVideoTheme;
}

export const Skiper52Showcase: FC<Skiper52ShowcaseProps> = ({ onNavigate, media, studies, theme }) => {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {studies.map((study, index) => {
        const fallback = visuals[index % visuals.length];
        const configured = publicMedia(media, `home.portfolio.${index + 1}`, fallback.image, theme);
        const visual = {
          image: study.imageUrl || configured.url,
          alt: study.imageAlt || configured.altText || fallback.alt,
          focalX: study.imagePositionX ?? configured.focalX,
          focalY: study.imagePositionY ?? configured.focalY,
          fit: study.imageSize === 'contain' ? 'contain' as const : 'cover' as const,
        };
        const leadMetric = study.metrics[0];

        return (
          <article key={study.id} className="home-case-study-card group relative isolate min-h-[390px] overflow-hidden rounded-2xl border border-white/10 bg-[#152126] text-white shadow-lg">
            <img src={visual.image} alt={visual.alt} loading="lazy" decoding="async" style={{ objectPosition: `${visual.focalX}% ${visual.focalY}%`, objectFit: visual.fit }} className="absolute inset-0 -z-20 h-full w-full transition-transform duration-500 group-hover:scale-105" />
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-[#07100F] via-[#07100F]/70 to-[#07100F]/10" />
            <div className="flex h-full min-h-[390px] flex-col justify-between p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <span className="rounded-full border border-white/20 bg-black/25 px-3 py-1 text-[9px] font-semibold text-white/85 backdrop-blur-sm sm:text-[10px]">{study.category}</span>
                <span className="home-case-study-index text-[10px] font-bold tracking-[0.2em] text-[#C7F36B]">{String(index + 1).padStart(2, '0')}</span>
              </div>
              <div className="mt-auto">
                <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#C7F36B]">{study.location} · {study.timeframe}</p>
                <h3 className="mt-2 text-lg font-extrabold leading-tight [text-wrap:balance] sm:text-xl">{study.title}</h3>
                <div className="mt-5 rounded-xl border border-[#C7F36B]/20 bg-black/35 p-4 backdrop-blur-sm">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/60">{leadMetric.label}</p>
                  <p className="mt-1 text-4xl font-black tracking-tight text-[#C7F36B] sm:text-5xl">{leadMetric.value}</p>
                  <p className="mt-1 text-[9px] text-white/55">{leadMetric.period}</p>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/15 pt-3">
                  {study.metrics.slice(1, 3).map((metric) => (
                    <div key={metric.label}>
                      <p className="text-base font-bold text-white">{metric.value}</p>
                      <p className="text-[9px] leading-tight text-white/60">{metric.label}</p>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => onNavigate('/work')} className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-bold text-white transition-colors hover:text-[#C7F36B] sm:text-xs">
                  Explore case study <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
};
