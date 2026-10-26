import React, { useState, useEffect, useRef } from 'react';
import { Send, CheckCircle2, AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { SERVICES } from '../../data/servicesData';
import { publicText } from '../../data/publicCopy';
import type { SiteContent } from '../../data/siteContent';
import { DEFAULT_SITE_CONTENT } from '../../data/siteContent';
import { getCtaDestination } from '../../data/publicLinks';
import { getLeadTracking } from '../../data/leadTracking';
import {
  validateConsultationForm,
  type ConsultationFormValidationMessages,
} from './consultationFormValidation';

export interface LeadSubmissionPayload {
  submissionId: string;
  name: string;
  businessName: string;
  email: string;
  phone?: string;
  websiteUrl?: string;
  serviceInterest: string;
  budgetRange?: string;
  message: string;
  preferredContactMethod?: 'whatsapp' | 'email' | 'phone';
  consent: boolean;
  sourcePage: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  _hpTrap?: string; // honeypot
}

interface ConsultationFormProps {
  defaultServiceSlug?: string;
  onSuccess?: () => void;
  className?: string;
  compact?: boolean;
  submitLabel?: string;
  siteContent?: SiteContent;
}

export const ConsultationForm: React.FC<ConsultationFormProps> = ({
  defaultServiceSlug,
  onSuccess,
  className = '',
  compact = false,
  submitLabel,
  siteContent,
}) => {
  const text = (key: string) => publicText(siteContent?.copy, key);
  const formRef = useRef<HTMLFormElement>(null);
  const submissionId = useRef(window.crypto.randomUUID());
  const [formData, setFormData] = useState({
    name: '',
    businessName: '',
    email: '',
    phone: '',
    websiteUrl: '',
    serviceInterest: defaultServiceSlug || 'google-business-profile',
    budgetRange: 'unspecified',
    message: '',
    preferredContactMethod: 'whatsapp' as 'whatsapp' | 'email' | 'phone',
    consent: false,
    _hpTrap: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Capture UTM parameters and current path
  const [tracking, setTracking] = useState<{
    sourcePage: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
  }>({
    sourcePage: typeof window !== 'undefined' ? window.location.pathname : '/',
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setTracking(getLeadTracking(window.location.pathname, window.location.search));
    }
  }, []);

  const validate = () => {
    const validationMessages: ConsultationFormValidationMessages = {
      nameRequired: text('form.error.nameRequired'),
      nameLength: text('form.error.nameLength'),
      businessRequired: text('form.error.businessRequired'),
      emailRequired: text('form.error.emailRequired'),
      emailInvalid: text('form.error.emailInvalid'),
      serviceRequired: text('form.error.serviceRequired'),
      messageRequired: text('form.error.messageRequired'),
      messageLength: text('form.error.messageLength'),
      consent: text('form.error.consent'),
    };
    const newErrors = validateConsultationForm(formData, validationMessages);

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
    }
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    // Honeypot check
    if (formData._hpTrap) {
      // Quietly simulate success for bots
      setSubmitSuccess(true);
      return;
    }

    if (!validate()) return;

    setIsSubmitting(true);

    const payload: LeadSubmissionPayload = {
      submissionId: submissionId.current,
      ...formData,
      ...tracking,
      email: formData.email.trim().toLowerCase(),
      name: formData.name.trim(),
      businessName: formData.businessName.trim(),
    };

    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json() as { success?: boolean; leadId?: string; message?: string };
      if (!response.ok) throw new Error(result.message || `Server responded with status ${response.status}`);
      if (result.success !== true || result.leadId !== submissionId.current) {
        throw new Error('The server did not confirm that your enquiry was saved. Please retry.');
      }

      setSubmitSuccess(true);
      if (onSuccess) {
        onSuccess();
      }
    } catch (error: unknown) {
      console.error('[NearGrow Ads] Consultation form submission failed.', error);
      setServerError(text('form.serverError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitSuccess) {
    return (
      <div className={`public-consultation-form p-8 bg-white border border-[#E5E9E4] rounded-2xl text-center ${className}`}>
        <div className="w-16 h-16 mx-auto mb-4 bg-[#EBF7EE] text-[#3EA259] rounded-full flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h3 className="text-2xl font-bold text-[#171A17] mb-2">{text('form.successTitle')}</h3>
        <p className="text-[#626A63] text-sm max-w-md mx-auto mb-6">
          {text('form.successIntro')} <strong className="text-[#171A17]">{formData.name}</strong>. {text('form.successBody')}{' '}
          <strong className="text-[#171A17]">{formData.businessName}</strong>{text('form.successBusinessSuffix')}{' '}
          {formData.preferredContactMethod}.
        </p>
        <div className="p-4 bg-[#F7F9F6] border border-[#E5E9E4] rounded-xl text-xs text-[#626A63] max-w-sm mx-auto mb-6">
          <p className="font-semibold text-[#171A17] mb-1">{text('form.successUrgent')}</p>
          <p>{text('form.successWhatsApp')}</p>
        </div>
        <a
          href={getCtaDestination(siteContent ?? DEFAULT_SITE_CONTENT, 'thankYou.whatsapp', 'https://wa.me/919289810149?text=Hi%20NearGrow%20Ads%2C%20I%20just%20submitted%20a%20consultation%20form%20for%20my%20business.')}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#3EA259] hover:bg-[#216F3D] text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {text('form.whatsappCta')} <ArrowRight className="w-4 h-4" />
        </a>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className={`public-consultation-form bg-white border border-[#E5E9E4] rounded-2xl p-6 md:p-8 shadow-sm ${className}`}
    >
      {/* Honeypot field (hidden from genuine users) */}
      <input
        type="text"
        name="_hp_company_trap"
        value={formData._hpTrap}
        onChange={(e) => setFormData({ ...formData, _hpTrap: e.target.value })}
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        aria-hidden="true"
      />

      <div className="mb-6">
        <h3 className="text-xl md:text-2xl font-bold text-[#171A17]">{text('form.heading')}</h3>
        <p className="text-sm text-[#626A63] mt-1">
          {text('form.description')}
        </p>
      </div>

      {serverError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-700 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>{serverError}</div>
        </div>
      )}

      <div className="space-y-4">
        {/* Name & Business Name */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="consultation-name" className="block text-xs font-semibold uppercase tracking-wider text-[#171A17] mb-1.5">
              {text('form.name')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="consultation-name"
              autoComplete="name"
              value={formData.name}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'consultation-name-error' : undefined}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder={text('form.namePlaceholder')}
              className={`w-full px-3.5 py-2.5 rounded-lg border text-sm text-[#171A17] bg-[#F7F9F6] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3EA259]/30 focus:border-[#3EA259] transition-all ${
                errors.name ? 'border-red-400 bg-red-50/30' : 'border-[#E5E9E4]'
              }`}
            />
            {errors.name && <p id="consultation-name-error" className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>

          <div>
            <label htmlFor="consultation-business" className="block text-xs font-semibold uppercase tracking-wider text-[#171A17] mb-1.5">
              {text('form.business')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="consultation-business"
              autoComplete="organization"
              value={formData.businessName}
              aria-invalid={Boolean(errors.businessName)}
              aria-describedby={errors.businessName ? 'consultation-business-error' : undefined}
              onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
              placeholder={text('form.businessPlaceholder')}
              className={`w-full px-3.5 py-2.5 rounded-lg border text-sm text-[#171A17] bg-[#F7F9F6] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3EA259]/30 focus:border-[#3EA259] transition-all ${
                errors.businessName ? 'border-red-400 bg-red-50/30' : 'border-[#E5E9E4]'
              }`}
            />
            {errors.businessName && <p id="consultation-business-error" className="text-xs text-red-500 mt-1">{errors.businessName}</p>}
          </div>
        </div>

        {/* Email & Phone */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="consultation-email" className="block text-xs font-semibold uppercase tracking-wider text-[#171A17] mb-1.5">
              {text('form.email')} <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              id="consultation-email"
              autoComplete="email"
              inputMode="email"
              value={formData.email}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'consultation-email-error' : undefined}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder={text('form.emailPlaceholder')}
              className={`w-full px-3.5 py-2.5 rounded-lg border text-sm text-[#171A17] bg-[#F7F9F6] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3EA259]/30 focus:border-[#3EA259] transition-all ${
                errors.email ? 'border-red-400 bg-red-50/30' : 'border-[#E5E9E4]'
              }`}
            />
            {errors.email && <p id="consultation-email-error" className="text-xs text-red-500 mt-1">{errors.email}</p>}
          </div>

          <div>
            <label htmlFor="consultation-phone" className="block text-xs font-semibold uppercase tracking-wider text-[#171A17] mb-1.5">
              {text('form.phone')} <span className="text-[#626A63] text-[10px] normal-case">{text('form.phoneOptional')}</span>
            </label>
            <input
              type="tel"
              id="consultation-phone"
              autoComplete="tel"
              inputMode="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder={text('form.phonePlaceholder')}
              className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E9E4] text-sm text-[#171A17] bg-[#F7F9F6] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3EA259]/30 focus:border-[#3EA259] transition-all"
            />
          </div>
        </div>

        {/* Website & Primary Service */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="consultation-service" className="block text-xs font-semibold uppercase tracking-wider text-[#171A17] mb-1.5">
              {text('form.service')} <span className="text-red-500">*</span>
            </label>
            <select
              id="consultation-service"
              value={formData.serviceInterest}
              onChange={(e) => setFormData({ ...formData, serviceInterest: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E9E4] text-sm text-[#171A17] bg-[#F7F9F6] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3EA259]/30 focus:border-[#3EA259] transition-all"
            >
              {SERVICES.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.title}
                </option>
              ))}
              <option value="general-consultation">{text('form.generalService')}</option>
            </select>
          </div>

          <div>
            <label htmlFor="consultation-website" className="block text-xs font-semibold uppercase tracking-wider text-[#171A17] mb-1.5">
              {text('form.website')} <span className="text-[#626A63] text-[10px] normal-case">{text('form.websiteOptional')}</span>
            </label>
            <input
              type="text"
              id="consultation-website"
              inputMode="url"
              autoComplete="url"
              value={formData.websiteUrl}
              onChange={(e) => setFormData({ ...formData, websiteUrl: e.target.value })}
              placeholder={text('form.websitePlaceholder')}
              className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E9E4] text-sm text-[#171A17] bg-[#F7F9F6] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3EA259]/30 focus:border-[#3EA259] transition-all"
            />
          </div>
        </div>

        {/* Budget & Preferred Contact (Only in non-compact mode) */}
        {!compact && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="consultation-budget" className="block text-xs font-semibold uppercase tracking-wider text-[#171A17] mb-1.5">
                {text('form.budget')} <span className="text-[#626A63] text-[10px] normal-case">{text('form.budgetOptional')}</span>
              </label>
              <select
                id="consultation-budget"
                value={formData.budgetRange}
                onChange={(e) => setFormData({ ...formData, budgetRange: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E9E4] text-sm text-[#171A17] bg-[#F7F9F6] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3EA259]/30 focus:border-[#3EA259] transition-all"
              >
                <option value="unspecified">{text('form.budgetUnspecified')}</option>
                <option value="15k-30k">₹15,000 – ₹30,000 / month</option>
                <option value="30k-60k">₹30,000 – ₹60,000 / month</option>
                <option value="60k-120k">₹60,000 – ₹1,20,000 / month</option>
                <option value="120k-plus">₹1,20,000+ / month (Enterprise / Multi-location)</option>
              </select>
            </div>

            <div>
              <label htmlFor="consultation-message" className="block text-xs font-semibold uppercase tracking-wider text-[#171A17] mb-1.5">
                {text('form.preferredContact')}
              </label>
              <div className="flex items-center gap-2 pt-1">
                {(['whatsapp', 'email', 'phone'] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    aria-pressed={formData.preferredContactMethod === method}
                    onClick={() => setFormData({ ...formData, preferredContactMethod: method })}
                    className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg border capitalize transition-colors ${
                      formData.preferredContactMethod === method
                        ? 'bg-[#EBF7EE] border-[#3EA259] text-[#216F3D]'
                        : 'bg-white border-[#E5E9E4] text-[#626A63] hover:text-[#171A17]'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Message */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[#171A17] mb-1.5">
            {text('form.message')} <span className="text-red-500">*</span>
          </label>
          <textarea
            id="consultation-message"
            rows={3}
            value={formData.message}
            aria-invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? 'consultation-message-error' : undefined}
            onChange={(e) => setFormData({ ...formData, message: e.target.value })}
            placeholder={text('form.messagePlaceholder')}
            className={`w-full px-3.5 py-2.5 rounded-lg border text-sm text-[#171A17] bg-[#F7F9F6] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3EA259]/30 focus:border-[#3EA259] transition-all resize-y ${
              errors.message ? 'border-red-400 bg-red-50/30' : 'border-[#E5E9E4]'
            }`}
          />
          {errors.message && <p id="consultation-message-error" className="text-xs text-red-500 mt-1">{errors.message}</p>}
        </div>

        {/* Consent checkbox */}
        <div>
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              id="consultation-consent"
              type="checkbox"
              checked={formData.consent}
              aria-invalid={Boolean(errors.consent)}
              aria-describedby={errors.consent ? 'consultation-consent-error' : undefined}
              onChange={(e) => setFormData({ ...formData, consent: e.target.checked })}
              className="mt-1 h-4 w-4 rounded border-[#E5E9E4] text-[#3EA259] focus:ring-[#3EA259]"
            />
            <span className="text-xs text-[#626A63] leading-relaxed">
              {text('form.consent')}{' '}
              <a href="/privacy-policy" className="text-[#3EA259] underline">{text('form.privacy')}</a>. {text('form.noSpam')}
            </span>
          </label>
          {errors.consent && <p id="consultation-consent-error" className="text-xs text-red-500 mt-1">{errors.consent}</p>}
        </div>

        {/* Submit button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl bg-[#3EA259] hover:bg-[#216F3D] active:scale-[0.99] text-white font-semibold text-sm transition-all shadow-sm disabled:opacity-70 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{text('form.submitting')}</span>
              </>
            ) : (
              <>
                <span>{submitLabel ?? text('form.submit')}</span>
                <Send className="w-4 h-4" />
              </>
            )}
          </button>
        </div>

        <p className="text-center text-[11px] text-[#626A63]">
          {text('form.footer')}
        </p>
      </div>
    </form>
  );
};
