import { useState } from 'react';
import {
  BarChart3,
  CalendarDays,
  Camera,
  CircleHelp,
  FileCheck2,
  LayoutDashboard,
  LogOut,
  Megaphone,
  ShieldCheck,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { PartnerProfile } from './partnerTypes';
import './partnerPortalPreview.css';

const sections = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'campaigns', label: 'Campaigns & Daily Targets', icon: Megaphone },
  { id: 'proof', label: 'Proof Submissions', icon: Camera },
  { id: 'earnings', label: 'Earnings & Progress', icon: Wallet },
  { id: 'profile', label: 'Profile & Support', icon: UserRound },
] as const;

type SectionId = typeof sections[number]['id'];

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header className="partner-preview-screen-header" data-mascot-obstacle>
      <p className="partner-preview-eyebrow">{eyebrow}</p>
      <h1 id="partner-workspace-page-title" className="partner-workspace-page-title">{title}</h1>
      <p className="partner-preview-description">{description}</p>
    </header>
  );
}

function EmptyCard({ Icon, title, description }: { Icon: LucideIcon; title: string; description: string }) {
  return (
    <section className="partner-preview-card" data-mascot-obstacle>
      <div className="partner-preview-card-title"><Icon aria-hidden="true" size={19} /><h2>{title}</h2></div>
      <div className="partner-preview-empty">
        <Icon aria-hidden="true" size={25} />
        <h3>Not available yet</h3>
        <p>{description}</p>
      </div>
    </section>
  );
}

function DashboardSection({ fullName }: { fullName: string }) {
  return (
    <section className="partner-preview-view" aria-labelledby="partner-workspace-page-title">
      <PageHeading
        eyebrow="Dashboard"
        title={`Welcome, ${fullName.split(/\s+/)[0] || 'Partner'}`}
        description="Your NearGrow WildCard workspace. Campaign, proof and earnings data will appear here when those workflows are available."
      />
      <div className="partner-workspace-empty-grid">
        <EmptyCard Icon={Megaphone} title="Campaigns" description="Campaign assignments are not connected yet." />
        <EmptyCard Icon={CalendarDays} title="Daily targets" description="Daily target data is not connected yet." />
        <EmptyCard Icon={FileCheck2} title="Proof submissions" description="Proof submission data is not connected yet." />
        <EmptyCard Icon={Wallet} title="Earnings" description="Earnings and payment data is not connected yet." />
      </div>
    </section>
  );
}

function CampaignsSection() {
  return (
    <section className="partner-preview-view" aria-labelledby="partner-workspace-page-title">
      <PageHeading
        eyebrow="Campaign workspace"
        title="Campaigns & daily targets"
        description="Campaign assignments and distribution targets will be shown here once the campaign workflow is connected."
      />
      <div className="partner-preview-campaign-grid">
        <EmptyCard Icon={Megaphone} title="Campaign assignments" description="There are no campaign records available to display." />
        <EmptyCard Icon={CalendarDays} title="Daily targets" description="There are no daily target records available to display." />
      </div>
    </section>
  );
}

function ProofSection() {
  return (
    <section className="partner-preview-view" aria-labelledby="partner-workspace-page-title">
      <PageHeading
        eyebrow="Distribution proof"
        title="Proof submissions"
        description="Submission and review history will appear here when the proof workflow is available."
      />
      <div className="partner-preview-proof-grid">
        <EmptyCard Icon={Camera} title="Submit proof" description="Proof uploads are not available yet. No submission will be accepted from this page." />
        <EmptyCard Icon={FileCheck2} title="Submission history" description="There are no proof records available to display." />
      </div>
    </section>
  );
}

function EarningsSection() {
  return (
    <section className="partner-preview-view" aria-labelledby="partner-workspace-page-title">
      <PageHeading
        eyebrow="Partner progress"
        title="Earnings & progress"
        description="Verified progress and earnings will appear here when those backend workflows are available."
      />
      <div className="partner-preview-earnings-grid">
        <EmptyCard Icon={BarChart3} title="Progress" description="There are no verified progress records available to display." />
        <EmptyCard Icon={Wallet} title="Earnings" description="There are no earnings or payment records available to display. Payments are not enabled here." />
      </div>
    </section>
  );
}

function ProfileSection({ profile }: { profile: PartnerProfile }) {
  const accountStatus = profile.status[0].toUpperCase() + profile.status.slice(1);
  return (
    <section className="partner-preview-view" aria-labelledby="partner-workspace-page-title">
      <PageHeading
        eyebrow="Your account"
        title="Profile & support"
        description="Your registered partner details and current account status."
      />
      <div className="partner-preview-profile-grid partner-workspace-profile-grid">
        <section className="partner-preview-card" data-mascot-obstacle>
          <div className="partner-preview-card-title"><UserRound aria-hidden="true" size={19} /><h2>Partner profile</h2></div>
          <dl className="partner-workspace-profile-details">
            <div><dt>Full name</dt><dd>{profile.fullName}</dd></div>
            <div><dt>Email address</dt><dd>{profile.email}</dd></div>
            <div><dt>Mobile number</dt><dd>{profile.mobileNumber}</dd></div>
          </dl>
        </section>
        <section className="partner-preview-card" data-mascot-obstacle>
          <div className="partner-preview-card-title"><CircleHelp aria-hidden="true" size={19} /><h2>Support</h2></div>
          <p className="partner-preview-muted">For help with your partner account, contact NearGrow Ads support.</p>
          <div className="partner-workspace-contact-links">
            <a href="mailto:info@neargrowads.in">Email support</a>
            <a href="tel:+919289810149">Call support</a>
          </div>
        </section>
        <aside className="partner-preview-card partner-preview-account-status" data-mascot-obstacle>
          <div className="partner-preview-card-title"><ShieldCheck aria-hidden="true" size={19} /><h2>Account status</h2></div>
          <span className="partner-preview-status">{accountStatus}</span>
          <p className="partner-preview-muted">This is the status currently associated with your partner account.</p>
        </aside>
      </div>
    </section>
  );
}

export function PartnerWorkspace({
  profile,
  logoutError,
  onLogout,
  busy,
}: {
  profile: PartnerProfile;
  logoutError: string;
  onLogout: () => void;
  busy: boolean;
}) {
  const [section, setSection] = useState<SectionId>('dashboard');

  return (
    <div className="partner-preview partner-workspace">
      <div className="partner-preview-layout">
        <aside className="partner-preview-sidebar" aria-label="Partner workspace">
          <p className="partner-preview-brand">NearGrow <span>WildCard</span></p>
          <nav aria-label="Partner workspace navigation">
            {sections.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>
                <Icon aria-hidden="true" size={18} /> <span>{label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="partner-preview-content">
          <header className="partner-preview-topline">
            <div>
              <span className="partner-preview-app-name">NearGrow <strong>WildCard</strong></span>
              <span className="partner-preview-app-caption">Partner workspace</span>
            </div>
            <button type="button" onClick={onLogout} disabled={busy} className="partner-workspace-logout">
              <LogOut aria-hidden="true" size={15} /> Log out
            </button>
          </header>
          <nav className="partner-preview-mobile-tabs" aria-label="Partner workspace navigation">
            {sections.map(({ id, label }) => (
              <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>
                {label}
              </button>
            ))}
          </nav>
          {logoutError && <p className="partner-workspace-error" role="alert">{logoutError}</p>}

          {section === 'dashboard' && <DashboardSection fullName={profile.fullName} />}
          {section === 'campaigns' && <CampaignsSection />}
          {section === 'proof' && <ProofSection />}
          {section === 'earnings' && <EarningsSection />}
          {section === 'profile' && <ProfileSection profile={profile} />}
        </div>
      </div>
    </div>
  );
}
