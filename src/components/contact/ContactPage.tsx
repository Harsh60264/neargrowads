import React from 'react';
import { ConsultationForm } from '../forms/ConsultationForm';
import { MapPin, Mail, MessageSquare, Clock, Phone, ShieldCheck, ArrowRight } from 'lucide-react';
import { DEFAULT_SITE_CONTENT, type SiteContent } from '../../data/siteContent';
import { HeroOrbitBackground } from '../ui/HeroOrbitBackground';
import { publicText } from '../../data/publicCopy';
import { getCtaDestination } from '../../data/publicLinks';

interface ContactPageProps {
  onNavigate: (path: string) => void;
  siteContent?: SiteContent;
}

export const ContactPage: React.FC<ContactPageProps> = ({ onNavigate, siteContent = DEFAULT_SITE_CONTENT }) => {
  const text = (key: string) => publicText(siteContent.copy, key);
  return (
    <div className="contact-page w-full bg-white">
      {/* Hero */}
      <section className="relative isolate overflow-hidden py-16 md:py-24 bg-[#F7F9F6] border-b border-[#E5E9E4]">
        <HeroOrbitBackground ambient />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl space-y-4">
            <div className="text-xs font-bold uppercase tracking-widest text-[#3EA259]">
              {siteContent.contactPage.eyebrow}
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold text-[#171A17] tracking-tight">
              {siteContent.contactPage.title}
            </h1>
            <p className="text-base sm:text-lg text-[#626A63] leading-relaxed">
              {siteContent.contactPage.description}
            </p>
          </div>
        </div>
      </section>

      {/* Main Grid: Direct Details + Form */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
            {/* Left Column: Direct Contact Details */}
            <div className="lg:col-span-5 space-y-8">
              <div>
                <h2 className="text-2xl font-bold text-[#171A17] mb-2">{text('contact.info.title')}</h2>
                <p className="text-xs text-[#626A63] leading-relaxed">
                  {text('contact.info.description')}
                </p>
              </div>

              <div className="space-y-4">
                {/* Channel 1: Phone */}
                <div className="p-5 bg-[#F7F9F6] border border-[#E5E9E4] rounded-2xl flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-[#EBF7EE] text-[#3EA259] flex items-center justify-center shrink-0">
                    <Phone className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#171A17]">{text('contact.phone.title')}</h3>
                    <p className="text-xs text-[#626A63] mt-0.5 mb-1">
                      {text('contact.phone.hours')}
                    </p>
                    <a
                      href={siteContent.footerSettings.phoneDestination}
                      className="text-base font-bold text-[#171A17] hover:text-[#3EA259] transition-colors"
                    >
                      {siteContent.footerSettings.phone}
                    </a>
                  </div>
                </div>

                {/* Channel 2: WhatsApp */}
                <div className="p-5 bg-[#F7F9F6] border border-[#E5E9E4] rounded-2xl flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-[#EBF7EE] text-[#3EA259] flex items-center justify-center shrink-0">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#171A17]">{text('contact.whatsapp.title')}</h3>
                    <p className="text-xs text-[#626A63] mt-0.5 mb-2">
                      {text('contact.whatsapp.description')}
                    </p>
                    <a
                      href={getCtaDestination(siteContent, 'contact.whatsapp', siteContent.footerSettings.whatsappDestination)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#3EA259] hover:bg-[#216F3D] text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5" /> {text('contact.whatsapp.cta')}
                    </a>
                  </div>
                </div>

                {/* Channel 3: Email */}
                <div className="p-5 bg-[#F7F9F6] border border-[#E5E9E4] rounded-2xl flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-[#EBF7EE] text-[#3EA259] flex items-center justify-center shrink-0">
                    <Mail className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#171A17]">{text('contact.email.title')}</h3>
                    <p className="text-xs text-[#626A63] mt-0.5 mb-1.5">
                      {text('contact.email.description')}
                    </p>
                    <div className="flex flex-col gap-1 text-xs font-semibold text-[#171A17]">
                      <a href={siteContent.footerSettings.emailDestination} className="hover:text-[#3EA259] transition-colors">
                        {siteContent.footerSettings.email}
                      </a>
                      <a href={siteContent.footerSettings.secondaryEmailDestination} className="text-[#626A63] hover:text-[#3EA259] transition-colors">
                        {siteContent.footerSettings.secondaryEmail}
                      </a>
                    </div>
                  </div>
                </div>

                {/* Channel 4: Office */}
                <div className="p-5 bg-[#F7F9F6] border border-[#E5E9E4] rounded-2xl flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-[#EBF7EE] text-[#3EA259] flex items-center justify-center shrink-0">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#171A17]">{text('contact.office.title')}</h3>
                    <p className="text-xs text-[#626A63] mt-0.5">
                      {text('contact.office.description')}
                    </p>
                    <a
                      href={siteContent.footerSettings.mapDestination}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-xs leading-relaxed text-[#3EA259] hover:underline"
                    >
                      {siteContent.footerSettings.location} · {text('contact.office.mapCta')}
                    </a>
                  </div>
                </div>
              </div>

              {/* Verified Social Media Channels */}
              <div className="p-5 bg-white border border-[#E5E9E4] rounded-2xl space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#171A17]">{text('contact.social.title')}</h4>
                <div className="flex flex-wrap gap-2">
                  {siteContent.footerSettings.socialLinks.map((link) => (
                    <a
                      key={link.id}
                      href={link.destination}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-[#F7F9F6] hover:bg-[#EBF7EE] text-xs font-medium text-[#171A17] hover:text-[#3EA259] rounded-lg border border-[#E5E9E4] transition-colors"
                    >
                      {link.label}{link.id === 'linkedin' ? ' /company/neargrowads' : ' @neargrowads'}
                    </a>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-white border border-[#E5E9E4] rounded-xl flex items-center gap-3 text-xs text-[#626A63]">
                <ShieldCheck className="w-5 h-5 text-[#3EA259] shrink-0" />
                <span>Zero spam · We never share your phone or email with third parties</span>
              </div>
            </div>

            {/* Right Column: Inquiry Form */}
            <div className="lg:col-span-7">
              <ConsultationForm submitLabel={siteContent.contactPage.primaryCta} siteContent={siteContent} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
