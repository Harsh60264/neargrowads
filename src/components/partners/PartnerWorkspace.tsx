import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Coins,
  Crosshair,
  FileCheck2,
  Gauge,
  HandCoins,
  LayoutDashboard,
  LifeBuoy,
  Layers,
  LocateFixed,
  LogOut,
  MailCheck,
  MapPin,
  Menu,
  Megaphone,
  Package,
  Pencil,
  Phone,
  Search,
  Send,
  ShieldCheck,
  Store,
  Upload,
  UserRound,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { PartnerProfile } from './partnerTypes';
import { buildPartnerWorkspaceActivity } from './partnerWorkspaceActivity';
import './partnerPortalPreview.css';

const sections = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'campaigns', label: 'Campaigns & Daily Targets', icon: Megaphone },
  { id: 'proof', label: 'Proof Submissions', icon: Camera },
  { id: 'earnings', label: 'Earnings & Progress', icon: Wallet },
  { id: 'profile', label: 'Profile & Support', icon: UserRound },
] as const;

type SectionId = typeof sections[number]['id'];
type ProofStatus = 'pending' | 'approved' | 'needs_correction' | 'rejected';

interface CampaignSite {
  id: string;
  name: string;
  address: string;
}

interface PartnerCampaign {
  assignmentId: string;
  dailyTarget: number;
  stockAvailable: number;
  deliveriesToday: number;
  submissionsToday: number;
  campaign: {
    id: string;
    name: string;
    description: string;
    area: string;
    start_date: string;
    end_date: string;
    daily_target: number;
    coins_per_proof: number;
    status: string;
    map_center_latitude?: number | null;
    map_center_longitude?: number | null;
  };
  sites: CampaignSite[];
}

interface PartnerProof {
  id: string;
  assignment_id: string;
  campaign_id: string;
  site_id: string;
  photoUrl: string;
  note: string;
  latitude: number | null;
  longitude: number | null;
  coins: number;
  status: ProofStatus;
  review_note: string;
  submitted_at: string;
  reviewed_at: string | null;
}

interface StockMovement {
  id: string;
  assignment_id: string;
  movement_type: string;
  quantity: number;
  notes: string;
  created_at: string;
}

interface CampaignRequest {
  id: string;
  assignment_id: string;
  request_type: string;
  details: string;
  status: string;
  review_note: string;
  created_at: string;
}

interface DamageReport {
  id: string;
  assignment_id: string;
  card_id: string;
  issue_type: string;
  details: string;
  status: string;
  created_at: string;
}

interface CoinLedgerEntry {
  id: string;
  campaign_id: string | null;
  entry_type: 'earning' | 'withdrawal' | 'adjustment';
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'requested' | 'settled';
  reference: string;
  notes: string;
  created_at: string;
}

interface Withdrawal {
  id: string;
  amount: number;
  status: string;
  reference: string;
  review_note: string;
  created_at: string;
}

interface PartnerWorkspaceData {
  user: PartnerProfile;
  campaigns: PartnerCampaign[];
  proofs: PartnerProof[];
  stockHistory: StockMovement[];
  requests: CampaignRequest[];
  damageReports: DamageReport[];
  ledger: CoinLedgerEntry[];
  withdrawals: Withdrawal[];
  coinSummary: {
    balance: number;
    totalEarned: number;
    totalWithdrawn: number;
    pendingApproval: number;
  };
}

interface PartnerApiResponse {
  message?: string;
  authenticated?: boolean;
  user?: PartnerProfile;
  proofId?: string;
  requestId?: string;
  [key: string]: unknown;
}

async function partnerApi<T extends PartnerApiResponse>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  let data: T;
  try {
    data = await response.json() as T;
  } catch {
    throw new Error('The partner service returned an unreadable response.');
  }
  if (!response.ok) throw new Error(data.message || 'The request could not be completed.');
  return data;
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header className="nwg-page-heading">
      <p className="nwg-eyebrow">{eyebrow}</p>
      <h1 id="partner-workspace-page-title">{title}</h1>
      <p>{description}</p>
    </header>
  );
}

function CardHeading({ icon: Icon, title, description, trailing }: {
  icon: LucideIcon;
  title: string;
  description?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="nwg-card-heading">
      <div className="nwg-card-heading-main">
        <Icon size={20} aria-hidden="true" />
        <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
      </div>
      {trailing}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: 'Pending',
    approved: 'Approved',
    needs_correction: 'Needs correction',
    rejected: 'Rejected',
    requested: 'Requested',
    settled: 'Settled',
    active: 'Active',
    paused: 'Paused',
    completed: 'Completed',
    resolved: 'Resolved',
  };
  return <span className={`nwg-status nwg-status-${status}`}>{labels[status] || status.replaceAll('_', ' ')}</span>;
}

function EmptyState({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return <div className="nwg-empty"><Icon size={25} aria-hidden="true" /><strong>{title}</strong><p>{detail}</p></div>;
}

function MetricCard({ icon: Icon, label, value, detail, tone }: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: 'soft';
}) {
  return (
    <article className={`nwg-metric${tone ? ` nwg-metric-${tone}` : ''}`}>
      <span className="nwg-metric-icon"><Icon size={21} aria-hidden="true" /></span>
      <span className="nwg-metric-label">{label}</span>
      <strong>{value}</strong>
      <span className="nwg-metric-detail">{detail}</span>
    </article>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function campaignName(data: PartnerWorkspaceData, campaignId: string | null): string {
  return data.campaigns.find((assignment) => assignment.campaign.id === campaignId)?.campaign.name || 'Partner activity';
}

function getInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || 'P';
}

function DashboardSection({ data, onNavigate }: { data: PartnerWorkspaceData; onNavigate: (section: SectionId) => void }) {
  const campaign = data.campaigns.find((item) => item.campaign.status === 'active') || data.campaigns[0];
  const approved = data.proofs.filter((proof) => proof.status === 'approved');
  const pending = data.proofs.filter((proof) => proof.status === 'pending');
  const dailyTarget = campaign?.dailyTarget || 0;
  const dailyPercent = dailyTarget > 0 ? Math.min(100, Math.round((campaign.deliveriesToday / dailyTarget) * 100)) : 0;
  const recent = data.proofs.slice(0, 5);
  const activity = useMemo(() => buildPartnerWorkspaceActivity(data).slice(0, 6), [data]);
  const coinProgress = Math.min(100, Math.round((data.coinSummary.balance / 100000) * 100));
  return (
    <section className="nwg-screen nwg-dashboard-screen" aria-labelledby="partner-workspace-page-title">
      <PageHeading eyebrow="Dashboard" title={`Welcome, ${data.user.fullName.split(/\s+/)[0] || 'Partner'}`}
        description="Here’s your campaign progress, delivery stock, and latest activity in your NearGrow WildCard workspace." />
      <div className="nwg-dashboard-hero">
        <article className="nwg-active-campaign">
          <div className="nwg-inline-heading"><Megaphone size={21} /><strong>Active campaign</strong>
            {campaign && <StatusPill status={campaign.campaign.status} />}
          </div>
          {campaign ? <>
            <h2>{campaign.campaign.name}</h2>
            <p>{campaign.campaign.description || `Build local awareness across ${campaign.campaign.area}.`}</p>
            <div className="nwg-campaign-meta">
              <span><CalendarDays size={16} />{campaign.campaign.start_date} – {campaign.campaign.end_date}</span>
              <span><MapPin size={16} />{campaign.campaign.area}</span>
            </div>
          </> : <div className="nwg-empty nwg-empty-inverse"><strong>No campaign assigned</strong>
            <p>Your active assignments will appear here when the owner assigns a campaign.</p></div>}
        </article>
        <article className="nwg-card nwg-daily-progress">
          <div className="nwg-progress-heading"><div className="nwg-inline-heading"><Gauge size={21} /><strong>Daily progress</strong></div>
            <div className="nwg-progress-numbers"><strong>{campaign ? `${campaign.deliveriesToday} / ${dailyTarget}` : '—'}</strong><span>Deliveries today</span></div>
          </div>
          {campaign && dailyTarget > 0
            ? <div className="nwg-progress-track" role="progressbar" aria-label="Daily delivery target"
              aria-valuenow={campaign.deliveriesToday} aria-valuemin={0} aria-valuemax={dailyTarget}>
              <span style={{ width: `${dailyPercent}%` }} />
            </div>
            : <p className="nwg-muted">{campaign
              ? 'No daily delivery target is configured for this assignment.'
              : 'Your daily progress will appear after a campaign is assigned.'}</p>}
          {campaign && campaign.submissionsToday > campaign.deliveriesToday &&
            <p className="nwg-muted">{campaign.submissionsToday - campaign.deliveriesToday} submission(s) awaiting review.</p>}
        </article>
      </div>

      <div className="nwg-dashboard-stats">
        <MetricCard icon={Package} label="Delivery stock" value={formatNumber(data.campaigns.reduce((sum, item) => sum + item.stockAvailable, 0))}
          detail="Available deliveries" tone="soft" />
        <MetricCard icon={CheckCircle2} label="Approved" value={formatNumber(approved.length)} detail="Proofs approved" />
        <MetricCard icon={Clock3} label="Pending" value={formatNumber(pending.length)} detail="Proofs under review" />
        <MetricCard icon={Coins} label="NGA Coins" value={formatNumber(data.coinSummary.balance)} detail="Available balance" />
      </div>
      <div className="nwg-dashboard-submit">
        <div><strong>Finished a WildCard handover?</strong><span>Submit a clear proof photo for campaign-owner review.</span></div>
        <button type="button" className="nwg-button nwg-button-primary" onClick={() => onNavigate('proof')}>
          <Camera size={16} />Submit proof<ArrowRight size={15} />
        </button>
      </div>

      <div className="nwg-dashboard-lower">
        <section className="nwg-card nwg-table-card nwg-recent-deliveries">
          <CardHeading icon={Layers} title="Recent deliveries"
            trailing={<button type="button" className="nwg-link-button" onClick={() => onNavigate('proof')}>View all <ArrowRight size={15} /></button>} />
          {recent.length ? <>
            <div className="nwg-table-scroll"><table className="nwg-table">
              <thead><tr><th>Delivery ID</th><th>Task / Shop</th><th>Date submitted</th><th>Status</th><th>Reviewed on</th><th>Photo</th></tr></thead>
              <tbody>{recent.map((proof) => {
                const site = data.campaigns.flatMap((item) => item.sites).find((item) => item.id === proof.site_id);
                return <tr key={proof.id}>
                  <td><strong>{proof.id.slice(0, 8).toUpperCase()}</strong></td>
                  <td>{site?.name || campaignName(data, proof.campaign_id)}</td>
                  <td>{formatDate(proof.submitted_at)}</td>
                  <td><StatusPill status={proof.status} /></td>
                  <td>{formatDate(proof.reviewed_at)}</td>
                  <td><a className="nwg-photo-link" href={proof.photoUrl} target="_blank" rel="noreferrer">View photo</a></td>
                </tr>;
              })}</tbody>
            </table></div>
            <div className="nwg-delivery-cards">{recent.map((proof) => {
              const site = data.campaigns.flatMap((item) => item.sites).find((item) => item.id === proof.site_id);
              return <article className="nwg-delivery-card" key={proof.id}>
                <div><strong>{site?.name || campaignName(data, proof.campaign_id)}</strong><StatusPill status={proof.status} /></div>
                <small>{proof.id.slice(0, 8).toUpperCase()} · {formatDate(proof.submitted_at)}</small>
                <a className="nwg-photo-link" href={proof.photoUrl} target="_blank" rel="noreferrer">View private proof photo</a>
              </article>;
            })}</div>
          </> : <EmptyState icon={FileCheck2} title="No deliveries submitted yet"
            detail="Submit a proof after completing an assigned campaign delivery." />}
        </section>
        <aside className="nwg-card nwg-quick-summary">
          <CardHeading icon={BarChart3} title="Quick summary"
            description="Your current partner workspace totals." />
          <div className="nwg-summary-balance">
            <span>Available NGA Coins</span>
            <strong><Coins size={18} />{formatNumber(data.coinSummary.balance)}</strong>
            <div className="nwg-summary-progress" role="progressbar" aria-label="Withdrawal threshold progress"
              aria-valuenow={coinProgress} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${coinProgress}%` }} />
            </div>
            <small>{coinProgress}% of the 100,000 coin minimum withdrawal threshold</small>
          </div>
          <dl className="nwg-summary-list">
            <div><dt>Total earned</dt><dd>{formatNumber(data.coinSummary.totalEarned)}</dd></div>
            <div><dt>Pending coin approval</dt><dd>{formatNumber(data.coinSummary.pendingApproval)}</dd></div>
            <div><dt>Active assignments</dt><dd>{formatNumber(data.campaigns.filter((item) => item.campaign.status === 'active').length)}</dd></div>
          </dl>
          <button type="button" className="nwg-button nwg-button-primary nwg-summary-link" onClick={() => onNavigate('earnings')}>
            <Wallet size={16} />View earnings <ArrowRight size={15} />
          </button>
        </aside>
      </div>

      <section className="nwg-card nwg-activity-card">
        <CardHeading icon={Activity} title="Recent activity"
          description="Latest proof, stock, request, damage, and coin ledger updates." />
        {activity.length ? <div className="nwg-activity-list">{activity.map((item) => (
          <article className="nwg-activity-row" key={item.id}>
            <span className="nwg-activity-icon"><Activity size={16} /></span>
            <div className="nwg-activity-copy"><strong>{item.type}</strong><span>{item.details}</span></div>
            <time>{formatDate(item.createdAt)}</time><StatusPill status={item.status} />
          </article>
        ))}</div> : <EmptyState icon={Activity} title="No activity yet"
          detail="Your actual proof submissions, stock movements, requests, and coin activity will appear here." />}
      </section>
    </section>
  );
}

function MapPanel({ campaign }: { campaign?: PartnerCampaign }) {
  if (!campaign) {
    return <section className="nwg-card nwg-map-card">
      <EmptyState icon={MapPin} title="No assigned locations"
        detail="A campaign map and assigned shops will appear here after an assignment is made." />
    </section>;
  }
  const latitude = campaign?.campaign.map_center_latitude;
  const longitude = campaign?.campaign.map_center_longitude;
  const hasMapCenter = typeof latitude === 'number' && typeof longitude === 'number';
  const mapUrl = hasMapCenter
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${longitude - 0.025}%2C${latitude - 0.018}%2C${longitude + 0.025}%2C${latitude + 0.018}&layer=mapnik&marker=${latitude}%2C${longitude}`
    : undefined;
  const area = campaign?.campaign.area || 'Assigned campaign area';
  return (
    <section className="nwg-card nwg-map-card">
      {mapUrl ? <>
        <iframe title={`Assigned campaign area: ${area}`} src={mapUrl} loading="lazy"
          referrerPolicy="no-referrer" />
        <div className="nwg-map-caption"><MapPin size={15} /><span>Campaign area: <strong>{area}</strong></span>
          <a href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=14/${latitude}/${longitude}`}
            target="_blank" rel="noreferrer">View larger map <ArrowRight size={13} /></a></div>
        <small className="nwg-map-attribution">© OpenStreetMap contributors</small>
      </> : <div className="nwg-map-unavailable"><MapPin size={27} />
        <strong>{area}</strong>
        <span>Map coordinates will appear when provided for this campaign.</span></div>}
    </section>
  );
}

function CampaignsSection({ data, onRefresh }: { data: PartnerWorkspaceData; onRefresh: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState('');
  const [requestType, setRequestType] = useState('additional_stock');
  const [requestDetails, setRequestDetails] = useState('');
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [damageCardId, setDamageCardId] = useState('');
  const [damageType, setDamageType] = useState('damaged');
  const [damageDetails, setDamageDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const campaign = data.campaigns.find((item) => item.assignmentId === selectedId) || data.campaigns[0];
  const campaignRequests = campaign
    ? data.requests.filter((request) => request.assignment_id === campaign.assignmentId)
    : [];
  const campaignDamageReports = campaign
    ? data.damageReports.filter((report) => report.assignment_id === campaign.assignmentId)
    : [];
  const campaignStockHistory = campaign
    ? data.stockHistory.filter((movement) => movement.assignment_id === campaign.assignmentId)
    : [];
  const pendingCampaignProofs = campaign
    ? data.proofs.filter((proof) => proof.assignment_id === campaign.assignmentId && proof.status === 'pending').length
    : 0;
  const dailyProgress = campaign?.dailyTarget
    ? Math.min(100, Math.round(campaign.deliveriesToday / campaign.dailyTarget * 100))
    : 0;
  const targetMetricValue = campaign
    ? campaign.dailyTarget > 0 ? `${campaign.deliveriesToday} / ${campaign.dailyTarget}` : formatNumber(campaign.deliveriesToday)
    : '—';
  const targetMetricDetail = campaign
    ? campaign.dailyTarget > 0 ? 'Deliveries today' : 'No target configured'
    : 'No assigned campaign';
  const stockRows = useMemo(() => {
    let balance = 0;
    return [...campaignStockHistory]
      .sort((left, right) => {
        const timeDifference = Date.parse(left.created_at) - Date.parse(right.created_at);
        return (Number.isNaN(timeDifference) ? 0 : timeDifference) || left.id.localeCompare(right.id);
      })
      .map((movement) => {
        balance += movement.quantity;
        return { ...movement, balance };
      })
      .reverse()
      .slice(0, 30);
  }, [campaignStockHistory]);

  const submitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!campaign) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await partnerApi('/api/partners/campaign-requests', {
        method: 'POST',
        body: JSON.stringify({ assignmentId: campaign.assignmentId, requestType, details: requestDetails }),
      });
      setRequestDetails('');
      setRequestFormOpen(false);
      setMessage('Your request was sent to the campaign owner.');
      await onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The request could not be sent.'); }
    finally { setBusy(false); }
  };
  const submitDamage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!campaign) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await partnerApi('/api/partners/damage-reports', {
        method: 'POST',
        body: JSON.stringify({
          assignmentId: campaign.assignmentId, cardId: damageCardId,
          issueType: damageType, details: damageDetails,
        }),
      });
      setDamageCardId(''); setDamageDetails('');
      setMessage('Your damage report was sent to the campaign owner.');
      await onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The report could not be sent.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="nwg-screen nwg-campaign-screen" aria-labelledby="partner-workspace-page-title">
      <PageHeading eyebrow="Campaigns & daily targets" title="Campaigns & Daily Targets"
        description="Track active campaigns, meet your daily targets, manage stock, handle requests, and report damage." />
      {data.campaigns.length > 1 && <label className="nwg-campaign-select">Active assignment
        <select value={campaign?.assignmentId || ''} onChange={(event) => setSelectedId(event.target.value)}>
          {data.campaigns.map((item) => <option key={item.assignmentId} value={item.assignmentId}>{item.campaign.name}</option>)}
        </select><ChevronDown size={16} />
      </label>}
      <div className="nwg-campaign-metrics">
        <MetricCard icon={Gauge} label="Daily target" value={targetMetricValue} detail={targetMetricDetail} />
        <MetricCard icon={Package} label="Available stock" value={campaign ? formatNumber(campaign.stockAvailable) : '—'}
          detail="Physical WildCards" tone="soft" />
        <MetricCard icon={Store} label="Assigned shops" value={campaign ? formatNumber(campaign.sites.length) : '—'}
          detail="Approved locations" />
        <MetricCard icon={Clock3} label="Pending proofs" value={formatNumber(pendingCampaignProofs)}
          detail="Awaiting review" />
      </div>
      <div className="nwg-campaign-overview">
        <section className="nwg-card nwg-assignment-card">
          {campaign ? <>
            <div className="nwg-assignment-title">
              <span className="nwg-icon-box"><Megaphone size={23} /></span>
              <StatusPill status={campaign.campaign.status} />
              <div><h2>{campaign.campaign.name}</h2><p>{campaign.campaign.description}</p></div>
            </div>
            <div className="nwg-assignment-details">
              <div><MapPin size={19} /><span>Locality<strong>{campaign.campaign.area}</strong></span></div>
              <div><CalendarDays size={19} /><span>Daily target<strong>{campaign.dailyTarget > 0
                ? `${campaign.deliveriesToday} / ${campaign.dailyTarget}` : 'Not configured'}</strong>
                {campaign.dailyTarget > 0 && <span className="nwg-progress-track" role="progressbar"
                  aria-label="Campaign daily target" aria-valuenow={campaign.deliveriesToday}
                  aria-valuemin={0} aria-valuemax={campaign.dailyTarget}>
                  <span style={{ width: `${dailyProgress}%` }} />
                </span>}</span></div>
              <div><Package size={19} /><span>Stock (WildCards)<strong>{campaign.stockAvailable} available</strong>
                <small>{campaign.deliveriesToday} delivered today</small></span></div>
            </div>
            <div className="nwg-campaign-sites">
              <strong>Assigned shops ({campaign.sites.length})</strong>
              {campaign.sites.length ? campaign.sites.map((site) => (
                <span key={site.id}><MapPin size={14} /><span><strong>{site.name}</strong>{site.address ? ` · ${site.address}` : ''}</span></span>
              )) : <p>No shops have been assigned to this campaign.</p>}
            </div>
          </> : <EmptyState icon={Megaphone} title="No active campaign assigned"
            detail="Your campaign assignment and delivery locations will show here when they are available." />}
        </section>
        <MapPanel campaign={campaign} />
      </div>

      <div className="nwg-campaign-tools">
        <section className="nwg-card nwg-requests-card">
          <CardHeading icon={Package} title={`Requests (${campaignRequests.length})`}
            description="Partner or team requests related to your assigned campaign."
            trailing={campaign && <button type="button" className="nwg-link-button"
              aria-expanded={requestFormOpen} aria-controls="nwg-campaign-request-form"
              onClick={() => setRequestFormOpen((open) => !open)}>
              {requestFormOpen ? 'Cancel' : 'New request'}
            </button>} />
          {campaignRequests.length ? <div className="nwg-request-list">{campaignRequests.slice(0, 5).map((request) => (
            <article key={request.id} className="nwg-request-row">
              <span className="nwg-request-icon">{request.request_type === 'additional_stock' ? <Package size={18} /> : <FileCheck2 size={18} />}</span>
              <div><strong>{request.request_type.replaceAll('_', ' ')}</strong><p>{request.details}</p></div>
              <time>{formatDate(request.created_at)}</time><StatusPill status={request.status} />
            </article>
          ))}</div> : campaign && <p className="nwg-muted nwg-no-records">No requests have been submitted for this campaign.</p>}
          {campaign && requestFormOpen && <form id="nwg-campaign-request-form" className="nwg-inline-form"
            onSubmit={(event) => void submitRequest(event)}>
            <label>New request
              <select value={requestType} onChange={(event) => setRequestType(event.target.value)}>
                <option value="additional_stock">Additional stock</option>
                <option value="update_locality">Update locality</option>
                <option value="material_clarification">Material clarification</option>
              </select>
            </label>
            <label>Details<textarea required maxLength={1000} value={requestDetails}
              onChange={(event) => setRequestDetails(event.target.value)} placeholder="Tell the campaign owner what you need." /></label>
            <button type="submit" className="nwg-button nwg-button-primary" disabled={busy || requestDetails.trim().length < 3}>
              <Send size={15} />Send request
            </button>
          </form>}
          {!campaign && <p className="nwg-muted nwg-no-records">Requests will appear here after you receive a campaign assignment.</p>}
        </section>

        <section className="nwg-card nwg-damage-card">
          <CardHeading icon={AlertTriangle} title="Report Damage"
            description="Report a damaged, lost, or unusable WildCard." />
          {campaignDamageReports.length > 0 && <div className="nwg-damage-history">
            {campaignDamageReports.slice(0, 3).map((report) => <div key={report.id}>
              <span>{report.card_id || report.issue_type.replaceAll('_', ' ')}</span><StatusPill status={report.status} />
            </div>)}
          </div>}
          {campaign ? <form className="nwg-form" onSubmit={(event) => void submitDamage(event)}>
            <div className="nwg-form-two">
              <label>Card ID (optional)<input value={damageCardId} maxLength={80}
                onChange={(event) => setDamageCardId(event.target.value)} placeholder="e.g., WC-04217" /></label>
              <label>Issue type<select value={damageType} onChange={(event) => setDamageType(event.target.value)}>
                <option value="damaged">Damaged</option><option value="lost">Lost</option>
                <option value="unusable">Unusable</option><option value="other">Other</option>
              </select></label>
            </div>
            <label>Details (optional)<textarea value={damageDetails} maxLength={1000}
              onChange={(event) => setDamageDetails(event.target.value)} placeholder="Share a brief note about the issue." /></label>
            <button type="submit" className="nwg-button nwg-button-primary" disabled={busy}>
              <Send size={15} />Submit report
            </button>
          </form> : <p className="nwg-muted nwg-no-records">A campaign assignment is needed before reporting stock damage.</p>}
        </section>
      </div>
      {(message || error) && <p className={`nwg-feedback${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}</p>}

      <section className="nwg-card nwg-table-card nwg-stock-history">
        <CardHeading icon={Package} title="Stock History"
          description={campaign ? `Stock movements for ${campaign.campaign.name}.` : 'Stock movements for your assigned campaigns.'} />
        {stockRows.length ? <>
          <div className="nwg-table-scroll"><table className="nwg-table">
          <thead><tr><th>Date & time</th><th>Activity</th><th>Quantity</th><th>Stock balance</th><th>Notes</th></tr></thead>
          <tbody>{stockRows.map((movement) => (
            <tr key={movement.id}>
              <td>{formatDate(movement.created_at)}</td>
              <td>{movement.movement_type.replaceAll('_', ' ')}</td>
              <td className={movement.quantity < 0 ? 'nwg-negative' : 'nwg-positive'}>
                {movement.quantity > 0 ? '+' : ''}{movement.quantity}</td>
              <td>{movement.balance}</td><td>{movement.notes || '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
          <div className="nwg-stock-cards">{stockRows.map((movement) => (
            <article className="nwg-stock-card" key={movement.id}>
              <div><strong>{movement.movement_type.replaceAll('_', ' ')}</strong><time>{formatDate(movement.created_at)}</time></div>
              <p>{movement.notes || 'Stock movement recorded'}</p>
              <span className={movement.quantity < 0 ? 'nwg-negative' : 'nwg-positive'}>
                {movement.quantity > 0 ? '+' : ''}{movement.quantity} cards · balance {movement.balance}
              </span>
            </article>
          ))}</div>
        </> : <EmptyState icon={Package} title="Stock history is empty"
          detail={campaign ? 'Stock issues and approved deliveries for this campaign will be recorded here.'
            : 'Stock history will appear when a campaign assignment is available.'} />}
      </section>
    </section>
  );
}

function ProofSection({ data, onRefresh }: { data: PartnerWorkspaceData; onRefresh: () => Promise<void> }) {
  const [assignmentId, setAssignmentId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [note, setNote] = useState('');
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [selectedProof, setSelectedProof] = useState<PartnerProof | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const assignment = data.campaigns.find((item) => item.assignmentId === assignmentId) || data.campaigns[0];
  const sites = assignment?.sites || [];

  useEffect(() => {
    if (cameraStream && videoRef.current) videoRef.current.srcObject = cameraStream;
  }, [cameraStream]);
  useEffect(() => () => cameraStream?.getTracks().forEach((track) => track.stop()), [cameraStream]);

  const startCamera = async () => {
    setCameraError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Live camera access requires HTTPS and a supported browser.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
      setCameraStream(stream);
    } catch (reason) {
      setCameraError(reason instanceof Error ? reason.message : 'Camera access was not available. Use the photo picker instead.');
    }
  };
  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setCameraError('Wait for the camera preview, then capture the photo.');
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const captured = canvas.toDataURL('image/jpeg', 0.86);
    if (captured.length > 2.85 * 1024 * 1024) {
      setCameraError('This photo is larger than 2 MB. Move closer and capture again.');
      return;
    }
    setPhotoDataUrl(captured);
    cameraStream?.getTracks().forEach((track) => track.stop());
    setCameraStream(null);
  };
  const choosePhoto = async (file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError('Choose a JPEG, PNG, or WebP photo up to 2 MB.');
      return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = () => setPhotoDataUrl(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => setError('The selected proof photo could not be read.');
    reader.readAsDataURL(file);
  };
  const captureLocation = () => {
    setError('');
    if (!navigator.geolocation) {
      setError('Location access is not available in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setLocation({ latitude: coords.latitude, longitude: coords.longitude }),
      (reason) => setError(reason.message || 'Location permission was denied. Allow location and retry.'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  };
  const submitProof = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assignment || !siteId || !photoDataUrl) {
      setError('Choose an assigned shop and capture a proof photo before submitting.');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      await partnerApi('/api/partners/proofs', {
        method: 'POST',
        body: JSON.stringify({
          assignmentId: assignment.assignmentId,
          siteId,
          photoDataUrl,
          note,
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
        }),
      });
      setPhotoDataUrl(''); setNote(''); setLocation(null);
      setMessage('Your captured proof was submitted for owner review.');
      await onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The proof could not be submitted.'); }
    finally { setBusy(false); }
  };

  const history = data.proofs.filter((proof) => filter === 'all' || proof.status === filter);
  const visibleHistory = showAllHistory ? history : history.slice(0, 3);
  return (
    <section className="nwg-screen nwg-proof-screen" aria-labelledby="partner-workspace-page-title">
      <PageHeading eyebrow="Proof submissions" title="Proof Submissions"
        description="Capture a live photo as proof of in-store promotion. Include the shop location and an optional note, then submit for review." />
      <div className="nwg-proof-layout">
        <section className="nwg-card nwg-capture-card">
          <CardHeading icon={Camera} title="Capture proof" />
          <form onSubmit={(event) => void submitProof(event)} className="nwg-form">
            {data.campaigns.length > 1 && <label>Campaign <span className="nwg-required">*</span>
              <select value={assignment?.assignmentId || ''} required
                onChange={(event) => { setAssignmentId(event.target.value); setSiteId(''); }}>
                {data.campaigns.map((item) => <option key={item.assignmentId} value={item.assignmentId}>
                  {item.campaign.name} · {item.campaign.area}
                </option>)}
              </select>
            </label>}
            <div className="nwg-location-picker">
              <label>Capture location <span className="nwg-required">*</span>
                <select value={siteId} onChange={(event) => setSiteId(event.target.value)} required disabled={!sites.length}>
                  <option value="">Select an assigned shop</option>
                  {sites.map((site) => <option key={site.id} value={site.id}>{site.name} – {site.address}</option>)}
                </select>
              </label>
              <button type="button" className="nwg-location-button" onClick={captureLocation}>
                <LocateFixed size={16} />{location ? 'Location captured' : 'Use my location'}
                {location && <span>{location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}</span>}
              </button>
              <small>Select the assigned shop where the promotion was done.</small>
            </div>
            <div className="nwg-camera-frame">
              {photoDataUrl ? <img src={photoDataUrl} alt="Captured partner proof preview" /> :
                cameraStream ? <video ref={videoRef} autoPlay muted playsInline aria-label="Live camera preview" /> :
                  <div className="nwg-camera-placeholder">
                    <Camera size={30} /><strong>Live camera</strong>
                    <span>Take a clear photo of the completed in-store handover.</span>
                  </div>}
              <canvas ref={canvasRef} className="nwg-hidden-canvas" />
              {cameraStream && <span className="nwg-live-label"><span />Live camera</span>}
              {photoDataUrl && <span className="nwg-live-label nwg-captured-label"><Check size={14} />Captured photo</span>}
              <div className="nwg-camera-actions">
                {!photoDataUrl && !cameraStream && <button type="button" className="nwg-button nwg-button-secondary" onClick={() => void startCamera()}>
                  <Camera size={16} />Start live camera
                </button>}
                {cameraStream && <button type="button" className="nwg-button nwg-button-primary" onClick={capturePhoto}>
                  <Camera size={16} />Capture photo
                </button>}
                {photoDataUrl && <button type="button" className="nwg-button nwg-button-secondary"
                  onClick={() => { setPhotoDataUrl(''); setCameraError(''); }}><Camera size={16} />Retake photo</button>}
                <label className="nwg-button nwg-button-secondary nwg-file-label"><Upload size={15} />Use photo
                  <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
                    onChange={(event) => void choosePhoto(event.target.files?.[0])} />
                </label>
              </div>
            </div>
            {cameraError && <p className="nwg-feedback is-error" role="alert">{cameraError}</p>}
            <label>Note (optional)<textarea value={note} maxLength={200}
              onChange={(event) => setNote(event.target.value)} placeholder="Add a short note for the reviewer." />
              <small className="nwg-char-count">{note.length} / 200</small>
            </label>
            <div className="nwg-form-end">
              <span className="nwg-muted">Reward is credited only after owner approval.</span>
              <button type="submit" className="nwg-button nwg-button-primary" disabled={busy || !assignment || !siteId || !photoDataUrl}>
                <Send size={15} />{busy ? 'Submitting…' : 'Submit proof'}
              </button>
            </div>
          </form>
          {error && <p className="nwg-feedback is-error" role="alert">{error}</p>}
          {message && <p className="nwg-feedback" role="status">{message}</p>}
        </section>

        <section className="nwg-card nwg-review-card">
          <CardHeading icon={Clock3} title="Review history"
            trailing={<select aria-label="Filter proof history" value={filter} onChange={(event) => {
              setFilter(event.target.value); setShowAllHistory(false);
            }}>
              <option value="all">All campaigns</option><option value="pending">Pending</option>
              <option value="approved">Approved</option><option value="needs_correction">Needs correction</option>
            </select>} />
          {history.length ? <div className="nwg-proof-history">
            {visibleHistory.map((proof) => {
              const site = data.campaigns.flatMap((item) => item.sites).find((item) => item.id === proof.site_id);
              return <button type="button" key={proof.id} className="nwg-proof-history-row" onClick={() => setSelectedProof(proof)}>
                <img src={proof.photoUrl} alt="" loading="lazy" />
                <span className="nwg-proof-history-copy">
                  <strong>{proof.id.slice(0, 8).toUpperCase()}</strong>
                  <span>{site?.name || campaignName(data, proof.campaign_id)}</span>
                  <small><CalendarDays size={13} />{formatDate(proof.submitted_at)}</small>
                </span>
                <StatusPill status={proof.status} /><ArrowRight size={17} />
              </button>;
            })}
          </div> : <EmptyState icon={FileCheck2} title="No proof history yet"
            detail="Your submissions and owner review decisions will appear here." />}
          {history.length > 3 && <button type="button" className="nwg-link-button"
            onClick={() => setShowAllHistory((showAll) => !showAll)}>
            {showAllHistory ? 'Show latest submissions' : 'View older submissions'} <ArrowRight size={14} />
          </button>}
          <p className="nwg-history-note"><ShieldCheck size={15} />Photos are private to the assigned partner and campaign owner.</p>
        </section>
      </div>
      {selectedProof && <div className="nwg-modal-backdrop" role="presentation" onClick={() => setSelectedProof(null)}>
        <section className="nwg-proof-modal" role="dialog" aria-modal="true" aria-label="Proof submission details"
          onClick={(event) => event.stopPropagation()}>
          <button type="button" className="nwg-modal-close" onClick={() => setSelectedProof(null)} aria-label="Close proof details"><X size={20} /></button>
          <img src={selectedProof.photoUrl} alt="Partner submitted proof" />
          <h2>{campaignName(data, selectedProof.campaign_id)}</h2>
          <StatusPill status={selectedProof.status} />
          <p>{selectedProof.note || 'No note added.'}</p>
          {selectedProof.review_note && <p className="nwg-review-note"><strong>Owner note:</strong> {selectedProof.review_note}</p>}
        </section>
      </div>}
    </section>
  );
}

function EarningsSection({ data, onRefresh }: { data: PartnerWorkspaceData; onRefresh: () => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [withdrawalFormOpen, setWithdrawalFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const balance = data.coinSummary.balance;
  const goal = 100000;
  const progress = Math.min(100, Math.round((balance / goal) * 100));
  const filteredLedger = useMemo(() => {
    const value = query.trim().toLowerCase();
    return data.ledger.filter((entry) => !value ||
      `${entry.reference} ${entry.notes} ${campaignName(data, entry.campaign_id)}`.toLowerCase().includes(value));
  }, [data, query]);
  const requestWithdrawal = async () => {
    const amount = Number(withdrawalAmount);
    if (!Number.isSafeInteger(amount) || amount < goal) {
      setError('Enter an amount of at least 100000 NGA Coins.');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      await partnerApi('/api/partners/withdrawals', {
        method: 'POST',
        body: JSON.stringify({ amount }),
      });
      setWithdrawalAmount('');
      setWithdrawalFormOpen(false);
      setMessage('Your withdrawal request was sent to the Primary Owner for review.');
      await onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The withdrawal request could not be submitted.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="nwg-screen nwg-earnings-screen" aria-labelledby="partner-workspace-page-title">
      <PageHeading eyebrow="Earnings & progress" title="Earnings & Progress"
        description="Track your NGA Coins, withdrawal progress, pending approvals, and coin activity." />
      <section className="nwg-balance-strip">
        <div className="nwg-balance-total"><span><Coins size={27} /></span><div><strong>NGA Coins Balance</strong>
          <p>{formatNumber(balance)} <small>Available</small></p></div></div>
        <div className="nwg-balance-progress"><strong>Withdrawal Progress</strong>
          <div className="nwg-balance-bar"><span style={{ width: `${progress}%` }} /></div>
          <span>{formatNumber(balance)} of {formatNumber(goal)} NGA Coins</span></div>
        <strong className="nwg-balance-percent">{progress}%</strong>
        <div className="nwg-withdraw-action">
          <button type="button" className="nwg-button nwg-button-light" disabled={busy}
            onClick={() => setWithdrawalFormOpen(true)}><Upload size={16} />Withdraw Coins</button>
          <small>Minimum {formatNumber(goal)} NGA Coins</small>
        </div>
      </section>
      {withdrawalFormOpen && <form className="nwg-card nwg-withdrawal-form" onSubmit={(event) => {
        event.preventDefault(); void requestWithdrawal();
      }}>
        {balance >= goal ? <>
          <label htmlFor="nwg-withdraw-amount">Amount to withdraw
            <input id="nwg-withdraw-amount" type="number" min={goal} max={balance} step="1" required
              value={withdrawalAmount} onChange={(event) => setWithdrawalAmount(event.target.value)}
              placeholder={String(goal)} />
          </label>
          <p>Available balance: {formatNumber(balance)} NGA Coins. The Primary Owner reviews every request.</p>
          <button type="submit" className="nwg-button nwg-button-primary"
            disabled={busy || Number(withdrawalAmount) < goal || Number(withdrawalAmount) > balance}>
            <Upload size={16} />{busy ? 'Sending…' : 'Request withdrawal'}
          </button>
        </> : <p>Earn {formatNumber(goal - balance)} more NGA Coins to reach the minimum withdrawal.</p>}
        <button type="button" className="nwg-button nwg-button-secondary"
          onClick={() => { setWithdrawalFormOpen(false); setWithdrawalAmount(''); }}>Cancel</button>
      </form>}
      {(error || message) && <p className={`nwg-feedback${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}</p>}
      <div className="nwg-earnings-metrics">
        <MetricCard icon={Coins} label="Total Earned" value={formatNumber(data.coinSummary.totalEarned)} detail="Approved earnings" />
        <MetricCard icon={ArrowUp} label="Total Withdrawn" value={formatNumber(data.coinSummary.totalWithdrawn)} detail="Successfully transferred" />
        <MetricCard icon={Clock3} label="Pending Approval" value={formatNumber(data.coinSummary.pendingApproval)} detail="Awaiting review" />
        <MetricCard icon={BarChart3} label="Withdrawal Target" value={formatNumber(goal)} detail="Minimum for withdrawal" />
      </div>
      <div className="nwg-earnings-lower">
        <section className="nwg-card">
          <CardHeading icon={Clock3} title={`Pending Approval (${data.proofs.filter((proof) => proof.status === 'pending').length})`}
            description="Coins earned and awaiting owner verification." />
          {data.proofs.filter((proof) => proof.status === 'pending').length ? <div className="nwg-pending-list">
            {data.proofs.filter((proof) => proof.status === 'pending').slice(0, 5).map((proof) => (
              <div className="nwg-pending-row" key={proof.id}>
                <span className="nwg-icon-box"><Megaphone size={18} /></span>
                <span><strong>{campaignName(data, proof.campaign_id)}</strong><small>Proof submission · {formatDate(proof.submitted_at)}</small></span>
                <StatusPill status="pending" /><strong className="nwg-positive">+{formatNumber(proof.coins)}</strong>
              </div>
            ))}
          </div> : <EmptyState icon={CheckCircle2} title="No pending approvals"
            detail="Approved proof rewards will be added to your balance." />}
        </section>
        <section className="nwg-card nwg-target-card">
          <CardHeading icon={Crosshair} title="Withdrawal Progress"
            description="Reach 100,000 NGA Coins to request a withdrawal." />
          <div className="nwg-target-numbers">
            <span>Current<strong>{formatNumber(balance)}</strong></span>
            <span>Target<strong>{formatNumber(goal)}</strong></span>
            <span>Progress<strong>{progress}%</strong></span>
          </div>
        </section>
      </div>
      <section className="nwg-card nwg-table-card nwg-ledger-card">
        <CardHeading icon={Coins} title="Coin Ledger" description="A record of your recent coin activity."
          trailing={<label className="nwg-search"><Search size={16} /><input type="search" value={query}
            onChange={(event) => setQuery(event.target.value)} placeholder="Search by campaign or note…" /></label>} />
        {filteredLedger.length ? <>
          <div className="nwg-table-scroll"><table className="nwg-table">
          <thead><tr><th>Date & time</th><th>Activity</th><th>Campaign / reference</th><th>Coins</th><th>Status</th><th>Notes</th></tr></thead>
          <tbody>{filteredLedger.slice(0, 15).map((entry) => <tr key={entry.id}>
            <td>{formatDate(entry.created_at)}</td><td className={entry.amount >= 0 ? 'nwg-positive' : 'nwg-negative'}>
              {entry.amount >= 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}{entry.entry_type === 'adjustment' ? 'administrator adjustment' : entry.entry_type}</td>
            <td>{entry.reference || campaignName(data, entry.campaign_id)}</td>
            <td className={entry.amount < 0 ? 'nwg-negative' : 'nwg-positive'}>{entry.amount > 0 ? '+' : ''}{formatNumber(entry.amount)}</td>
            <td><StatusPill status={entry.status} /></td><td>{entry.notes || '—'}</td>
          </tr>)}</tbody>
        </table></div>
          <div className="nwg-ledger-cards">{filteredLedger.slice(0, 15).map((entry) => (
            <article className="nwg-ledger-card-row" key={entry.id}>
              <div><strong>{entry.entry_type === 'adjustment' ? 'Administrator adjustment' : entry.entry_type}</strong>
                <StatusPill status={entry.status} /></div>
              <p>{entry.reference || campaignName(data, entry.campaign_id)}</p>
              <small>{formatDate(entry.created_at)}{entry.notes ? ` · ${entry.notes}` : ''}</small>
              <b className={entry.amount < 0 ? 'nwg-negative' : 'nwg-positive'}>
                {entry.amount > 0 ? '+' : ''}{formatNumber(entry.amount)} NGA Coins
              </b>
            </article>
          ))}</div>
        </> : <EmptyState icon={Coins} title={query ? 'No matching ledger entries' : 'No coin activity yet'}
          detail={query ? 'Try another search term.' : 'Approved proof rewards and withdrawal activity will appear here.'} />}
      </section>
    </section>
  );
}

function ProfileSection({ data, onProfileUpdated }: {
  data: PartnerWorkspaceData;
  onProfileUpdated: (profile: PartnerProfile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(data.user.fullName);
  const [mobileNumber, setMobileNumber] = useState(data.user.mobileNumber);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await partnerApi<{ user: PartnerProfile }>('/api/partners/profile', {
        method: 'PATCH',
        body: JSON.stringify({ fullName, mobileNumber }),
      });
      onProfileUpdated(response.user);
      setEditing(false);
      setMessage('Your profile was saved.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Your profile could not be saved.'); }
    finally { setBusy(false); }
  };
  return (
    <section className="nwg-screen nwg-profile-screen" aria-labelledby="partner-workspace-page-title">
      <PageHeading eyebrow="Profile & support" title={`Profile & Support — ${data.user.fullName.split(/\s+/)[0]}`}
        description="Manage your partner profile, get help, and follow the handover guide for smooth campaign execution." />
      <div className="nwg-profile-top">
        <section className="nwg-card nwg-profile-summary">
          <span className="nwg-profile-avatar" aria-hidden="true">{getInitials(data.user.fullName)}</span>
          <div><h2>{data.user.fullName}</h2><p>Partner ID: {data.user.id.slice(0, 8).toUpperCase()}
            <span className="nwg-separator">|</span><StatusPill status={data.user.status} /></p></div>
          <button className="nwg-button nwg-button-secondary" type="button" onClick={() => { setEditing((current) => !current); setError(''); }}>
            <Pencil size={15} />{editing ? 'Cancel edit' : 'Edit profile'}
          </button>
        </section>
        {editing ? <section className="nwg-card nwg-edit-profile">
          <h2>Edit partner profile</h2>
          <form className="nwg-form" onSubmit={(event) => void saveProfile(event)}>
            <div className="nwg-form-two">
              <label>Full name<input required autoComplete="name" maxLength={80} value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
              <label>Mobile number<input required type="tel" autoComplete="tel" maxLength={24} value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} /></label>
            </div>
            <label>Email address<input type="email" value={data.user.email} readOnly /></label>
            <button type="submit" className="nwg-button nwg-button-primary" disabled={busy}><Check size={15} />{busy ? 'Saving…' : 'Save changes'}</button>
          </form>
        </section> : <section className="nwg-card nwg-support-card">
          <div><h2>Need help?</h2><p>Contact our support team about campaigns, proofs, or earnings.</p></div>
          <a href="mailto:info@neargrowads.in" className="nwg-button nwg-button-primary"><MailCheck size={16} />Email support</a>
          <a href="tel:+919289810149" className="nwg-button nwg-button-secondary"><Phone size={16} />Call support</a>
        </section>}
      </div>
      {(error || message) && <p className={`nwg-feedback${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}</p>}
      <section className="nwg-card nwg-handover-guide">
        <CardHeading icon={LifeBuoy} title="Three Step Handover Guide"
          description="Follow these steps at every site to complete a successful handover and submit valid proof." />
        <div className="nwg-guide-steps">
          <article><MapPin size={27} /><span className="nwg-step-number">1</span><div><strong>Go to the site</strong>
            <p>Use the assigned site address from your campaign.</p></div></article>
          <ArrowRight className="nwg-step-arrow" size={22} />
          <article><Camera size={27} /><span className="nwg-step-number">2</span><div><strong>Capture proof</strong>
            <p>Take clear, well-lit photos of the completed handover.</p></div></article>
          <ArrowRight className="nwg-step-arrow" size={22} />
          <article><Upload size={27} /><span className="nwg-step-number">3</span><div><strong>Submit & confirm</strong>
            <p>Upload in Proof Submissions and check your review history.</p></div></article>
        </div>
      </section>
      <div className="nwg-examples-layout">
        <section className="nwg-card nwg-photo-examples">
          <CardHeading icon={Camera} title="Photo Examples"
            description="See what a good proof photo looks like versus a blurry one." />
          <div className="nwg-example-pair">
            <figure><div><img src="/images/wildcard/handover-clear-example.webp" alt="Example of a clear, focused shop handover photo" />
              <span className="nwg-example-label is-good"><Check size={13} />Clear (✓)</span></div>
              <figcaption><span>✓ In focus</span><span>✓ Well-lit</span><span>✓ Complete view</span></figcaption></figure>
            <figure><div><img src="/images/wildcard/handover-blurry-example.webp" alt="Example of an out-of-focus shop handover photo" />
              <span className="nwg-example-label is-bad"><X size={13} />Blurry (✕)</span></div>
              <figcaption className="is-bad"><span>× Out of focus</span><span>× Hard to read</span><span>× Not acceptable</span></figcaption></figure>
          </div>
        </section>
        <section className="nwg-card nwg-sample-data">
          <CardHeading icon={CircleHelp} title="Sample Data — Reference Only"
            description="Illustrative handover details; not a live campaign or partner record." />
          <dl>
            <div><dt><Crosshair size={16} />Campaign</dt><dd>GC-104 · Store Signage</dd></div>
            <div><dt><Store size={16} />Site / Store</dt><dd>GreenCart Mart</dd></div>
            <div><dt><MapPin size={16} />Location</dt><dd>Sector 62, Noida</dd></div>
            <div><dt><CalendarDays size={16} />Handover date</dt><dd>10 Jan 2025</dd></div>
            <div><dt><Camera size={16} />Proof photos</dt><dd>2 (front view, close-up)</dd></div>
          </dl>
          <p className="nwg-sample-warning"><ShieldCheck size={14} />Live assignments and submissions are never populated from this sample.</p>
        </section>
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
  const [workspace, setWorkspace] = useState<PartnerWorkspaceData | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(true);
  const [workspaceError, setWorkspaceError] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);
  const wasMobileNavOpen = useRef(false);

  const refreshWorkspace = useCallback(async () => {
    setWorkspaceError('');
    try {
      const data = await partnerApi<PartnerWorkspaceData & PartnerApiResponse>('/api/partners/dashboard');
      if (!Array.isArray(data.campaigns) || !Array.isArray(data.proofs) ||
        !Array.isArray(data.stockHistory) || !Array.isArray(data.requests) ||
        !Array.isArray(data.damageReports) || !Array.isArray(data.ledger) ||
        !Array.isArray(data.withdrawals) || !data.coinSummary || !data.user) {
        throw new Error('The partner workspace response was incomplete.');
      }
      setWorkspace(data);
    } catch (reason) {
      setWorkspaceError(reason instanceof Error ? reason.message : 'Partner campaign data could not be loaded.');
    } finally { setWorkspaceBusy(false); }
  }, []);

  useEffect(() => { void refreshWorkspace(); }, [refreshWorkspace]);

  useEffect(() => {
    if (!mobileNavOpen) {
      if (wasMobileNavOpen.current) mobileMenuButtonRef.current?.focus();
      wasMobileNavOpen.current = false;
      return;
    }

    wasMobileNavOpen.current = true;
    const drawer = mobileNavRef.current;
    const getFocusableElements = () => Array.from(
      drawer?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    getFocusableElements()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileNavOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (!firstElement || !lastElement) return;
      if (!drawer?.contains(document.activeElement)) {
        event.preventDefault();
        firstElement.focus();
      } else if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const handleResize = () => {
      if (window.innerWidth > 720) setMobileNavOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [mobileNavOpen]);

  const selectSection = (nextSection: SectionId) => {
    setSection(nextSection);
    setMobileNavOpen(false);
  };

  return (
    <div className="partner-preview partner-workspace">
      <div className="partner-preview-layout">
        {mobileNavOpen && <button
          type="button"
          className="partner-workspace-mobile-backdrop"
          aria-label="Close partner navigation"
          onClick={() => setMobileNavOpen(false)}
        />}
        <aside
          id="partner-workspace-navigation"
          ref={mobileNavRef}
          className={`partner-preview-sidebar${mobileNavOpen ? ' is-mobile-open' : ''}`}
          role={mobileNavOpen ? 'dialog' : undefined}
          aria-modal={mobileNavOpen ? true : undefined}
          aria-label="Partner workspace"
        >
          <div className="partner-workspace-drawer-head">
            <p className="partner-preview-brand">NearGrow <span>WildCard</span></p>
            <button type="button" className="partner-workspace-mobile-close" aria-label="Close partner navigation"
              onClick={() => setMobileNavOpen(false)}>
              <X aria-hidden="true" size={19} />
            </button>
          </div>
          <nav aria-label="Partner workspace navigation">
            {sections.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => selectSection(id)}>
                <Icon aria-hidden="true" size={18} /> <span>{label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="partner-preview-content">
          <header className="partner-preview-topline">
            <button
              ref={mobileMenuButtonRef}
              type="button"
              className="partner-workspace-mobile-menu"
              aria-label={mobileNavOpen ? 'Close partner navigation' : 'Open partner navigation'}
              aria-expanded={mobileNavOpen}
              aria-controls="partner-workspace-navigation"
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              <Menu aria-hidden="true" size={19} />
            </button>
            <div className="partner-workspace-topline-brand">
              <span className="partner-preview-app-name">NearGrow <strong>WildCard</strong></span>
              <span className="partner-preview-app-caption">Partner workspace</span>
            </div>
            <div className="partner-workspace-account">
              <span className="partner-workspace-account-avatar" aria-hidden="true">
                {getInitials(workspace?.user.fullName || profile.fullName)}
              </span>
              <span className="partner-workspace-account-copy">
                <strong>{workspace?.user.fullName || profile.fullName}</strong>
                <small>Delivery partner</small>
              </span>
            </div>
            <button type="button" onClick={onLogout} disabled={busy} className="partner-workspace-logout">
              <LogOut aria-hidden="true" size={15} /> Log out
            </button>
          </header>
          <nav className="partner-preview-mobile-tabs" aria-label="Partner workspace navigation">
            {sections.map(({ id, label }) => (
              <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => selectSection(id)}>
                {label}
              </button>
            ))}
          </nav>
          {logoutError && <p className="partner-workspace-error" role="alert">{logoutError}</p>}

          <main className="nwg-workspace-main">
            {workspaceBusy && <div className="nwg-loading" role="status">Loading your partner workspace…</div>}
            {!workspaceBusy && workspaceError && <section className="nwg-workspace-error" role="alert">
              <AlertTriangle size={24} /><div><strong>Partner workspace could not be loaded</strong><p>{workspaceError}</p>
                <button type="button" className="nwg-button nwg-button-secondary" onClick={() => { setWorkspaceBusy(true); void refreshWorkspace(); }}>
                  Retry
                </button></div>
            </section>}
            {!workspaceBusy && !workspaceError && workspace && <>
              {section === 'dashboard' && <DashboardSection data={workspace} onNavigate={setSection} />}
              {section === 'campaigns' && <CampaignsSection data={workspace} onRefresh={refreshWorkspace} />}
              {section === 'proof' && <ProofSection data={workspace} onRefresh={refreshWorkspace} />}
              {section === 'earnings' && <EarningsSection data={workspace} onRefresh={refreshWorkspace} />}
              {section === 'profile' && <ProfileSection data={workspace} onProfileUpdated={(user) => {
                setWorkspace((current) => current ? { ...current, user } : current);
              }} />}
            </>}
          </main>
        </div>
      </div>
    </div>
  );
}
