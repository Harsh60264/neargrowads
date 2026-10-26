import React from 'react';
import { ArrowRight, CheckCircle2, ShieldCheck, Users, Target, HeartHandshake, MapPin } from 'lucide-react';
import { NearGrowMascot } from '../mascot/NearGrowMascot';
import { LeadershipTeamSection } from './LeadershipTeamSection';
import { DEFAULT_SITE_CONTENT, type SiteContent } from '../../data/siteContent';
import { HeroOrbitBackground } from '../ui/HeroOrbitBackground';
import { publicText } from '../../data/publicCopy';
import { followPublicDestination, getCtaDestination } from '../../data/publicLinks';

interface AboutPageProps {
  onNavigate: (path: string) => void;
  siteContent?: SiteContent;
}

export const AboutPage: React.FC<AboutPageProps> = ({ onNavigate, siteContent = DEFAULT_SITE_CONTENT }) => {
  const text = (key: string) => publicText(siteContent.copy, key);
  return (
    <div className="about-page w-full bg-white">
      {/* Hero */}
      <section className="relative isolate overflow-hidden py-16 md:py-24 bg-[#F7F9F6] border-b border-[#E5E9E4]">
        <HeroOrbitBackground ambient />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl space-y-4">
            <div className="text-xs font-bold uppercase tracking-widest text-[#3EA259]">
              {siteContent.aboutPage.eyebrow}
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold text-[#171A17] tracking-tight">
              {siteContent.aboutPage.title}
            </h1>
            <p className="text-base sm:text-lg text-[#626A63] leading-relaxed">
              {siteContent.aboutPage.description}
            </p>
          </div>
        </div>
      </section>

      {/* Brand Philosophy: PEOPLE · IDEAS · GROWTH */}
      <section className="about-philosophy-section relative isolate overflow-hidden border-b border-white/10 bg-[#0B1014] py-20 text-white">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_12%_18%,rgba(103,216,183,0.10),transparent_38%),radial-gradient(ellipse_at_90%_82%,rgba(62,162,89,0.10),transparent_42%)]" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-6 space-y-6">
              <div className="text-xs font-bold uppercase tracking-wider text-[#67D8B7]">
                {text('about.philosophy.eyebrow')}
              </div>
              <h2 className="text-3xl font-extrabold text-white tracking-tight">
                {text('about.philosophy.title')}
              </h2>
              <p className="text-sm text-white/65 leading-relaxed">
                {text('about.philosophy.intro')}
              </p>
              <p className="text-sm text-white/55 leading-relaxed">
                {text('about.philosophy.detail')}
              </p>

              <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-[#101A25]/90 p-4 shadow-[0_12px_32px_rgba(0,0,0,0.16)] transition-colors hover:border-[#67D8B7]/30">
                  <h3 className="text-sm font-bold text-white">{text('about.philosophy.peopleTitle')}</h3>
                  <p className="text-xs text-white/60 leading-relaxed">
                    {text('about.philosophy.peopleBody')}
                  </p>
                </div>

                <div className="rounded-xl border border-white/10 bg-[#101A25]/90 p-4 shadow-[0_12px_32px_rgba(0,0,0,0.16)] transition-colors hover:border-[#67D8B7]/30">
                  <h3 className="text-sm font-bold text-white">{text('about.philosophy.ideasTitle')}</h3>
                  <p className="text-xs text-white/60 leading-relaxed">
                    {text('about.philosophy.ideasBody')}
                  </p>
                </div>

                <div className="rounded-xl border border-white/10 bg-[#101A25]/90 p-4 shadow-[0_12px_32px_rgba(0,0,0,0.16)] transition-colors hover:border-[#67D8B7]/30">
                  <h3 className="text-sm font-bold text-white">{text('about.philosophy.growthTitle')}</h3>
                  <p className="text-xs text-white/60 leading-relaxed">
                    {text('about.philosophy.growthBody')}
                  </p>
                </div>
              </div>
            </div>

            <div className="relative isolate overflow-hidden lg:col-span-6 flex flex-col items-center justify-center rounded-3xl border border-[#67D8B7]/20 bg-[#101A25] p-8 shadow-[0_24px_70px_rgba(0,0,0,0.24),0_0_40px_rgba(103,216,183,0.05)]">
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_35%,rgba(103,216,183,0.12),transparent_55%)]" />
              <NearGrowMascot size="lg" mood="happy" interactive={true} />
              <div className="text-center mt-6 space-y-1 max-w-sm">
                <div className="text-xs font-bold uppercase tracking-wider text-[#67D8B7]">
                  {text('about.identity.eyebrow')}
                </div>
                <h3 className="text-lg font-bold text-white">{text('about.identity.title')}</h3>
                <p className="text-xs text-white/60">
                  {text('about.identity.description')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Code of Ethics / Agency Commitments */}
      <section className="about-commitments-section border-b border-white/10 bg-[#080E16] py-20 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-12">
            <div className="text-xs font-bold uppercase tracking-wider text-[#67D8B7] mb-1">{text('about.commitments.eyebrow')}</div>
            <h2 className="text-3xl font-extrabold text-white tracking-tight">
              {text('about.commitments.title')}
            </h2>
            <p className="text-sm text-white/60 mt-2">
              {text('about.commitments.description')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-3 rounded-2xl border border-white/10 bg-[#101A25] p-6 shadow-[0_16px_42px_rgba(0,0,0,0.18)] transition-all hover:-translate-y-1 hover:border-[#67D8B7]/30 hover:shadow-[0_20px_48px_rgba(0,0,0,0.28),0_0_24px_rgba(103,216,183,0.06)]">
              <ShieldCheck className="w-6 h-6 text-[#67D8B7]" />
              <h3 className="text-base font-bold text-white">{text('about.commitments.card1Title')}</h3>
              <p className="text-xs text-white/60 leading-relaxed">
                {text('about.commitments.card1Body')}
              </p>
            </div>

            <div className="space-y-3 rounded-2xl border border-white/10 bg-[#101A25] p-6 shadow-[0_16px_42px_rgba(0,0,0,0.18)] transition-all hover:-translate-y-1 hover:border-[#67D8B7]/30 hover:shadow-[0_20px_48px_rgba(0,0,0,0.28),0_0_24px_rgba(103,216,183,0.06)]">
              <CheckCircle2 className="w-6 h-6 text-[#67D8B7]" />
              <h3 className="text-base font-bold text-white">{text('about.commitments.card2Title')}</h3>
              <p className="text-xs text-white/60 leading-relaxed">
                {text('about.commitments.card2Body')}
              </p>
            </div>

            <div className="space-y-3 rounded-2xl border border-white/10 bg-[#101A25] p-6 shadow-[0_16px_42px_rgba(0,0,0,0.18)] transition-all hover:-translate-y-1 hover:border-[#67D8B7]/30 hover:shadow-[0_20px_48px_rgba(0,0,0,0.28),0_0_24px_rgba(103,216,183,0.06)]">
              <Users className="w-6 h-6 text-[#67D8B7]" />
              <h3 className="text-base font-bold text-white">{text('about.commitments.card3Title')}</h3>
              <p className="text-xs text-white/60 leading-relaxed">
                {text('about.commitments.card3Body')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Leadership & Team */}
      <LeadershipTeamSection />

      {/* CTA */}
      <section className="py-20 bg-white text-center">
        <div className="max-w-3xl mx-auto px-4 space-y-6">
          <h2 className="text-3xl font-extrabold text-[#171A17]">
            {text('about.closing.title')}
          </h2>
          <p className="text-sm text-[#626A63] max-w-xl mx-auto leading-relaxed">
            {text('about.closing.description')}
          </p>
          <div className="pt-2 flex flex-wrap justify-center gap-4">
            <button
              onClick={() => followPublicDestination(getCtaDestination(siteContent, 'about.primary', '/get-started'), onNavigate)}
              className="about-closing-primary-cta px-6 py-3 bg-[#3EA259] hover:bg-[#216F3D] text-white text-xs font-semibold rounded-xl transition-all shadow-sm flex items-center gap-2"
            >
              <span>{siteContent.aboutPage.primaryCta}</span>
              <ArrowRight className="w-4 h-4 text-current" />
            </button>
            <button
              onClick={() => followPublicDestination(getCtaDestination(siteContent, 'about.secondary', '/contact'), onNavigate)}
              className="px-6 py-3 bg-[#F7F9F6] hover:bg-[#E5E9E4] text-[#171A17] text-xs font-semibold rounded-xl border border-[#E5E9E4] transition-all"
            >
              {siteContent.aboutPage.secondaryCta}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
