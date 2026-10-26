import React, { useEffect, useMemo, useState } from 'react';
import type { CaseStudy } from '../../data/caseStudiesData';
import { ArrowRight, CheckCircle2, ShieldCheck, MapPin, Clock } from 'lucide-react';
import { DEFAULT_SITE_CONTENT, type SiteContent } from '../../data/siteContent';
import { HeroOrbitBackground } from '../ui/HeroOrbitBackground';
import { CaseStudyImage } from './CaseStudyImage';
import { publicText } from '../../data/publicCopy';
import { followPublicDestination, getCtaDestination } from '../../data/publicLinks';
import type { PublicImageTheme } from '../../data/themeImages';
import {
  filterCaseStudies,
  normalizeCaseStudyCategoryName,
  paginateCaseStudies,
} from '../../data/caseStudyListing';

interface WorkPageProps {
  onNavigate: (path: string) => void;
  siteContent?: SiteContent;
  theme: PublicImageTheme;
}

export const WorkPage: React.FC<WorkPageProps> = ({ onNavigate, siteContent = DEFAULT_SITE_CONTENT, theme }) => {
  const text = (key: string) => publicText(siteContent.copy, key);
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [caseStudies, setCaseStudies] = useState<CaseStudy[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [retryCount, setRetryCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    setLoadState('loading');
    const loadPublishedCaseStudies = () => {
      if (loading) return Promise.resolve();
      loading = true;
      return fetch('/api/case-studies', {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Published case studies unavailable (${response.status}).`);
          return response.json() as Promise<{ caseStudies?: CaseStudy[] }>;
        })
        .then((result) => {
          if (!Array.isArray(result.caseStudies)) {
            throw new Error('Published case study response was invalid.');
          }
          const publishedStudies = result.caseStudies.filter((study) => study.status === 'published');
          setCaseStudies(publishedStudies);
          const seenCategories = new Set<string>();
          const nextCategories = publishedStudies.reduce<string[]>((unique, study) => {
            const label = study.category.trim().replace(/\s+/g, ' ');
            const normalized = normalizeCaseStudyCategoryName(label);
            if (label && !seenCategories.has(normalized)) {
              seenCategories.add(normalized);
              unique.push(label);
            }
            return unique;
          }, []);
          setCategories(nextCategories);
          setSelectedFilter((selected) => selected === 'all' ||
            nextCategories.some((category) => `category:${normalizeCaseStudyCategoryName(category)}` === selected)
            ? selected
            : 'all');
          setLoadState('loaded');
          setCurrentPage(1);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          console.error('[NearGrow Ads] Could not load published case studies.', error);
          setCaseStudies([]);
          setCategories([]);
          setLoadState('error');
        })
        .finally(() => {
          loading = false;
        });
    };
    const revalidate = () => {
      if (document.visibilityState === 'visible') void loadPublishedCaseStudies();
    };
    const channel = typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel('neargrow-case-studies')
      : undefined;
    if (channel) channel.onmessage = revalidate;
    void loadPublishedCaseStudies();
    window.addEventListener('focus', revalidate);
    window.addEventListener('pageshow', revalidate);
    window.addEventListener('case-studies-updated', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      controller.abort();
      channel?.close();
      window.removeEventListener('focus', revalidate);
      window.removeEventListener('pageshow', revalidate);
      window.removeEventListener('case-studies-updated', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [retryCount]);

  const filters = useMemo(() => [
    { id: 'all', label: text('work.filters.all') },
    ...categories.map((category) => ({ id: `category:${normalizeCaseStudyCategoryName(category)}`, label: category })),
  ], [categories, siteContent.copy]);

  const filteredStudies = filterCaseStudies(caseStudies, selectedFilter);
  const { pageCount, pageStudies } = paginateCaseStudies(filteredStudies, currentPage);

  const selectFilter = (filter: string) => {
    setSelectedFilter(filter);
    setCurrentPage(1);
  };

  const navigateToCta = (study: CaseStudy) => {
    const destination = study.ctaLink || `/services/${study.serviceSlug}`;
    if (destination.startsWith('/') && !destination.startsWith('//')) {
      onNavigate(destination);
      return;
    }
    window.open(destination, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="work-page w-full bg-white">
      {/* Hero */}
      <section className="relative isolate overflow-hidden py-16 md:py-24 bg-[#F7F9F6] border-b border-[#E5E9E4]">
        <HeroOrbitBackground ambient />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl space-y-4">
            <div className="text-xs font-bold uppercase tracking-widest text-[#3EA259]">
              {siteContent.workPage.eyebrow}
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold text-[#171A17] tracking-tight">
              {siteContent.workPage.title}
            </h1>
            <p className="text-base sm:text-lg text-[#626A63] leading-relaxed">
              {siteContent.workPage.description}
            </p>
          </div>
        </div>
      </section>

      {/* Case Studies List */}
      <section className="py-20 bg-white border-b border-[#E5E9E4]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="sticky top-[4.5rem] z-30 -mx-4 mb-10 border-y border-[#DDE5DD]/80 bg-[#ddddd]/95 px-4 py-3 shadow-sm backdrop-blur-xl sm:mx-0 sm:mb-12 sm:w-fit sm:rounded-xl sm:border sm:p-1.5 sm:shadow-none">
            <div className="case-study-filter-scroll flex w-full items-center gap-2 overflow-x-auto overscroll-x-contain px-1 py-1 sm:w-fit" role="group" aria-label="Filter case studies by category or service">
              {filters.map((filter) => {
                const isSelected = selectedFilter === filter.id;
                return (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => selectFilter(filter.id)}
                    aria-pressed={isSelected}
                    className={`shrink-0 rounded-lg border px-4 py-2.5 text-xs font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3EA259] focus-visible:ring-offset-2 ${
                      isSelected
                        ? 'border-[#216F3D] bg-[#216F3D] text-white shadow-[0_4px_14px_rgba(33,111,61,0.24)]'
                        : 'border-transparent text-[#626A63] hover:border-[#DDE5DD] hover:text-[#171A17]'
                    }`}
                  >
                    {filter.label}
                  </button>
                );
              })}
            </div>
          </div>

          {loadState === 'loading' && <p role="status" className="py-8 text-center text-sm text-[#626A63]">Loading published case studies…</p>}
          {loadState === 'error' && <div role="alert" className="mx-auto max-w-xl rounded-2xl border border-[#E5E9E4] bg-[#F7F9F6] p-6 text-center">
            <p className="text-sm font-semibold text-[#171A17]">Published case studies are temporarily unavailable.</p>
            <p className="mt-2 text-xs text-[#626A63]">Please try again. No sample or unpublished case studies are shown.</p>
            <button
              type="button"
              onClick={() => setRetryCount((count) => count + 1)}
              className="mt-4 rounded-lg bg-[#216F3D] px-4 py-2 text-xs font-semibold text-white"
            >Retry</button>
          </div>}
          {loadState === 'loaded' && filteredStudies.length === 0 && <p className="py-12 text-center text-sm text-[#626A63]">
            {caseStudies.length === 0 ? 'No published case studies are available yet.' : 'No published case studies match this category.'}
          </p>}
          {loadState === 'loaded' && filteredStudies.length > 0 && <>
          <p className="sr-only" role="status" aria-live="polite">
            Showing {pageStudies.length} of {filteredStudies.length} {filteredStudies.length === 1 ? 'case study' : 'case studies'}
          </p>
          <div key={selectedFilter} className="work-filter-results space-y-16">
            {pageStudies.map((study) => (
              <div
                key={study.id}
                data-case-study-theme={theme}
                data-image-placement={study.imagePlacement || 'top'}
                className="relative isolate overflow-hidden rounded-3xl border border-[#E5E9E4] bg-[#F7F9F6] p-8 md:p-10"
              >
                {(study.imagePlacement === 'background-cover' || study.imagePlacement === 'background-watermark') &&
                  <CaseStudyImage study={study} theme={theme} />}
                <div className="case-study-content relative z-10 space-y-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-[#E5E9E4]">
                  <div className="case-study-copy">
                    <div className="case-study-category text-xs font-bold uppercase tracking-wider text-[#3EA259] mb-1">
                      {study.category}
                    </div>
                    <h2 className="case-study-heading text-2xl sm:text-3xl font-extrabold text-[#171A17]">{study.title}</h2>
                    <div className="case-study-metadata flex flex-wrap items-center gap-3 text-xs text-[#626A63] mt-2">
                      <span className="case-study-metadata-strong font-semibold text-[#171A17]">{study.approvedClientName || study.clientDescriptor}</span>
                      <span aria-hidden="true">·</span>
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-[#3EA259]" /> {study.location}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-[#3EA259]" /> {study.timeframe}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => navigateToCta(study)}
                    className="self-start md:self-center px-4 py-2 bg-white border border-[#E5E9E4] hover:border-[#3EA259] text-[#171A17] text-xs font-semibold rounded-xl transition-all shadow-xs flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <span>{study.ctaLabel || text('work.caseStudy.serviceCta')}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#3EA259]" />
                  </button>
                </div>

                {study.imagePlacement !== 'background-cover' && study.imagePlacement !== 'background-watermark' &&
                  <CaseStudyImage study={study} theme={theme} />}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  <div className="case-study-copy lg:col-span-7 space-y-6">
                    <div>
                      <h3 className="case-study-heading text-xs font-bold uppercase tracking-wider text-[#171A17] mb-2">{text('work.caseStudy.challenge')}</h3>
                      <p className="case-study-body text-xs text-[#626A63] leading-relaxed">{study.challenge}</p>
                    </div>

                    <div>
                      <h3 className="case-study-heading text-xs font-bold uppercase tracking-wider text-[#171A17] mb-2">{text('work.caseStudy.strategy')}</h3>
                      <p className="case-study-body text-xs text-[#626A63] leading-relaxed">{study.strategy}</p>
                    </div>

                    <div>
                      <h3 className="case-study-heading text-xs font-bold uppercase tracking-wider text-[#171A17] mb-2">
                        {text('work.caseStudy.deliverables')}
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {study.deliverablesExecuted.map((deliv, idx) => (
                          <div key={idx} className="case-study-body flex items-start gap-2 text-xs text-[#626A63]">
                            <CheckCircle2 className="w-4 h-4 text-[#3EA259] shrink-0 mt-0.5" />
                            <span>{deliv}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="lg:col-span-5 space-y-6">
                    {/* Metrics Strip */}
                    <div className="p-6 bg-white border border-[#E5E9E4] rounded-2xl space-y-4">
                      <div className="text-xs font-bold uppercase tracking-wider text-[#171A17]">
                        {text('work.caseStudy.results')}
                      </div>
                      <div className="space-y-3">
                        {study.metrics.map((m, idx) => (
                          <div
                            key={idx}
                            className="p-3 bg-[#F7F9F6] rounded-xl border border-[#E5E9E4] flex items-center justify-between"
                          >
                            <div>
                              <div className="text-xs font-semibold text-[#171A17]">{m.label}</div>
                              <div className="text-[10px] text-[#626A63]">{m.period}</div>
                            </div>
                            <div className="text-lg font-black text-[#3EA259] tabular-nums">{m.value}</div>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-[#626A63] italic pt-1">{study.resultsContext}</p>
                    </div>

                    {/* Testimonial Quote if present */}
                    {study.testimonialQuote && study.testimonialApproved !== false && (
                      <div className="p-5 bg-white border border-[#E5E9E4] rounded-2xl space-y-2">
                        <blockquote className="text-xs text-[#171A17] italic leading-relaxed">
                          “{study.testimonialQuote.quote}”
                        </blockquote>
                        <div className="text-[11px] font-semibold text-[#3EA259] pt-1">
                          {study.testimonialQuote.author} ·{' '}
                          <span className="text-[#626A63] font-normal">{study.testimonialQuote.role}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              </div>
            ))}
          </div>
          {pageCount > 1 && <nav className="mt-12 flex flex-wrap items-center justify-center gap-2" aria-label="Case study pages">
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPage === 1}
              className="rounded-lg border border-[#DDE5DD] px-3 py-2 text-xs font-semibold text-[#39473C] disabled:cursor-not-allowed disabled:opacity-40"
            >Previous</button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setCurrentPage(page)}
                aria-current={currentPage === page ? 'page' : undefined}
                className={`h-9 min-w-9 rounded-lg border px-3 text-xs font-semibold ${currentPage === page ? 'border-[#216F3D] bg-[#216F3D] text-white' : 'border-[#DDE5DD] text-[#39473C] hover:bg-[#F7F9F6]'}`}
              >{page}</button>
            ))}
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
              disabled={currentPage === pageCount}
              className="rounded-lg border border-[#DDE5DD] px-3 py-2 text-xs font-semibold text-[#39473C] disabled:cursor-not-allowed disabled:opacity-40"
            >Next</button>
          </nav>}
          </>}
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-white text-center">
        <div className="max-w-3xl mx-auto px-4 space-y-6">
          <h2 className="text-3xl font-extrabold text-[#171A17]">
            {text('work.closing.title')}
          </h2>
          <p className="text-sm text-[#626A63] max-w-xl mx-auto leading-relaxed">
            {text('work.closing.description')}
          </p>
          <div className="pt-2">
            <button
              onClick={() => followPublicDestination(getCtaDestination(siteContent, 'work.primary', '/get-started'), onNavigate)}
              className="px-6 py-3.5 bg-[#3EA259] hover:bg-[#216F3D] text-white text-xs font-semibold rounded-xl transition-all shadow-sm"
            >
              {siteContent.workPage.primaryCta}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
