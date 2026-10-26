import React, { useState, useRef, useEffect } from 'react';
import { NearGrowLogo } from '../brand/NearGrowLogo';
import { ChevronDown, Menu, X, ArrowUpRight, MessageSquare, Moon, Sun } from 'lucide-react';
import { SERVICES } from '../../data/servicesData';
import { DEFAULT_SITE_CONTENT, type SiteContent } from '../../data/siteContent';
import { publicText } from '../../data/publicCopy';
import { getCtaDestination, isSafePublicDestination } from '../../data/publicLinks';

interface HeaderProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  siteContent?: SiteContent;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentPath,
  onNavigate,
  siteContent = DEFAULT_SITE_CONTENT,
  theme,
  onToggleTheme,
}) => {
  const text = (key: string) => publicText(siteContent.copy, key);
  const navItem = (id: SiteContent['navigation'][number]['id']) =>
    siteContent.navigation.find((item) => item.id === id) ?? DEFAULT_SITE_CONTENT.navigation.find((item) => item.id === id)!;
  const navOrder = (id: SiteContent['navigation'][number]['id']) => siteContent.navigation.findIndex((item) => item.id === id);
  const navIsActive = (id: SiteContent['navigation'][number]['id']) => {
    const destination = navItem(id).destination;
    if (!destination.startsWith('/')) return false;
    const destinationPath = destination.replace(/\/+$/, '') || '/';
    const routePath = currentPath.replace(/\/+$/, '') || '/';
    return routePath === destinationPath ||
      (destinationPath !== '/' && routePath.startsWith(`${destinationPath}/`));
  };
  const [servicesOpen, setServicesOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setServicesOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        setServicesOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [currentPath]);

  const handleLinkClick = (path: string) => {
    setServicesOpen(false);
    setMobileMenuOpen(false);
    onNavigate(path);
  };
  const handlePublicDestination = (destination: string) => {
    if (!isSafePublicDestination(destination)) return;
    if (destination.startsWith('/')) handleLinkClick(destination);
    else window.location.assign(destination);
  };

  return (
    <header className="sticky top-0 z-40 shrink-0 bg-white/95 backdrop-blur-md border-b border-[#E5E9E4] transition-colors">
      <div className="mx-auto flex h-[72px] min-h-[72px] max-w-7xl items-center justify-between gap-2 px-4 sm:px-6 lg:gap-8 lg:px-8">
        {/* Zone 1: Brand Wordmark (Single text element / logo mark, no tags) */}
        <div className="flex items-center shrink-0">
          <button
            onClick={() => handleLinkClick('/')}
            className="flex min-h-11 items-center text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3EA259] rounded-lg"
            aria-label="NearGrow Ads Home"
          >
            <NearGrowLogo size="md" variant={theme === 'dark' ? 'dark' : 'light'} />
          </button>
        </div>

        {/* Zone 2: Navigation Links (Clean single-line text links with hover underline) */}
        <nav className="hidden xl:flex items-center gap-7 text-sm font-medium text-[#626A63]">
          <button
            style={{ order: navOrder('home') }}
            onClick={() => handlePublicDestination(navItem('home').destination)}
            aria-current={navIsActive('home') ? 'page' : undefined}
            className={`whitespace-nowrap transition-colors hover:text-[#70bf56] ${
              navIsActive('home') ? 'text-[#171A17]' : ''
            }`}
          >
            {navItem('home').label}
          </button>

          {/* Services with accessible dropdown */}
          <div className="relative" ref={dropdownRef} style={{ order: navOrder('services') }}>
            <button
              onClick={() => setServicesOpen(!servicesOpen)}
              onMouseEnter={() => setServicesOpen(true)}
              aria-current={navIsActive('services') ? 'page' : undefined}
              className={`flex items-center gap-1.5 whitespace-nowrap transition-colors hover:text-[#70bf56] ${
                navIsActive('services') ? 'text-[#171A17]' : ''
              }`}
              aria-expanded={servicesOpen}
            >
              <span>{navItem('services').label}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  servicesOpen ? 'rotate-180 text-[#3EA259]' : ''
                }`}
              />
            </button>

            {/* Dropdown Menu */}
            {servicesOpen && (
              <div
                onMouseLeave={() => setServicesOpen(false)}
                className="absolute top-full -left-12 mt-2 w-96 bg-white border border-[#E5E9E4] rounded-2xl shadow-xl p-3 z-50 animate-in fade-in slide-in-from-top-1 duration-150"
              >
                <div className="px-3 py-2 border-b border-[#E5E9E4] flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#171A17]">{text('header.servicesDropdown')}</span>
                  <button
                    onClick={() => handlePublicDestination(navItem('services').destination)}
                    className="text-xs text-[#3EA259] hover:underline flex items-center gap-1 font-medium"
                  >
                    {text('header.viewAllServices')} <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="py-1 grid grid-cols-1 gap-1 max-h-[380px] overflow-y-auto">
                  {SERVICES.map((s) => (
                    <button
                      key={s.slug}
                      onClick={() => handleLinkClick(`/services/${s.slug}`)}
                      className="w-full text-left p-2.5 rounded-xl hover:bg-[#F7F9F6] transition-colors flex items-start gap-3 group"
                    >
                      <div className="w-2 h-2 rounded-full bg-[#3EA259] mt-1.5 group-hover:scale-125 transition-transform" />
                      <div>
                        <div className="text-xs font-semibold text-[#171A17] group-hover:text-[#3EA259] transition-colors">
                          {s.title}
                        </div>
                        <div className="text-[11px] text-[#626A63] line-clamp-1 mt-0.5">{s.shortDescription}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            style={{ order: navOrder('catalogue') }}
            onClick={() => handlePublicDestination(navItem('catalogue').destination)}
            aria-current={navIsActive('catalogue') ? 'page' : undefined}
            className={`whitespace-nowrap transition-colors hover:text-[#70bf56] ${
              navIsActive('catalogue') ? 'text-[#171A17]' : ''
            }`}
          >
            {navItem('catalogue').label}
          </button>

          <button
            style={{ order: navOrder('work') }}
            onClick={() => handlePublicDestination(navItem('work').destination)}
            aria-current={navIsActive('work') ? 'page' : undefined}
            className={`whitespace-nowrap transition-colors hover:text-[#70bf56] ${
              navIsActive('work') ? 'text-[#171A17]' : ''
            }`}
          >
            {navItem('work').label}
          </button>

          <button
            style={{ order: navOrder('about') }}
            onClick={() => handlePublicDestination(navItem('about').destination)}
            aria-current={navIsActive('about') ? 'page' : undefined}
            className={`whitespace-nowrap transition-colors hover:text-[#70bf56] ${
              navIsActive('about') ? 'text-[#171A17]' : ''
            }`}
          >
            {navItem('about').label}
          </button>

          <button
            style={{ order: navOrder('blog') }}
            onClick={() => handlePublicDestination(navItem('blog').destination)}
            aria-current={navIsActive('blog') ? 'page' : undefined}
            className={`whitespace-nowrap transition-colors hover:text-[#70bf56] ${
              navIsActive('blog') ? 'text-[#171A17]' : ''
            }`}
          >
            {navItem('blog').label}
          </button>

          <button
            style={{ order: navOrder('contact') }}
            onClick={() => handlePublicDestination(navItem('contact').destination)}
            aria-current={navIsActive('contact') ? 'page' : undefined}
            className={`whitespace-nowrap transition-colors hover:text-[#70bf56] ${
              navIsActive('contact') ? 'text-[#171A17]' : ''
            }`}
          >
            {navItem('contact').label}
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action (Single CTA button) */}
        <div className="hidden xl:flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onToggleTheme}
            className="grid h-9 w-9 place-items-center rounded-lg text-[#626A63] transition-colors hover:bg-[#F7F9F6] hover:text-[#23734B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#23734B]"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            aria-pressed={theme === 'light'}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
          </button>
          <a
            href={getCtaDestination(siteContent, 'header.whatsapp', DEFAULT_SITE_CONTENT.ctaDestinations['header.whatsapp'])}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-[#626A63] hover:text-[#3EA259] transition-colors rounded-lg hover:bg-[#F7F9F6]"
            aria-label={text('header.chat')}
            title="Chat on WhatsApp (+91 92898 10149)"
          >
            <MessageSquare className="w-4 h-4" />
          </a>
          <button
            onClick={() => handlePublicDestination(getCtaDestination(siteContent, 'header.consultation', '/get-started'))}
            className="px-4 py-2.5 text-xs font-semibold text-white bg-[#3EA259] hover:bg-[#216F3D] active:scale-[0.98] rounded-xl transition-all shadow-sm whitespace-nowrap shrink-0"
          >
            {text('header.consultation')}
          </button>
        </div>

        {/* Mobile menu trigger */}
        <div className="flex items-center gap-1.5 xl:hidden">
          <button
            type="button"
            onClick={onToggleTheme}
            className="grid h-10 w-10 place-items-center rounded-lg text-[#626A63] transition-colors hover:bg-[#F7F9F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#23734B]"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            aria-pressed={theme === 'light'}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="grid h-11 w-11 place-items-center rounded-lg text-[#171A17] transition-colors hover:bg-[#F7F9F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#23734B]"
            aria-label={text('header.mobileMenu')}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation-drawer"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <nav id="mobile-navigation-drawer" aria-label="Mobile navigation" className="xl:hidden max-h-[calc(100dvh-4.5rem)] overscroll-contain overflow-y-auto bg-white border-b border-[#E5E9E4] px-4 pt-3 pb-6 space-y-3 animate-in fade-in duration-200">
          <div className="flex flex-wrap gap-2 pb-3 border-b border-[#E5E9E4]">
            <button
              style={{ order: navOrder('home'), width: 'calc(50% - 0.25rem)' }}
              onClick={() => handlePublicDestination(navItem('home').destination)}
              aria-current={navIsActive('home') ? 'page' : undefined}
              className={`min-h-11 p-2.5 rounded-lg text-left text-sm font-medium ${
                navIsActive('home') ? 'bg-[#EBF7EE] text-[#216F3D] font-semibold' : 'text-[#626A63] bg-[#F7F9F6]'
              }`}
            >
              {navItem('home').label}
            </button>
            <button
              style={{ order: navOrder('services'), width: 'calc(50% - 0.25rem)' }}
              onClick={() => handlePublicDestination(navItem('services').destination)}
              aria-current={navIsActive('services') ? 'page' : undefined}
              className={`min-h-11 p-2.5 rounded-lg text-left text-sm font-medium ${
                navIsActive('services') ? 'bg-[#EBF7EE] text-[#216F3D] font-semibold' : 'text-[#626A63] bg-[#F7F9F6]'
              }`}
            >
              {navItem('services').label}
            </button>
            <button
              style={{ order: navOrder('catalogue'), width: 'calc(50% - 0.25rem)' }}
              onClick={() => handlePublicDestination(navItem('catalogue').destination)}
              aria-current={navIsActive('catalogue') ? 'page' : undefined}
              className={`min-h-11 p-2.5 rounded-lg text-left text-sm font-medium ${
                navIsActive('catalogue') ? 'bg-[#EBF7EE] text-[#216F3D] font-semibold' : 'text-[#626A63] bg-[#F7F9F6]'
              }`}
            >
              {navItem('catalogue').label}
            </button>
            <button
              style={{ order: navOrder('work'), width: 'calc(50% - 0.25rem)' }}
              onClick={() => handlePublicDestination(navItem('work').destination)}
              aria-current={navIsActive('work') ? 'page' : undefined}
              className={`min-h-11 p-2.5 rounded-lg text-left text-sm font-medium ${
                navIsActive('work') ? 'bg-[#EBF7EE] text-[#216F3D] font-semibold' : 'text-[#626A63] bg-[#F7F9F6]'
              }`}
            >
              {navItem('work').label}
            </button>
            <button
              style={{ order: navOrder('about'), width: 'calc(50% - 0.25rem)' }}
              onClick={() => handlePublicDestination(navItem('about').destination)}
              aria-current={navIsActive('about') ? 'page' : undefined}
              className={`min-h-11 p-2.5 rounded-lg text-left text-sm font-medium ${
                navIsActive('about') ? 'bg-[#EBF7EE] text-[#216F3D] font-semibold' : 'text-[#626A63] bg-[#F7F9F6]'
              }`}
            >
              {navItem('about').label}
            </button>
            <button
              style={{ order: navOrder('blog'), width: 'calc(50% - 0.25rem)' }}
              onClick={() => handlePublicDestination(navItem('blog').destination)}
              aria-current={navIsActive('blog') ? 'page' : undefined}
              className={`min-h-11 p-2.5 rounded-lg text-left text-sm font-medium ${
                navIsActive('blog') ? 'bg-[#EBF7EE] text-[#216F3D] font-semibold' : 'text-[#626A63] bg-[#F7F9F6]'
              }`}
            >
              {navItem('blog').label}
            </button>
            <button
              style={{ order: navOrder('contact'), width: 'calc(50% - 0.25rem)' }}
              onClick={() => handlePublicDestination(navItem('contact').destination)}
              aria-current={navIsActive('contact') ? 'page' : undefined}
              className={`min-h-11 p-2.5 rounded-lg text-left text-sm font-medium ${
                navIsActive('contact') ? 'bg-[#EBF7EE] text-[#216F3D] font-semibold' : 'text-[#626A63] bg-[#F7F9F6]'
              }`}
            >
              {navItem('contact').label}
            </button>
          </div>

          <div>
            <div className="text-xs font-semibold text-[#171A17] uppercase tracking-wider mb-2">{text('header.servicesDropdown')}</div>
            <div className="space-y-1">
              {SERVICES.slice(0, 4).map((s) => (
                <button
                  key={s.slug}
                  onClick={() => handleLinkClick(`/services/${s.slug}`)}
                  className="min-h-11 w-full text-left py-1.5 px-2 text-xs text-[#626A63] hover:text-[#3EA259] hover:bg-[#F7F9F6] rounded flex items-center justify-between"
                >
                  <span>{s.title}</span>
                  <ArrowUpRight className="w-3 h-3 text-[#CBD5E1]" />
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 flex flex-col gap-2">
            <button
              onClick={() => handlePublicDestination(getCtaDestination(siteContent, 'header.consultation', '/get-started'))}
              className="w-full py-3 text-center text-xs font-semibold text-white bg-[#3EA259] rounded-xl"
            >
              {text('header.consultation')}
            </button>
            <a
              href={getCtaDestination(siteContent, 'header.whatsapp', DEFAULT_SITE_CONTENT.ctaDestinations['header.whatsapp'])}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2.5 text-center text-xs font-semibold text-[#216F3D] bg-[#EBF7EE] rounded-xl flex items-center justify-center gap-2"
            >
              <MessageSquare className="w-4 h-4" /> {text('header.chat')}
            </a>
          </div>
        </nav>
      )}
    </header>
  );
};
