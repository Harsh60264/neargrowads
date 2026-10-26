import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Compass,
  Cpu,
  FileText,
  Laptop,
  MapPin,
  MessageSquare,
  Share2,
  TrendingUp,
} from 'lucide-react';
import { DEFAULT_SITE_CONTENT, type SiteContent } from '../../data/siteContent';
import { publicText } from '../../data/publicCopy';
import { followPublicDestination, getCtaDestination } from '../../data/publicLinks';
import { HeroOrbitBackground } from '../ui/HeroOrbitBackground';
import type { WebsiteService } from '../../data/websiteServices';

import { resolveWebsiteServiceImage } from '../../data/websiteServices';

interface ServicesIndexPageProps {
  onNavigate: (path: string) => void;
  siteContent?: SiteContent;
  theme: 'light' | 'dark';
}

const serviceIcons = {
  MapPin,
  Compass,
  TrendingUp,
  Share2,
  Laptop,
  FileText,
  Cpu,
};

export const ServicesIndexPage: React.FC<ServicesIndexPageProps> = ({ onNavigate, siteContent = DEFAULT_SITE_CONTENT, theme }) => {
  const text = (key: string) => publicText(siteContent.copy, key);
  const [services, setServices] = useState<WebsiteService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState('');

  const loadServices = async () => {
    setServicesLoading(true);
    setServicesError('');
    try {
      const response = await fetch('/api/services', { cache: 'no-store' });
      const data = await response.json() as { services?: WebsiteService[]; message?: string };
      if (!response.ok) throw new Error(data.message || `Could not load services (${response.status}).`);
      if (!Array.isArray(data.services)) throw new Error('The services API returned an invalid response.');
      setServices(data.services);
    } catch (error) {
      console.error('[NearGrow Ads] Published website services could not be loaded.', error);
      setServicesError(error instanceof Error ? error.message : 'Published services could not be loaded.');
    } finally {
      setServicesLoading(false);
    }
  };

  useEffect(() => { void loadServices(); }, []);

  return (
  <div className="services-index-page relative isolate w-full overflow-hidden bg-[#070B13] text-[#F5F6FA]">
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] bg-[radial-gradient(ellipse_at_50%_0%,rgba(58,153,104,0.2),transparent_62%)]"
    />

    <section className="relative isolate overflow-hidden border-b border-white/[0.07] px-4 pb-16 pt-20 sm:px-6 sm:pb-20 sm:pt-28 lg:px-8 lg:pb-24">
      <HeroOrbitBackground ambient />
      <div className="relative z-10 mx-auto max-w-7xl">
        <div className="max-w-4xl">
          <div className="mb-6 inline-flex items-center rounded-full border border-[#70BE55]/25 bg-[#70BE55]/[0.08] px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#8BD477]">
            {siteContent.servicesPage.eyebrow}
          </div>
          <h1 className="max-w-4xl text-4xl font-extrabold leading-[1.08] tracking-[-0.045em] text-white [text-wrap:balance] sm:text-5xl md:text-6xl">
            {siteContent.servicesPage.headlineBefore}{' '}
            <span className="bg-gradient-to-r from-[#A1E48D] via-[#70BE55] to-[#44B98A] bg-clip-text text-transparent">
              {siteContent.servicesPage.headlineHighlight}
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-sm leading-7 text-[#A6AEC0] sm:text-base sm:leading-8">
            {siteContent.servicesPage.description}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => followPublicDestination(getCtaDestination(siteContent, 'services.primary', '/get-started'), onNavigate)}
              className="inline-flex items-center gap-2 rounded-xl bg-[#70BE55] px-5 py-3.5 text-sm font-bold text-[#07110A] shadow-[0_8px_30px_rgba(112,190,85,0.2)] transition hover:bg-[#8BD477] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1E48D] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070B13]"
            >
              {siteContent.servicesPage.primaryCta}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="text-xs text-[#818A9C] sm:text-sm">
              {siteContent.servicesPage.supportingText}
            </span>
          </div>
        </div>

        <div className="mt-14 grid max-w-3xl grid-cols-3 gap-4 border-t border-white/[0.09] pt-6 sm:mt-16 sm:gap-8">
          {[
            ['8', 'connected services'],
            ['1', 'growth-focused team'],
            ['Global', 'market perspective'],
          ].map(([metric, label]) => (
            <div key={label}>
              <div className="text-lg font-extrabold tracking-tight text-white sm:text-xl">{metric}</div>
              <div className="mt-1 text-[10px] leading-4 text-[#818A9C] sm:text-xs">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>

    <section className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-9 flex flex-col justify-between gap-4 sm:mb-12 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#8BD477]">
              {text('services.intro.eyebrow')}
            </div>
            <h2 className="text-3xl font-extrabold tracking-[-0.035em] text-white sm:text-4xl">
              {text('services.intro.title')}
            </h2>
            <p className="mt-3 text-sm leading-6 text-[#A6AEC0]">
              {text('services.intro.description')}
            </p>
          </div>
          <span className="text-xs font-medium text-[#818A9C]">{text('services.intro.supporting')}</span>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {servicesLoading ? (
            <p role="status" className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-5 text-sm text-[#A6AEC0]">Loading services…</p>
          ) : servicesError ? (
            <div role="alert" className="rounded-xl border border-rose-300/20 bg-rose-950/20 px-4 py-5 text-sm text-rose-100">
              <p>{servicesError}</p>
              <button type="button" onClick={() => void loadServices()} className="mt-3 underline underline-offset-4">Retry</button>
            </div>
          ) : services.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-5 text-sm text-[#A6AEC0]">Our service cards are being updated. Please check back soon.</p>
          ) : services.map((service) => {
            const Icon = serviceIcons[service.icon as keyof typeof serviceIcons];

            return (
              <article
                key={service.slug}
                className={`service-index-card group relative flex h-full flex-col rounded-2xl bg-gradient-to-br from-white/[0.16] via-white/[0.055] to-[#70BE55]/[0.14] p-px transition duration-300 hover:-translate-y-1 hover:from-[#70BE55]/50 hover:via-white/[0.12] hover:to-[#70BE55]/30 hover:shadow-[0_18px_55px_rgba(18,104,66,0.14)] ${
                  resolveWebsiteServiceImage(service, theme).backgroundEnabled && resolveWebsiteServiceImage(service, theme).url ? 'service-index-card--image-background' : ''
                }`}
              >
                <div className="relative isolate flex h-full flex-col rounded-[15px] bg-[#0D1320]/95 p-5 sm:p-6">
                  {resolveWebsiteServiceImage(service, theme).backgroundEnabled && resolveWebsiteServiceImage(service, theme).url && (
                    <div
                      aria-hidden="true"
                      className="service-index-card-background pointer-events-none absolute inset-0 z-0"
                      style={{ opacity: theme === 'dark' ? resolveWebsiteServiceImage(service, theme).backgroundOpacity / 100 : 1 }}
                    >
                      <img
                        src={resolveWebsiteServiceImage(service, theme).url}
                        alt=""
                        className="absolute inset-0 h-full w-full rounded-[15px]"
                        onError={(event) => { event.currentTarget.hidden = true; }}
                        style={{
                          objectFit: resolveWebsiteServiceImage(service, theme).backgroundFit,
                          objectPosition: `${resolveWebsiteServiceImage(service, theme).backgroundPositionX}% ${resolveWebsiteServiceImage(service, theme).backgroundPositionY}%`,
                          opacity: theme === 'light' ? resolveWebsiteServiceImage(service, theme).backgroundOpacity / 100 : undefined,
                        }}
                      />
                      <div className={`service-index-card-scrim absolute inset-0 rounded-[15px] ${theme === 'light' ? 'service-index-card-scrim--light' : 'bg-[#0D1320]/75'}`} />
                    </div>
                  )}
                  <div className="relative z-10 flex h-full flex-col">
                  <div className="mb-6 flex items-start justify-between gap-3">
                    {Icon && (
                      <div className="service-index-card-icon-chip flex h-11 w-11 items-center justify-center rounded-xl border border-[#70BE55]/20 bg-[#70BE55]/[0.09] text-[#8BD477] transition group-hover:border-[#70BE55]/40 group-hover:bg-[#70BE55]/[0.15]">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                    )}
                    <span className="pt-1 text-[10px] font-bold tracking-[0.16em] text-[#626D80]">
                      {String(service.displayOrder + 1).padStart(2, '0')}
                    </span>
                  </div>

                  <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#8BD477]">
                    {service.badge}
                  </div>
                  <h3 className="text-lg font-bold leading-snug tracking-[-0.025em] text-white sm:text-xl">
                    {service.title}
                  </h3>
                  <p className="mt-3 text-xs leading-6 text-[#A6AEC0]">{service.shortDescription}</p>

                  <div className="mt-6 border-t border-white/[0.08] pt-5">
                    <h4 className="mb-4 text-[10px] font-bold uppercase tracking-[0.14em] text-[#D9DFEA]">
                      Key deliverables
                    </h4>
                    <ul className="space-y-3">
                      {service.deliverables.map((deliverable, deliverableIndex) => (
                        <li key={`${deliverableIndex}-${deliverable}`} className="flex items-start gap-2.5">
                          <Check
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8BD477]"
                            strokeWidth={2.5}
                            aria-hidden="true"
                          />
                          <span className="text-xs leading-5 text-[#B9C1D0]">{deliverable}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-auto pt-7">
                    <button
                      type="button"
                      onClick={() => onNavigate(service.primaryCtaLink)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#70BE55]/35 bg-[#70BE55]/[0.1] px-4 py-3 text-xs font-bold text-[#A1E48D] transition hover:border-[#70BE55]/70 hover:bg-[#70BE55]/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1E48D]"
                    >
                      {service.primaryCtaLabel}
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    {service.secondaryCtaLabel && <button
                      type="button"
                      onClick={() => onNavigate(service.secondaryCtaLink)}
                      className="mx-auto mt-4 flex items-center gap-1.5 text-[11px] font-semibold text-[#8993A6] transition hover:text-white focus-visible:outline-none focus-visible:text-white"
                    >
                      {service.secondaryCtaLabel}
                      <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                    </button>}
                  </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>

    <section className="px-4 pb-20 sm:px-6 sm:pb-24 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="relative overflow-hidden rounded-3xl border border-[#70BE55]/20 bg-gradient-to-br from-[#13251E] via-[#101A21] to-[#111725] px-6 py-10 sm:px-10 sm:py-12 lg:px-14">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -top-24 h-72 w-72 rounded-full bg-[#70BE55]/10 blur-3xl"
          />
          <div className="relative flex flex-col items-start justify-between gap-7 md:flex-row md:items-center">
            <div className="max-w-2xl">
              <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#8BD477]">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                {text('services.closing.eyebrow')}
              </div>
              <h2 className="text-2xl font-extrabold leading-tight tracking-[-0.03em] text-white sm:text-3xl">
                {text('services.closing.title')}
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[#A6AEC0]">
                {text('services.closing.description')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('/get-started')}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#70BE55] px-5 py-3.5 text-sm font-bold text-[#07110A] transition hover:bg-[#8BD477] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1E48D] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111A20]"
            >
              {text('services.closing.cta')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
  );
};
