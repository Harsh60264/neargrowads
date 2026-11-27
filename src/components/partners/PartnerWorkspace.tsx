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
  { id: 'inventory', label: 'WildCard Inventory', icon: Package },
  { id: 'proof', label: 'Delivery & Proofs', icon: Camera },
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
  assignment_id: string | null;
  campaign_id: string | null;
  site_id: string | null;
  photoUrl: string;
  note: string;
  business_name: string;
  business_category: string;
  delivery_address: string;
  address_detail: string;
  location_address_source: string;
  location_accuracy_meters: number | null;
  location_captured_at: string | null;
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
  assignment_id: string | null;
  movement_type: string;
  quantity: number;
  notes: string;
  created_at: string;
}

interface CampaignRequest {
  id: string;
  assignment_id: string | null;
  request_type: string;
  details: string;
  status: string;
  stock_quantity: number | null;
  review_note: string;
  created_at: string;
}

interface PartnerInventory {
  totalReceived: number;
  available: number;
  delivered: number;
  reserved: number;
  damaged: number;
  returned: number;
  issued: number;
  restocked: number;
  progressPercent: number;
}

interface DamageReport {
  id: string;
  assignment_id: string | null;
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
  inventory: PartnerInventory;
  coinSummary: {
    balance: number;
    totalEarned: number;
    totalWithdrawn: number;
    pendingApproval: number;
  };
  deliveriesToday: number;
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
    fulfilled: 'Fulfilled',
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
  return data.campaigns.find((assignment) => assignment.campaign.id === campaignId)?.campaign.name || 'Independent delivery';
}

function getInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || 'P';
}

function DashboardSection({ data, onNavigate }: {
  data: PartnerWorkspaceData;
  onNavigate: (section: SectionId) => void;
}) {
  const recent = data.proofs.slice(0, 5);
  const activity = useMemo(() => buildPartnerWorkspaceActivity(data).slice(0, 6), [data]);
  const coinProgress = Math.min(100, Math.round((data.coinSummary.balance / 100000) * 100));
  return (
    <section className="nwg-screen nwg-dashboard-screen" aria-labelledby="partner-workspace-page-title">
      <PageHeading eyebrow="Dashboard" title={`Welcome, ${data.user.fullName.split(/\s+/)[0] || 'Partner'}`}
        description="Your WildCard inventory, independent deliveries, proof reviews, and NGA Coin activity." />
      <div className="nwg-dashboard-hero">
        <article className="nwg-active-campaign nwg-independent-overview">
          <div className="nwg-inline-heading"><Package size={21} /><strong>WildCard Inventory</strong>
            <StatusPill status={data.inventory.available === 0 ? 'out_of_stock' :
              data.inventory.available <= 10 ? 'low_stock' : 'active'} />
          </div>
          <div className="nwg-independent-stock">
            <span>Available WildCards</span><strong>{formatNumber(data.inventory.available)}</strong>
          </div>
          <div className="nwg-independent-overview-metrics">
            <span>Reserved<strong>{formatNumber(data.inventory.reserved)}</strong></span>
            <span>Total received<strong>{formatNumber(data.inventory.totalReceived)}</strong></span>
            <span>Approved deliveries<strong>{formatNumber(data.inventory.delivered)}</strong></span>
          </div>
          <div className="nwg-independent-actions">
            <button type="button" className="nwg-button nwg-button-light" onClick={() => onNavigate('proof')}>
              <Camera size={15} />Submit Delivery Proof
            </button>
            <button type="button" className="nwg-button nwg-button-secondary" onClick={() => onNavigate('inventory')}>
              <Package size={15} />Request Restock
            </button>
          </div>
        </article>
        <article className="nwg-card nwg-daily-progress">
          <div className="nwg-progress-heading"><div className="nwg-inline-heading"><CheckCircle2 size={21} /><strong>Delivery & earnings</strong></div>
            <div className="nwg-progress-numbers"><strong>{formatNumber(data.deliveriesToday)}</strong><span>Deliveries completed today</span></div>
          </div>
          <div className="nwg-summary-balance">
            <span>Available NGA Coins</span>
            <strong><Coins size={18} />{formatNumber(data.coinSummary.balance)}</strong>
            <small>{formatNumber(data.proofs.filter((proof) => proof.status === 'pending').length)} proof(s) awaiting owner review</small>
          </div>
          <div className="nwg-dashboard-restock-status">
            Restock status: <strong>{data.requests.find((request) => request.request_type === 'additional_stock')?.status || 'No request'}</strong>
          </div>
        </article>
      </div>

      <div className="nwg-dashboard-stats">
        <MetricCard icon={Package} label="Delivery stock" value={formatNumber(data.inventory.available)}
          detail="Available WildCards" tone="soft" />
        <MetricCard icon={CheckCircle2} label="Approved" value={formatNumber(data.inventory.delivered)} detail="Cards delivered" />
        <MetricCard icon={Clock3} label="Pending" value={formatNumber(data.inventory.reserved)} detail="Cards reserved for review" />
        <MetricCard icon={Coins} label="NGA Coins" value={formatNumber(data.coinSummary.balance)} detail="Available balance" />
      </div>
      <div className="nwg-dashboard-submit">
        <div><strong>Finished a WildCard delivery?</strong><span>Submit a clear proof photo for owner review and receive 1,000 NGA Coins after approval.</span></div>
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
              <thead><tr><th>Business</th><th>Delivery address</th><th>Date submitted</th><th>Status</th><th>NGA Coins</th><th>Location</th><th>Photo</th></tr></thead>
              <tbody>{recent.map((proof) => {
                return <tr key={proof.id}>
                  <td><strong>{proof.business_name || campaignName(data, proof.campaign_id)}</strong></td>
                  <td>{proof.delivery_address || campaignName(data, proof.campaign_id)}</td>
                  <td>{formatDate(proof.submitted_at)}</td>
                  <td><StatusPill status={proof.status} /></td>
                  <td>{proof.status === 'approved' ? `${formatNumber(proof.coins)} NGA Coins` : '—'}</td>
                  <td>{proof.latitude !== null && proof.longitude !== null
                    ? <a className="nwg-photo-link" href={`https://www.google.com/maps?q=${proof.latitude},${proof.longitude}`}
                      target="_blank" rel="noreferrer">View Location</a> : '—'}</td>
                  <td><a className="nwg-photo-link" href={proof.photoUrl} target="_blank" rel="noreferrer">View photo</a></td>
                </tr>;
              })}</tbody>
            </table></div>
            <div className="nwg-delivery-cards">{recent.map((proof) => {
              return <article className="nwg-delivery-card" key={proof.id}>
                <div><strong>{proof.business_name || campaignName(data, proof.campaign_id)}</strong><StatusPill status={proof.status} /></div>
                <small>{proof.delivery_address || 'Address not provided in legacy record'} · {formatDate(proof.submitted_at)}</small>
                {proof.status === 'approved' && <b>{formatNumber(proof.coins)} NGA Coins earned</b>}
                {proof.latitude !== null && proof.longitude !== null && <a className="nwg-photo-link"
                  href={`https://www.google.com/maps?q=${proof.latitude},${proof.longitude}`} target="_blank" rel="noreferrer">View location</a>}
                <a className="nwg-photo-link" href={proof.photoUrl} target="_blank" rel="noreferrer">View private proof photo</a>
              </article>;
            })}</div>
          </> : <EmptyState icon={FileCheck2} title="No deliveries submitted yet"
            detail="Submit your delivery details and photo. The owner reviews each proof before the reward is credited." />}
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
            <div><dt>Pending proofs</dt><dd>{formatNumber(data.proofs.filter((proof) => proof.status === 'pending').length)}</dd></div>
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

function PartnerInventorySection({
  data,
  onNavigate,
  onRefresh,
}: {
  data: PartnerWorkspaceData;
  onNavigate: (section: SectionId) => void;
  onRefresh: () => Promise<void>;
}) {
  const [requestOpen, setRequestOpen] = useState(false);
  const [quantity, setQuantity] = useState('10');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requests = data.requests.filter((request) => request.request_type === 'additional_stock');
  const hasPendingRequest = requests.some((request) => request.status === 'pending');
  const canRequest = data.inventory.available <= 10;

  const submitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const requestedQuantity = Number(quantity);
    if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 100) {
      setError('Choose a whole-card quantity between 1 and 100.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await partnerApi('/api/partners/restock-requests', {
        method: 'POST',
        body: JSON.stringify({ quantity: requestedQuantity, reason: reason.trim() }),
      });
      setReason('');
      setRequestOpen(false);
      setMessage('Your WildCard restock request was sent to the owner.');
      await onRefresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The restock request could not be submitted.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="nwg-card nwg-inventory-panel" aria-labelledby="nwg-inventory-title">
    <CardHeading icon={Package} title="WildCard Inventory"
      description="Physical cards are separate from NGA Coins. Pending proof submissions reserve one card each."
      trailing={<button type="button" className="nwg-link-button" onClick={() => onNavigate('proof')}>
        <Camera size={15} /> Submit Delivery Proof
      </button>} />
    {data.inventory.available === 0
      ? <p className="nwg-inventory-alert is-empty" role="status"><AlertTriangle size={17} /> Out of stock. Request a restock before submitting another delivery proof.</p>
      : data.inventory.available <= 10
        ? <p className="nwg-inventory-alert is-low" role="status"><AlertTriangle size={17} /> Low stock: {formatNumber(data.inventory.available)} WildCards available.</p>
        : null}
    <div className="nwg-inventory-metrics">
      <MetricCard icon={Package} label="Total cards received" value={formatNumber(data.inventory.totalReceived)} detail="Lifetime physical stock" />
      <MetricCard icon={CheckCircle2} label="Available cards" value={formatNumber(data.inventory.available)} detail="Ready for delivery" tone="soft" />
      <MetricCard icon={CheckCircle2} label="Successfully delivered" value={formatNumber(data.inventory.delivered)} detail="Approved proof submissions" />
      <MetricCard icon={Clock3} label="Reserved" value={formatNumber(data.inventory.reserved)} detail="Pending proof submissions" />
      <MetricCard icon={AlertTriangle} label="Damaged or returned" value={formatNumber(data.inventory.damaged + data.inventory.returned)} detail={`${formatNumber(data.inventory.damaged)} damaged/lost · ${formatNumber(data.inventory.returned)} returned`} />
    </div>
    <div className="nwg-inventory-progress">
      <div><strong>Delivery progress</strong><span>{formatNumber(data.inventory.delivered)} of {formatNumber(data.inventory.totalReceived)} received cards</span></div>
      <div className="nwg-progress-track" role="progressbar" aria-label="WildCard delivery progress"
        aria-valuenow={data.inventory.progressPercent} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${data.inventory.progressPercent}%` }} />
      </div>
      <p>Reward per approved delivery: <strong>1,000 NGA Coins</strong>. Pending or rejected proofs earn no coins.</p>
    </div>
    <div className="nwg-inventory-actions">
      <button type="button" className="nwg-button nwg-button-secondary"
        disabled={!canRequest || hasPendingRequest}
        aria-expanded={requestOpen}
        onClick={() => setRequestOpen((open) => !open)}>
        <Package size={16} />{hasPendingRequest ? 'Restock request pending' : 'Request Restock'}
      </button>
      <button type="button" className="nwg-button nwg-button-primary" onClick={() => onNavigate('proof')}>
        <Camera size={16} />Submit Delivery Proof
      </button>
      {!canRequest && <span>Restock requests are available when 10 or fewer cards remain.</span>}
    </div>
    {requestOpen && <form className="nwg-inline-form nwg-restock-form" onSubmit={(event) => void submitRequest(event)}>
      <p>Available stock now: <strong>{formatNumber(data.inventory.available)}</strong></p>
      <label>Requested quantity
        <input type="number" min="1" max="100" step="1" required value={quantity}
          onChange={(event) => setQuantity(event.target.value)} />
      </label>
      <label>Reason (optional)
        <textarea maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}
          placeholder="Add a note for the owner." />
      </label>
      <button type="submit" className="nwg-button nwg-button-primary" disabled={busy || hasPendingRequest}>
        <Send size={15} />{busy ? 'Submitting…' : 'Submit Request'}
      </button>
    </form>}
    {error && <p className="nwg-feedback is-error" role="alert">{error}</p>}
    {message && <p className="nwg-feedback" role="status">{message}</p>}
    <div className="nwg-restock-history">
      <strong>Restock request history</strong>
      {requests.length ? requests.slice(0, 5).map((request) => <article key={request.id} className="nwg-request-row">
        <span className="nwg-request-icon"><Package size={18} /></span>
        <div><strong>{request.stock_quantity === null ? 'Restock request' : `${formatNumber(request.stock_quantity)} cards requested`}</strong>
          <p>{request.details}</p>{request.review_note && <small>Owner response: {request.review_note}</small>}</div>
        <time>{formatDate(request.created_at)}</time><StatusPill status={request.status} />
      </article>) : <p className="nwg-muted nwg-no-records">No restock requests yet.</p>}
    </div>
  </section>;
}

function IndependentInventorySection({ data, onNavigate, onRefresh }: {
  data: PartnerWorkspaceData;
  onNavigate: (section: SectionId) => void;
  onRefresh: () => Promise<void>;
}) {
  const [damageCardId, setDamageCardId] = useState('');
  const [damageType, setDamageType] = useState('damaged');
  const [damageDetails, setDamageDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const submitDamage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await partnerApi('/api/partners/damage-reports', {
        method: 'POST',
        body: JSON.stringify({ cardId: damageCardId, issueType: damageType, details: damageDetails }),
      });
      setDamageCardId('');
      setDamageDetails('');
      setMessage('Your damage or loss report was sent to the owner.');
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The report could not be submitted.');
    } finally {
      setBusy(false);
    }
  };

  const stockRows = useMemo(() => {
    let balance = 0;
    return [...data.stockHistory].sort((left, right) =>
      Date.parse(left.created_at) - Date.parse(right.created_at) || left.id.localeCompare(right.id))
      .map((movement) => {
        balance += movement.quantity;
        return { ...movement, balance };
      }).reverse().slice(0, 100);
  }, [data.stockHistory]);
  const restockRequests = data.requests.filter((request) => request.request_type === 'additional_stock');

  return <section className="nwg-screen nwg-inventory-screen" aria-labelledby="partner-workspace-page-title">
    <PageHeading eyebrow="WildCard inventory" title="WildCard Inventory"
      description="Track your physical cards, request a restock, report damage, and review stock history." />
    <PartnerInventorySection data={data} onRefresh={onRefresh} onNavigate={onNavigate} />
    <section className="nwg-card nwg-table-card nwg-stock-history">
      <CardHeading icon={Package} title="Stock Movement History"
        description="Audited issues, restocks, deliveries, returns, and adjustments." />
      {stockRows.length ? <>
        <div className="nwg-table-scroll"><table className="nwg-table">
          <thead><tr><th>Date & time</th><th>Activity</th><th>Quantity</th><th>Balance</th><th>Notes</th></tr></thead>
          <tbody>{stockRows.map((movement) => <tr key={movement.id}>
            <td>{formatDate(movement.created_at)}</td><td>{movement.movement_type.replaceAll('_', ' ')}</td>
            <td className={movement.quantity < 0 ? 'nwg-negative' : 'nwg-positive'}>
              {movement.quantity > 0 ? '+' : ''}{movement.quantity}</td>
            <td>{movement.balance}</td><td>{movement.notes || '—'}</td>
          </tr>)}</tbody>
        </table></div>
        <div className="nwg-stock-cards">{stockRows.slice(0, 20).map((movement) => <article className="nwg-stock-card" key={movement.id}>
          <div><strong>{movement.movement_type.replaceAll('_', ' ')}</strong><time>{formatDate(movement.created_at)}</time></div>
          <p>{movement.notes || 'Stock movement recorded'}</p>
          <span className={movement.quantity < 0 ? 'nwg-negative' : 'nwg-positive'}>
            {movement.quantity > 0 ? '+' : ''}{movement.quantity} cards · balance {movement.balance}
          </span>
        </article>)}</div>
      </> : <EmptyState icon={Package} title="No stock movements yet"
        detail="Real stock issues, delivery consumption, and adjustments will appear here." />}
    </section>
    <section className="nwg-card nwg-damage-card">
      <CardHeading icon={AlertTriangle} title="Report Damaged or Lost Cards"
        description="Submit a report without a campaign or assigned area. The owner will review it before stock is adjusted." />
      {data.damageReports.length > 0 && <div className="nwg-damage-history">
        {data.damageReports.slice(0, 5).map((report) => <div key={report.id}>
          <span>{report.card_id || report.issue_type.replaceAll('_', ' ')}</span><StatusPill status={report.status} />
        </div>)}
      </div>}
      <form className="nwg-form" onSubmit={(event) => void submitDamage(event)}>
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
          <Send size={15} />{busy ? 'Submitting…' : 'Submit report'}
        </button>
      </form>
      {(error || message) && <p className={`nwg-feedback${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}</p>}
    </section>
    <details className="nwg-card nwg-historical-campaigns">
      <summary>Historical campaign activity</summary>
      <p>Existing campaign assignments and records are retained for reference. Independent deliveries, inventory, and restocks do not require campaign participation.</p>
      <CampaignsSection data={data} onRefresh={onRefresh} />
      <div className="nwg-restock-history">
        <strong>Restock request history</strong>
        {restockRequests.length ? restockRequests.map((request) => <article key={request.id} className="nwg-request-row">
          <span className="nwg-request-icon"><Package size={18} /></span>
          <div><strong>{request.stock_quantity === null ? 'Restock request' : `${formatNumber(request.stock_quantity)} cards requested`}</strong>
            <p>{request.details}</p>{request.review_note && <small>Owner response: {request.review_note}</small>}</div>
          <time>{formatDate(request.created_at)}</time><StatusPill status={request.status} />
        </article>) : <p className="nwg-muted nwg-no-records">No restock requests yet.</p>}
      </div>
    </details>
  </section>;
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
  const [requestType, setRequestType] = useState('update_locality');
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
    ? data.requests.filter((request) => request.assignment_id === campaign.assignmentId &&
      request.request_type !== 'additional_stock')
    : [];
  const campaignDamageReports = campaign
    ? data.damageReports.filter((report) => report.assignment_id === campaign.assignmentId)
    : [];
  const campaignStockHistory = data.stockHistory;
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
        <MetricCard icon={Package} label="Partner-wide stock" value={formatNumber(data.inventory.available)}
          detail="Available physical WildCards" tone="soft" />
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
              <div><Package size={19} /><span>Stock (WildCards)<strong>{data.inventory.available} available</strong>
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
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [note, setNote] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessCategory, setBusinessCategory] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [addressDetail, setAddressDetail] = useState('');
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
    capturedAt: string;
  } | null>(null);
  const [locationToken, setLocationToken] = useState('');
  const [locationSource, setLocationSource] = useState<'gps_reverse_geocoded' | 'gps_manual' | 'manual_no_gps'>('manual_no_gps');
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState('');
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
    setLocationError('');
    setLocation(null);
    setLocationToken('');
    setLocationSource('manual_no_gps');
    setDeliveryAddress('');
    if (!navigator.geolocation) {
      setLocationError('Location access is not available in this browser. Enter the delivery address manually.');
      return;
    }
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords, timestamp }) => {
        const capturedAt = new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString();
        const captured = {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
          capturedAt,
        };
        setLocation(captured);
        setLocationToken('');
        setLocationSource('gps_manual');
        setDeliveryAddress('');
        try {
          const result = await partnerApi<{ address: string; token: string }>('/api/partners/reverse-geocode', {
            method: 'POST',
            body: JSON.stringify({
              latitude: captured.latitude,
              longitude: captured.longitude,
              accuracy: captured.accuracy,
              capturedAt: captured.capturedAt,
            }),
          });
          setDeliveryAddress(result.address);
          setLocationToken(result.token);
          setLocationSource('gps_reverse_geocoded');
        } catch (reason) {
          setLocationError(reason instanceof Error
            ? `${reason.message} Your coordinates are retained; enter the address manually or retry.`
            : 'Address lookup failed. Your coordinates are retained; enter the address manually or retry.');
        } finally {
          setLocationLoading(false);
        }
      },
      (reason) => {
        setLocationLoading(false);
        setLocationToken('');
        setLocationSource('manual_no_gps');
        const message = reason.code === reason.PERMISSION_DENIED
          ? 'Location permission was denied. Enable location access for this site in your browser settings, then retry. You can enter the address manually.'
          : reason.code === reason.POSITION_UNAVAILABLE
            ? 'Your device could not determine a location. Check device location services and retry, or enter the address manually.'
            : 'Location capture timed out. Retry or enter the address manually.';
        setLocationError(message);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  };
  const submitProof = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (businessName.trim().length < 2 || deliveryAddress.trim().length < 3 || !photoDataUrl) {
      setError('Enter the business name and delivery address, and capture or choose a proof photo.');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      await partnerApi('/api/partners/proofs', {
        method: 'POST',
        body: JSON.stringify({
          businessName: businessName.trim(),
          businessCategory: businessCategory.trim(),
          deliveryAddress: deliveryAddress.trim(),
          addressDetail: addressDetail.trim(),
          photoDataUrl,
          note,
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
          accuracy: location?.accuracy ?? null,
          capturedAt: location?.capturedAt ?? null,
          locationAddressSource: location
            ? locationSource
            : 'manual_no_gps',
          locationToken,
        }),
      });
      setPhotoDataUrl('');
      setNote('');
      setBusinessName('');
      setBusinessCategory('');
      setDeliveryAddress('');
      setAddressDetail('');
      setLocation(null);
      setLocationToken('');
      setLocationSource('manual_no_gps');
      setLocationError('');
      setMessage('Your delivery proof was submitted for owner review.');
      await onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The proof could not be submitted.'); }
    finally { setBusy(false); }
  };

  const history = data.proofs.filter((proof) => filter === 'all' || proof.status === filter);
  const visibleHistory = showAllHistory ? history : history.slice(0, 3);
  return (
    <section className="nwg-screen nwg-proof-screen" aria-labelledby="partner-workspace-page-title">
      <PageHeading eyebrow="Delivery & proofs" title="Delivery & Proofs"
        description="Visit any local business, record the delivery location, and submit a clear photo for owner review." />
      <div className="nwg-proof-layout">
        <section className="nwg-card nwg-capture-card">
          <CardHeading icon={Camera} title="Capture proof" />
          <form onSubmit={(event) => void submitProof(event)} className="nwg-form">
            <label>Business / Shop Name <span className="nwg-required">*</span>
              <input required minLength={2} maxLength={120} value={businessName}
                onChange={(event) => setBusinessName(event.target.value)} placeholder="Enter the business name" />
            </label>
            <label>Business Category (optional)
              <select value={businessCategory} onChange={(event) => setBusinessCategory(event.target.value)}>
                <option value="">Select a category (optional)</option>
                <option value="Retail">Retail</option><option value="Food & Beverage">Food &amp; Beverage</option>
                <option value="Health & Wellness">Health &amp; Wellness</option><option value="Services">Services</option>
                <option value="Education">Education</option><option value="Other">Other</option>
              </select>
            </label>
            <div className="nwg-location-picker nwg-delivery-location">
              <label>Current Delivery Location <span className="nwg-required">*</span>
                <textarea required minLength={3} maxLength={500} value={deliveryAddress}
                  onChange={(event) => {
                    setDeliveryAddress(event.target.value);
                    setLocationToken('');
                    setLocationSource(location ? 'gps_manual' : 'manual_no_gps');
                  }} placeholder="Detected address will appear here. You can also enter it manually." />
              </label>
              <button type="button" className="nwg-location-button" onClick={captureLocation} disabled={locationLoading}>
                <LocateFixed size={16} />{locationLoading ? 'Detecting address…' : location ? 'Refresh Location' : 'Use My Location'}
              </button>
              <small>Location is captured only when requested. Coordinates are sent to OpenStreetMap Nominatim to resolve the address and stored with this proof.</small>
            </div>
            {locationError && <p className="nwg-feedback is-error" role="alert">{locationError}</p>}
            {location && <section className="nwg-location-confirmation" aria-label="GPS location evidence">
              <div className="nwg-location-confirmation-heading">
                <CheckCircle2 size={18} />
                <strong>{locationSource === 'gps_reverse_geocoded' ? 'Location captured successfully' : 'GPS captured · address needs confirmation'}</strong>
              </div>
              <p>{deliveryAddress || 'Address lookup failed. Enter the delivery address above or retry location detection.'}</p>
              <dl>
                <div><dt>GPS coordinates</dt><dd>{location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}</dd></div>
                <div><dt>Accuracy</dt><dd>±{Math.round(location.accuracy)} m</dd></div>
                <div><dt>Captured</dt><dd>{formatDate(location.capturedAt)}</dd></div>
              </dl>
              <iframe title="Delivery location map preview"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${location.longitude - 0.006}%2C${location.latitude - 0.004}%2C${location.longitude + 0.006}%2C${location.latitude + 0.004}&layer=mapnik&marker=${location.latitude}%2C${location.longitude}`}
                loading="lazy" referrerPolicy="no-referrer" />
              <small>© OpenStreetMap contributors</small>
            </section>}
            <label>Additional address detail or landmark (optional)
              <input maxLength={240} value={addressDetail}
                onChange={(event) => setAddressDetail(event.target.value)}
                placeholder="Floor, nearby landmark, or directions" />
              <small>This is stored separately and does not change your GPS evidence or detected address.</small>
            </label>
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
            <label>Additional note (optional)<textarea value={note} maxLength={200}
              onChange={(event) => setNote(event.target.value)} placeholder="Add a short note for the reviewer." />
              <small className="nwg-char-count">{note.length} / 200</small>
            </label>
            <div className="nwg-form-end">
              <span className="nwg-muted">{data.inventory.available > 0
                ? 'No campaign or shop assignment is required. One card is reserved on submit; 1,000 NGA Coins are credited only after approval.'
                : 'No unreserved WildCards are available. Request a restock before submitting.'}</span>
              <button type="submit" className="nwg-button nwg-button-primary"
                disabled={busy || !businessName.trim() || deliveryAddress.trim().length < 3 ||
                  !photoDataUrl || data.inventory.available <= 0}>
                <Send size={15} />{busy ? 'Submitting…' : 'Submit Delivery Proof'}
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
              <option value="all">All deliveries</option><option value="pending">Pending</option>
              <option value="approved">Approved</option><option value="needs_correction">Needs correction</option>
            </select>} />
          {history.length ? <div className="nwg-proof-history">
            {visibleHistory.map((proof) => {
              return <button type="button" key={proof.id} className="nwg-proof-history-row" onClick={() => setSelectedProof(proof)}>
                <img src={proof.photoUrl} alt="" loading="lazy" />
                <span className="nwg-proof-history-copy">
                  <strong>{proof.id.slice(0, 8).toUpperCase()}</strong>
                  <span>{proof.business_name || campaignName(data, proof.campaign_id)}</span>
                  <small>{proof.delivery_address || 'Address not provided in legacy record'}</small>
                  <small><CalendarDays size={13} />{formatDate(proof.submitted_at)}</small>
                </span>
                <span className="nwg-proof-history-status"><StatusPill status={proof.status} />
                  <small>{proof.status === 'approved' ? `${formatNumber(proof.coins)} NGA Coins` : 'No coins yet'}</small></span><ArrowRight size={17} />
              </button>;
            })}
          </div> : <EmptyState icon={FileCheck2} title="No proof history yet"
            detail="Your submissions and owner review decisions will appear here." />}
          {history.length > 3 && <button type="button" className="nwg-link-button"
            onClick={() => setShowAllHistory((showAll) => !showAll)}>
            {showAllHistory ? 'Show latest submissions' : 'View older submissions'} <ArrowRight size={14} />
          </button>}
          <p className="nwg-history-note"><ShieldCheck size={15} />Proof photos are private and available only to you and authorized NearGrow reviewers.</p>
        </section>
      </div>
      {selectedProof && <div className="nwg-modal-backdrop" role="presentation" onClick={() => setSelectedProof(null)}>
        <section className="nwg-proof-modal" role="dialog" aria-modal="true" aria-label="Proof submission details"
          onClick={(event) => event.stopPropagation()}>
          <button type="button" className="nwg-modal-close" onClick={() => setSelectedProof(null)} aria-label="Close proof details"><X size={20} /></button>
          <img src={selectedProof.photoUrl} alt="Partner submitted proof" />
          <h2>{selectedProof.business_name || campaignName(data, selectedProof.campaign_id)}</h2>
          {selectedProof.business_category && <p>{selectedProof.business_category}</p>}
          <p>{selectedProof.delivery_address || 'Address not provided in legacy record'}</p>
          {selectedProof.address_detail && <p>{selectedProof.address_detail}</p>}
          <p>{formatDate(selectedProof.submitted_at)} · {selectedProof.status === 'approved'
            ? `${formatNumber(selectedProof.coins)} NGA Coins earned` : 'No reward credited'}</p>
          <StatusPill status={selectedProof.status} />
          <p>{selectedProof.note || 'No note added.'}</p>
          {selectedProof.review_note && <p className="nwg-review-note"><strong>Owner note:</strong> {selectedProof.review_note}</p>}
          {selectedProof.latitude !== null && selectedProof.longitude !== null &&
            <a className="nwg-button nwg-button-secondary" href={`https://www.google.com/maps?q=${selectedProof.latitude},${selectedProof.longitude}`}
              target="_blank" rel="noreferrer">View Location</a>}
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
        description="Manage your partner profile, get help, and follow the independent WildCard delivery guide." />
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
          <div><h2>Need help?</h2><p>Contact our support team about WildCard deliveries, inventory, proofs, or earnings.</p></div>
          <a href="mailto:info@neargrowads.in" className="nwg-button nwg-button-primary"><MailCheck size={16} />Email support</a>
          <a href="tel:+919289810149" className="nwg-button nwg-button-secondary"><Phone size={16} />Call support</a>
        </section>}
      </div>
      {(error || message) && <p className={`nwg-feedback${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}</p>}
      <section className="nwg-card nwg-handover-guide">
        <CardHeading icon={LifeBuoy} title="Three Step Handover Guide"
          description="Visit local businesses independently, capture delivery evidence, and submit your proof for owner review." />
        <div className="nwg-guide-steps">
          <article><MapPin size={27} /><span className="nwg-step-number">1</span><div><strong>Visit any local business</strong>
            <p>Introduce NearGrow WildCard to a legitimate local business. No campaign or area assignment is required.</p></div></article>
          <ArrowRight className="nwg-step-arrow" size={22} />
          <article><Camera size={27} /><span className="nwg-step-number">2</span><div><strong>Deliver and capture</strong>
            <p>Deliver the WildCard, capture the current location, and take a clear proof photo.</p></div></article>
          <ArrowRight className="nwg-step-arrow" size={22} />
          <article><Upload size={27} /><span className="nwg-step-number">3</span><div><strong>Submit and earn</strong>
            <p>Submit your proof. Receive 1,000 NGA Coins after owner approval.</p></div></article>
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
            <div><dt><Store size={16} />Business</dt><dd>Sample local grocery store</dd></div>
            <div><dt><MapPin size={16} />Delivery address</dt><dd>Example Street, Noida, India</dd></div>
            <div><dt><CalendarDays size={16} />Handover date</dt><dd>Reference only · not a live delivery</dd></div>
            <div><dt><Camera size={16} />Proof photo</dt><dd>One clear delivery photo</dd></div>
            <div><dt><Coins size={16} />Reward</dt><dd>1,000 NGA Coins after owner approval</dd></div>
          </dl>
          <p className="nwg-sample-warning"><ShieldCheck size={14} />Reference example only. This is not a live business, address, assignment, or partner record.</p>
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
      const inventoryValues = data.inventory ? Object.values(data.inventory) : [];
      if (!Array.isArray(data.campaigns) || !Array.isArray(data.proofs) ||
        !Array.isArray(data.stockHistory) || !Array.isArray(data.requests) ||
        !Array.isArray(data.damageReports) || !Array.isArray(data.ledger) ||
        !Array.isArray(data.withdrawals) || !data.coinSummary || !data.user ||
        !data.inventory || inventoryValues.some((value) => !Number.isSafeInteger(value) || value < 0) ||
        data.inventory.progressPercent > 100 ||
        !Number.isSafeInteger(data.deliveriesToday) || data.deliveriesToday < 0) {
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
              {section === 'inventory' && <IndependentInventorySection data={workspace} onNavigate={setSection} onRefresh={refreshWorkspace} />}
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
