import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { HomePage } from './components/home/HomePage';
const AdminPage = React.lazy(() => import('./components/admin/AdminPage').then((module) => ({ default: module.AdminPage })));
const AdminAuthAction = React.lazy(() => import('./components/admin/AdminAuthAction').then((module) => ({ default: module.AdminAuthAction })));
const ServicesIndexPage = React.lazy(() => import('./components/services/ServicesIndexPage').then((module) => ({ default: module.ServicesIndexPage })));
const ServiceDetailPage = React.lazy(() => import('./components/services/ServiceDetailPage').then((module) => ({ default: module.ServiceDetailPage })));
const ManagedWebsiteServiceDetailPage = React.lazy(() => import('./components/services/ServiceDetailPage').then((module) => ({ default: module.ManagedWebsiteServiceDetailPage })));
const CataloguePage = React.lazy(() => import('./components/catalogue/CataloguePage').then((module) => ({ default: module.CataloguePage })));
const AboutPage = React.lazy(() => import('./components/about/AboutPage').then((module) => ({ default: module.AboutPage })));
const WorkPage = React.lazy(() => import('./components/work/WorkPage').then((module) => ({ default: module.WorkPage })));
const BlogIndexPage = React.lazy(() => import('./components/blog/BlogIndexPage').then((module) => ({ default: module.BlogIndexPage })));
const BlogPostPage = React.lazy(() => import('./components/blog/BlogPostPage').then((module) => ({ default: module.BlogPostPage })));
const ContactPage = React.lazy(() => import('./components/contact/ContactPage').then((module) => ({ default: module.ContactPage })));
const GetStartedPage = React.lazy(() => import('./components/contact/GetStartedPage').then((module) => ({ default: module.GetStartedPage })));
const PrivacyPolicy = React.lazy(() => import('./components/legal/PrivacyPolicy').then((module) => ({ default: module.PrivacyPolicy })));
const TermsPage = React.lazy(() => import('./components/legal/TermsPage').then((module) => ({ default: module.TermsPage })));
const ThankYouPage = React.lazy(() => import('./components/legal/ThankYouPage').then((module) => ({ default: module.ThankYouPage })));
import { NearGrowMascot } from './components/mascot/NearGrowMascot';
import { FloatingAssistant } from './components/mascot/FloatingAssistant';
import { ChatbotWidget } from './components/chat/ChatbotWidget';
import { normalizeMascotSettings } from './data/mascotSizing';
import { PageTransitionOverlay } from './components/brand/PageTransitionOverlay';
import { SERVICES } from './data/servicesData';
import { BLOG_POSTS, type BlogPost } from './data/blogData';
import { fetchBlogPosts } from './data/blogApi';
import { DEFAULT_SITE_CONTENT, type SiteContent } from './data/siteContent';
import { publicMedia } from './data/publicMedia';
import { captureFirstTouchCampaign } from './data/leadTracking';
import { PublicActivityTracker } from './components/PublicActivityTracker';
import { ArrowLeft } from 'lucide-react';
import { readAdminAuthRoute } from './components/admin/adminAuthCallback';

const FIRST_VISIT_TRANSITION_MS = 900;
const INTERNAL_TRANSITION_MS = 650;
type PublicTheme = 'light' | 'dark';

function getSessionTheme(): PublicTheme {
  try {
    return window.sessionStorage.getItem('neargrow-theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

interface RouteErrorBoundaryProps {
  children: React.ReactNode;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
}

class RouteErrorBoundary extends React.Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[NearGrow Ads] The destination page could not be rendered.', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="min-h-[50vh] px-6 py-24 text-center" role="alert">
          <h1 className="text-2xl font-bold">This page could not be loaded</h1>
          <p className="mt-3 text-sm text-[#626A63]">Please try another page or return home.</p>
        </section>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const isCmsPreview = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('ng-cms-preview') === '1';
  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname || '/';
    }
    return '/';
  });
  const [transitionId, setTransitionId] = useState(1);
  const [readyTransitionId, setReadyTransitionId] = useState(0);
  const [transitionActive, setTransitionActive] = useState(false);
  const focusAfterTransitionRef = useRef(false);
  const pendingNavigationHashRef = useRef('');
  const [blogPosts, setBlogPosts] = useState<BlogPost[]>(BLOG_POSTS);
  const [siteContent, setSiteContent] = useState<SiteContent>(DEFAULT_SITE_CONTENT);
  const [siteContentLoaded, setSiteContentLoaded] = useState(false);
  const [theme, setTheme] = useState<PublicTheme>(getSessionTheme);
  const [chatOpen, setChatOpen] = useState(false);

  useLayoutEffect(() => {
    setReadyTransitionId(transitionId);
  }, [currentPath, transitionId]);

  useEffect(() => {
    if (currentPath.startsWith('/admin') || isCmsPreview) setChatOpen(false);
  }, [currentPath, isCmsPreview]);

  useLayoutEffect(() => {
    if (transitionActive || !focusAfterTransitionRef.current) return;
    focusAfterTransitionRef.current = false;
    document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
  }, [transitionActive]);

  useLayoutEffect(() => {
    const target = pendingNavigationHashRef.current;
    if (!target) return;
    pendingNavigationHashRef.current = '';
    window.requestAnimationFrame(() => {
      const element = document.getElementById(target);
      element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (element instanceof HTMLElement) element.focus({ preventScroll: true });
    });
  }, [currentPath]);

  useEffect(() => {
    captureFirstTouchCampaign(window.location.search);
  }, []);

  useLayoutEffect(() => {
    if (!transitionActive) return;
    const root = document.documentElement;
    const body = document.body;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousScrollbarGutter = root.style.scrollbarGutter;
    root.style.overflow = 'hidden';
    root.style.scrollbarGutter = 'stable';
    body.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previousRootOverflow;
      root.style.scrollbarGutter = previousScrollbarGutter;
      body.style.overflow = previousBodyOverflow;
    };
  }, [transitionActive]);

  const completeTransition = useCallback(() => {
    focusAfterTransitionRef.current = true;
  }, []);

  useEffect(() => {
    let active = true;
    void fetchBlogPosts().then((posts) => {
      if (active) setBlogPosts(posts);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isCmsPreview) return;
    if (window.parent === window) {
      setSiteContentLoaded(true);
      return;
    }
    const receivePreviewContent = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (!event.data || typeof event.data !== 'object') return;
      const message = event.data as { type?: unknown; content?: unknown };
      if (message.type !== 'ng-cms-preview-content' || !message.content ||
        typeof message.content !== 'object') return;
      setSiteContent(message.content as SiteContent);
      setSiteContentLoaded(true);
    };
    window.addEventListener('message', receivePreviewContent);
    window.parent.postMessage({ type: 'ng-cms-preview-ready' }, window.location.origin);
    return () => window.removeEventListener('message', receivePreviewContent);
  }, [isCmsPreview]);

  useEffect(() => {
    if (isCmsPreview) return;
    let active = true;
    fetch('/api/site-content')
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load page content (${response.status}).`);
        return await response.json() as { content?: SiteContent };
      })
      .then((data) => {
        if (!active) return;
        if (data.content) setSiteContent(data.content);
        setSiteContentLoaded(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('[NearGrow Ads] Public page content could not be loaded; using built-in defaults.', error);
        setSiteContentLoaded(true);
      });
    return () => { active = false; };
  }, [isCmsPreview]);

  useEffect(() => {
    const pageByPath = {
      '/': 'home',
      '/services': 'services',
      '/catalogue': 'catalogue',
      '/work': 'work',
      '/about': 'about',
      '/blog': 'blog',
      '/contact': 'contact',
    } as const;
    const normalizedPath = currentPath === '/' ? '/' : currentPath.replace(/\/+$/, '');
    const page = pageByPath[normalizedPath as keyof typeof pageByPath];
    const staticService = normalizedPath.startsWith('/services/')
      ? SERVICES.find((service) => service.slug === normalizedPath.slice('/services/'.length))
      : undefined;
    const article = normalizedPath.startsWith('/blog/')
      ? blogPosts.find((post) => post.slug === normalizedPath.slice('/blog/'.length))
      : undefined;
    const defaultSeo = page ? siteContent.seo[page] : undefined;
    const isAdminRoute = normalizedPath.startsWith('/admin');
    const staticRouteSeo: Record<string, { title: string; description: string }> = {
      '/get-started': {
        title: 'Get Started | NearGrow Ads',
        description: 'Start a conversation with NearGrow Ads about your business goals.',
      },
      '/privacy-policy': {
        title: 'Privacy Policy | NearGrow Ads',
        description: 'NearGrow Ads website information.',
      },
      '/terms-and-conditions': {
        title: 'Terms and Conditions | NearGrow Ads',
        description: 'NearGrow Ads website information.',
      },
      '/thank-you': {
        title: 'Thank You | NearGrow Ads',
        description: 'Thank you for contacting NearGrow Ads.',
      },
    };
    const specialRouteSeo = isAdminRoute
      ? { title: 'Admin | NearGrow Ads', description: 'Administrative workspace.' }
      : staticRouteSeo[normalizedPath];
    const seo = defaultSeo ?? {
      title: article
        ? article.metaTitle || article.title
        : specialRouteSeo?.title || `${staticService?.title || (normalizedPath.startsWith('/services/') ? 'Services' : 'Page Not Found')} | NearGrow Ads`,
      description: article?.metaDescription || article?.excerpt || specialRouteSeo?.description ||
        staticService?.shortDescription || (normalizedPath.startsWith('/services/')
          ? 'Explore NearGrow Ads services.'
          : 'The requested page is not available.'),
      ogImage: '',
    };
    const previousTitle = document.title;
    document.title = seo.title;
    const siteOrigin = import.meta.env.VITE_SITE_URL || window.location.origin;
    const canonicalUrl = new URL(normalizedPath, `${siteOrigin.replace(/\/+$/, '')}/`).href;
    const socialImage = defaultSeo
      ? publicMedia(siteContent.media, `seo.${page}.ogImage`, defaultSeo.ogImage, theme).url
      : `${siteOrigin.replace(/\/+$/, '')}/neargrow-mark.jpg`;
    const metaEntries = [
      ['name', 'description', seo.description],
      ['property', 'og:title', seo.title],
      ['property', 'og:description', seo.description],
      ['property', 'og:image', new URL(socialImage, `${siteOrigin.replace(/\/+$/, '')}/`).href],
      ['property', 'og:url', canonicalUrl],
      ['property', 'og:type', article ? 'article' : 'website'],
      ['property', 'og:site_name', 'NearGrow Ads'],
      ['name', 'twitter:card', 'summary_large_image'],
      ['name', 'twitter:title', seo.title],
      ['name', 'twitter:description', seo.description],
      ['name', 'twitter:image', new URL(socialImage, `${siteOrigin.replace(/\/+$/, '')}/`).href],
      ['name', 'robots', currentPath.startsWith('/admin') || currentPath === '/thank-you' || isCmsPreview ? 'noindex, nofollow' : 'index, follow'],
    ] as const;
    const previousMeta = metaEntries.map(([attribute, name, content]) => {
      const selector = `meta[${attribute}="${name}"]`;
      let element = document.head.querySelector<HTMLMetaElement>(selector);
      const created = !element;
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attribute, name);
        document.head.append(element);
      }
      const previousContent = element.getAttribute('content');
      element.setAttribute('content', content);
      return { element, created, previousContent };
    });
    const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    let createdCanonical = false;
    const canonicalElement = canonical ?? document.head.appendChild(document.createElement('link'));
    if (!canonical) {
      canonicalElement.rel = 'canonical';
      createdCanonical = true;
    }
    const previousCanonical = canonicalElement.href;
    canonicalElement.href = canonicalUrl;

    return () => {
      document.title = previousTitle;
      previousMeta.forEach(({ element, created, previousContent }) => {
        if (created) element.remove();
        else if (previousContent === null) element.removeAttribute('content');
        else element.setAttribute('content', previousContent);
      });
      if (createdCanonical) canonicalElement.remove();
      else if (previousCanonical) canonicalElement.href = previousCanonical;
    };
  }, [blogPosts, currentPath, isCmsPreview, siteContent.media, siteContent.seo, theme]);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.sessionStorage.setItem('neargrow-theme', theme);
    } catch {
      // The selected theme remains active for this session if storage is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.home = currentPath === '/' ? 'true' : 'false';
  }, [currentPath]);

  // Handle browser back and forward buttons
  useEffect(() => {
    const handlePopState = () => {
      const nextPath = window.location.pathname || '/';
      if (nextPath === currentPath) return;
      setTransitionId((current) => current + 1);
      setCurrentPath(nextPath);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [currentPath]);

  useEffect(() => {
    const main = document.querySelector('main');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!main || prefersReducedMotion || !('IntersectionObserver' in window)) return;

    const revealTargets = Array.from(
      main.querySelectorAll<HTMLElement>('section, section .grid > .rounded-2xl, section .grid > article, section .grid > button'),
    );
    const root = document.documentElement;
    revealTargets.forEach((target, index) => {
      target.classList.add('ng-reveal');
      target.style.setProperty('--ng-reveal-delay', `${(index % 5) * 55}ms`);
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('ng-revealed');
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -32px 0px' },
    );

    revealTargets.forEach((target) => observer.observe(target));
    root.classList.add('ng-motion-ready');
    const revealFallback = window.setTimeout(() => {
      revealTargets.forEach((target) => target.classList.add('ng-revealed'));
      observer.disconnect();
    }, 2500);

    return () => {
      window.clearTimeout(revealFallback);
      observer.disconnect();
      root.classList.remove('ng-motion-ready');
      revealTargets.forEach((target) => {
        target.classList.remove('ng-reveal', 'ng-revealed');
        target.style.removeProperty('--ng-reveal-delay');
      });
    };
  }, [currentPath]);

  const navigate = useCallback((path: string) => {
    const destination = new URL(path, window.location.href);
    if (destination.origin !== window.location.origin) {
      window.location.assign(destination.href);
      return;
    }
    if (isCmsPreview) destination.searchParams.set('ng-cms-preview', '1');
    const nextPath = destination.pathname || '/';
    const historyPath = `${nextPath}${destination.search}${destination.hash}`;
    const pathChanged = nextPath !== (window.location.pathname || '/');
    if (!pathChanged && !destination.hash) {
      window.history.pushState({}, '', historyPath);
      return;
    }
    window.history.pushState({}, '', historyPath);
    pendingNavigationHashRef.current = destination.hash.slice(1);
    if (pathChanged && !destination.hash) window.scrollTo({ top: 0, behavior: 'smooth' });
    setTransitionId((current) => current + 1);
    setCurrentPath(nextPath);
  }, [isCmsPreview]);

  useEffect(() => {
    const handleInternalLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;

      const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (destination.pathname === window.location.pathname) return;

      event.preventDefault();
      navigate(`${destination.pathname}${destination.search}${destination.hash}`);
    };

    document.addEventListener('click', handleInternalLink);
    return () => document.removeEventListener('click', handleInternalLink);
  }, [navigate]);

  const adminThemeControls = {
    theme,
    onToggleTheme: () => setTheme((current) => current === 'dark' ? 'light' : 'dark'),
  };

  // Route matching logic
  const renderCurrentView = () => {
    if (currentPath === '/admin/accept-invite') {
      const callbackRoute = readAdminAuthRoute(window.location.search);
      return <AdminAuthAction
        mode={callbackRoute.mode}
        temporaryCredential={callbackRoute.temporaryCredential}
        invitationSetup
      />;
    }
    if (currentPath === '/admin/password-reset') {
      return <AdminAuthAction mode="recovery" />;
    }
    if (currentPath === '/admin' || currentPath === '/admin/login') {
      return <AdminPage {...adminThemeControls} />;
    }
    if (currentPath === '/admin/blog' || currentPath === '/admin/blog/') {
      return <AdminPage {...adminThemeControls} section="blog" blogMode="list" onNavigate={navigate} />;
    }
    if (currentPath === '/admin/team' || currentPath === '/admin/team/') {
      return <AdminPage {...adminThemeControls} section="team" onNavigate={navigate} />;
    }
    if (currentPath === '/admin/leads' || currentPath === '/admin/leads/') {
      return <AdminPage {...adminThemeControls} section="leads" onNavigate={navigate} />;
    }
    if (currentPath === '/admin/categories' || currentPath === '/admin/categories/') {
      return <AdminPage {...adminThemeControls} section="categories" onNavigate={navigate} />;
    }
    if (currentPath === '/admin/content' || currentPath === '/admin/content/') {
      return <AdminPage {...adminThemeControls} section="content" onNavigate={navigate} onSiteContentSaved={setSiteContent} />;
    }
    if (currentPath === '/admin/mascot' || currentPath === '/admin/mascot/') {
      return <AdminPage {...adminThemeControls} section="mascot" onNavigate={navigate} />;
    }
    if (currentPath === '/admin/case-studies' || currentPath === '/admin/case-studies/') {
      return <AdminPage {...adminThemeControls} section="caseStudies" onNavigate={navigate} />;
    }
    if (currentPath === '/admin/services' || currentPath === '/admin/services/') {
      return <AdminPage {...adminThemeControls} section="servicesManagement" onNavigate={navigate} />;
    }
    if (currentPath === '/admin/settings' || currentPath === '/admin/settings/') {
      return <AdminPage {...adminThemeControls} section="settings" onNavigate={navigate} />;
    }
    if (currentPath === '/admin/security-monitoring' || currentPath === '/admin/security-monitoring/') {
      return <AdminPage {...adminThemeControls} section="securityMonitoring" onNavigate={navigate} />;
    }
    if (currentPath === '/admin/service-store' || currentPath === '/admin/service-store/') {
      return <AdminPage {...adminThemeControls} section="serviceStore" onNavigate={navigate} />;
    }
    if (currentPath === '/admin/blog/new' || currentPath.startsWith('/admin/blog/')) {
      return <AdminPage {...adminThemeControls} section="blog" blogMode="editor" isNewBlog={currentPath === '/admin/blog/new'} onNavigate={navigate} />;
    }

    // Exact routes
    if (currentPath === '/' || currentPath === '') {
      return <HomePage onNavigate={navigate} blogPosts={blogPosts} siteContent={siteContent} siteContentLoaded={siteContentLoaded} theme={theme} />;
    }
    if (currentPath === '/services') {
      return <ServicesIndexPage onNavigate={navigate} siteContent={siteContent} theme={theme} />;
    }
    if (currentPath === '/catalogue' || currentPath.startsWith('/catalogue/')) {
      const slug = currentPath.startsWith('/catalogue/') ? currentPath.slice('/catalogue/'.length) : undefined;
      return <CataloguePage slug={slug} onNavigate={navigate} siteContent={siteContent} />;
    }
    if (currentPath === '/about') {
      return <AboutPage onNavigate={navigate} siteContent={siteContent} />;
    }
    if (currentPath === '/work') {
      return <WorkPage onNavigate={navigate} siteContent={siteContent} theme={theme} />;
    }
    if (currentPath === '/blog') {
      return <BlogIndexPage onNavigate={navigate} posts={blogPosts} siteContent={siteContent} theme={theme} />;
    }
    if (currentPath === '/contact') {
      return <ContactPage onNavigate={navigate} siteContent={siteContent} />;
    }
    if (currentPath === '/get-started') {
      return <GetStartedPage onNavigate={navigate} siteContent={siteContent} />;
    }
    if (currentPath === '/privacy-policy') {
      return <PrivacyPolicy onNavigate={navigate} siteContent={siteContent} />;
    }
    if (currentPath === '/terms-and-conditions') {
      return <TermsPage onNavigate={navigate} siteContent={siteContent} />;
    }
    if (currentPath === '/thank-you') {
      return <ThankYouPage onNavigate={navigate} siteContent={siteContent} />;
    }

    // Dynamic service detail route: /services/[slug]
    if (currentPath.startsWith('/services/')) {
      const slug = currentPath.replace('/services/', '');
      const service = SERVICES.find((s) => s.slug === slug);
      if (service) {
        return <ServiceDetailPage service={service} onNavigate={navigate} siteContent={siteContent} theme={theme} />;
      }
      return <ManagedWebsiteServiceDetailPage slug={slug} onNavigate={navigate} theme={theme} />;
    }

    // Dynamic blog detail route: /blog/[slug]
    if (currentPath.startsWith('/blog/')) {
      const slug = currentPath.replace('/blog/', '');
      const post = blogPosts.find((p) => p.slug === slug);
      if (post) {
        return <BlogPostPage post={post} onNavigate={navigate} theme={theme} />;
      }
    }

    // 404 Not Found Page
    return (
      <div className="py-24 md:py-32 bg-[#F7F9F6] text-center px-4">
        <div className="max-w-md mx-auto p-8 bg-white border border-[#E5E9E4] rounded-3xl space-y-4 shadow-sm">
          <NearGrowMascot size="lg" mood="focused" interactive={true} />
          <h1 className="text-3xl font-extrabold text-[#171A17]">Page Not Found</h1>
          <p className="text-xs text-[#626A63] leading-relaxed">
            The page you are looking for does not exist or may have been moved.
          </p>
          <div className="pt-2">
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#3EA259] hover:bg-[#216F3D] text-white text-xs font-semibold rounded-xl transition-all shadow-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Return to Homepage
            </button>
          </div>
        </div>
      </div>
    );
  };

  const isAdminRoute = currentPath.startsWith('/admin');

  return (
    <>
      <PublicActivityTracker pathname={currentPath} enabled={!isCmsPreview} />
      <div
        className="min-h-screen flex flex-col bg-white text-[#171A17]"
        data-public-theme={isAdminRoute ? undefined : theme}
        inert={transitionActive}
        aria-hidden={transitionActive}
      >
        {isAdminRoute ? (
          <div className="flex-1" tabIndex={-1}>
            <React.Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-[#B8C7BC]" aria-busy="true">Loading admin workspace…</div>}>
              <RouteErrorBoundary key="admin">{renderCurrentView()}</RouteErrorBoundary>
            </React.Suspense>
          </div>
        ) : (
          <>
            <Header
              currentPath={currentPath}
              onNavigate={navigate}
              siteContent={siteContent}
              theme={theme}
              onToggleTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
            />
            <main className="flex-1" tabIndex={-1}>
              <React.Suspense fallback={<div className="min-h-[50vh]" aria-busy="true" />}>
                <RouteErrorBoundary key={currentPath}>{renderCurrentView()}</RouteErrorBoundary>
              </React.Suspense>
            </main>
            <Footer onNavigate={navigate} siteContent={siteContent} />
            <FloatingAssistant
              sizeSettings={normalizeMascotSettings(siteContent.mascotSettings)}
              chatOpen={chatOpen}
              onOpenChat={() => setChatOpen(true)}
            />
            {!isCmsPreview && (
              <ChatbotWidget
                siteContent={siteContent}
                siteContentLoaded={siteContentLoaded}
                blogPosts={blogPosts}
                onNavigate={navigate}
                isOpen={chatOpen}
                onOpen={() => setChatOpen(true)}
                onClose={() => setChatOpen(false)}
              />
            )}
          </>
        )}
      </div>
      {!isAdminRoute && !isCmsPreview && (
        <PageTransitionOverlay
          transitionId={transitionId}
          transitionDuration={transitionId === 1 ? FIRST_VISIT_TRANSITION_MS : INTERNAL_TRANSITION_MS}
          contentReady={readyTransitionId === transitionId}
          onActiveChange={setTransitionActive}
          onComplete={completeTransition}
        />
      )}
    </>
  );
}
