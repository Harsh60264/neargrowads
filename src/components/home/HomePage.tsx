import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  MapPin,
  TrendingUp,
  Cpu,
  Laptop,
  Compass,
  Share2,
  FileText,
  MessageSquare,
  HelpCircle,
  ChevronDown,
  Layers,
  Shield,
  Award,
  Hotel,
  Play,
  Star,
  Store,
  Utensils,
  Stethoscope,
  House,
  Scissors,
  Wrench,
} from 'lucide-react';
import { ConsultationForm } from '../forms/ConsultationForm';
import { SERVICES } from '../../data/servicesData';
import type { BlogPost } from '../../data/blogData';
import type { CaseStudy } from '../../data/caseStudiesData';
import { DEFAULT_SITE_CONTENT, type SiteContent } from '../../data/siteContent';
import { HeroOrbitBackground } from '../ui/HeroOrbitBackground';
import { Skiper52Showcase } from './Skiper52Showcase';
import { publicText } from '../../data/publicCopy';
import { HOME_HERO_DARK_VIDEO_ID, HOME_HERO_LIGHT_VIDEO_ID, publicMedia } from '../../data/publicMedia';
import { resolveHeroVideoSource, type HeroVideoSource, type HeroVideoTheme } from '../../data/heroVideo';
import { followPublicDestination, getCtaDestination } from '../../data/publicLinks';
import heroVideo from '../../assets/media/neargrow_ads_kinetic_4x3.mp4';

const GlobalReachSection = React.lazy(() => import('./GlobalReach'));

interface HomePageProps {
  onNavigate: (path: string) => void;
  blogPosts: BlogPost[];
  siteContent?: SiteContent;
  siteContentLoaded: boolean;
  theme: HeroVideoTheme;
}

export const HomePage: React.FC<HomePageProps> = ({
  onNavigate,
  blogPosts,
  siteContent = DEFAULT_SITE_CONTENT,
  siteContentLoaded,
  theme,
}) => {
  const text = (key: string) => publicText(siteContent.copy, key);
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  const [failedLightVideoUrl, setFailedLightVideoUrl] = useState('');
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [activeFaq, setActiveFaq] = useState<number | null>(0);
  const [publicTestimonials, setPublicTestimonials] = useState<CaseStudy[]>([]);
  const [publishedCaseStudies, setPublishedCaseStudies] = useState<CaseStudy[]>([]);
  const [activeProcessStage, setActiveProcessStage] = useState(0);
  const [monthlyFootfall, setMonthlyFootfall] = useState(1200);
  const [monthlyFootfallInput, setMonthlyFootfallInput] = useState('1200');
  const [averageSale, setAverageSale] = useState(5000);
  const [averageSaleInput, setAverageSaleInput] = useState('5000');
  const [industry, setIndustry] = useState('Retail & Showrooms');
  const [selectedStory, setSelectedStory] = useState(0);

  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => setPrefersReducedMotion(motionQuery.matches);
    updateMotionPreference();
    motionQuery.addEventListener('change', updateMotionPreference);
    return () => motionQuery.removeEventListener('change', updateMotionPreference);
  }, []);

  useEffect(() => {
    let active = true;
    let loading = false;
    const controller = new AbortController();
    const loadTestimonials = async () => {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch('/api/case-studies', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`Published case studies unavailable (${response.status}).`);
        const result = await response.json() as { caseStudies?: CaseStudy[] };
        if (!Array.isArray(result.caseStudies)) throw new Error('Published case study response was invalid.');
        const publishedStudies = result.caseStudies.filter((study) => study.status === 'published');
        const testimonials = publishedStudies.filter((study) =>
          study.testimonialApproved === true && Boolean(study.testimonialQuote?.quote),
        );
        if (active) {
          setPublishedCaseStudies(publishedStudies);
          setPublicTestimonials(testimonials);
          setSelectedStory(0);
        }
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error('[NearGrow Ads] Could not load published client testimonials.', error);
        if (active) {
          setPublishedCaseStudies([]);
          setPublicTestimonials([]);
        }
      } finally {
        loading = false;
      }
    };
    const revalidate = () => {
      if (document.visibilityState === 'visible') void loadTestimonials();
    };
    const channel = typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel('neargrow-case-studies')
      : undefined;
    if (channel) channel.onmessage = revalidate;
    window.addEventListener('case-studies-updated', revalidate);
    void loadTestimonials();
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener('case-studies-updated', revalidate);
      channel?.close();
    };
  }, []);

  const serviceVisualFallbacks = [
    { image: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?auto=format&fit=crop&w=760&q=85', label: 'Search across markets' },
    { image: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=760&q=85', label: 'Audience and market strategy' },
    { image: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=760&q=85', label: 'Google Ads campaign' },
    { image: 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?auto=format&fit=crop&w=760&q=85', label: 'Social video content' },
    { image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=760&q=85', label: 'Website analytics' },
    { image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=760&q=85', label: 'Growth consulting' },
    { image: 'https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=760&q=85', label: 'Content production' },
    { image: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=760&q=85', label: 'Marketing automation' },
  ];
  const serviceVisuals = serviceVisualFallbacks.map((fallback, index) => {
    const media = publicMedia(siteContent.media, `home.service.${index + 1}`, fallback.image, theme);
    return {
      image: media.url,
      label: media.altText || fallback.label,
      focalX: media.focalX,
      focalY: media.focalY,
      backgroundEnabled: media.backgroundEnabled,
      backgroundFit: media.backgroundFit,
      backgroundOpacity: media.backgroundOpacity,
      backgroundPositionX: media.backgroundPositionX,
      backgroundPositionY: media.backgroundPositionY,
    };
  });
  const darkHeroVideoMedia = publicMedia(
    siteContent.media,
    HOME_HERO_DARK_VIDEO_ID,
    siteContent.hero.videoUrl || heroVideo,
  );
  const lightHeroVideoMedia = publicMedia(siteContent.media, HOME_HERO_LIGHT_VIDEO_ID);
  const heroVideoSource = resolveHeroVideoSource(
    theme,
    darkHeroVideoMedia.url,
    lightHeroVideoMedia.url,
    failedLightVideoUrl,
  );
  const heroVideoMedia = heroVideoSource.mode === 'light' ? lightHeroVideoMedia : darkHeroVideoMedia;
  const heroVideoSourceRef = useRef<HeroVideoSource>(heroVideoSource);
  heroVideoSourceRef.current = heroVideoSource;
  const handleHeroVideoFailure = (video: HTMLVideoElement, source: HeroVideoSource) => {
    const currentSource = heroVideoSourceRef.current;
    if (source.url !== currentSource.url || source.mode !== currentSource.mode) return;
    if (video.currentSrc && video.currentSrc !== new URL(source.url, window.location.href).href) return;

    if (source.mode === 'light') {
      setFailedLightVideoUrl(source.url);
      return;
    }
    console.error('[NearGrow Ads] Hero video could not be loaded.', video.error);
  };

  useLayoutEffect(() => {
    const video = heroVideoRef.current;
    if (!video) return;
    let isVisible = false;
    let playAttempted = false;
    let hasPlayed = false;
    const attemptPlayback = () => {
      if (
        prefersReducedMotion ||
        !siteContentLoaded ||
        !isVisible ||
        document.hidden ||
        !video.paused ||
        playAttempted
      ) return;

      playAttempted = true;
      void video.play().then(() => {
        hasPlayed = true;
      }).catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') {
          playAttempted = false;
          return;
        }
        if (error instanceof Error && error.name === 'NotAllowedError') return;
        if (error instanceof Error && error.name === 'NotSupportedError') {
          handleHeroVideoFailure(video, heroVideoSource);
          return;
        }
        console.error('[NearGrow Ads] Hero video could not be played.', error);
      });
    };
    const syncPlayback = () => {
      const shouldPlay = !prefersReducedMotion && siteContentLoaded && isVisible && !document.hidden;
      if (!shouldPlay) {
        if (!video.paused) {
          video.pause();
          if (hasPlayed) playAttempted = false;
          hasPlayed = false;
        }
        return;
      }

      attemptPlayback();
    };
    const handleVisibilityChange = () => syncPlayback();
    const cleanup = () => {
      video.removeEventListener('canplay', syncPlayback);
      video.removeEventListener('loadeddata', syncPlayback);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      video.pause();
    };
    video.addEventListener('canplay', syncPlayback);
    video.addEventListener('loadeddata', syncPlayback);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(([entry]) => {
        isVisible = entry.intersectionRatio >= 0.05;
        syncPlayback();
      }, { threshold: [0, 0.05] });
      observer.observe(video);
      return () => {
        observer.disconnect();
        cleanup();
      };
    }

    isVisible = true;
    syncPlayback();
    return cleanup;
  }, [heroVideoSource.mode, heroVideoSource.url, prefersReducedMotion, siteContentLoaded]);

  const heroPoster = publicMedia(siteContent.media, 'home.hero.poster', '', theme);
  const hospitalityProblem = publicMedia(siteContent.media, 'home.hospitality.problem', '', theme);
  const hospitalitySolution = publicMedia(siteContent.media, 'home.hospitality.solution', '', theme);

  const monthlyInquiries = Math.round(monthlyFootfall * 0.025);
  const projectedRevenue = Math.round(monthlyInquiries * averageSale * 0.2);

  const processStages = [
    {
      title: text('home.process.stage1.title'),
      summary: text('home.process.stage1.summary'),
      detail: text('home.process.stage1.detail'),
    },
    {
      title: text('home.process.stage2.title'),
      summary: text('home.process.stage2.summary'),
      detail: text('home.process.stage2.detail'),
    },
    {
      title: text('home.process.stage3.title'),
      summary: text('home.process.stage3.summary'),
      detail: text('home.process.stage3.detail'),
    },
    {
      title: text('home.process.stage4.title'),
      summary: text('home.process.stage4.summary'),
      detail: text('home.process.stage4.detail'),
    },
    {
      title: text('home.process.stage5.title'),
      summary: text('home.process.stage5.summary'),
      detail: text('home.process.stage5.detail'),
    },
  ];

  const industries = [
    { title: text('home.industry.1.title'), description: text('home.industry.1.description'), Icon: Store },
    { title: text('home.industry.2.title'), description: text('home.industry.2.description'), Icon: Utensils },
    { title: text('home.industry.3.title'), description: text('home.industry.3.description'), Icon: Stethoscope },
    { title: text('home.industry.4.title'), description: text('home.industry.4.description'), Icon: House },
    { title: text('home.industry.5.title'), description: text('home.industry.5.description'), Icon: Scissors },
    { title: text('home.industry.6.title'), description: text('home.industry.6.description'), Icon: Utensils },
    { title: text('home.industry.7.title'), description: text('home.industry.7.description'), Icon: Hotel },
    { title: text('home.industry.8.title'), description: text('home.industry.8.description'), Icon: Wrench },
  ];

  const faqs = siteContent.faqs;

  const getServiceIcon = (iconName: string) => {
    switch (iconName) {
      case 'MapPin':
        return <MapPin className="w-5 h-5" />;
      case 'Compass':
        return <Compass className="w-5 h-5" />;
      case 'TrendingUp':
        return <TrendingUp className="w-5 h-5" />;
      case 'Share2':
        return <Share2 className="w-5 h-5" />;
      case 'Laptop':
        return <Laptop className="w-5 h-5" />;
      case 'FileText':
        return <FileText className="w-5 h-5" />;
      case 'Cpu':
        return <Cpu className="w-5 h-5" />;
      default:
        return null;
    }
  };
  const renderServiceIcon = (iconName: string) => {
    const icon = getServiceIcon(iconName);
    return icon && (
      <span className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-xl bg-[#C7F36B] text-[#132016] shadow-lg">
        {icon}
      </span>
    );
  };

  return (
    <div className="home-page w-full">
      {/* SECTION 2: HERO */}
      <section className="relative flex min-h-[620px] items-center overflow-hidden border-b border-white/10 bg-[#050912] pt-12 pb-16 text-white isolate lg:min-h-[calc(100vh-4.5rem)] lg:pt-10 lg:pb-12">
        <HeroOrbitBackground settings={siteContent.animations} />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center">
            {/* Left Column: Value Proposition */}
            <div className="lg:col-span-6 space-y-6 py-4 lg:py-10">
              {/* Global growth positioning */}
              <div className="inline-flex items-center gap-2 rounded-full border border-[#67D8B7]/25 bg-[#67D8B7]/10 px-3 py-1.5 text-[11px] font-semibold text-white/75">
                <MapPin className="h-3.5 w-3.5 text-[#67D8B7]" />
                <span className="text-[#67D8B7] font-bold">{siteContent.hero.eyebrow}</span>
                <span aria-hidden="true" className="text-white/35">·</span>
                <span>{text('home.hero.agencyLabel')}</span>
              </div>

              {/* Display Headline */}
              <h1 className="text-4xl sm:text-5xl lg:text-[3.75rem] font-extrabold tracking-tight text-white leading-[1.04] [text-wrap:balance]">
                {siteContent.hero.headlineBefore}{' '}
                <span className="text-[#67D8B7] underline decoration-[#F4B66B] decoration-[3px] underline-offset-[7px]">
                  {siteContent.hero.headlineHighlight}
                </span>{' '}
                {siteContent.hero.headlineAfter}
              </h1>

              <div className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-2 text-[11px] font-medium text-white/80 shadow-lg backdrop-blur-md">
                <span className="grid h-6 w-6 place-items-center rounded-lg bg-white text-[#4285F4]" aria-hidden="true">
                  <MapPin className="h-3.5 w-3.5" />
                </span>
                <span>{text('home.hero.trust')}</span>
                <span className="text-white/30" aria-hidden="true">|</span>
                <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 fill-[#C7F36B] text-[#C7F36B]" /> {text('home.hero.rating')}</span>
              </div>

              {/* Supporting Copy */}
              <p className="text-sm sm:text-base text-white/70 leading-relaxed max-w-xl">
                {siteContent.hero.description}
              </p>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-wrap items-center gap-4">
                <button
                  onClick={() => followPublicDestination(getCtaDestination(siteContent, 'home.hero.primary', '/get-started'), onNavigate)}
                  className="group px-5 py-3 bg-[#159B80] hover:bg-[#20B395] active:scale-[0.98] text-white font-semibold text-sm rounded-full transition-all shadow-[0_10px_30px_rgba(21,155,128,0.22)] flex items-center gap-2 whitespace-nowrap"
                >
                  <span>{siteContent.hero.primaryCta}</span>
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </button>
                <button
                  onClick={() => followPublicDestination(getCtaDestination(siteContent, 'home.hero.secondary', '/services'), onNavigate)}
                  className="px-5 py-3 bg-white/5 hover:bg-white/10 text-white font-semibold text-sm rounded-full border border-white/25 transition-all whitespace-nowrap"
                >
                  {siteContent.hero.secondaryCta}
                </button>
                <a
                  href={getCtaDestination(siteContent, 'home.hero.caseStudies', '#home-case-studies')}
                  onClick={(event) => {
                    const destination = getCtaDestination(siteContent, 'home.hero.caseStudies', '#home-case-studies');
                    if (destination.startsWith('/') || destination.startsWith('#')) event.preventDefault();
                    followPublicDestination(destination, onNavigate);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-white/70 transition-colors hover:text-[#91E3C9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]"
                >
                  {text('home.hero.caseStudiesLink')}
                  <ChevronDown className="h-4 w-4 text-[#67D8B7]" />
                </a>
              </div>

              <div className="flex flex-wrap items-center gap-2.5" aria-label="Trust and transparency">
                <a
                  href="https://clutch.co/profile/neargrow-ads"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex min-h-10 items-center gap-2 rounded-full border border-[#67D8B7]/25 bg-[#67D8B7]/[0.07] px-3.5 py-2 transition-colors hover:border-[#67D8B7]/50 hover:bg-[#67D8B7]/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]"
                  aria-label="View NearGrow Ads on Clutch. The profile is listed but not yet reviewed. Opens in a new tab."
                >
                  <span className="text-xs font-extrabold tracking-tight text-white">Clutch<span className="text-[#67D8B7]">.</span></span>
                  <span className="h-3.5 w-px bg-white/15" aria-hidden="true" />
                  <span className="text-[10px] font-semibold text-white/70">{text('home.hero.clutchLabel')}</span>
                  <ArrowRight className="h-3 w-3 text-[#67D8B7] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </a>
                <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-[10px] font-semibold text-white/65">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#67D8B7]" aria-hidden="true" />
                  {text('home.hero.transparency')}
                </span>
              </div>

              {/* Pillars kicker */}
              <div className="pt-5 border-t border-white/15 grid grid-cols-1 sm:grid-cols-3 gap-4 text-[11px] text-white/70">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#67D8B7] shrink-0" />
                  <span>{text('home.hero.pillar1')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#67D8B7] shrink-0" />
                  <span>{text('home.hero.pillar2')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#67D8B7] shrink-0" />
                  <span>{text('home.hero.pillar3')}</span>
                </div>
              </div>
            </div>

            {/* Right Column: Agency visual with an animated data overlay */}
            <div className="lg:col-span-6 relative lg:-mr-[max(0px,calc((100vw-80rem)/2))]">
              <div className="home-hero-visual relative mx-auto min-h-[300px] max-w-xl overflow-hidden rounded-[2rem] border border-white/15 bg-[#101A25] shadow-[0_32px_100px_rgba(0,0,0,0.45)] sm:min-h-[380px] lg:min-h-[500px]">
                <video
                  ref={heroVideoRef}
                  muted
                  loop
                  playsInline
                  preload="none"
                  src={siteContentLoaded && !prefersReducedMotion ? heroVideoSource.url : undefined}
                  aria-hidden="true"
                  onError={(event) => handleHeroVideoFailure(event.currentTarget, heroVideoSource)}
                  className={`absolute inset-0 h-full w-full object-cover ${theme === 'light' ? 'opacity-100' : 'opacity-85'}`}
                  poster={heroVideoSource.mode === 'dark' ? heroPoster.url || undefined : undefined}
                  style={{
                    filter: theme === 'light' ? 'none' : 'brightness(1.2) contrast(1.1)',
                    objectPosition: `${heroVideoMedia.focalX}% ${heroVideoMedia.focalY}%`,
                  }}
                >
                </video>
                <div className={`absolute inset-0 ${theme === 'light' ? 'bg-transparent' : 'bg-gradient-to-tr from-[#050912]/70 via-[#050912]/15 to-transparent'}`} />
                <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(103,216,183,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(103,216,183,0.12)_1px,transparent_1px)] [background-size:42px_42px]" />
                <div className="absolute left-[22%] top-[30%] h-2.5 w-2.5 animate-pulse rounded-full bg-[#C7F36B] shadow-[0_0_24px_8px_rgba(199,243,107,0.45)]" />
                <div className="absolute right-[27%] top-[48%] h-2 w-2 animate-pulse rounded-full bg-[#67D8B7] shadow-[0_0_20px_6px_rgba(103,216,183,0.5)]" />
                <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-4">
                  <div className="rounded-2xl border border-white/15 bg-[#07100F]/70 p-4 backdrop-blur-md">
                    <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#C7F36B]">Cross-market · Live signals</p>
                    <p className="mt-1 text-sm font-semibold text-white">Growth opportunities, made visible.</p>
                  </div>
                  <span className="hidden items-center gap-2 rounded-full border border-white/15 bg-black/35 px-3 py-2 text-[10px] text-white/80 backdrop-blur sm:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-[#C7F36B]" /> Strategy in motion</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3: TRUST AND VALUE PROPOSITION — PEOPLE · IDEAS · GROWTH */}
      <section className="py-16 bg-[#F7F9F6] border-b border-[#E5E9E4]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <div className="text-xs font-bold uppercase tracking-widest text-[#3EA259] mb-2">
              {siteContent.philosophy.eyebrow}
            </div>
            <h2 className="text-3xl font-extrabold text-[#171A17] tracking-tight">
              {siteContent.philosophy.title}
            </h2>
            <p className="text-sm text-[#626A63] mt-2">
              {siteContent.philosophy.description}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Pillar 1: People */}
            <div className="p-8 bg-white border border-[#E5E9E4] rounded-2xl space-y-3">
              <div className="w-12 h-12 rounded-xl bg-[#EBF7EE] text-[#3EA259] flex items-center justify-center font-bold text-lg">
                01
              </div>
              <h3 className="text-xl font-bold text-[#171A17]">{siteContent.philosophy.peopleTitle}</h3>
              <p className="text-sm text-[#626A63] leading-relaxed">
                {siteContent.philosophy.peopleDescription}
              </p>
            </div>

            {/* Pillar 2: Ideas */}
            <div className="p-8 bg-white border border-[#E5E9E4] rounded-2xl space-y-3">
              <div className="w-12 h-12 rounded-xl bg-[#FEF3C7] text-[#D97706] flex items-center justify-center font-bold text-lg">
                02
              </div>
              <h3 className="text-xl font-bold text-[#171A17]">{siteContent.philosophy.ideasTitle}</h3>
              <p className="text-sm text-[#626A63] leading-relaxed">
                {siteContent.philosophy.ideasDescription}
              </p>
            </div>

            {/* Pillar 3: Growth */}
            <div className="p-8 bg-white border border-[#E5E9E4] rounded-2xl space-y-3">
              <div className="w-12 h-12 rounded-xl bg-[#EBF7EE] text-[#3EA259] flex items-center justify-center font-bold text-lg">
                03
              </div>
              <h3 className="text-xl font-bold text-[#171A17]">{siteContent.philosophy.growthTitle}</h3>
              <p className="text-sm text-[#626A63] leading-relaxed">
                {siteContent.philosophy.growthDescription}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4: OUR MISSION AND VISION */}
      <section className="py-16 bg-white border-b border-[#E5E9E4]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <div className="text-xs font-bold uppercase tracking-widest text-[#3EA259] mb-2">{siteContent.missionVision.eyebrow}</div>
            <h2 className="text-3xl font-extrabold text-[#171A17] tracking-tight">{siteContent.missionVision.title}</h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <article className="p-7 sm:p-9 bg-[#F7F9F6] border border-[#E5E9E4] rounded-2xl">
              <div className="text-xs font-bold uppercase tracking-wider text-[#3EA259] mb-3">{siteContent.missionVision.missionTitle}</div>
              <p className="text-base sm:text-lg text-[#171A17] leading-relaxed">{siteContent.missionVision.missionDescription}</p>
            </article>
            <article className="p-7 sm:p-9 bg-[#171A17] border border-[#171A17] rounded-2xl text-white">
              <div className="text-xs font-bold uppercase tracking-wider text-[#67D8B7] mb-3">{siteContent.missionVision.visionTitle}</div>
              <p className="text-base sm:text-lg text-white/80 leading-relaxed">{siteContent.missionVision.visionDescription}</p>
            </article>
          </div>
        </div>
      </section>

      {/* SECTION 5: SERVICES OVERVIEW */}
      <section id="home-services" className="border-b border-white/10 bg-[#080E16] py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-10 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div className="max-w-2xl">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#C7F36B]">{siteContent.services.eyebrow}</div>
              <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
                {siteContent.services.title}
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/60">
                {siteContent.services.description}
              </p>
            </div>
            <button
              onClick={() => followPublicDestination(getCtaDestination(siteContent, 'home.services.browse', '/services'), onNavigate)}
              className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-[#C7F36B]/40 px-4 py-2.5 text-xs font-semibold text-[#D6F6A0] transition-colors hover:border-[#C7F36B] hover:bg-[#C7F36B]/10 sm:self-auto"
            >
              {siteContent.services.cta} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {SERVICES.slice(0, 8).map((service, index) => (
              <div
                key={service.slug}
                  className={`home-service-card group relative isolate flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101824] transition-all duration-200 hover:-translate-y-1 hover:border-[#C7F36B]/40 hover:shadow-[0_20px_50px_rgba(0,0,0,0.25)] ${
                    serviceVisuals[index].backgroundEnabled ? 'home-service-card--image-background' : ''
                  }`}
              >
                  {serviceVisuals[index].backgroundEnabled && (
                    <div
                      aria-hidden="true"
                      className="home-public-image-opacity pointer-events-none absolute inset-0 z-0"
                      style={{ opacity: serviceVisuals[index].backgroundOpacity / 100 }}
                    >
                      <img
                        src={serviceVisuals[index].image}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                        className="pointer-events-none absolute inset-0 z-0 h-full w-full"
                        style={{
                          objectFit: serviceVisuals[index].backgroundFit,
                          objectPosition: `${serviceVisuals[index].backgroundPositionX}% ${serviceVisuals[index].backgroundPositionY}%`,
                          opacity: serviceVisuals[index].backgroundOpacity / 100,
                        }}
                      />
                      <div className="absolute inset-0 bg-[#101824]/65" />
                    </div>
                  )}
                  <div className="relative z-10 flex flex-1 flex-col">
                    <div className="home-service-card-image relative h-36 overflow-hidden">
                      {!serviceVisuals[index].backgroundEnabled && (
                        <img src={serviceVisuals[index].image} alt={serviceVisuals[index].label} loading="lazy" style={{ objectPosition: `${serviceVisuals[index].focalX}% ${serviceVisuals[index].focalY}%` }} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#07100F]/80 via-[#07100F]/10 to-transparent" />
                      <span className="home-image-overlay-label absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/40 px-2.5 py-1 text-[9px] font-semibold text-white backdrop-blur">
                        <Play className="h-2.5 w-2.5 fill-current" /> {serviceVisuals[index].label}
                      </span>
                      {renderServiceIcon(service.icon)}
                    </div>
                    <div className="flex flex-1 flex-col p-5">
                      <span className="mb-2 block text-[9px] font-semibold tracking-wide text-white/40">{String(index + 1).padStart(2, '0')} / 08</span>
                      <h3 className="min-h-[3rem] text-base font-bold leading-snug text-white transition-colors group-hover:text-[#C7F36B]">{service.title}</h3>
                      <p className="mt-2 flex-1 text-xs leading-relaxed text-white/55">{service.shortDescription}</p>
                      <button
                        onClick={() => onNavigate(`/services/${service.slug}`)}
                        className="mt-5 flex w-full items-center justify-between border-t border-white/10 pt-3 text-xs font-semibold text-[#C7F36B] transition-colors hover:text-white"
                      >
                        <span>{text('home.services.explore')}</span>
                        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                      </button>
                    </div>
                  </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 6: HOSPITALITY GROWTH */}
      <section className="py-20 bg-[#F7F9F6] border-b border-[#E5E9E4]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <div className="text-xs font-bold uppercase tracking-widest text-[#3EA259] mb-2">
              {text('home.hospitality.eyebrow')}
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#171A17] tracking-tight">
              {text('home.hospitality.title')}
            </h2>
            <p className="text-sm text-[#626A63] mt-3 leading-relaxed">
              {text('home.hospitality.description')}
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="relative isolate overflow-hidden rounded-2xl border border-[#E5E9E4] bg-white p-7 sm:p-8">
              {hospitalityProblem.backgroundEnabled && (
                <div
                  aria-hidden="true"
                  className="home-public-image-opacity pointer-events-none absolute inset-0 z-0"
                  style={{ opacity: hospitalityProblem.backgroundOpacity / 100 }}
                >
                  <img
                    src={hospitalityProblem.url || 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1400&q=90'}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    className="pointer-events-none absolute inset-0 z-0 h-full w-full"
                    style={{
                      objectFit: hospitalityProblem.backgroundFit,
                      objectPosition: `${hospitalityProblem.backgroundPositionX}% ${hospitalityProblem.backgroundPositionY}%`,
                      opacity: hospitalityProblem.backgroundOpacity / 100,
                    }}
                  />
                  <div className="absolute inset-0 bg-white/65" />
                </div>
              )}
              <div className="relative z-10">
              <div className="relative -mx-7 -mt-7 mb-5 h-40 overflow-hidden rounded-t-2xl sm:-mx-8 sm:-mt-8">
                {!hospitalityProblem.backgroundEnabled && (
                  <img src={hospitalityProblem.url || 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1400&q=90'} alt={hospitalityProblem.altText} loading="lazy" style={{ objectPosition: `${hospitalityProblem.focalX}% ${hospitalityProblem.focalY}%` }} className="h-full w-full object-cover" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#07100F]/80 via-transparent to-black/10" />
                <span className="home-image-overlay-label absolute bottom-3 left-4 rounded-full border border-white/20 bg-black/45 px-3 py-1.5 text-[10px] font-semibold text-white backdrop-blur">Hospitality growth · Across markets</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#D97706] mb-3">
                <Hotel className="w-4 h-4" /> Common Bottlenecks
              </div>
              <h3 className="text-xl font-bold text-[#171A17] mb-5">{text('home.hospitality.problemTitle')}</h3>
              <div className="space-y-4">
                {[
                  ['Low occupancy', 'Unfilled rooms during off-peak periods and uneven weekday bookings.'],
                  ['Inconsistent branding', 'Fragmented social and search presence that can weaken guest confidence.'],
                  ['Weak guest engagement', 'Few follow-up and rebooking touchpoints after a guest checks out.'],
                  ['OTA dependence', 'Third-party booking channels can reduce margins and limit direct guest relationships.'],
                ].map(([title, description]) => (
                  <div key={title} className="flex items-start gap-3">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#F59E0B]" />
                    <div>
                      <h4 className="text-sm font-bold text-[#171A17]">{title}</h4>
                      <p className="text-xs text-[#626A63] leading-relaxed mt-0.5">{description}</p>
                    </div>
                  </div>
                ))}
              </div>
              </div>
            </div>

            <div className="relative isolate overflow-hidden rounded-2xl border border-[#171A17] bg-[#171A17] p-7 sm:p-8 text-white">
              {hospitalitySolution.backgroundEnabled && (
                <div
                  aria-hidden="true"
                  className="home-public-image-opacity pointer-events-none absolute inset-0 z-0"
                  style={{ opacity: hospitalitySolution.backgroundOpacity / 100 }}
                >
                  <img
                    src={hospitalitySolution.url || 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1400&q=90'}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    className="pointer-events-none absolute inset-0 z-0 h-full w-full"
                    style={{
                      objectFit: hospitalitySolution.backgroundFit,
                      objectPosition: `${hospitalitySolution.backgroundPositionX}% ${hospitalitySolution.backgroundPositionY}%`,
                      opacity: hospitalitySolution.backgroundOpacity / 100,
                    }}
                  />
                  <div className="absolute inset-0 bg-[#171A17]/65" />
                </div>
              )}
              <div className="relative z-10">
              <div className="relative -mx-7 -mt-7 mb-5 h-40 overflow-hidden rounded-t-2xl sm:-mx-8 sm:-mt-8">
                {!hospitalitySolution.backgroundEnabled && (
                  <img src={hospitalitySolution.url || 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1400&q=90'} alt={hospitalitySolution.altText} loading="lazy" style={{ objectPosition: `${hospitalitySolution.focalX}% ${hospitalitySolution.focalY}%` }} className="h-full w-full object-cover" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#07100F]/80 via-transparent to-black/10" />
              </div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#67D8B7] mb-3">
                <TrendingUp className="w-4 h-4" /> NearGrow Growth System
              </div>
              <h3 className="text-xl font-bold text-white mb-5">{text('home.hospitality.solutionTitle')}</h3>
              <div className="space-y-4">
                {[
                  ['Higher visibility', 'Search optimization and targeted campaigns that reach travelers actively planning a stay.'],
                  ['Stronger brand presence', 'Consistent creative and property storytelling across key digital touchpoints.'],
                  ['More direct inquiries', 'Clear, mobile-friendly paths for guests to ask questions and reserve directly.'],
                  ['Lasting guest relationships', 'Practical follow-up journeys that encourage return visits and recommendations.'],
                ].map(([title, description]) => (
                  <div key={title} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#67D8B7]" />
                    <div>
                      <h4 className="text-sm font-bold text-white">{title}</h4>
                      <p className="text-xs text-white/65 leading-relaxed mt-0.5">{description}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => followPublicDestination(getCtaDestination(siteContent, 'home.hospitality', '/get-started'), onNavigate)}
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#159B80] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#20B395]"
              >
                {text('home.hospitality.cta')} <ArrowRight className="h-3.5 w-3.5" />
              </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 7: INDUSTRIES WE SERVE */}
      <section className="py-20 bg-white border-b border-[#E5E9E4]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <div className="text-xs font-bold uppercase tracking-widest text-[#3EA259] mb-2">
              {text('home.industries.eyebrow')}
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#171A17] tracking-tight">
              {text('home.industries.title')}
            </h2>
            <p className="text-sm text-[#626A63] mt-3">
              {text('home.industries.description')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {industries.map(({ title, description, Icon }) => (
              <article
                key={title}
                className="p-5 bg-[#F7F9F6] border border-[#E5E9E4] rounded-2xl transition-colors hover:border-[#3EA259]"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#EBF7EE] text-[#3EA259]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="text-sm font-bold text-[#171A17]">{title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-[#626A63]">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 8: FIVE-STAGE GROWTH PROCESS */}
      <section className="py-14 bg-[#0B1014] border-b border-white/10 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#67D8B7] mb-2">{siteContent.methodology.eyebrow}</div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              {siteContent.methodology.title}
            </h2>
            <p className="text-sm text-white/60 mt-2">
              {siteContent.methodology.description}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4" role="group" aria-label="NearGrow process stages">
            {processStages.map((stage, index) => {
              const isActive = activeProcessStage === index;
              return (
                <button
                  key={stage.title}
                  type="button"
                  onClick={() => setActiveProcessStage(index)}
                  aria-pressed={isActive}
                  aria-controls="process-stage-detail"
                  className={`group p-5 text-left border rounded-2xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3EA259] focus-visible:ring-offset-2 ${
                    isActive
                      ? 'bg-[#173B3A] border-[#67D8B7] text-white shadow-[0_12px_36px_rgba(0,0,0,0.28)] -translate-y-1'
                      : 'bg-[#11191F] border-white/10 hover:border-[#67D8B7]/60 hover:-translate-y-1 hover:shadow-lg'
                  }`}
                >
                  <div className={`text-2xl font-black mb-3 ${isActive ? 'text-[#F4B66B]' : 'text-[#67D8B7]'}`}>
                    {String(index + 1).padStart(2, '0')}
                  </div>
                  <h3 className="text-base font-bold text-white mb-2">
                    {stage.title}
                  </h3>
                  <p className="text-xs text-white/60 leading-relaxed">
                    {stage.summary}
                  </p>
                </button>
              );
            })}
          </div>

          <div
            id="process-stage-detail"
            role="status"
            aria-live="polite"
            className="mt-5 flex items-center gap-4 border-l-4 border-[#F4B66B] bg-[#141F24] px-4 py-4 rounded-r-xl shadow-sm"
          >
            <img src={serviceVisuals[(activeProcessStage + 2) % serviceVisuals.length].image} alt={serviceVisuals[(activeProcessStage + 2) % serviceVisuals.length].label} loading="lazy" style={{ objectPosition: `${serviceVisuals[(activeProcessStage + 2) % serviceVisuals.length].focalX}% ${serviceVisuals[(activeProcessStage + 2) % serviceVisuals.length].focalY}%` }} className="hidden h-16 w-24 shrink-0 rounded-lg object-cover sm:block" />
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="inline-flex w-[4.5rem] shrink-0 items-center justify-center rounded-full border border-[#67D8B7]/25 bg-[#67D8B7]/10 px-2 py-1 text-[10px] font-bold leading-none text-[#67D8B7]">
                STEP {String(activeProcessStage + 1).padStart(2, '0')}
              </span>
              <p className="text-sm text-white/70 leading-relaxed">{processStages[activeProcessStage].detail}</p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 9: SELECTED WORK & PRACTICAL EXAMPLES */}
      <section id="home-case-studies" className="scroll-mt-20 py-20 bg-white border-b border-[#E5E9E4]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#3EA259] mb-1">{text('home.work.eyebrow')}</div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-[#171A17] tracking-tight">
                {text('home.work.title')}
              </h2>
              <p className="text-sm text-[#626A63] mt-2 max-w-xl">
                {text('home.work.description')}
              </p>
            </div>
            <button
              onClick={() => onNavigate('/work')}
              className="text-xs font-semibold text-[#3EA259] hover:underline flex items-center gap-1.5 self-start md:self-auto"
            >
              {text('home.work.cta')} <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <Skiper52Showcase onNavigate={onNavigate} media={siteContent.media} studies={publishedCaseStudies} theme={theme} />
        </div>
      </section>

      {/* SECTION 10: WHY NEARGROW ADS */}
      <section className="py-20 bg-white border-b border-[#E5E9E4]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <div className="text-xs font-bold uppercase tracking-wider text-[#3EA259] mb-1">{text('home.why.eyebrow')}</div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#171A17] tracking-tight">
              {text('home.why.title')}
            </h2>
            <p className="text-sm text-[#626A63] mt-2">
              {text('home.why.description')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="p-6 bg-[#F7F9F6] border border-[#E5E9E4] rounded-2xl space-y-2">
              <h3 className="flex items-center gap-2 text-base font-bold text-[#171A17]"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#EBF7EE] text-[#3EA259]"><Laptop className="h-4 w-4" /></span>{text('home.why.card1.title')}</h3>
              <p className="text-xs text-[#626A63] leading-relaxed">{text('home.why.card1.body')}</p>
            </div>

            <div className="p-6 bg-[#F7F9F6] border border-[#E5E9E4] rounded-2xl space-y-2">
              <h3 className="flex items-center gap-2 text-base font-bold text-[#171A17]"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#EBF7EE] text-[#3EA259]"><Shield className="h-4 w-4" /></span>{text('home.why.card2.title')}</h3>
              <p className="text-xs text-[#626A63] leading-relaxed">{text('home.why.card2.body')}</p>
            </div>

            <div className="p-6 bg-[#F7F9F6] border border-[#E5E9E4] rounded-2xl space-y-2">
              <h3 className="flex items-center gap-2 text-base font-bold text-[#171A17]"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#EBF7EE] text-[#3EA259]"><MapPin className="h-4 w-4" /></span>{text('home.why.card3.title')}</h3>
              <p className="text-xs text-[#626A63] leading-relaxed">{text('home.why.card3.body')}</p>
            </div>

            <div className="p-6 bg-[#F7F9F6] border border-[#E5E9E4] rounded-2xl space-y-2">
              <h3 className="flex items-center gap-2 text-base font-bold text-[#171A17]"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#EBF7EE] text-[#3EA259]"><Cpu className="h-4 w-4" /></span>{text('home.why.card4.title')}</h3>
              <p className="text-xs text-[#626A63] leading-relaxed">{text('home.why.card4.body')}</p>
            </div>

            <div className="p-6 bg-[#F7F9F6] border border-[#E5E9E4] rounded-2xl space-y-2">
              <h3 className="flex items-center gap-2 text-base font-bold text-[#171A17]"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#EBF7EE] text-[#3EA259]"><Layers className="h-4 w-4" /></span>{text('home.why.card5.title')}</h3>
              <p className="text-xs text-[#626A63] leading-relaxed">{text('home.why.card5.body')}</p>
            </div>

            <div className="p-6 bg-[#F7F9F6] border border-[#E5E9E4] rounded-2xl space-y-2">
              <h3 className="flex items-center gap-2 text-base font-bold text-[#171A17]"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#EBF7EE] text-[#3EA259]"><Award className="h-4 w-4" /></span>{text('home.why.card6.title')}</h3>
              <p className="text-xs text-[#626A63] leading-relaxed">{text('home.why.card6.body')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 11: GROWTH ESTIMATOR */}
      <section className="border-b border-white/10 bg-[#080E16] py-16 text-white sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#101A25] shadow-[0_28px_80px_rgba(0,0,0,0.24)]">
            <div className="border-b border-white/[0.08] px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#67D8B7]">{text('home.calculator.eyebrow')}</p>
              <h2 className="mt-3 max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">{text('home.calculator.title')}</h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/60">
                {text('home.calculator.description')}
              </p>
            </div>

            <div className="grid lg:grid-cols-[1fr_0.9fr]">
              <div className="space-y-7 p-5 sm:p-8 lg:p-10">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-white/75">Your industry</span>
                  <select
                    value={industry}
                    onChange={(event) => setIndustry(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-[#0B121C] px-4 py-3 text-sm text-white outline-none transition-colors focus:border-[#67D8B7] focus:ring-2 focus:ring-[#67D8B7]/15"
                  >
                    {industries.map((item) => <option key={item.title}>{item.title}</option>)}
                  </select>
                </label>

                <div>
                  <label htmlFor="monthly-footfall" className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-white/75">
                    <span>{text('home.calculator.footfall')}</span>
                    <span className="text-[10px] font-medium text-white/40">100–10,000</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="100"
                      max="10000"
                      step="100"
                      value={monthlyFootfall}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setMonthlyFootfall(value);
                        setMonthlyFootfallInput(String(value));
                      }}
                      aria-label="Current monthly visits or sessions"
                      className="h-2 min-w-0 flex-1 cursor-pointer accent-[#67D8B7]"
                    />
                    <div className="relative w-32 shrink-0 sm:w-36">
                      <input
                        id="monthly-footfall"
                        type="number"
                        min="100"
                        max="10000"
                        step="100"
                        value={monthlyFootfallInput}
                        onChange={(event) => {
                          const input = event.target.value;
                          setMonthlyFootfallInput(input);
                          if (input !== '' && Number.isFinite(Number(input))) {
                            setMonthlyFootfall(Math.min(10000, Math.max(100, Math.round(Number(input)))));
                          }
                        }}
                        onBlur={() => {
                          const value = monthlyFootfallInput === '' ? monthlyFootfall : Number(monthlyFootfallInput);
                          const normalized = Math.min(10000, Math.max(100, Math.round(value)));
                          setMonthlyFootfall(normalized);
                          setMonthlyFootfallInput(String(normalized));
                        }}
                        className="w-full rounded-xl border border-white/10 bg-[#0B121C] py-2.5 pl-3 pr-10 text-right text-sm font-semibold tabular-nums text-white outline-none transition-colors focus:border-[#67D8B7] focus:ring-2 focus:ring-[#67D8B7]/15"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[10px] text-white/40">visits</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="average-sale" className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-white/75">
                    <span>{text('home.calculator.averageSale')}</span>
                    <span className="text-[10px] font-medium text-white/40">₹100–₹1,00,000</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="100"
                      max="100000"
                      step="100"
                      value={averageSale}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setAverageSale(value);
                        setAverageSaleInput(String(value));
                      }}
                      aria-label="Average sale value"
                      className="h-2 min-w-0 flex-1 cursor-pointer accent-[#67D8B7]"
                    />
                    <div className="relative w-32 shrink-0 sm:w-36">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-white/40">₹</span>
                      <input
                        id="average-sale"
                        type="number"
                        min="100"
                        max="100000"
                        step="100"
                        value={averageSaleInput}
                        onChange={(event) => {
                          const input = event.target.value;
                          setAverageSaleInput(input);
                          if (input !== '' && Number.isFinite(Number(input))) {
                            setAverageSale(Math.min(100000, Math.max(100, Math.round(Number(input)))));
                          }
                        }}
                        onBlur={() => {
                          const value = averageSaleInput === '' ? averageSale : Number(averageSaleInput);
                          const normalized = Math.min(100000, Math.max(100, Math.round(value)));
                          setAverageSale(normalized);
                          setAverageSaleInput(String(normalized));
                        }}
                        className="w-full rounded-xl border border-white/10 bg-[#0B121C] py-2.5 pl-7 pr-3 text-right text-sm font-semibold tabular-nums text-white outline-none transition-colors focus:border-[#67D8B7] focus:ring-2 focus:ring-[#67D8B7]/15"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-center border-t border-white/[0.08] bg-[radial-gradient(ellipse_at_top_right,rgba(103,216,183,0.09),transparent_55%),#0D1520] p-5 sm:p-8 lg:border-l lg:border-t-0 lg:p-10">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Illustrative estimate · {industry}</span>
                <div className="mt-7 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 sm:p-6">
                  <p className="text-xs font-medium text-white/60">{text('home.calculator.inquiriesResult')}</p>
                  <p aria-live="polite" className="mt-2 text-4xl font-black tracking-tight text-[#67D8B7] sm:text-5xl">
                    <span key={monthlyInquiries} className="ng-estimate-value">+{monthlyInquiries.toLocaleString('en-IN')}</span>
                  </p>
                </div>
                <div className="mt-3 rounded-2xl border border-[#67D8B7]/15 bg-[#67D8B7]/[0.04] p-5 sm:p-6">
                  <p className="text-xs font-medium text-white/60">{text('home.calculator.revenueResult')}</p>
                  <p aria-live="polite" className="mt-2 text-3xl font-black tracking-tight text-[#67D8B7] sm:text-4xl">
                    <span key={projectedRevenue} className="ng-estimate-value">₹{projectedRevenue.toLocaleString('en-IN')}</span>
                  </p>
                </div>
                <p className="mt-5 text-[10px] leading-relaxed text-white/40">
                  {text('home.calculator.estimateDisclaimer')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST AND PARTNERSHIPS */}
      <section className="border-b border-white/10 bg-[#080E16] py-14 text-white sm:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8 max-w-2xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#67D8B7]">{text('home.trust.eyebrow')}</p>
            <h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">{text('home.trust.title')}</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/55">
              {text('home.trust.description')}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <a
              href="https://clutch.co/profile/neargrow-ads"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View NearGrow Ads official profile on Clutch (opens in a new tab)"
              className="group flex min-h-32 flex-col justify-between rounded-2xl border border-[#67D8B7]/25 bg-[radial-gradient(ellipse_at_top_left,rgba(103,216,183,0.12),transparent_65%),#101A25] p-5 shadow-[0_0_36px_rgba(103,216,183,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#67D8B7]/50 hover:shadow-[0_12px_42px_rgba(0,0,0,0.28),0_0_30px_rgba(103,216,183,0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-2xl font-extrabold tracking-tight text-white">Clutch<span className="text-[#67D8B7]">.</span></span>
                <ArrowRight className="h-4 w-4 text-[#67D8B7] transition-transform group-hover:translate-x-1" />
              </span>
              <span className="mt-4">
                <span className="block text-xs font-bold text-white/90">Official agency profile</span>
                <span className="mt-1 block text-[10px] text-white/50">Listed on Clutch · Not yet reviewed</span>
              </span>
            </a>

            <div className="flex min-h-32 items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#67D8B7]/15 bg-[#67D8B7]/[0.08] text-[#67D8B7]">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-xs font-bold text-white/90">Clear ad spend</span>
                <span className="mt-1 block text-[10px] leading-relaxed text-white/50">You pay platforms directly from your own account.</span>
              </span>
            </div>

            <div className="flex min-h-32 items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#67D8B7]/15 bg-[#67D8B7]/[0.08] text-[#67D8B7]">
                <MapPin className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-xs font-bold text-white/90">Market-specific strategy</span>
                <span className="mt-1 block text-[10px] leading-relaxed text-white/50">Research-led plans for the audiences you serve.</span>
              </span>
            </div>

            <div className="flex min-h-32 items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#67D8B7]/15 bg-[#67D8B7]/[0.08] text-[#67D8B7]">
                <Shield className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-xs font-bold text-white/90">No artificial guarantees</span>
                <span className="mt-1 block text-[10px] leading-relaxed text-white/50">Honest expectations and transparent execution.</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 12: CLIENT STORIES */}
      {publicTestimonials.length > 0 && <section className="py-20 border-b border-white/10 bg-[#0B111A] text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#C7F36B]">{text('home.stories.eyebrow')}</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{text('home.stories.title')}</h2>
              <p className="mt-2 max-w-2xl text-sm text-white/55">
                {text('home.stories.description').replace(/\s*Video interviews can be added as they become available\.?/i, '')}
              </p>
            </div>
            <div className="flex gap-2">
              {publicTestimonials.map((study, index) => (
                <button key={study.id} type="button" onClick={() => setSelectedStory(index)} aria-label={`Show client story ${index + 1}`} aria-pressed={selectedStory === index} className={`h-2.5 w-8 rounded-full transition-colors ${selectedStory === index ? 'bg-[#C7F36B]' : 'bg-white/20'}`} />
              ))}
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {publicTestimonials.map((study, index) => (
              <article key={study.id} className={`overflow-hidden rounded-2xl border transition-colors ${selectedStory === index ? 'border-[#C7F36B]/60 bg-[#111A25]' : 'border-white/10 bg-[#0E1621]'}`}>
                <div className="relative h-48 overflow-hidden">
                  <img
                    src={study.imageUrl || serviceVisuals[[0, 4, 2][index % 3]].image}
                    alt={study.imageAlt || serviceVisuals[[0, 4, 2][index % 3]].label}
                    loading="lazy"
                    decoding="async"
                    style={{
                      objectPosition: `${study.imagePositionX ?? serviceVisuals[[0, 4, 2][index % 3]].focalX}% ${study.imagePositionY ?? serviceVisuals[[0, 4, 2][index % 3]].focalY}%`,
                      objectFit: study.imageSize === 'contain' ? 'contain' : 'cover',
                    }}
                    className="h-full w-full"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#07100F]/80 to-transparent" />
                </div>
                <div className="p-5">
                  <p className="text-sm leading-relaxed text-white/80">“{study.testimonialQuote?.quote}”</p>
                  <div className="mt-5 border-t border-white/10 pt-4">
                    <p className="text-sm font-bold text-white">{study.testimonialQuote?.author || study.clientDescriptor}</p>
                    <p className="mt-1 text-[10px] text-white/45">{study.testimonialQuote?.role || study.category}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>}

      {/* SECTION 12: LEAD MAGNET / DISCOVERY AUDIT SECTION */}
      <section id="consultation" className="py-20 bg-white border-b border-[#E5E9E4]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12 lg:gap-14">
            {/* Left Column: Context & Promise */}
            <div className="space-y-6 lg:col-span-5 lg:py-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#C7F36B]/20 bg-[#C7F36B]/[0.08] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#C7F36B]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#C7F36B]" />
                Discovery & Consultation
              </div>
              <h2 className="text-3xl font-extrabold leading-[1.1] tracking-tight text-white [text-wrap:balance] sm:text-4xl">
                Not Sure What Your Business Needs Next?
              </h2>
              <p className="text-sm leading-relaxed text-white/65">
                Tell us about your business. We will help identify relevant opportunities across search, advertising,
                websites, and digital workflows—with clear recommendations on what to prioritize first.
              </p>

              <div className="space-y-3 pt-2">
                <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#C7F36B]" />
                  <div>
                    <h4 className="text-xs font-bold text-white">No High-Pressure Sales</h4>
                    <p className="mt-0.5 text-xs leading-relaxed text-white/55">
                      Our discovery session is an honest diagnostic. If your business doesn’t need a specific service, we
                      will openly tell you.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#C7F36B]" />
                  <div>
                    <h4 className="text-xs font-bold text-white">1 Business Day Response</h4>
                    <p className="mt-0.5 text-xs leading-relaxed text-white/55">
                      Our strategy team reviews your business information and responds with preliminary insights.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-[#C7F36B]" />
                  <div>
                    <h4 className="text-xs font-bold text-white">Direct WhatsApp Availability</h4>
                    <p className="mt-0.5 text-xs leading-relaxed text-white/55">
                      Prefer messaging? Connect directly with our team on WhatsApp for quick initial questions.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Interactive Consultation Form */}
            <div className="lg:col-span-7">
              <ConsultationForm className="home-consultation-form" siteContent={siteContent} />
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 12: LATEST INSIGHTS */}
      <section className="py-20 bg-white border-b border-[#E5E9E4]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#3EA259] mb-1">
                Growth Insights & Strategies
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-[#171A17] tracking-tight">
                Latest Insights
              </h2>
              <p className="text-sm text-[#626A63] mt-2 max-w-xl">
                Practical guides on search visibility, customer acquisition, and technology for growing businesses.
              </p>
            </div>
            <button
              onClick={() => onNavigate('/blog')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#3EA259] hover:underline self-start md:self-auto"
            >
              View All Articles <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {blogPosts.slice(0, 3).map((post) => (
              <article
                key={post.slug}
                className="flex flex-col justify-between rounded-2xl border border-[#E5E9E4] bg-[#F7F9F6] p-6 transition-colors hover:border-[#3EA259]"
              >
                <div>
                  {resolveBlogImage(post.featuredImage, post.featuredImageAltText ?? '', post.featuredImageVariants, theme).image.url && (
                    <img src={resolveBlogImage(post.featuredImage, post.featuredImageAltText ?? '', post.featuredImageVariants, theme).image.url} alt={resolveBlogImage(post.featuredImage, post.featuredImageAltText ?? '', post.featuredImageVariants, theme).image.altText ?? ''} loading="lazy" className="mb-4 aspect-video w-full rounded-xl object-cover" />
                  )}
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#3EA259]">{post.category}</div>
                  <h3 className="mt-3 text-lg font-bold leading-snug text-[#171A17]">{post.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-[#626A63] line-clamp-3">{post.excerpt}</p>
                </div>
                <button
                  onClick={() => onNavigate(`/blog/${post.slug}`)}
                  className="mt-5 inline-flex items-center gap-1.5 self-start text-xs font-semibold text-[#3EA259] hover:text-[#216F3D]"
                >
                  Read Article <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 13: GROWTH ACROSS MARKETS */}
      <section className="border-b border-white/10 bg-[#080E16] py-20 text-white">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#67D8B7]">{text('home.markets.eyebrow')}</p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{text('home.markets.title')}</h2>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/60">
              {text('home.markets.description')}
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-[#67D8B7]/20 bg-[#67D8B7]/[0.08] px-4 py-2 text-xs font-semibold text-[#A8EBD6]">
              <CheckCircle2 className="h-3.5 w-3.5" /> People · Ideas · Growth
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                number: '01',
                title: 'Search across markets',
                description: 'International and multi-location SEO built around market-specific intent and useful content.',
                Icon: Compass,
              },
              {
                number: '02',
                title: 'Acquire with clarity',
                description: 'Performance campaigns with direct media billing, conversion tracking, and transparent reporting.',
                Icon: TrendingUp,
              },
              {
                number: '03',
                title: 'Scale digital experiences',
                description: 'Fast, accessible web engineering designed for global audiences and measurable action.',
                Icon: Laptop,
              },
            ].map(({ number, title, description, Icon }) => (
              <article key={number} className="rounded-2xl border border-white/10 bg-[#101A25] p-5 transition-colors hover:border-[#67D8B7]/35">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black tracking-wider text-[#67D8B7]">{number}</span>
                  <Icon className="h-4 w-4 text-[#67D8B7]" aria-hidden="true" />
                </div>
                <h3 className="mt-5 text-sm font-bold text-white">{title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-white/55">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 14: FAQS */}
      <section className="border-b border-[#E5E9E4] bg-[#F7F9F6] py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="home-faq-panel relative isolate overflow-hidden rounded-[2rem] border border-[#263A32] bg-[#101A17] p-5 text-white shadow-[0_28px_80px_rgba(23,42,31,0.16)] sm:p-8 lg:p-12">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_15%_100%,rgba(62,162,89,0.18),transparent_48%),radial-gradient(ellipse_at_88%_0%,rgba(103,216,183,0.10),transparent_42%)]" />
            <div className="grid gap-10 lg:grid-cols-[0.78fr_1.22fr] lg:gap-12">
              <div className="flex flex-col">
                <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-[#67D8B7]/20 bg-[#67D8B7]/[0.08] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#91E3C9]">
                  <HelpCircle className="h-3.5 w-3.5" />
                  {text('home.faqs.eyebrow')}
                </div>
                <h2 className="max-w-md text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
                  {text('home.faqs.titleBefore')} <span className="text-[#A9B8AD]">{text('home.faqs.titleHighlight')}</span>
                </h2>
                <p className="mt-4 max-w-md text-sm leading-relaxed text-white/60">
                  {text('home.faqs.description')}
                </p>

                <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#67D8B7]/20 bg-[#67D8B7]/10 text-[#67D8B7]">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-base font-bold text-white">{text('home.faqs.cardTitle')}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-white/55">
                    {text('home.faqs.cardDescription')}
                  </p>
                  <button
                    type="button"
                    onClick={() => followPublicDestination(getCtaDestination(siteContent, 'home.faqs', '/get-started'), onNavigate)}
                    className="group mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#3EA259] px-5 py-3 text-xs font-bold text-white shadow-[0_8px_24px_rgba(62,162,89,0.24)] transition-colors hover:bg-[#348A4B] sm:w-auto"
                  >
                    {text('home.faqs.cta')}
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                  </button>
                </div>
              </div>

              <div className="space-y-2.5">
                {faqs.map((faq, index) => {
                  const isOpen = activeFaq === index;
                  const answerId = `home-faq-answer-${faq.id}`;
                  return (
                    <div
                      key={faq.id}
                      className={`overflow-hidden rounded-2xl border transition-colors ${
                        isOpen
                          ? 'border-[#67D8B7]/20 bg-[#17231E]'
                          : 'border-white/[0.08] bg-white/[0.025] hover:border-white/15'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveFaq(isOpen ? null : index)}
                        className="flex w-full items-center gap-3 px-4 py-4 text-left sm:px-5"
                        aria-expanded={isOpen}
                        aria-controls={answerId}
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[#67D8B7]/15 bg-[#67D8B7]/[0.06] text-[9px] font-bold tracking-wide text-[#67D8B7]">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="flex-1 text-xs font-semibold leading-relaxed text-white/90 sm:text-sm">
                          {faq.question}
                        </span>
                        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border transition-colors ${
                          isOpen
                            ? 'border-[#67D8B7]/30 bg-[#67D8B7]/10 text-[#67D8B7]'
                            : 'border-white/10 text-white/50'
                        }`}>
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                        </span>
                      </button>
                      {isOpen && (
                        <div id={answerId} className="ml-11 border-t border-white/[0.08] px-4 pb-4 pt-3 text-xs leading-relaxed text-white/60 sm:ml-12 sm:px-5">
                          {faq.answer}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 15: FINAL CTA */}
      <section className="py-20 bg-[#171A17] text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
          <div className="text-xs uppercase tracking-widest text-[#3EA259] font-bold">
            {text('home.closing.eyebrow')}
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight [text-wrap:balance]">
            {text('home.closing.title')}
          </h2>
          <p className="text-sm sm:text-base text-neutral-400 max-w-2xl mx-auto leading-relaxed">
            {text('home.closing.description')}
          </p>

          <div className="pt-4 flex flex-wrap items-center justify-center gap-4">
            <button
              onClick={() => followPublicDestination(getCtaDestination(siteContent, 'home.closing.primary', '/get-started'), onNavigate)}
              className="px-6 py-3.5 bg-[#3EA259] hover:bg-[#2E8044] text-white text-sm font-semibold rounded-xl transition-all shadow-sm"
            >
              {text('home.closing.primaryCta')}
            </button>
            <button
              type="button"
              onClick={() => followPublicDestination(getCtaDestination(siteContent, 'home.closing.secondary', 'https://wa.me/919289810149?text=Hi%20NearGrow%20Ads%2C%20I%20would%20like%20to%20discuss%20digital%20marketing%20services.'), onNavigate)}
              className="px-6 py-3.5 bg-neutral-800 hover:bg-neutral-700 text-white text-sm font-semibold rounded-xl transition-all flex items-center gap-2 border border-neutral-700"
            >
              <MessageSquare className="w-4 h-4 text-[#3EA259]" />
              <span>{text('home.closing.secondaryCta')}</span>
            </button>
          </div>
        </div>
      </section>

      <React.Suspense fallback={null}>
        <GlobalReachSection media={siteContent.media} settings={siteContent.animations} theme={theme} />
      </React.Suspense>

      {/* SECTION 16: TRUSTED TECHNOLOGY */}
      <section className="border-b border-white/10 bg-[#080E16] py-14 text-white">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#C7F36B]">{text('home.tools.eyebrow')}</p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">{text('home.tools.title')}</h2>
          <div className="mt-8 grid grid-cols-2 items-center gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { name: 'Google', detail: 'Business Profile', color: 'text-white' },
              { name: 'Meta', detail: 'Business Suite', color: 'text-[#9BC6FF]' },
              { name: 'Google Ads', detail: 'Campaigns', color: 'text-[#C7F36B]' },
              { name: 'Next.js', detail: 'Web Engineering', color: 'text-white' },
              { name: 'HubSpot', detail: '+ CRM tools', color: 'text-[#FFA87B]' },
            ].map((tool) => (
              <div key={tool.name} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5 transition hover:border-[#C7F36B]/35 hover:bg-white/[0.06]">
                <p className={`text-lg font-extrabold tracking-tight ${tool.color}`}>{tool.name}</p>
                <p className="mt-1 text-[10px] text-white/45">{tool.detail}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 text-[10px] font-medium uppercase tracking-[0.18em] text-white/35">Official Tools and Tech We Master</p>
        </div>
      </section>
    </div>
  );
};
import { resolveBlogImage } from '../../data/blogData';
