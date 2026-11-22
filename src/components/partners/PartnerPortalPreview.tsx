import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  FileCheck2,
  LayoutDashboard,
  LogIn,
  MapPin,
  Megaphone,
  Search,
  ShieldCheck,
  UploadCloud,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import './partnerPortalPreview.css';

interface PartnerPortalPreviewProps {
  onNavigate: (path: string) => void;
}

const views = [
  { id: 'login', label: 'Partner Login', icon: LogIn },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'campaigns', label: 'Campaigns & Daily Targets', icon: Megaphone },
  { id: 'proof', label: 'Proof Submissions', icon: Camera },
  { id: 'earnings', label: 'Earnings & Progress', icon: Wallet },
  { id: 'profile', label: 'Profile & Support', icon: UserRound },
] as const;

type ViewId = typeof views[number]['id'];

function ScreenHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="partner-preview-screen-header" data-mascot-obstacle>
      <p className="partner-preview-eyebrow">{eyebrow}</p>
      <div className="partner-preview-title-row">
        <h1 id="partner-preview-screen-title">{title}</h1>
        <span className="partner-preview-design-label">Design preview</span>
      </div>
      <p className="partner-preview-description">{description}</p>
    </div>
  );
}

function MetricCard({ Icon, label, detail }: { Icon: LucideIcon; label: string; detail: string }) {
  return (
    <article className="partner-preview-card partner-preview-metric-card" data-mascot-obstacle>
      <div className="partner-preview-metric-icon"><Icon aria-hidden="true" size={19} /></div>
      <span className="partner-preview-metric-label">{label}</span>
      <strong>—</strong>
      <span className="partner-preview-metric-detail">{detail}</span>
    </article>
  );
}

function MockField({ label, placeholder, type = 'text' }: { label: string; placeholder: string; type?: string }) {
  return (
    <label className="partner-preview-field-control">
      <span>{label}</span>
      <input type={type} placeholder={placeholder} disabled />
    </label>
  );
}

function EmptyPanel({ Icon = FileCheck2, title, description }: { Icon?: LucideIcon; title: string; description: string }) {
  return (
    <div className="partner-preview-empty" data-mascot-obstacle>
      <Icon aria-hidden="true" size={25} />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function LoginView({ onExplore }: { onExplore: () => void }) {
  return (
    <section className="partner-preview-view partner-preview-login" aria-labelledby="partner-login-title">
      <div className="partner-preview-login-copy" data-mascot-obstacle>
        <p className="partner-preview-eyebrow">LocalDrop partner access</p>
        <h1 id="partner-login-title">Welcome to your LocalDrop workspace.</h1>
        <p className="partner-preview-description">
          A proposed home for campaign assignments, daily targets, proof submissions and progress.
        </p>
        <ul className="partner-preview-login-features">
          <li><CheckCircle2 aria-hidden="true" size={18} /> Campaign instructions in one place</li>
          <li><CheckCircle2 aria-hidden="true" size={18} /> A clear view of daily targets</li>
          <li><CheckCircle2 aria-hidden="true" size={18} /> Proof and progress at a glance</li>
        </ul>
      </div>

      <div className="partner-preview-card partner-preview-login-card" data-mascot-obstacle>
        <span className="partner-preview-design-label">Design preview</span>
        <h2>Partner Login</h2>
        <p className="partner-preview-muted">Sign-in layout for delivery partners.</p>
        <div className="partner-preview-login-fields">
          <MockField label="Mobile number or email" placeholder="Enter mobile number or email" />
          <MockField label="Password" placeholder="Enter password" type="password" />
        </div>
        <div className="partner-preview-login-actions">
          <button type="button" className="partner-preview-text-button" disabled>Forgot password?</button>
        </div>
        <button type="button" className="partner-preview-primary-button" disabled>Login</button>
        <p className="partner-preview-register">New to LocalDrop? <button type="button" disabled>Register now</button></p>
        <button type="button" className="partner-preview-secondary-button" onClick={onExplore}>
          Explore portal screens <ArrowRight aria-hidden="true" size={16} />
        </button>
      </div>
    </section>
  );
}

function DashboardView() {
  return (
    <section className="partner-preview-view" aria-labelledby="partner-preview-screen-title">
      <ScreenHeader eyebrow="Dashboard" title="Welcome, Partner" description="Your LocalDrop workspace at a glance." />
      <div className="partner-preview-stat-grid">
        <MetricCard Icon={Megaphone} label="Assigned campaigns" detail="Campaign overview" />
        <MetricCard Icon={CalendarDays} label="Today's target" detail="Daily distribution" />
        <MetricCard Icon={FileCheck2} label="Proofs under review" detail="Submission status" />
        <MetricCard Icon={Wallet} label="Approved earnings" detail="Earnings summary" />
      </div>

      <div className="partner-preview-dashboard-grid">
        <section className="partner-preview-card" data-mascot-obstacle>
          <div className="partner-preview-section-heading">
            <div><h2>Your assigned campaigns</h2><p className="partner-preview-muted">Campaign details will appear here when available.</p></div>
            <button type="button" className="partner-preview-text-button" disabled>View all</button>
          </div>
          <div className="partner-preview-table-wrap">
            <table className="partner-preview-table">
              <thead><tr><th>Campaign</th><th>Area</th><th>Schedule</th><th>Status</th></tr></thead>
              <tbody><tr><td colSpan={4}>No campaign assignments in this design preview.</td></tr></tbody>
            </table>
          </div>
        </section>

        <section className="partner-preview-card partner-preview-distribution" data-mascot-obstacle>
          <div className="partner-preview-card-title"><CalendarDays aria-hidden="true" size={19} /><h2>Today's distribution</h2></div>
          <div className="partner-preview-distribution-total"><strong>—</strong><span>Daily target</span></div>
          <div className="partner-preview-progress" aria-label="Distribution progress preview"><span /></div>
          <p className="partner-preview-muted">Progress appears after a campaign is assigned.</p>
          <button type="button" className="partner-preview-secondary-button" disabled>View daily targets</button>
        </section>
      </div>

      <div className="partner-preview-lower-grid">
        <section className="partner-preview-card" data-mascot-obstacle>
          <div className="partner-preview-section-heading"><div><h2>Quick actions</h2><p className="partner-preview-muted">Shortcuts for your partner workspace.</p></div></div>
          <div className="partner-preview-quick-actions">
            <button type="button" disabled><Megaphone aria-hidden="true" size={17} /> View campaigns</button>
            <button type="button" disabled><Camera aria-hidden="true" size={17} /> Submit proof</button>
            <button type="button" disabled><Wallet aria-hidden="true" size={17} /> View earnings</button>
          </div>
        </section>
        <section className="partner-preview-card" data-mascot-obstacle>
          <div className="partner-preview-card-title"><ClipboardCheck aria-hidden="true" size={19} /><h2>Recent activity</h2></div>
          <EmptyPanel title="Nothing to show yet" description="Campaign and proof activity will appear here." />
        </section>
      </div>
    </section>
  );
}

function CampaignsView() {
  return (
    <section className="partner-preview-view" aria-labelledby="partner-preview-screen-title">
      <ScreenHeader eyebrow="Campaign workspace" title="Campaigns & daily targets" description="Review campaign instructions and the daily distribution plan." />
      <div className="partner-preview-campaign-toolbar">
        <div className="partner-preview-filter-tabs" aria-label="Campaign status filters">
          <button type="button" aria-pressed="true" disabled>Assigned</button>
          <button type="button" disabled>In progress</button>
          <button type="button" disabled>Completed</button>
        </div>
        <label className="partner-preview-search"><Search aria-hidden="true" size={17} /><input type="search" placeholder="Search campaigns" disabled /></label>
      </div>
      <div className="partner-preview-campaign-grid">
        <section className="partner-preview-card partner-preview-campaign-list" data-mascot-obstacle>
          <div className="partner-preview-section-heading"><div><h2>Campaign assignments</h2><p className="partner-preview-muted">Your current and upcoming campaigns.</p></div><span className="partner-preview-count">— assigned</span></div>
          <div className="partner-preview-campaign-placeholder">
            <div className="partner-preview-campaign-art"><MapPin aria-hidden="true" size={25} /><span>Campaign preview</span></div>
            <div className="partner-preview-campaign-copy">
              <span className="partner-preview-status">Assignment details</span>
              <h3>No campaign assigned</h3>
              <p>Business, area, schedule and campaign instructions will appear here.</p>
              <div className="partner-preview-campaign-meta"><span><MapPin aria-hidden="true" size={14} /> Area to be assigned</span><span><CalendarDays aria-hidden="true" size={14} /> Schedule to be confirmed</span></div>
              <button type="button" className="partner-preview-secondary-button" disabled>View campaign details</button>
            </div>
          </div>
        </section>
        <section className="partner-preview-card partner-preview-target-card" data-mascot-obstacle>
          <div className="partner-preview-card-title"><CalendarDays aria-hidden="true" size={19} /><h2>Daily targets</h2></div>
          <p className="partner-preview-muted">Your distribution plan for the selected campaign.</p>
          <div className="partner-preview-target-total"><span>Today's target</span><strong>—</strong></div>
          <div className="partner-preview-target-row"><span>Cards distributed</span><strong>—</strong></div>
          <div className="partner-preview-progress" aria-label="Daily target progress preview"><span /></div>
          <div className="partner-preview-target-row"><span>Remaining</span><strong>—</strong></div>
          <button type="button" className="partner-preview-primary-button" disabled>Submit distribution update</button>
          <p className="partner-preview-small-note">Target details appear after a campaign is assigned.</p>
        </section>
      </div>
    </section>
  );
}

function ProofView() {
  return (
    <section className="partner-preview-view" aria-labelledby="partner-preview-screen-title">
      <ScreenHeader eyebrow="Distribution proof" title="Proof submissions" description="A proposed workflow for documenting card distribution and review." />
      <div className="partner-preview-proof-grid">
        <section className="partner-preview-card" data-mascot-obstacle>
          <div className="partner-preview-section-heading"><div><h2>New proof submission</h2><p className="partner-preview-muted">Fields shown for design purposes only.</p></div><span className="partner-preview-status">Preview form</span></div>
          <fieldset className="partner-preview-mock-form" disabled>
            <label className="partner-preview-field-control"><span>Assigned campaign</span><select defaultValue=""><option value="">Select a campaign</option></select></label>
            <div className="partner-preview-inline-fields">
              <label className="partner-preview-field-control"><span>Distribution date</span><input type="date" /></label>
              <label className="partner-preview-field-control"><span>Cards distributed</span><input type="number" placeholder="Enter quantity" /></label>
            </div>
            <div className="partner-preview-upload-box"><UploadCloud aria-hidden="true" size={25} /><strong>Add photo proof</strong><span>Choose or drop files here</span><small>Image uploads are not active in this preview.</small><button type="button" className="partner-preview-secondary-button" disabled>Choose photos</button></div>
            <label className="partner-preview-checkbox"><input type="checkbox" /> I confirm these details are accurate.</label>
            <div className="partner-preview-form-actions"><button type="button" className="partner-preview-primary-button" disabled>Submit for review</button><button type="button" className="partner-preview-secondary-button" disabled>Save draft</button></div>
          </fieldset>
        </section>

        <div className="partner-preview-proof-aside">
          <section className="partner-preview-card" data-mascot-obstacle>
            <div className="partner-preview-card-title"><CheckCircle2 aria-hidden="true" size={19} /><h2>Before you submit</h2></div>
            <ul className="partner-preview-checklist">
              <li><CheckCircle2 aria-hidden="true" size={17} /> Select the assigned campaign</li>
              <li><CheckCircle2 aria-hidden="true" size={17} /> Add the distribution date and quantity</li>
              <li><CheckCircle2 aria-hidden="true" size={17} /> Include clear photo proof</li>
            </ul>
          </section>
          <section className="partner-preview-card" data-mascot-obstacle>
            <div className="partner-preview-card-title"><ShieldCheck aria-hidden="true" size={19} /><h2>Review process</h2></div>
            <ol className="partner-preview-review-steps"><li><span>1</span> Proof submitted</li><li><span>2</span> Team review</li><li><span>3</span> Status update</li></ol>
          </section>
        </div>
      </div>
      <section className="partner-preview-card partner-preview-history" data-mascot-obstacle>
        <div className="partner-preview-section-heading"><div><h2>Submission history</h2><p className="partner-preview-muted">Submitted proof and review status.</p></div><span className="partner-preview-count">— submissions</span></div>
        <EmptyPanel title="No proof submissions" description="Your submission history will appear here." />
      </section>
    </section>
  );
}

function EarningsView() {
  return (
    <section className="partner-preview-view" aria-labelledby="partner-preview-screen-title">
      <ScreenHeader eyebrow="Partner progress" title="Earnings & progress" description="A proposed overview of verified distribution and earnings records." />
      <div className="partner-preview-stat-grid">
        <MetricCard Icon={Wallet} label="Approved earnings" detail="Verified work" />
        <MetricCard Icon={CalendarDays} label="Pending verification" detail="Under review" />
        <MetricCard Icon={BarChart3} label="Recorded payments" detail="Payment history" />
        <MetricCard Icon={CheckCircle2} label="Verified distributions" detail="Approved proof" />
      </div>
      <div className="partner-preview-earnings-grid">
        <section className="partner-preview-card" data-mascot-obstacle>
          <div className="partner-preview-section-heading"><div><h2>Earnings history</h2><p className="partner-preview-muted">Approved campaign earnings and payment records.</p></div><button type="button" className="partner-preview-text-button" disabled>View all</button></div>
          <div className="partner-preview-table-wrap">
            <table className="partner-preview-table">
              <thead><tr><th>Campaign</th><th>Period</th><th>Status</th><th>Amount</th></tr></thead>
              <tbody><tr><td colSpan={4}>No earnings records in this design preview.</td></tr></tbody>
            </table>
          </div>
        </section>
        <section className="partner-preview-card" data-mascot-obstacle>
          <div className="partner-preview-card-title"><BarChart3 aria-hidden="true" size={19} /><h2>How progress is tracked</h2></div>
          <ol className="partner-preview-review-steps"><li><span>1</span> Complete an assigned distribution</li><li><span>2</span> Submit proof for review</li><li><span>3</span> Check the verified status</li></ol>
          <p className="partner-preview-small-note">No earnings or payment information is shown in this preview.</p>
        </section>
      </div>
    </section>
  );
}

function ProfileView() {
  return (
    <section className="partner-preview-view" aria-labelledby="partner-preview-screen-title">
      <ScreenHeader eyebrow="Your account" title="Profile & support" description="A proposed space for partner details, account status and help." />
      <div className="partner-preview-profile-grid">
        <section className="partner-preview-card partner-preview-profile-card" data-mascot-obstacle>
          <div className="partner-preview-section-heading"><div><h2>Profile & account</h2><p className="partner-preview-muted">Partner details shown as empty fields.</p></div><span className="partner-preview-status">Profile preview</span></div>
          <div className="partner-preview-photo-row">
            <div className="partner-preview-photo-placeholder"><UserRound aria-hidden="true" size={27} /></div>
            <div><strong>Profile photo</strong><p className="partner-preview-muted">No photo added</p></div>
            <button type="button" className="partner-preview-secondary-button" disabled>Upload photo</button>
          </div>
          <div className="partner-preview-profile-fields">
            <MockField label="Full name" placeholder="Enter full name" />
            <MockField label="Mobile number" placeholder="Enter mobile number" type="tel" />
            <MockField label="Email address" placeholder="Enter email address" type="email" />
            <MockField label="Delivery area" placeholder="Enter delivery area" />
            <MockField label="Vehicle type" placeholder="Select vehicle type" />
            <MockField label="Availability" placeholder="Set availability" />
          </div>
          <div className="partner-preview-form-actions"><button type="button" className="partner-preview-primary-button" disabled>Save changes</button><button type="button" className="partner-preview-secondary-button" disabled>Cancel</button></div>
        </section>

        <section className="partner-preview-card partner-preview-support-card" data-mascot-obstacle>
          <div className="partner-preview-card-title"><CircleHelp aria-hidden="true" size={19} /><h2>Help & support</h2></div>
          <p className="partner-preview-muted">Common questions for LocalDrop partners.</p>
          <div className="partner-preview-faq-list">
            <button type="button" disabled>How do campaign assignments work?<ChevronDown aria-hidden="true" size={16} /></button>
            <button type="button" disabled>How do I submit distribution proof?<ChevronDown aria-hidden="true" size={16} /></button>
            <button type="button" disabled>Where can I see my progress?<ChevronDown aria-hidden="true" size={16} /></button>
          </div>
          <div className="partner-preview-support-form">
            <h3>Need more help?</h3>
            <MockField label="Topic" placeholder="Choose a support topic" />
            <label className="partner-preview-field-control"><span>Message</span><textarea placeholder="Write your message" disabled rows={3} /></label>
            <button type="button" className="partner-preview-primary-button" disabled>Send support request</button>
            <p className="partner-preview-small-note">Support requests are not sent from this design preview.</p>
          </div>
        </section>

        <aside className="partner-preview-card partner-preview-account-status" data-mascot-obstacle>
          <div className="partner-preview-card-title"><ShieldCheck aria-hidden="true" size={19} /><h2>Account status</h2></div>
          <span className="partner-preview-status">Not provided</span>
          <p className="partner-preview-muted">Account and verification details will appear here after registration and review.</p>
          <div className="partner-preview-security-note"><ShieldCheck aria-hidden="true" size={17} /><span>Account security settings</span><strong>—</strong></div>
        </aside>
      </div>
    </section>
  );
}

export const PartnerPortalPreview: React.FC<PartnerPortalPreviewProps> = ({ onNavigate }) => {
  const [view, setView] = useState<ViewId>('login');

  return (
    <div className="partner-preview">
      <div className="partner-preview-banner" role="note">
        Design preview only. Sign-in, accounts, uploads, support requests and partner actions are not functional.
      </div>
      <div className="partner-preview-layout">
        <aside className="partner-preview-sidebar" aria-label="Partner preview navigation">
          <p className="partner-preview-brand">NearGrow <span>LocalDrop</span></p>
          <nav aria-label="Preview screens">
            {views.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
                <Icon aria-hidden="true" size={18} /> <span>{label}</span>
              </button>
            ))}
          </nav>
          <button className="partner-preview-back" type="button" onClick={() => onNavigate('/partners/localdrop')}>
            <ArrowLeft aria-hidden="true" size={16} /> Back to LocalDrop
          </button>
        </aside>

        <div className="partner-preview-content">
          <header className="partner-preview-topline">
            <div><span className="partner-preview-app-name">NearGrow <strong>LocalDrop</strong></span><span className="partner-preview-app-caption">Partner workspace</span></div>
            <span className="partner-preview-app-badge">Design preview</span>
          </header>
          <nav className="partner-preview-mobile-tabs" aria-label="Preview screens">
            {views.map(({ id, label }) => (
              <button type="button" key={id} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>{label}</button>
            ))}
          </nav>

          {view === 'login' && <LoginView onExplore={() => setView('dashboard')} />}
          {view === 'dashboard' && <DashboardView />}
          {view === 'campaigns' && <CampaignsView />}
          {view === 'proof' && <ProofView />}
          {view === 'earnings' && <EarningsView />}
          {view === 'profile' && <ProfileView />}
        </div>
      </div>
    </div>
  );
};
