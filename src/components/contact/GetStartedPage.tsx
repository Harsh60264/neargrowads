import React, { useRef, useState } from 'react';
import { ArrowRight, ArrowLeft, CheckCircle2, Store, Briefcase, Factory, ShoppingCart, HelpCircle } from 'lucide-react';
import { NearGrowMascot } from '../mascot/NearGrowMascot';
import { DEFAULT_SITE_CONTENT, type SiteContent } from '../../data/siteContent';
import { publicText } from '../../data/publicCopy';
import { getLeadTracking } from '../../data/leadTracking';

interface GetStartedPageProps {
  onNavigate: (path: string) => void;
  siteContent?: SiteContent;
}

export const GetStartedPage: React.FC<GetStartedPageProps> = ({ onNavigate, siteContent = DEFAULT_SITE_CONTENT }) => {
  const text = (key: string) => publicText(siteContent.copy, key);
  const [step, setStep] = useState(1);
  const [businessType, setBusinessType] = useState('');
  const [primaryGoal, setPrimaryGoal] = useState('');
  const [budget, setBudget] = useState('prefer-to-discuss');
  const [contactInfo, setContactInfo] = useState({
    name: '',
    businessName: '',
    email: '',
    phone: '',
    notes: '',
  });
  const [consent, setConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submissionId = useRef(window.crypto.randomUUID());

  const businessTypes = [
    { id: 'local-retail', label: 'Retail & Consumer Brand', icon: Store, desc: 'Single- or multi-location business growing discovery and sales' },
    { id: 'service-clinic', label: 'Service Practice / Medical Clinic', icon: Briefcase, desc: 'Healthcare, dental, legal, or home service practice' },
    { id: 'b2b-mfg', label: 'B2B / Industrial Supplier', icon: Factory, desc: 'Wholesale distributor or commercial contractor' },
    { id: 'ecommerce', label: 'D2C / Online Brand', icon: ShoppingCart, desc: 'Digital products or consumer goods brand' },
    { id: 'startup-other', label: 'Growing Startup / Other', icon: HelpCircle, desc: 'New business or unique digital model' },
  ];

  const goals = [
    { id: 'maps-local', label: 'Improve Search & Multi-Location Visibility', desc: 'Strengthen organic, international, and location-based discovery' },
    { id: 'google-ads', label: 'Launch or Optimize Performance Ads', desc: 'Build paid campaigns around measurable acquisition goals' },
    { id: 'new-website', label: 'Build a Fast, Scalable Website', desc: 'Conversion-focused experiences for mobile and global audiences' },
    { id: 'multi-market-seo', label: 'Expand SEO Across Markets', desc: 'Plan search architecture and content for international or multi-location growth' },
    { id: 'ai-automation', label: 'Implement Lead Automation', desc: 'Instant WhatsApp lead alerts and automated CRM entry' },
    { id: 'full-audit', label: 'Complete Digital Footprint Audit', desc: 'Unbiased review of where your marketing capital will work best' },
  ];

  const handleNext = () => {
    if (step === 1 && !businessType) return;
    if (step === 2 && !primaryGoal) return;
    setStep(step + 1);
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactInfo.name.trim() || !contactInfo.email.trim() || !contactInfo.businessName.trim()) {
      setError('Please provide your name, business name, and email.');
      return;
    }
    if (!consent) {
      setError('Please accept the privacy notice before sending your enquiry.');
      return;
    }
    setError(null);
    setIsSubmitting(true);

    const payload = {
      submissionId: submissionId.current,
      name: contactInfo.name,
      businessName: contactInfo.businessName,
      email: contactInfo.email,
      phone: contactInfo.phone,
      serviceInterest: primaryGoal,
      budgetRange: budget,
      message: `[Discovery Wizard] Business Type: ${businessType}. Goal: ${primaryGoal}. Notes: ${contactInfo.notes || 'None'}`,
      preferredContactMethod: 'whatsapp',
      consent,
      ...getLeadTracking('/get-started', window.location.search),
    };

    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json() as { success?: boolean; leadId?: string; message?: string };
      if (!res.ok) throw new Error(result.message || `Submission failed (${res.status}).`);
      if (result.success !== true || result.leadId !== submissionId.current) {
        throw new Error('The server did not confirm that your enquiry was saved. Please retry.');
      }
      setSubmitted(true);
    } catch (submissionError: unknown) {
      setError(submissionError instanceof Error
        ? `${submissionError.message} Your answers are still here; please retry or contact us on WhatsApp.`
        : 'Submission failed. Your answers are still here; please retry or contact us on WhatsApp.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="py-24 bg-[#F7F9F6] min-h-[70vh] flex items-center justify-center">
        <div className="max-w-md w-full mx-4 p-8 bg-white border border-[#E5E9E4] rounded-3xl text-center space-y-6 shadow-sm">
          <NearGrowMascot size="lg" mood="celebrating" interactive={false} />
          <div>
            <h2 className="text-2xl font-bold text-[#171A17] mb-2">{text('getStarted.success.title')}</h2>
            <p className="text-xs text-[#626A63] leading-relaxed">
              {text('getStarted.success.description').split('{name}')[0]}<strong className="text-[#171A17]">{contactInfo.name}</strong>{text('getStarted.success.description').split('{name}')[1]?.split('{business}')[0]}<strong className="text-[#171A17]">{contactInfo.businessName}</strong>{text('getStarted.success.description').split('{business}')[1]}
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={() => onNavigate('/')}
              className="w-full py-3 bg-[#3EA259] hover:bg-[#216F3D] text-white text-xs font-semibold rounded-xl transition-all"
            >
              {text('getStarted.success.home')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-[#F7F9F6] py-16 md:py-20 min-h-[80vh]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-xs text-[#626A63] font-semibold mb-2">
            <span>{text('getStarted.progress').replace('{step}', String(step))}</span>
            <span>
              {step === 1 && text('getStarted.step1.label')}
              {step === 2 && text('getStarted.step2.label')}
              {step === 3 && text('getStarted.step3.label')}
              {step === 4 && text('getStarted.step4.label')}
            </span>
          </div>
          <div className="w-full h-2 bg-[#E5E9E4] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#3EA259] transition-all duration-300"
              style={{ width: `${(step / 4) * 100}%` }}
            />
          </div>
        </div>

        {/* Wizard Card */}
        <div className="bg-white border border-[#E5E9E4] rounded-3xl p-6 sm:p-10 shadow-sm">
          {/* Step 1: Business Category */}
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div>
                <h1 className="text-2xl font-extrabold text-[#171A17]">{text('getStarted.step1.title')}</h1>
                <p className="text-xs text-[#626A63] mt-1">{text('getStarted.step1.description')}</p>
              </div>

              <div className="space-y-3">
                {businessTypes.map((type) => {
                  const Icon = type.icon;
                  const isSelected = businessType === type.id;
                  return (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => setBusinessType(type.id)}
                      className={`w-full p-4 rounded-2xl border text-left flex items-start gap-4 transition-all ${
                        isSelected
                          ? 'bg-[#EBF7EE] border-[#3EA259] ring-2 ring-[#3EA259]/20'
                          : 'bg-white border-[#E5E9E4] hover:bg-[#F7F9F6]'
                      }`}
                    >
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          isSelected ? 'bg-[#3EA259] text-white' : 'bg-[#F7F9F6] text-[#626A63]'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-[#171A17]">{type.label}</div>
                        <div className="text-xs text-[#626A63] mt-0.5">{type.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="pt-4 flex justify-end">
                <button
                  type="button"
                  disabled={!businessType}
                  onClick={handleNext}
                  className="px-6 py-3 bg-[#3EA259] hover:bg-[#216F3D] disabled:opacity-50 text-white text-xs font-semibold rounded-xl flex items-center gap-2 transition-all shadow-sm"
                >
                  <span>{text('getStarted.continue')}</span> <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Primary Objective */}
          {step === 2 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div>
                <h2 className="text-2xl font-extrabold text-[#171A17]">{text('getStarted.step2.title')}</h2>
                <p className="text-xs text-[#626A63] mt-1">{text('getStarted.step2.description')}</p>
              </div>

              <div className="space-y-3">
                {goals.map((g) => {
                  const isSelected = primaryGoal === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setPrimaryGoal(g.id)}
                      className={`w-full p-4 rounded-2xl border text-left flex items-start justify-between gap-4 transition-all ${
                        isSelected
                          ? 'bg-[#EBF7EE] border-[#3EA259] ring-2 ring-[#3EA259]/20'
                          : 'bg-white border-[#E5E9E4] hover:bg-[#F7F9F6]'
                      }`}
                    >
                      <div>
                        <div className="text-sm font-bold text-[#171A17]">{g.label}</div>
                        <div className="text-xs text-[#626A63] mt-0.5">{g.desc}</div>
                      </div>
                      <div
                        className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                          isSelected ? 'border-[#3EA259] bg-[#3EA259] text-white' : 'border-[#CBD5E1]'
                        }`}
                      >
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="pt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2 text-xs font-semibold text-[#626A63] hover:text-[#171A17] flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" /> {text('getStarted.back')}
                </button>
                <button
                  type="button"
                  disabled={!primaryGoal}
                  onClick={handleNext}
                  className="px-6 py-3 bg-[#3EA259] hover:bg-[#216F3D] disabled:opacity-50 text-white text-xs font-semibold rounded-xl flex items-center gap-2 transition-all shadow-sm"
                >
                  <span>{text('getStarted.continue')}</span> <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Budget Scope */}
          {step === 3 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div>
                <h2 className="text-2xl font-extrabold text-[#171A17]">{text('getStarted.step3.title')}</h2>
                <p className="text-xs text-[#626A63] mt-1">{text('getStarted.step3.description')}</p>
              </div>

              <div className="space-y-3">
                {[
                  { id: '15k-30k', label: '₹15,000 – ₹30,000 / month', sub: 'Targeted single-channel or Google Maps focus' },
                  { id: '30k-60k', label: '₹30,000 – ₹60,000 / month', sub: 'Combined SEO + performance advertising management' },
                  { id: '60k-120k', label: '₹60,000 – ₹1,20,000 / month', sub: 'Multi-channel acquisition + website engineering' },
                  { id: 'prefer-to-discuss', label: 'Prefer to Discuss During Call', sub: 'Audit first before finalizing budget' },
                ].map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBudget(b.id)}
                    className={`w-full p-4 rounded-2xl border text-left flex items-center justify-between transition-all ${
                      budget === b.id
                        ? 'bg-[#EBF7EE] border-[#3EA259] ring-2 ring-[#3EA259]/20'
                        : 'bg-white border-[#E5E9E4] hover:bg-[#F7F9F6]'
                    }`}
                  >
                    <div>
                      <div className="text-sm font-bold text-[#171A17]">{b.label}</div>
                      <div className="text-xs text-[#626A63]">{b.sub}</div>
                    </div>
                    <div
                      className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                        budget === b.id ? 'border-[#3EA259] bg-[#3EA259] text-white' : 'border-[#CBD5E1]'
                      }`}
                    >
                      {budget === b.id && <CheckCircle2 className="w-3.5 h-3.5" />}
                    </div>
                  </button>
                ))}
              </div>

              <div className="pt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="px-4 py-2 text-xs font-semibold text-[#626A63] hover:text-[#171A17] flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" /> {text('getStarted.back')}
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  className="px-6 py-3 bg-[#3EA259] hover:bg-[#216F3D] text-white text-xs font-semibold rounded-xl flex items-center gap-2 transition-all shadow-sm"
                >
                  <span>{text('getStarted.continue')}</span> <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Contact Information */}
          {step === 4 && (
            <form onSubmit={handleFinalSubmit} className="space-y-6 animate-in fade-in duration-200">
              <div>
                <h2 className="text-2xl font-extrabold text-[#171A17]">{text('getStarted.step4.title')}</h2>
                <p className="text-xs text-[#626A63] mt-1">No spam, ever. We review every submission individually.</p>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">{error}</div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="get-started-name" className="block text-xs font-semibold text-[#171A17] mb-1">Your Name *</label>
                    <input
                      id="get-started-name"
                      type="text"
                      required
                      autoComplete="name"
                      value={contactInfo.name}
                      onChange={(e) => setContactInfo({ ...contactInfo, name: e.target.value })}
                      placeholder="e.g. Ankit Verma"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E9E4] text-sm bg-[#F7F9F6] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3EA259]/30 focus:border-[#3EA259]"
                    />
                  </div>
                  <div>
                    <label htmlFor="get-started-business" className="block text-xs font-semibold text-[#171A17] mb-1">Business Name *</label>
                    <input
                      id="get-started-business"
                      type="text"
                      required
                      autoComplete="organization"
                      value={contactInfo.businessName}
                      onChange={(e) => setContactInfo({ ...contactInfo, businessName: e.target.value })}
                      placeholder="e.g. Verma Dental Care"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E9E4] text-sm bg-[#F7F9F6] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3EA259]/30 focus:border-[#3EA259]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="get-started-email" className="block text-xs font-semibold text-[#171A17] mb-1">Work Email *</label>
                    <input
                      id="get-started-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={contactInfo.email}
                      onChange={(e) => setContactInfo({ ...contactInfo, email: e.target.value })}
                      placeholder="ankit@company.com"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E9E4] text-sm bg-[#F7F9F6] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3EA259]/30 focus:border-[#3EA259]"
                    />
                  </div>
                  <div>
                    <label htmlFor="get-started-phone" className="block text-xs font-semibold text-[#171A17] mb-1">Phone / WhatsApp (Optional)</label>
                    <input
                      id="get-started-phone"
                      type="tel"
                      autoComplete="tel"
                      value={contactInfo.phone}
                      onChange={(e) => setContactInfo({ ...contactInfo, phone: e.target.value })}
                      placeholder="+91 98110 00000"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E9E4] text-sm bg-[#F7F9F6] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3EA259]/30 focus:border-[#3EA259]"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="get-started-notes" className="block text-xs font-semibold text-[#171A17] mb-1">
                    Specific notes or existing website URL
                  </label>
                  <textarea
                    id="get-started-notes"
                    rows={2}
                    value={contactInfo.notes}
                    onChange={(e) => setContactInfo({ ...contactInfo, notes: e.target.value })}
                    placeholder="e.g. Website is https://vermadental.in, currently getting zero calls from Google."
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E9E4] text-sm bg-[#F7F9F6] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3EA259]/30 focus:border-[#3EA259]"
                  />
                </div>

                <label className="flex items-start gap-2.5 text-xs leading-relaxed text-[#626A63]">
                  <input
                    type="checkbox"
                    checked={consent}
                    aria-invalid={Boolean(error && !consent)}
                    onChange={(event) => setConsent(event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#E5E9E4] text-[#216F3D] focus:ring-[#216F3D]"
                    aria-describedby={error && !consent ? 'get-started-consent-error' : undefined}
                  />
                  <span>
                    I agree to be contacted about this enquiry and acknowledge the{' '}
                    <a href="/privacy-policy" className="font-semibold text-[#216F3D] underline">privacy notice</a>.
                  </span>
                </label>
                {error && !consent && (
                  <p id="get-started-consent-error" className="text-xs text-red-700" role="alert">
                    Consent is required to submit this enquiry.
                  </p>
                )}
              </div>

              <div className="pt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="px-4 py-2 text-xs font-semibold text-[#626A63] hover:text-[#171A17] flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" /> {text('getStarted.back')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-8 py-3 bg-[#3EA259] hover:bg-[#216F3D] disabled:opacity-50 text-white text-xs font-semibold rounded-xl flex items-center gap-2 transition-all shadow-sm"
                >
                  {isSubmitting ? text('getStarted.submitting') : text('getStarted.submit')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
