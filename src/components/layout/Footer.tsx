import React from 'react';
import { NearGrowLogo } from '../brand/NearGrowLogo';
import { Mail, MapPin, MessageSquare, ArrowUpRight, ShieldCheck, Phone, Clock } from 'lucide-react';
import { SERVICES } from '../../data/servicesData';
import { DEFAULT_SITE_CONTENT, type SiteContent } from '../../data/siteContent';
import { publicText } from '../../data/publicCopy';
import { followPublicDestination, getCtaDestination, isSafePublicDestination } from '../../data/publicLinks';

interface FooterProps {
  onNavigate: (path: string) => void;
  siteContent?: SiteContent;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate, siteContent = DEFAULT_SITE_CONTENT }) => {
  const text = (key: string) => publicText(siteContent.copy, key);
  const settings = siteContent.footerSettings;
  const navigateTo = (path: string) => followPublicDestination(path, onNavigate);
  const navigationDestination = (id: SiteContent['navigation'][number]['id'], fallback: string) => {
    const destination = siteContent.navigation.find((item) => item.id === id)?.destination;
    return destination && isSafePublicDestination(destination) ? destination : fallback;
  };
  return (
    <footer className="bg-[#171A17] text-white pt-16 pb-12 border-t border-neutral-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Brand Banner / Tagline Strip */}
        <div className="pb-12 border-b border-neutral-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <div className="text-xs uppercase tracking-widest text-[#3EA259] font-bold mb-1">
              {text('footer.tagline')}
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              {text('footer.heading')}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={settings.phoneDestination}
              className="px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold rounded-xl transition-all flex items-center gap-2 whitespace-nowrap border border-neutral-700"
            >
              <Phone className="w-3.5 h-3.5 text-[#3EA259]" /> {settings.phone}
            </a>
            <a
              href={settings.whatsappDestination}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2.5 bg-[#3EA259] hover:bg-[#216F3D] text-white text-xs font-semibold rounded-xl transition-all flex items-center gap-2 whitespace-nowrap shadow-sm"
            >
              <MessageSquare className="w-3.5 h-3.5" /> {text('footer.whatsapp')}
            </a>
          </div>
        </div>

        {/* Links Grid */}
        <div className="py-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10">
          {/* Column 1: Brand & Contact Info */}
          <div className="lg:col-span-2 space-y-4">
            <NearGrowLogo size="lg" variant="dark" />
            <p className="text-sm text-neutral-400 leading-relaxed max-w-sm">
              {text('footer.description')}
            </p>

            <div className="pt-2 flex flex-col gap-2.5 text-xs text-neutral-300">
              <div className="flex items-center gap-2.5">
                <Phone className="w-4 h-4 text-[#3EA259] shrink-0" />
                <a href={settings.phoneDestination} className="hover:text-white font-medium transition-colors">
                  {settings.phone}
                </a>
              </div>
              <div className="flex items-center gap-2.5">
                <Mail className="w-4 h-4 text-[#3EA259] shrink-0" />
                <a href={settings.emailDestination} className="hover:text-white font-medium transition-colors">
                  {settings.email}
                </a>
              </div>
              <div className="flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-[#3EA259] shrink-0" />
                <span>{settings.hours}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <MapPin className="w-4 h-4 text-[#3EA259] shrink-0" />
                <span>{settings.location}</span>
              </div>
            </div>

            {/* Verified Social Media Links */}
            <div className="pt-3 flex items-center gap-3">
              {settings.socialLinks.map((link) => (
                <a key={link.id} href={link.destination} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-300 hover:text-white rounded-lg transition-colors">
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          {/* Column 2: Core Services */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white mb-4">{text('footer.coreServices')}</h4>
            <ul className="space-y-2.5 text-xs text-neutral-400">
              {SERVICES.slice(0, 4).map((s) => (
                <li key={s.slug}>
                  <button
                    onClick={() => navigateTo(`/services/${s.slug}`)}
                    className="hover:text-white transition-colors text-left"
                  >
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 3: Tech & Strategy */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white mb-4">{text('footer.techStrategy')}</h4>
            <ul className="space-y-2.5 text-xs text-neutral-400">
              {SERVICES.slice(4).map((s) => (
                <li key={s.slug}>
                  <button
                    onClick={() => navigateTo(`/services/${s.slug}`)}
                    className="hover:text-white transition-colors text-left"
                  >
                    {s.title}
                  </button>
                </li>
              ))}
              <li>
                <button
                  onClick={() => navigateTo(navigationDestination('services', '/services'))}
                  className="text-[#3EA259] hover:underline flex items-center gap-1 font-medium pt-1"
                >
                  {text('footer.viewAll')} <ArrowUpRight className="w-3 h-3" />
                </button>
              </li>
            </ul>
          </div>

          {/* Column 4: Agency & Insights */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white mb-4">{text('footer.agency')}</h4>
            <ul className="space-y-2.5 text-xs text-neutral-400">
              <li>
                <button onClick={() => navigateTo(navigationDestination('about', '/about'))} className="hover:text-white transition-colors">
                  {text('footer.about')}
                </button>
              </li>
              <li>
                <button onClick={() => navigateTo(navigationDestination('work', '/work'))} className="hover:text-white transition-colors">
                  {text('footer.work')}
                </button>
              </li>
              <li>
                <button onClick={() => navigateTo(navigationDestination('blog', '/blog'))} className="hover:text-white transition-colors">
                  {text('footer.blog')}
                </button>
              </li>
              <li>
                <button onClick={() => navigateTo(navigationDestination('contact', '/contact'))} className="hover:text-white transition-colors">
                  {text('footer.contact')}
                </button>
              </li>
              <li>
                <button onClick={() => navigateTo(getCtaDestination(siteContent, 'header.consultation', '/get-started'))} className="hover:text-white transition-colors">
                  {text('footer.consultation')}
                </button>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Legal / Disclaimer Bar */}
        <div className="pt-8 border-t border-neutral-800 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-neutral-500">
          <div className="flex flex-wrap items-center gap-4">
            <span>© {new Date().getFullYear()} {text('footer.copyright')}</span>
            <span>·</span>
            <button onClick={() => onNavigate('/privacy-policy')} className="hover:text-neutral-300 transition-colors">
              {text('footer.privacy')}
            </button>
            <span>·</span>
            <button
              onClick={() => onNavigate('/terms-and-conditions')}
              className="hover:text-neutral-300 transition-colors"
            >
              {text('footer.terms')}
            </button>
          </div>

          <div className="flex items-center gap-2 text-neutral-400">
            <ShieldCheck className="w-4 h-4 text-[#3EA259]" />
            <span>{text('footer.disclaimer')}</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
