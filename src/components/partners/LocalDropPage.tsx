import React, { useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleHelp, Layers3, MapPin, Play, RotateCcw, Truck, UploadCloud, Wallet } from 'lucide-react';
import { getLeadTracking } from '../../data/leadTracking';
import { HeroOrbitBackground } from '../ui/HeroOrbitBackground';
import './localDrop.css';

interface LocalDropPageProps {
  onNavigate: (path: string) => void;
}

type InterestKind = 'partner' | 'business';

const steps = [
  { title: 'Share your interest', description: 'Tell us about your delivery area or local business.', icon: MapPin },
  { title: 'Discuss a campaign', description: 'Review the promotional cards and distribution plan together.', icon: Layers3 },
  { title: 'Deliver locally', description: 'Cards can go along with regular orders, with distribution proof.', icon: Truck },
];

const benefits = [
  { title: 'Flexible opportunities', description: 'Explore campaigns that fit around your existing delivery schedule.', icon: Wallet },
  { title: 'Local connections', description: 'Help nearby businesses reach customers in their neighbourhood.', icon: MapPin },
  { title: 'Clear assignments', description: 'See campaign instructions and daily distribution targets when the portal launches.', icon: Layers3 },
  { title: 'Proof and progress', description: 'The planned portal will keep submissions and progress in one place.', icon: UploadCloud },
];

function InterestForm({ kind }: { kind: InterestKind }) {
  const submissionId = useRef(crypto.randomUUID());
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const fields = new FormData(form);
    if (fields.get('website')) {
      setStatus('success');
      return;
    }
    const name = String(fields.get('name') || '').trim();
    const email = String(fields.get('email') || '').trim().toLowerCase();
    const phone = String(fields.get('phone') || '').trim();
    const businessName = kind === 'business'
      ? String(fields.get('businessName') || '').trim()
      : 'Delivery Partner Interest';
    const area = String(fields.get('area') || '').trim();
    const details = String(fields.get('details') || '').trim();
    const message = `${kind === 'partner' ? 'Delivery partner' : 'Local business'} interest. Area: ${area}. Details: ${details || 'Please contact me to discuss LocalDrop.'}`;
    const tracking = getLeadTracking(window.location.pathname, window.location.search);
    setErrorMessage('');
    setStatus('sending');
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: submissionId.current,
          name,
          email,
          phone,
          businessName,
          serviceInterest: kind === 'partner' ? 'localdrop-partner-interest' : 'localdrop-business-interest',
          message,
          preferredContactMethod: 'phone',
          consent: true,
          ...tracking,
        }),
      });
      const result = await response.json() as { success?: boolean; leadId?: string; message?: string };
      if (!response.ok) throw new Error(result.message || `Submission failed (${response.status}).`);
      if (result.success !== true || result.leadId !== submissionId.current) {
        throw new Error('The server did not confirm that your enquiry was saved. Please retry.');
      }
      setStatus('success');
    } catch (submissionError: unknown) {
      setErrorMessage(submissionError instanceof Error
        ? `${submissionError.message} Your details are still here; please retry.`
        : 'Submission failed. Your details are still here; please retry.');
      setStatus('error');
    }
  };

  if (status === 'success') {
    return <div className="localdrop-form-success" role="status"><CheckCircle2 aria-hidden="true" /> Thank you. Your interest has been received. Our team will contact you.</div>;
  }

  return (
    <form className="localdrop-form" onSubmit={submit}>
      <div className="localdrop-form-grid">
        <label>Full name<input name="name" autoComplete="name" required maxLength={100} /></label>
        {kind === 'business' && <label>Business name<input name="businessName" autoComplete="organization" required maxLength={100} /></label>}
        <label>Email<input name="email" type="email" autoComplete="email" required maxLength={120} /></label>
        <label>Mobile number<input name="phone" type="tel" autoComplete="tel" required minLength={7} maxLength={30} /></label>
        <label>Delivery or business area<input name="area" required maxLength={100} placeholder="Your local area" /></label>
      </div>
      <label>Anything else we should know?<textarea name="details" rows={3} maxLength={1700} placeholder="Tell us about your route or campaign idea" /></label>
      <input name="website" tabIndex={-1} autoComplete="off" className="localdrop-trap" aria-hidden="true" />
      <label className="localdrop-consent"><input type="checkbox" required /> I agree to be contacted about NearGrow LocalDrop.</label>
      {status === 'error' && <p className="localdrop-form-error" role="alert">{errorMessage}</p>}
      <button className="localdrop-button localdrop-button-primary" type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Send interest'} <ArrowRight aria-hidden="true" size={18} />
      </button>
    </form>
  );
}

export const LocalDropPage: React.FC<LocalDropPageProps> = ({ onNavigate }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [prefersReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [videoPlaying, setVideoPlaying] = useState(!prefersReducedMotion);
  const [interestKind, setInterestKind] = useState<InterestKind>('partner');

  const replay = () => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = 0;
    void videoRef.current.play().then(() => setVideoPlaying(true)).catch(() => setVideoPlaying(false));
  };

  return (
    <div className="localdrop-page">
      <section className="localdrop-hero" aria-labelledby="localdrop-heading">
        <HeroOrbitBackground ambient />
        <div className="localdrop-hero-copy" data-mascot-obstacle>
          <span className="localdrop-eyebrow">NearGrow LocalDrop · By NearGrow Ads</span>
          <h1 id="localdrop-heading">Your Deliveries.<br /><span>More Opportunities.</span></h1>
          <p>Turn everyday local deliveries into opportunities for businesses, delivery partners and communities.</p>
          <div className="localdrop-actions">
            <a className="localdrop-button localdrop-button-primary" href="#partner-interest">Become a Delivery Partner <ArrowRight aria-hidden="true" size={18} /></a>
            <a className="localdrop-button localdrop-button-outline" href="#how-it-works">Explore How It Works</a>
          </div>
        </div>
        <div className="localdrop-video-wrap" data-mascot-obstacle>
          <video
            ref={videoRef}
            src="/media/localdrop/scooter-and-card.mp4"
            poster="/media/localdrop/scooter-poster.jpg"
            autoPlay={!prefersReducedMotion}
            muted
            playsInline
            preload="metadata"
            onPlay={() => setVideoPlaying(true)}
            onPause={() => setVideoPlaying(false)}
            onEnded={() => setVideoPlaying(false)}
            aria-label="Delivery partner arrives on a scooter and shows the NearGrow Ads promotional card"
          />
          <button type="button" className="localdrop-replay" onClick={replay} aria-label="Replay LocalDrop video">
            {videoPlaying ? <RotateCcw aria-hidden="true" size={17} /> : <Play aria-hidden="true" size={17} />} Replay
          </button>
        </div>
      </section>

      <section id="how-it-works" className="localdrop-section localdrop-process" aria-labelledby="localdrop-process-heading">
        <div className="localdrop-container">
          <p className="localdrop-kicker">How it works</p>
          <h2 id="localdrop-process-heading">A simple start. A local impact.</h2>
          <div className="localdrop-step-grid">
            {steps.map(({ title, description, icon: Icon }, index) => (
              <article className="localdrop-card" key={title} data-mascot-obstacle>
                <div className="localdrop-card-top"><span className="localdrop-icon"><Icon aria-hidden="true" size={24} /></span><span className="localdrop-step-number">0{index + 1}</span></div>
                <h3>{title}</h3><p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="localdrop-section localdrop-benefits" aria-labelledby="localdrop-benefits-heading">
        <div className="localdrop-container">
          <p className="localdrop-kicker">Built around your day</p>
          <h2 id="localdrop-benefits-heading">More possibilities, on your route.</h2>
          <div className="localdrop-benefit-grid">
            {benefits.map(({ title, description, icon: Icon }) => (
              <article className="localdrop-card" key={title} data-mascot-obstacle><span className="localdrop-icon"><Icon aria-hidden="true" size={24} /></span><h3>{title}</h3><p>{description}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section id="partner-access" className="localdrop-section localdrop-access" aria-labelledby="localdrop-access-heading">
        <div className="localdrop-container localdrop-access-grid">
          <div><p className="localdrop-kicker">Partner access</p><h2 id="localdrop-access-heading">One place for your delivery campaigns.</h2><p>Campaign assignments, daily targets, photo proof and progress are planned for the partner portal.</p></div>
          <div className="localdrop-access-card" data-mascot-obstacle><CircleHelp aria-hidden="true" size={30} /><h3>Partner Login</h3><p>A dedicated workspace for campaign assignments, daily targets, proof and progress.</p><button type="button" onClick={() => onNavigate('/partners/portal-preview')} className="localdrop-text-link">Partner Login <ArrowRight aria-hidden="true" size={16} /></button></div>
        </div>
      </section>

      <section id="partner-interest" className="localdrop-section localdrop-interest" aria-labelledby="localdrop-interest-heading">
        <div className="localdrop-container localdrop-interest-grid">
          <div><p className="localdrop-kicker">Let's connect</p><h2 id="localdrop-interest-heading">Bring local businesses and deliveries together.</h2><p>Tell us whether you deliver in your area or want to explore promotional cards for your business.</p><button type="button" className="localdrop-text-link" onClick={() => onNavigate('/contact')}>Contact NearGrow Ads <ArrowRight aria-hidden="true" size={16} /></button></div>
          <div className="localdrop-interest-panel" data-mascot-obstacle>
            <div className="localdrop-form-tabs" aria-label="Enquiry type">
              <button type="button" aria-pressed={interestKind === 'partner'} onClick={() => setInterestKind('partner')}>Delivery partner</button>
              <button type="button" aria-pressed={interestKind === 'business'} onClick={() => setInterestKind('business')}>Local business</button>
            </div>
            <h3>{interestKind === 'partner' ? 'Become a delivery partner' : 'Explore a local campaign'}</h3>
            <InterestForm key={interestKind} kind={interestKind} />
          </div>
        </div>
      </section>
    </div>
  );
};
