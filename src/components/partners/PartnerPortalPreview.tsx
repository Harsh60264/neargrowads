import React, { useState } from 'react';
import { ArrowLeft, BarChart3, CalendarDays, Camera, CheckCircle2, CircleHelp, FileCheck2, LayoutDashboard, MapPin, Megaphone, UserRound, Wallet } from 'lucide-react';
import './partnerPortalPreview.css';

interface PartnerPortalPreviewProps {
  onNavigate: (path: string) => void;
}

const views = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'campaigns', label: 'Campaigns & Daily Targets', icon: Megaphone },
  { id: 'proof', label: 'Proof Submissions', icon: Camera },
  { id: 'earnings', label: 'Earnings & Progress', icon: Wallet },
  { id: 'profile', label: 'Profile & Support', icon: UserRound },
] as const;

type ViewId = typeof views[number]['id'];

const EmptyPanel = ({ title, description }: { title: string; description: string }) => (
  <div className="partner-preview-empty" data-mascot-obstacle><FileCheck2 aria-hidden="true" size={30} /><h3>{title}</h3><p>{description}</p></div>
);

export const PartnerPortalPreview: React.FC<PartnerPortalPreviewProps> = ({ onNavigate }) => {
  const [view, setView] = useState<ViewId>('dashboard');

  return (
    <div className="partner-preview">
      <div className="partner-preview-banner" role="note">Design preview · Partner accounts and campaign data are not live</div>
      <div className="partner-preview-layout">
        <aside className="partner-preview-sidebar" aria-label="Partner portal preview navigation">
          <p className="partner-preview-brand">NearGrow <span>LocalDrop</span></p>
          <nav>
            {views.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
                <Icon aria-hidden="true" size={18} /> {label}
              </button>
            ))}
          </nav>
          <button className="partner-preview-back" type="button" onClick={() => onNavigate('/partners/localdrop')}><ArrowLeft aria-hidden="true" size={16} /> Back to LocalDrop</button>
        </aside>

        <div className="partner-preview-content">
          <header className="partner-preview-topline"><span>Partner portal preview</span><span className="partner-preview-avatar" aria-hidden="true"><UserRound size={18} /></span></header>
          <div className="partner-preview-mobile-tabs" aria-label="Preview screens">
            {views.map(({ id, label }) => <button type="button" key={id} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>{label}</button>)}
          </div>

          {view === 'dashboard' && (
            <section className="partner-preview-view" aria-labelledby="partner-preview-title">
              <p className="partner-preview-eyebrow" data-mascot-obstacle>Overview</p><h1 id="partner-preview-title" data-mascot-obstacle>Welcome, Partner</h1><p data-mascot-obstacle>See your assignments and distribution activity in one place.</p>
              <div className="partner-preview-stat-grid">
                {[['Assigned campaigns', Megaphone], ["Today's target", CalendarDays], ['Proofs under review', FileCheck2], ['Approved earnings', Wallet]].map(([label, Icon]) => {
                  const StatIcon = Icon as typeof Megaphone;
                  return <article className="partner-preview-card partner-preview-stat" key={label as string} data-mascot-obstacle><StatIcon aria-hidden="true" size={20} /><span>{label as string}</span><strong>—</strong></article>;
                })}
              </div>
              <div className="partner-preview-two-col"><EmptyPanel title="Assigned campaigns" description="Campaigns will appear here after a partner account is activated." /><EmptyPanel title="Daily activity" description="Targets and recent proof submissions will be shown here." /></div>
            </section>
          )}

          {view === 'campaigns' && (
            <section className="partner-preview-view" aria-labelledby="partner-preview-title"><p className="partner-preview-eyebrow" data-mascot-obstacle>Campaigns</p><h1 id="partner-preview-title" data-mascot-obstacle>Assignments & daily targets</h1><p data-mascot-obstacle>Review campaign instructions and track a day's distribution.</p>
              <div className="partner-preview-two-col"><div className="partner-preview-card" data-mascot-obstacle><span className="partner-preview-icon"><MapPin size={21} aria-hidden="true" /></span><h2>Campaign details</h2><p>Business, delivery area, card quantity, dates and guidelines will appear when a campaign is assigned.</p><div className="partner-preview-placeholder">No campaign assigned</div></div><div className="partner-preview-card" data-mascot-obstacle><span className="partner-preview-icon"><CalendarDays size={21} aria-hidden="true" /></span><h2>Daily targets</h2><div className="partner-preview-metric"><span>Assigned</span><strong>—</strong></div><div className="partner-preview-metric"><span>Submitted</span><strong>—</strong></div><div className="partner-preview-metric"><span>Verified</span><strong>—</strong></div></div></div>
            </section>
          )}

          {view === 'proof' && (
            <section className="partner-preview-view" aria-labelledby="partner-preview-title"><p className="partner-preview-eyebrow" data-mascot-obstacle>Distribution proof</p><h1 id="partner-preview-title" data-mascot-obstacle>Submit and track proof</h1><p data-mascot-obstacle>Proposed workflow for documenting card distribution.</p>
              <div className="partner-preview-two-col"><div className="partner-preview-card" data-mascot-obstacle><h2>New proof submission</h2><div className="partner-preview-field">Assigned campaign <span>Choose a campaign</span></div><div className="partner-preview-field">Distribution date <span>Choose a date</span></div><div className="partner-preview-field">Cards distributed <span>Enter a quantity</span></div><div className="partner-preview-upload"><Camera aria-hidden="true" size={26} /> Photo proof upload preview</div><p className="partner-preview-hint">Uploads will be available when the partner portal is implemented.</p></div><div className="partner-preview-card" data-mascot-obstacle><h2>Review status</h2><div className="partner-preview-statuses"><span>Submitted</span><span>Under review</span><span>Approved</span><span>Changes requested</span></div><EmptyPanel title="No submissions yet" description="Your proof and admin review history will appear here." /></div></div>
            </section>
          )}

          {view === 'earnings' && (
            <section className="partner-preview-view" aria-labelledby="partner-preview-title"><p className="partner-preview-eyebrow" data-mascot-obstacle>Progress</p><h1 id="partner-preview-title" data-mascot-obstacle>Earnings & progress</h1><p data-mascot-obstacle>Planned view of verified distribution and payment records.</p>
              <div className="partner-preview-stat-grid">{['Approved earnings', 'Pending verification', 'Recorded payments', 'Verified distributions'].map((label) => <div className="partner-preview-card partner-preview-stat" key={label} data-mascot-obstacle><BarChart3 aria-hidden="true" size={20} /><span>{label}</span><strong>—</strong></div>)}</div><EmptyPanel title="No earnings history" description="Approved work and any recorded payments will appear here after the portal launches." />
            </section>
          )}

          {view === 'profile' && (
            <section className="partner-preview-view" aria-labelledby="partner-preview-title"><p className="partner-preview-eyebrow" data-mascot-obstacle>Your account</p><h1 id="partner-preview-title" data-mascot-obstacle>Profile & support</h1><p data-mascot-obstacle>Partner details and help in one convenient space.</p>
              <div className="partner-preview-two-col"><div className="partner-preview-card" data-mascot-obstacle><span className="partner-preview-icon"><UserRound size={21} aria-hidden="true" /></span><h2>Partner profile</h2><div className="partner-preview-field">Name <span>—</span></div><div className="partner-preview-field">Mobile number <span>—</span></div><div className="partner-preview-field">Delivery area <span>—</span></div><div className="partner-preview-field">Vehicle <span>—</span></div><p className="partner-preview-hint">Account editing will be added with partner registration.</p></div><div className="partner-preview-card" data-mascot-obstacle><span className="partner-preview-icon"><CircleHelp size={21} aria-hidden="true" /></span><h2>Help & support</h2><p>Contact the NearGrow Ads team for campaign or account questions.</p><div className="partner-preview-placeholder"><CheckCircle2 aria-hidden="true" size={18} /> Support requests will appear here</div><button className="partner-preview-link" onClick={() => onNavigate('/contact')} type="button">Contact NearGrow Ads</button></div></div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
