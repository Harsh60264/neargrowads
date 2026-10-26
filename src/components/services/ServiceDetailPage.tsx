import React, { useEffect, useState } from 'react';
import type { ServiceItem } from '../../data/servicesData';
import type { CaseStudy } from '../../data/caseStudiesData';
import { resolveWebsiteServiceImage, type WebsiteService } from '../../data/websiteServices';
import { DEFAULT_SITE_CONTENT, type SiteContent } from '../../data/siteContent';
import { followPublicDestination } from '../../data/publicLinks';
import { ConsultationForm } from '../forms/ConsultationForm';
import { HeroOrbitBackground } from '../ui/HeroOrbitBackground';
import {
  ArrowLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  MessageSquare,
  ChevronDown,
  Wrench,
  ShieldAlert,
} from 'lucide-react';

interface ManagedWebsiteServiceDetailPageProps {
  slug: string;
  onNavigate: (path: string) => void;
  theme: 'light' | 'dark';
}

export const ManagedWebsiteServiceDetailPage: React.FC<ManagedWebsiteServiceDetailPageProps> = ({ slug, onNavigate, theme }) => {
  const [service, setService] = useState<WebsiteService | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoadState('loading');
    setError('');
    void fetch('/api/services', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Published services unavailable (${response.status}).`);
        return response.json() as Promise<{ services?: WebsiteService[] }>;
      })
      .then((result) => {
        if (!Array.isArray(result.services)) throw new Error('The services API returned an invalid response.');
        const matchedService = result.services.find((candidate) =>
          candidate.status === 'published' && candidate.slug === slug,
        );
        setService(matchedService || null);
        setLoadState('loaded');
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        console.error('[NearGrow Ads] Published service detail could not be loaded.', reason);
        setError(reason instanceof Error ? reason.message : 'Published service details could not be loaded.');
        setLoadState('error');
      });
    return () => controller.abort();
  }, [slug]);

  if (loadState === 'loading') {
    return <div className="grid min-h-[60vh] place-items-center bg-[#F7F9F6] text-sm text-[#626A63]" role="status">Loading service details…</div>;
  }
  if (loadState === 'error' || !service) {
    return (
      <section className="grid min-h-[60vh] place-items-center bg-[#F7F9F6] px-5 text-center">
        <div>
          <h1 className="text-2xl font-bold text-[#171A17]">{loadState === 'error' ? 'Service details unavailable' : 'Service not found'}</h1>
          {loadState === 'error' && <p className="mt-2 text-sm text-[#626A63]">{error}</p>}
          <button type="button" onClick={() => onNavigate('/services')} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#3EA259] px-4 py-3 text-xs font-bold text-white">
            <ArrowLeft className="h-4 w-4" /> Back to Services
          </button>
        </div>
      </section>
    );
  }

  const serviceImage = resolveWebsiteServiceImage(service, theme);
  const hasImage = serviceImage.backgroundEnabled && Boolean(serviceImage.url);
  return (
    <div className="service-detail-page w-full bg-white">
      <div className="border-b border-[#E5E9E4] bg-[#F7F9F6] py-3">
        <nav aria-label="Breadcrumb" className="mx-auto flex max-w-7xl items-center gap-2 px-4 text-xs text-[#626A63] sm:px-6 lg:px-8">
          <button type="button" onClick={() => onNavigate('/')} className="hover:text-[#171A17]">Home</button>
          <ChevronRight className="h-3.5 w-3.5" />
          <button type="button" onClick={() => onNavigate('/services')} className="hover:text-[#171A17]">Services</button>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="truncate font-medium text-[#171A17]">{service.title}</span>
        </nav>
      </div>
      <section className="relative isolate overflow-hidden border-b border-[#E5E9E4] bg-white py-16 md:py-20">
        <HeroOrbitBackground ambient />
        {hasImage && (
          <img
            src={serviceImage.url}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 h-full w-full"
            style={{
              opacity: serviceImage.backgroundOpacity / 100,
              objectPosition: `${serviceImage.backgroundPositionX}% ${serviceImage.backgroundPositionY}%`,
              objectFit: serviceImage.backgroundFit,
            }}
          />
        )}
        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl space-y-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#3EA259]">{service.badge}</p>
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-[#171A17] [text-wrap:balance] sm:text-4xl md:text-5xl">{service.title}</h1>
            <p className="text-base leading-relaxed text-[#626A63] sm:text-lg">{service.shortDescription}</p>
            {(service.primaryCtaLabel || service.secondaryCtaLabel) && (
              <div className="flex flex-wrap gap-3 pt-2">
                {service.primaryCtaLabel && service.primaryCtaLink && (
                  <button type="button" onClick={() => followPublicDestination(service.primaryCtaLink, onNavigate)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#3EA259] px-5 text-xs font-bold text-white hover:bg-[#216F3D]">
                    {service.primaryCtaLabel}<ArrowRight className="h-4 w-4" />
                  </button>
                )}
                {service.secondaryCtaLabel && service.secondaryCtaLink && (
                  <button type="button" onClick={() => followPublicDestination(service.secondaryCtaLink, onNavigate)} className="inline-flex min-h-11 items-center rounded-xl border border-[#E5E9E4] bg-[#F7F9F6] px-5 text-xs font-semibold text-[#171A17] hover:border-[#3EA259]">
                    {service.secondaryCtaLabel}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
      {service.deliverables.length > 0 && (
        <section className="border-b border-[#E5E9E4] bg-[#F7F9F6] py-14 sm:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-extrabold tracking-tight text-[#171A17]">What’s included</h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {service.deliverables.map((deliverable, index) => (
                <li key={`${index}-${deliverable}`} className="flex items-start gap-3 rounded-xl border border-[#E5E9E4] bg-white p-4 text-sm leading-relaxed text-[#626A63]">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#3EA259]" />{deliverable}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
};

interface ServiceDetailPageProps {
  service: ServiceItem;
  onNavigate: (path: string) => void;
  siteContent?: SiteContent;
  theme: 'light' | 'dark';
}

export const ServiceDetailPage: React.FC<ServiceDetailPageProps> = ({ service: builtInService, onNavigate, siteContent = DEFAULT_SITE_CONTENT, theme }) => {
  const [activeFaq, setActiveFaq] = useState<number | null>(0);
  const [managedService, setManagedService] = useState<WebsiteService | null>(null);
  const [publishedServices, setPublishedServices] = useState<WebsiteService[]>([]);
  const [serviceLoadState, setServiceLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [publishedCaseStudies, setPublishedCaseStudies] = useState<CaseStudy[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setServiceLoadState('loading');
    void fetch('/api/services', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Published services unavailable (${response.status}).`);
        return response.json() as Promise<{ services?: WebsiteService[] }>;
      })
      .then((result) => {
        if (!Array.isArray(result.services)) throw new Error('The services API returned an invalid response.');
        const published = result.services.filter((candidate) => candidate.status === 'published');
        const match = published.find((candidate) => candidate.slug === builtInService.slug) ?? null;
        setPublishedServices(published);
        setManagedService(match);
        setServiceLoadState('loaded');
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        console.error('[NearGrow Ads] Published service detail could not be loaded.', reason);
        setServiceLoadState('error');
      });
    void fetch('/api/case-studies', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Published case studies unavailable (${response.status}).`);
        return response.json() as Promise<{ caseStudies?: CaseStudy[] }>;
      })
      .then((result) => {
        if (!Array.isArray(result.caseStudies)) throw new Error('The case studies API returned an invalid response.');
        setPublishedCaseStudies(result.caseStudies.filter((study) => study.status === 'published'));
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        console.error('[NearGrow Ads] Published related case studies could not be loaded.', reason);
        setPublishedCaseStudies([]);
      });
    return () => controller.abort();
  }, [builtInService.slug]);

  if (serviceLoadState === 'loading') {
    return <div className="grid min-h-[60vh] place-items-center text-sm text-[#626A63]" role="status">Loading service details…</div>;
  }
  if (serviceLoadState === 'error' || !managedService) {
    return (
      <section className="grid min-h-[60vh] place-items-center px-5 text-center" role={serviceLoadState === 'error' ? 'alert' : undefined}>
        <div>
          <h1 className="text-2xl font-bold text-[#171A17]">{serviceLoadState === 'error' ? 'Service details unavailable' : 'Service not found'}</h1>
          {serviceLoadState === 'error' && <p className="mt-2 text-sm text-[#626A63]">Please retry when the published services are available.</p>}
          <button type="button" onClick={() => onNavigate('/services')} className="mt-5 rounded-xl bg-[#216F3D] px-4 py-3 text-xs font-bold text-white">
            Back to Services
          </button>
        </div>
      </section>
    );
  }

  const service: ServiceItem = {
    ...builtInService,
    title: managedService.title,
    badge: managedService.badge,
    icon: managedService.icon,
    shortDescription: managedService.shortDescription,
    heroSubheadline: managedService.shortDescription,
    primaryCtaLabel: managedService.primaryCtaLabel,
    primaryCtaLink: managedService.primaryCtaLink,
    secondaryCtaLabel: managedService.secondaryCtaLabel,
    secondaryCtaLink: managedService.secondaryCtaLink,
    deliverables: managedService.deliverables.map((item) => ({ title: item, desc: '' })),
  };

  const relatedCaseStudy = publishedCaseStudies.find((study) => study.serviceSlug === service.slug);

  const relatedServicesList = publishedServices.filter((item) => service.relatedServices.includes(item.slug));
  const serviceImage = managedService ? resolveWebsiteServiceImage(managedService, theme) : null;
  const hasServiceImage = Boolean(serviceImage?.backgroundEnabled && serviceImage.url);

  return (
    <div className="service-detail-page w-full bg-white">
      {/* 1. Breadcrumb Navigation */}
      <div className="bg-[#F7F9F6] border-b border-[#E5E9E4] py-3">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex items-center gap-2 text-xs text-[#626A63]">
            <button onClick={() => onNavigate('/')} className="hover:text-[#171A17] transition-colors">
              Home
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-[#CBD5E1]" />
            <button onClick={() => onNavigate('/services')} className="hover:text-[#171A17] transition-colors">
              Services
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-[#CBD5E1]" />
            <span className="text-[#171A17] font-medium truncate">{service.title}</span>
          </nav>
        </div>
      </div>

      {/* 2. Service Hero Section */}
      <section className="relative isolate overflow-hidden py-16 md:py-20 bg-white border-b border-[#E5E9E4]">
        <HeroOrbitBackground ambient />
        {hasServiceImage && serviceImage && (
          <img
            src={serviceImage.url}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 h-full w-full"
            style={{
              opacity: serviceImage.backgroundOpacity / 100,
              objectPosition: `${serviceImage.backgroundPositionX}% ${serviceImage.backgroundPositionY}%`,
              objectFit: serviceImage.backgroundFit,
            }}
          />
        )}
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl space-y-5">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#3EA259] uppercase tracking-wider">
              <span>{service.badge}</span>
              <span aria-hidden="true">·</span>
              <span>India-based · Supporting growth across markets</span>
            </div>

            <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-[#171A17] tracking-tight leading-tight [text-wrap:balance]">
              {service.heroHeadline}
            </h1>

            <p className="text-base sm:text-lg text-[#626A63] leading-relaxed">
              {service.heroSubheadline}
            </p>

            <div className="pt-2 flex flex-wrap items-center gap-4">
              <button
                onClick={() => service.primaryCtaLink
                  ? followPublicDestination(service.primaryCtaLink, onNavigate)
                  : document.getElementById('service-consultation-form')?.scrollIntoView({ behavior: 'smooth' })}
                className="px-6 py-3 bg-[#3EA259] hover:bg-[#216F3D] text-white font-semibold text-xs rounded-xl transition-all shadow-sm flex items-center gap-2"
              >
                <span>{service.primaryCtaLabel || `Request ${service.title} Consultation`}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <a
                href={siteContent.footerSettings.whatsappDestination}
                target="_blank"
                rel="noopener noreferrer"
                className="px-5 py-3 bg-[#F7F9F6] hover:bg-[#E5E9E4] text-[#171A17] font-semibold text-xs rounded-xl border border-[#E5E9E4] transition-all flex items-center gap-2"
              >
                <MessageSquare className="w-3.5 h-3.5 text-[#3EA259]" /> Chat on WhatsApp
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Intended Audience & Problem Statement */}
      <section className="py-16 bg-[#F7F9F6] border-b border-[#E5E9E4]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            {/* Target Audience */}
            <div className="p-8 bg-white border border-[#E5E9E4] rounded-2xl space-y-4">
              <h2 className="text-lg font-bold text-[#171A17]">Who This Service Is For</h2>
              <ul className="space-y-3">
                {service.targetAudience.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-xs text-[#626A63]">
                    <CheckCircle2 className="w-4 h-4 text-[#3EA259] shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Problem Statement */}
            <div className="p-8 bg-white border border-[#E5E9E4] rounded-2xl space-y-4">
              <h2 className="text-lg font-bold text-[#171A17]">The Core Business Challenge</h2>
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-[#F59E0B] shrink-0 mt-0.5" />
                <p className="text-xs text-[#626A63] leading-relaxed">{service.problemStatement}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Deliverables and Scope */}
      <section className="py-16 bg-white border-b border-[#E5E9E4]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-12">
            <div className="text-xs font-bold uppercase tracking-wider text-[#3EA259] mb-1">Scope of Work</div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-[#171A17] tracking-tight">
              Concrete Deliverables You Receive
            </h2>
            <p className="text-xs text-[#626A63] mt-2">
              Every deliverable is documented, transparent, and reviewed with your team.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {service.deliverables.map((deliv, index) => (
              <div key={index} className="p-6 bg-[#F7F9F6] border border-[#E5E9E4] rounded-2xl space-y-2">
                <div className="text-xs font-bold text-[#3EA259]">Deliverable {String(index + 1).padStart(2, '0')}</div>
                <h3 className="text-base font-bold text-[#171A17]">{deliv.title}</h3>
                <p className="text-xs text-[#626A63] leading-relaxed">{deliv.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Our Implementation Approach & Tools */}
      <section className="py-16 bg-[#F7F9F6] border-b border-[#E5E9E4]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-7 space-y-6">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-[#3EA259] mb-1">Execution</div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-[#171A17] tracking-tight">
                  NearGrow Ads’ Implementation Method
                </h2>
              </div>

              <div className="space-y-3">
                {service.ourApproach.map((step, idx) => (
                  <div key={idx} className="p-4 bg-white border border-[#E5E9E4] rounded-xl flex items-start gap-3">
                    <span className="text-xs font-bold text-[#3EA259] shrink-0">{idx + 1}.</span>
                    <span className="text-xs text-[#626A63] leading-relaxed">{step}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-5 space-y-6">
              {/* Tools Used */}
              <div className="p-6 bg-white border border-[#E5E9E4] rounded-2xl space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-[#171A17]">
                  <Wrench className="w-4 h-4 text-[#3EA259]" />
                  <span>Platforms & Professional Tooling</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {service.toolsUsed.map((tool, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 bg-[#F7F9F6] border border-[#E5E9E4] text-xs text-[#171A17] font-medium rounded-lg"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>

              {/* Realistic Expectations Notice (Anti-guarantee disclosure) */}
              <div className="p-6 bg-white border border-[#E5E9E4] rounded-2xl space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-[#171A17]">
                  <ShieldAlert className="w-4 h-4 text-[#F59E0B]" />
                  <span>Realistic Expectations & Timelines</span>
                </div>
                <p className="text-xs text-[#626A63] leading-relaxed">{service.realisticOutcomes}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 9. Related Case Study if available */}
      {relatedCaseStudy && (
        <section className="py-16 bg-white border-b border-[#E5E9E4]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="p-8 bg-[#F7F9F6] border border-[#E5E9E4] rounded-3xl">
              <div className="text-xs font-bold uppercase tracking-wider text-[#3EA259] mb-1">Case Study Spotlight</div>
              <h2 className="text-2xl font-extrabold text-[#171A17] mb-2">{relatedCaseStudy.title}</h2>
              <div className="text-xs text-[#626A63] mb-4">
                {relatedCaseStudy.location} · {relatedCaseStudy.timeframe}
              </div>
              <p className="text-xs text-[#626A63] leading-relaxed max-w-3xl mb-6">{relatedCaseStudy.strategy}</p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                {relatedCaseStudy.metrics.map((metric, idx) => (
                  <div key={idx} className="p-4 bg-white border border-[#E5E9E4] rounded-xl text-center">
                    <div className="text-xl font-black text-[#3EA259] tabular-nums">{metric.value}</div>
                    <div className="text-xs font-semibold text-[#171A17] mt-0.5">{metric.label}</div>
                    <div className="text-[10px] text-[#626A63]">{metric.period}</div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => onNavigate('/work')}
                className="text-xs font-semibold text-[#3EA259] hover:underline flex items-center gap-1"
              >
                Read full case studies <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 10. Service FAQs */}
      <section className="py-16 bg-[#F7F9F6] border-b border-[#E5E9E4]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <div className="text-xs font-bold uppercase tracking-wider text-[#3EA259] mb-1">Service Details</div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-[#171A17]">Frequently Asked Questions</h2>
          </div>

          <div className="space-y-3">
            {service.faqs.map((faq, idx) => {
              const isOpen = activeFaq === idx;
              return (
                <div key={idx} className="bg-white border border-[#E5E9E4] rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setActiveFaq(isOpen ? null : idx)}
                    className="w-full p-5 text-left flex items-center justify-between gap-4 font-semibold text-sm text-[#171A17] hover:text-[#3EA259] transition-colors"
                  >
                    <span>{faq.question}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-[#626A63] shrink-0 transition-transform ${
                        isOpen ? 'rotate-180 text-[#3EA259]' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-5 text-xs text-[#626A63] leading-relaxed border-t border-[#E5E9E4]/60 pt-3">
                      {faq.answer}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 11. Consultation CTA Form Anchor */}
      <section id="service-consultation-form" className="py-20 bg-white border-b border-[#E5E9E4]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <ConsultationForm defaultServiceSlug={service.slug} siteContent={siteContent} />
        </div>
      </section>

      {/* 12. Related Services */}
      <section className="py-16 bg-[#F7F9F6]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-lg font-bold text-[#171A17] mb-6">Complementary Growth Services</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {relatedServicesList.map((rel) => (
              <a
                href={`/services/${rel.slug}`}
                key={rel.slug}
                className="p-6 bg-white border border-[#E5E9E4] hover:border-[#3EA259] rounded-2xl transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="text-[10px] uppercase font-bold text-[#3EA259] tracking-wider mb-1">{rel.badge}</div>
                  <h3 className="text-base font-bold text-[#171A17] mb-2">{rel.title}</h3>
                  <p className="text-xs text-[#626A63] leading-relaxed mb-4">{rel.shortDescription}</p>
                </div>
                <div className="text-xs font-semibold text-[#3EA259] flex items-center gap-1">
                  Learn More <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
