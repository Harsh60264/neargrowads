import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, ArrowDown, ArrowUp, BadgeCheck, Bell, Boxes, BriefcaseBusiness, Check, ChevronLeft,
  ChevronRight, CircleAlert, Coins, LoaderCircle, MapPin, PackageCheck, RefreshCw, Search,
  Settings2, ShieldCheck, UsersRound, X,
} from 'lucide-react';
import './adminDeliveryTeam.css';

export interface DeliveryTeamActivity {
  id: string;
  partnerName: string;
  activityType: string;
  details: string;
  status: string;
  createdAt: string;
}

export interface DeliveryTeamOverview {
  totalPartners: number;
  activePartners: number;
  totalAvailableCoins: number;
  totalIssuedStock: number;
  pendingRequests: number;
  pendingProofs: number;
  todaysActivity: number;
  lowStockThreshold: number;
  recentActivity: DeliveryTeamActivity[];
}

interface DeliveryTeamPartner {
  id: string;
  full_name: string;
  email: string;
  mobile_number: string;
  status: 'pending' | 'active' | 'disabled';
  created_at: string;
  last_login_at: string | null;
  available_coins: number;
  remaining_stock: number;
  pending_requests: number;
  last_activity: string | null;
  assignment_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  campaign_area: string | null;
  campaign_status: string | null;
}

interface DeliveryTeamPartnerDetail {
  partner: DeliveryTeamPartner;
  coinSummary: {
    balance: number;
    totalEarned: number;
    totalWithdrawn: number;
    pendingApproval: number;
  };
  coinHistory: Array<{
    id: string;
    entry_type: 'earning' | 'withdrawal' | 'adjustment';
    amount: number;
    status: string;
    reference: string;
    notes: string;
    created_at: string;
    administrator_id?: string | null;
    admin_previous_balance?: number | null;
    admin_resulting_balance?: number | null;
  }>;
  stockSummary: {
    available: number;
    issued: number;
    distributed: number;
    damaged: number;
    returned: number;
  };
  stockHistory: Array<{
    id: string;
    assignment_id: string;
    movement_type: string;
    quantity: number;
    notes: string;
    created_at: string;
    campaign_name?: string;
    previous_balance?: number | null;
    resulting_balance?: number | null;
  }>;
  assignments: Array<{
    id: string;
    campaign_id: string;
    campaign_name: string;
    campaign_status: string;
    area: string;
  }>;
}

interface DeliveryTeamCampaign {
  id: string;
  name: string;
  area: string;
  start_date: string;
  end_date: string;
  daily_target: number;
  coins_per_proof: number;
  status: 'active' | 'paused' | 'completed';
  assigned_partners: number;
}

interface DeliveryTeamQueues {
  proofs: Array<{
    id: string;
    partnerName: string;
    campaignName: string;
    siteName: string;
    photoUrl: string;
    note: string;
    latitude: number | null;
    longitude: number | null;
    coins: number;
    submittedAt: string;
  }>;
  campaignRequests: Array<{
    id: string;
    partnerName: string;
    assignmentId: string;
    campaignName: string;
    requestType: string;
    details: string;
    createdAt: string;
  }>;
  damageReports: Array<{
    id: string;
    partnerName: string;
    assignmentId: string;
    campaignName: string;
    cardId: string;
    issueType: string;
    details: string;
    createdAt: string;
  }>;
  withdrawals: Array<{
    id: string;
    partnerName: string;
    amount: number;
    status: string;
    createdAt: string;
  }>;
}

type TeamTab = 'deliveryBoys' | 'activity' | 'requests' | 'campaigns' | 'settings';

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let message = `Delivery Team request failed (${response.status}).`;
    try {
      const body = await response.json() as { message?: unknown };
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // The server can return an empty response for infrastructure errors.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'No activity yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function ActivityRows({ items, compact = false }: { items: DeliveryTeamActivity[]; compact?: boolean }) {
  if (!items.length) return <p className="dt-empty">No WildCard activity has been recorded yet.</p>;
  return <div className="dt-activity-list">
    {items.map((item) => <article className="dt-activity-row" key={item.id}>
      <span className="dt-activity-icon"><Activity size={16} aria-hidden="true" /></span>
      <div className="dt-activity-copy">
        <p><strong>{item.partnerName}</strong> · {item.activityType}</p>
        <span>{item.details}</span>
      </div>
      <div className="dt-activity-meta">
        {item.status && <span className={`dt-status dt-status--${item.status.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{item.status}</span>}
        {!compact && <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>}
      </div>
    </article>)}
  </div>;
}

export function DeliveryTeamOverviewWidget({
  overview,
  error,
  theme,
  onRefresh,
  onOpen,
}: {
  overview: DeliveryTeamOverview | null;
  error?: string;
  theme: 'light' | 'dark';
  onRefresh: () => void;
  onOpen: () => void;
}) {
  return <section className="dt-overview-widget" data-theme={theme} aria-labelledby="dt-overview-title">
    <div className="dt-widget-header">
      <div>
        <p className="dt-eyebrow">WildCard operations</p>
        <h2 id="dt-overview-title">Delivery Team activity</h2>
      </div>
      <div className="dt-widget-actions">
        <button type="button" className="dt-button dt-button--quiet" onClick={onRefresh} aria-label="Refresh Delivery Team activity">
          <RefreshCw size={15} aria-hidden="true" /> Refresh
        </button>
        <button type="button" className="dt-button dt-button--primary" onClick={onOpen}>View all activity</button>
      </div>
    </div>
    {error ? <p className="dt-error" role="alert">{error}</p> : overview ? <>
      <div className="dt-widget-stats">
        <span><strong>{overview.pendingProofs}</strong> proofs awaiting review</span>
        <span><strong>{overview.pendingRequests}</strong> requests awaiting review</span>
        <span><strong>{formatNumber(overview.todaysActivity)}</strong> actions today</span>
      </div>
      <ActivityRows items={overview.recentActivity.slice(0, 3)} compact />
    </> : <p className="dt-loading"><LoaderCircle size={16} className="dt-spin" /> Loading WildCard activity…</p>}
  </section>;
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  tone = 'green',
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone?: 'green' | 'navy' | 'amber';
}) {
  return <article className={`dt-metric dt-metric--${tone}`}>
    <span className="dt-metric-icon">{icon}</span>
    <p>{label}</p>
    <strong>{value}</strong>
    <small>{detail}</small>
  </article>;
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return <div className="dt-modal-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="dt-modal" role="dialog" aria-modal="true" aria-labelledby="dt-modal-title">
      <header className="dt-modal-header">
        <h2 id="dt-modal-title">{title}</h2>
        <button type="button" className="dt-icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
      </header>
      {children}
    </section>
  </div>;
}

export function AdminDeliveryTeam({
  canCreate,
  canEdit,
  theme,
}: {
  canCreate: boolean;
  canEdit: boolean;
  theme: 'light' | 'dark';
}) {
  const [tab, setTab] = useState<TeamTab>(() => {
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    return requestedTab === 'activity' ? 'activity' : 'deliveryBoys';
  });
  const [activityFilter, setActivityFilter] = useState<'all' | 'proofs' | 'stock' | 'coins' | 'requests' | 'campaigns'>('all');
  const [overview, setOverview] = useState<DeliveryTeamOverview | null>(null);
  const [partners, setPartners] = useState<DeliveryTeamPartner[]>([]);
  const [campaignPartners, setCampaignPartners] = useState<DeliveryTeamPartner[]>([]);
  const [campaignPartnerSearch, setCampaignPartnerSearch] = useState('');
  const [totalPartners, setTotalPartners] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending' | 'disabled'>('all');
  const [page, setPage] = useState(1);
  const [selectedPartner, setSelectedPartner] = useState<DeliveryTeamPartnerDetail | null>(null);
  const [campaigns, setCampaigns] = useState<DeliveryTeamCampaign[]>([]);
  const [queues, setQueues] = useState<DeliveryTeamQueues | null>(null);
  const [activity, setActivity] = useState<DeliveryTeamActivity[]>([]);
  const [lowStockThreshold, setLowStockThreshold] = useState('5');
  const thresholdInitialized = useRef(false);
  const [loading, setLoading] = useState(true);
  const refreshPending = useRef(false);
  const coinIdempotency = useRef<{ fingerprint: string; key: string } | null>(null);
  const stockIdempotency = useRef<{ fingerprint: string; key: string } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [coinAmount, setCoinAmount] = useState('');
  const [coinReason, setCoinReason] = useState('');
  const [stockAssignmentId, setStockAssignmentId] = useState('');
  const [stockMovement, setStockMovement] = useState<'issued' | 'returned' | 'adjusted'>('issued');
  const [stockQuantity, setStockQuantity] = useState('');
  const [stockReason, setStockReason] = useState('');
  const [proofNotes, setProofNotes] = useState<Record<string, string>>({});
  const [requestNotes, setRequestNotes] = useState<Record<string, string>>({});
  const [withdrawalReference, setWithdrawalReference] = useState<Record<string, string>>({});
  const [confirmedSettlements, setConfirmedSettlements] = useState<Record<string, boolean>>({});
  const [campaignForm, setCampaignForm] = useState({
    partnerProfileId: '',
    name: '',
    description: '',
    area: '',
    startDate: '',
    endDate: '',
    dailyTarget: '',
    coinsPerProof: '',
    initialStock: '0',
    sites: [{ name: '', address: '' }],
  });
  const pageSize = 20;

  const fetchOverview = useCallback(async () => {
    const response = await requestJson<{ overview: DeliveryTeamOverview }>('/api/admin/delivery-team/overview');
    setOverview(response.overview);
    if (!thresholdInitialized.current) {
      setLowStockThreshold(String(response.overview.lowStockThreshold));
      thresholdInitialized.current = true;
    }
    setActivity(response.overview.recentActivity);
  }, []);

  const fetchPartners = useCallback(async () => {
    const params = new URLSearchParams({
      search,
      status: statusFilter,
      page: String(page),
      pageSize: String(pageSize),
    });
    const response = await requestJson<{ partners: DeliveryTeamPartner[]; total: number }>(
      `/api/admin/delivery-team/partners?${params.toString()}`,
    );
    setPartners(response.partners);
    setTotalPartners(response.total);
  }, [page, search, statusFilter]);

  const fetchCampaigns = useCallback(async () => {
    const response = await requestJson<{ campaigns: DeliveryTeamCampaign[] }>('/api/admin/delivery-team/campaigns');
    setCampaigns(response.campaigns);
  }, []);

  const fetchQueues = useCallback(async () => {
    const response = await requestJson<DeliveryTeamQueues>('/api/admin/delivery-team/requests');
    setQueues(response);
  }, []);

  const refresh = useCallback(async () => {
    if (refreshPending.current) return;
    refreshPending.current = true;
    setError('');
    try {
      await Promise.all([fetchOverview(), fetchPartners(), fetchCampaigns(), fetchQueues()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Delivery Team data could not be loaded.');
    } finally {
      setLoading(false);
      refreshPending.current = false;
    }
  }, [fetchCampaigns, fetchOverview, fetchPartners, fetchQueues]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (tab !== 'campaigns' || !canCreate) return;
    let active = true;
    const params = new URLSearchParams({
      search: campaignPartnerSearch,
      status: 'active',
      page: '1',
      pageSize: '100',
    });
    void requestJson<{ partners: DeliveryTeamPartner[] }>(`/api/admin/delivery-team/partners?${params.toString()}`)
      .then((response) => {
        if (active) setCampaignPartners(response.partners);
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Active delivery partners could not be loaded.');
      });
    return () => { active = false; };
  }, [campaignPartnerSearch, canCreate, tab]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    if (!selectedPartner) return;
    setStockAssignmentId(selectedPartner.assignments[0]?.id || '');
  }, [selectedPartner]);

  const openPartner = useCallback(async (partner: DeliveryTeamPartner) => {
    setError('');
    setNotice('');
    try {
      const response = await requestJson<{ detail: DeliveryTeamPartnerDetail }>(
        `/api/admin/delivery-team/partners/${encodeURIComponent(partner.id)}`,
      );
      setSelectedPartner(response.detail);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Partner details could not be loaded.');
    }
  }, []);

  const runAction = useCallback(async (path: string, body: Record<string, unknown>, successMessage: string) => {
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      await requestJson(path, { method: 'POST', body: JSON.stringify(body) });
      setNotice(successMessage);
      await refresh();
      if (selectedPartner) {
        try {
          const response = await requestJson<{ detail: DeliveryTeamPartnerDetail }>(
            `/api/admin/delivery-team/partners/${encodeURIComponent(selectedPartner.partner.id)}`,
          );
          setSelectedPartner(response.detail);
        } catch (detailError) {
          setError(detailError instanceof Error ? detailError.message : 'The action was recorded, but partner details did not refresh.');
        }
      }
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The requested action could not be completed.');
      return false;
    } finally {
      setActionBusy(false);
    }
  }, [refresh, selectedPartner]);

  const adjustCoins = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedPartner) return;
    const amount = Number(coinAmount);
    if (!Number.isSafeInteger(amount) || amount === 0 || !coinReason.trim()) {
      setError('Enter a non-zero whole number of NGA Coins and a reason.');
      return;
    }
    const currentBalance = selectedPartner.coinSummary.balance;
    const nextBalance = currentBalance + amount;
    const verb = amount > 0 ? 'increase' : 'decrease';
    if (amount < 0 && nextBalance < 0) {
      setError('This adjustment would make the available coin balance negative.');
      return;
    }
    if (!window.confirm(`Confirm ${verb} by ${formatNumber(Math.abs(amount))} NGA Coins?\n\nCurrent balance: ${formatNumber(currentBalance)}\nResulting balance: ${formatNumber(nextBalance)}\nReason: ${coinReason.trim()}`)) return;
    const fingerprint = JSON.stringify({ amount, reason: coinReason.trim(), isReset: false });
    if (coinIdempotency.current?.fingerprint !== fingerprint) {
      coinIdempotency.current = { fingerprint, key: crypto.randomUUID() };
    }
    const saved = await runAction(
      `/api/admin/delivery-team/partners/${encodeURIComponent(selectedPartner.partner.id)}/coins`,
      { amount, reason: coinReason.trim(), idempotencyKey: coinIdempotency.current.key, isReset: false },
      'NGA Coins adjustment recorded in the ledger.',
    );
    if (saved) {
      coinIdempotency.current = null;
      setCoinAmount('');
      setCoinReason('');
    }
  }, [coinAmount, coinReason, runAction, selectedPartner]);

  const resetCoins = useCallback(async () => {
    if (!selectedPartner) return;
    const currentBalance = selectedPartner.coinSummary.balance;
    if (currentBalance <= 0) {
      setError('This partner has no available balance to reset.');
      return;
    }
    const reason = window.prompt(`Enter the required reason for resetting ${selectedPartner.partner.full_name}'s available balance to zero.`);
    if (!reason?.trim()) return;
    if (!window.confirm(`Reset available NGA Coins from ${formatNumber(currentBalance)} to 0?\n\nThis records a ledger adjustment and preserves earnings, withdrawals and history.\nReason: ${reason.trim()}`)) return;
    const fingerprint = JSON.stringify({ amount: -currentBalance, reason: reason.trim(), isReset: true });
    if (coinIdempotency.current?.fingerprint !== fingerprint) {
      coinIdempotency.current = { fingerprint, key: crypto.randomUUID() };
    }
    const saved = await runAction(
      `/api/admin/delivery-team/partners/${encodeURIComponent(selectedPartner.partner.id)}/coins`,
      { amount: -currentBalance, reason: reason.trim(), idempotencyKey: coinIdempotency.current.key, isReset: true },
      'Available balance reset recorded. Historical entries were preserved.',
    );
    if (saved) coinIdempotency.current = null;
  }, [runAction, selectedPartner]);

  const manageStock = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedPartner || !stockAssignmentId) {
      setError('Choose an active campaign assignment before recording stock.');
      return;
    }
    const inputQuantity = Number(stockQuantity);
    if (!Number.isSafeInteger(inputQuantity) || inputQuantity === 0 ||
      Math.abs(inputQuantity) > 1_000_000 ||
      (stockMovement !== 'adjusted' && inputQuantity < 1) || !stockReason.trim()) {
      setError('Enter a valid whole-card quantity and a reason.');
      return;
    }
    const quantity = stockMovement === 'returned' ? -inputQuantity : inputQuantity;
    if (!window.confirm(`Record ${stockMovement} of ${formatNumber(Math.abs(quantity))} physical WildCards for this campaign?${stockMovement === 'adjusted' ? `\nBalance change: ${quantity > 0 ? '+' : ''}${formatNumber(quantity)}` : ''}\nReason: ${stockReason.trim()}`)) return;
    const fingerprint = JSON.stringify({
      partnerProfileId: selectedPartner.partner.id,
      assignmentId: stockAssignmentId,
      movementType: stockMovement,
      quantity,
      notes: stockReason.trim(),
    });
    if (stockIdempotency.current?.fingerprint !== fingerprint) {
      stockIdempotency.current = { fingerprint, key: crypto.randomUUID() };
    }
    const saved = await runAction('/api/admin/delivery-team/stock', {
      partnerProfileId: selectedPartner.partner.id,
      assignmentId: stockAssignmentId,
      movementType: stockMovement,
      quantity,
      notes: stockReason.trim(),
      idempotencyKey: stockIdempotency.current.key,
    }, 'Stock movement recorded in the partner ledger.');
    if (saved) {
      stockIdempotency.current = null;
      setStockQuantity('');
      setStockReason('');
    }
  }, [runAction, selectedPartner, stockAssignmentId, stockMovement, stockQuantity, stockReason]);

  const reviewProof = useCallback(async (proofId: string, decision: 'approved' | 'rejected' | 'needs_correction') => {
    const note = proofNotes[proofId]?.trim() || '';
    if (decision !== 'approved' && !note) {
      setError('Enter a review note before returning or rejecting a proof.');
      return;
    }
    if (!window.confirm(`Confirm ${decision.replace('_', ' ')} for this proof?`)) return;
    await runAction(`/api/admin/delivery-team/proofs/${encodeURIComponent(proofId)}/review`, {
      decision,
      reviewNote: note,
    }, `Proof ${decision.replace('_', ' ')}.`);
  }, [proofNotes, runAction]);

  const reviewRequest = useCallback(async (
    type: 'campaign' | 'damage' | 'withdrawal',
    id: string,
    decision: string,
    extra: Record<string, unknown> = {},
  ) => {
    const reviewNote = requestNotes[id]?.trim() || '';
    if (reviewNote.length < 3 || reviewNote.length > 500) {
      setError('Enter a review reason between 3 and 500 characters before reviewing this request.');
      return;
    }
    const message = type === 'withdrawal' && decision === 'settled'
      ? 'Record this withdrawal as paid only after confirming the external payout is complete.'
      : `Confirm ${decision} for this ${type} request?`;
    if (!window.confirm(message)) return;
    await runAction(`/api/admin/delivery-team/requests/${type}/${encodeURIComponent(id)}/review`, {
      decision,
      reviewNote,
      reference: withdrawalReference[id] || '',
      payoutConfirmed: confirmedSettlements[id] === true,
      ...extra,
    }, `${type === 'withdrawal' && decision === 'settled' ? 'Withdrawal payout recorded' : 'Request reviewed'}.`);
  }, [confirmedSettlements, requestNotes, runAction, withdrawalReference]);

  const createCampaign = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const sites = campaignForm.sites.map((site) => ({
      name: site.name.trim(),
      address: site.address.trim(),
    }));
    const initialStock = Number(campaignForm.initialStock);
    const dailyTarget = Number(campaignForm.dailyTarget);
    const coinsPerProof = Number(campaignForm.coinsPerProof);
    if (!campaignForm.partnerProfileId || sites.some((site) => !site.name || !site.address) ||
      !Number.isSafeInteger(initialStock) || initialStock < 0 ||
      !Number.isSafeInteger(dailyTarget) || dailyTarget < 1 ||
      !Number.isSafeInteger(coinsPerProof) || coinsPerProof < 1) {
      setError('Complete the campaign, assigned partner, reward, target, stock and every shop location.');
      return;
    }
    if (!window.confirm(`Create and assign "${campaignForm.name.trim()}" to the selected partner? No other partners will be assigned automatically.`)) return;
    const saved = await runAction('/api/admin/delivery-team/campaigns', {
      ...campaignForm,
      name: campaignForm.name.trim(),
      description: campaignForm.description.trim(),
      area: campaignForm.area.trim(),
      dailyTarget,
      coinsPerProof,
      initialStock,
      sites,
    }, 'Campaign created and assigned.');
    if (saved) {
      setCampaignForm((current) => ({
        ...current,
        partnerProfileId: '',
        name: '',
        description: '',
        area: '',
        dailyTarget: '',
        coinsPerProof: '',
        initialStock: '0',
        sites: [{ name: '', address: '' }],
      }));
    }
  }, [campaignForm, runAction]);

  const saveThreshold = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const threshold = Number(lowStockThreshold);
    if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 100_000) {
      setError('The low-stock threshold must be a whole number between 1 and 100,000.');
      return;
    }
    await runAction('/api/admin/delivery-team/settings', { lowStockThreshold: threshold }, 'Low-stock threshold saved.');
  }, [lowStockThreshold, runAction]);

  const maxPages = Math.max(1, Math.ceil(totalPartners / pageSize));
  const visibleActivity = activity.filter((item) => {
    const type = item.activityType.toLowerCase();
    if (activityFilter === 'proofs') return type.includes('proof');
    if (activityFilter === 'stock') return type.includes('stock') || type.includes('wildcard') || type.includes('damage');
    if (activityFilter === 'coins') return type.includes('coin');
    if (activityFilter === 'requests') return type.includes('request') || type.includes('withdrawal');
    if (activityFilter === 'campaigns') return type.includes('campaign');
    return true;
  });

  const tabs: Array<{ key: TeamTab; label: string; icon: ReactNode }> = [
    { key: 'deliveryBoys', label: 'Delivery Boys', icon: <UsersRound size={16} /> },
    { key: 'activity', label: 'Activity Feed', icon: <Activity size={16} /> },
    { key: 'requests', label: 'Requests & Proofs', icon: <Bell size={16} /> },
    { key: 'campaigns', label: 'Campaigns & Stock', icon: <Boxes size={16} /> },
    { key: 'settings', label: 'Settings', icon: <Settings2 size={16} /> },
  ];

  return <div className="delivery-team" data-theme={theme}>
    <header className="dt-page-heading">
      <div>
        <p className="dt-eyebrow"><span className="dt-dot" /> WildCard operations</p>
        <h2>Delivery Team</h2>
        <p>Manage registered partners, physical stock, proofs, requests and audited NGA Coins activity.</p>
      </div>
      <button type="button" className="dt-button dt-button--quiet" onClick={() => void refresh()} disabled={loading}>
        <RefreshCw size={16} className={loading ? 'dt-spin' : ''} /> Refresh data
      </button>
    </header>

    {error && <div className="dt-error" role="alert"><CircleAlert size={17} />{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
    {notice && <div className="dt-notice" role="status"><Check size={17} />{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={15} /></button></div>}

    {overview && <div className="dt-metrics">
      <MetricCard label="Registered partners" value={formatNumber(overview.totalPartners)} detail={`${formatNumber(overview.activePartners)} active`} icon={<UsersRound size={19} />} />
      <MetricCard label="Available NGA Coins" value={formatNumber(overview.totalAvailableCoins)} detail="Across registered partners" icon={<Coins size={19} />} tone="navy" />
      <MetricCard label="WildCards issued" value={formatNumber(overview.totalIssuedStock)} detail="Physical stock ledger" icon={<PackageCheck size={19} />} />
      <MetricCard label="Pending requests" value={formatNumber(overview.pendingRequests + overview.pendingProofs)} detail={`${overview.pendingRequests} requests · ${overview.pendingProofs} proofs`} icon={<Bell size={19} />} tone="amber" />
      <MetricCard label="Today's activity" value={formatNumber(overview.todaysActivity)} detail="Recorded partner actions" icon={<Activity size={19} />} tone="navy" />
    </div>}

    <nav className="dt-tabs" aria-label="Delivery Team sections">
      {tabs.map((item) => <button
        key={item.key}
        type="button"
        className={`dt-tab ${tab === item.key ? 'is-active' : ''}`}
        aria-current={tab === item.key ? 'page' : undefined}
        onClick={() => setTab(item.key)}
      >{item.icon}<span>{item.label}</span>
        {item.key === 'requests' && overview && (overview.pendingProofs + overview.pendingRequests) > 0 &&
          <b className="dt-tab-count">{overview.pendingProofs + overview.pendingRequests}</b>}
      </button>)}
    </nav>

    {tab === 'deliveryBoys' && <section className="dt-panel">
      <div className="dt-panel-heading">
        <div><h3>Delivery partners</h3><p>Real partner accounts and current ledger-derived balances.</p></div>
        <div className="dt-filters">
          <label className="dt-search"><Search size={16} /><span className="dt-sr-only">Search partners</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email or partner ID" />
          </label>
          <label className="dt-select-wrap"><span className="dt-sr-only">Filter partner status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="all">All statuses</option><option value="active">Active</option><option value="pending">Pending</option><option value="disabled">Disabled</option>
            </select>
          </label>
        </div>
      </div>
      <div className="dt-table-wrap">
        <table className="dt-table">
          <thead><tr><th>Partner</th><th>Status</th><th>Available coins</th><th>Remaining stock</th><th>Campaign</th><th>Pending</th><th>Last activity</th><th><span className="dt-sr-only">Manage</span></th></tr></thead>
          <tbody>
            {partners.map((partner) => <tr key={partner.id}>
              <td><div className="dt-partner-name">{partner.full_name}</div><span className="dt-muted">{partner.email} · {partner.mobile_number}</span><small className="dt-id">ID {partner.id}</small></td>
              <td><span className={`dt-status dt-status--${partner.status}`}>{partner.status}</span></td>
              <td className="dt-number">{formatNumber(partner.available_coins)}</td>
              <td><span className={`dt-stock-state ${partner.remaining_stock <= (overview?.lowStockThreshold || 5) ? 'is-low' : ''}`}>
                {partner.remaining_stock <= 0 ? 'Out of Stock' : partner.remaining_stock <= (overview?.lowStockThreshold || 5) ? `Low · ${formatNumber(partner.remaining_stock)}` : formatNumber(partner.remaining_stock)}
              </span></td>
              <td>{partner.campaign_name ? <><strong>{partner.campaign_name}</strong><span className="dt-muted">{partner.campaign_area}</span></> : <span className="dt-muted">Unassigned</span>}</td>
              <td>{partner.pending_requests > 0 ? <span className="dt-pending-count">{partner.pending_requests}</span> : '—'}</td>
              <td className="dt-muted">{formatDate(partner.last_activity || partner.last_login_at)}</td>
              <td><button type="button" className="dt-button dt-button--small" onClick={() => void openPartner(partner)}>Manage</button></td>
            </tr>)}
            {!partners.length && <tr><td colSpan={8}><p className="dt-empty">{loading ? 'Loading partners…' : 'No registered partners match this search.'}</p></td></tr>}
          </tbody>
        </table>
      </div>
      <footer className="dt-pagination">
        <span>Showing {totalPartners ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, totalPartners)} of {formatNumber(totalPartners)}</span>
        <div><button type="button" className="dt-icon-button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={17} /></button>
          <span>Page {page} of {maxPages}</span>
          <button type="button" className="dt-icon-button" aria-label="Next page" disabled={page >= maxPages} onClick={() => setPage((current) => Math.min(maxPages, current + 1))}><ChevronRight size={17} /></button></div>
      </footer>
    </section>}

    {tab === 'activity' && <section className="dt-panel">
      <div className="dt-panel-heading"><div><h3>Recent activity</h3><p>Latest 100 real proof, stock, request, coin and campaign events.</p></div>
        <label className="dt-select-wrap"><span className="dt-sr-only">Filter activity type</span><select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value as typeof activityFilter)}>
          <option value="all">All activity</option><option value="proofs">Proofs</option><option value="stock">Stock &amp; damage</option><option value="coins">NGA Coins</option><option value="requests">Requests &amp; withdrawals</option><option value="campaigns">Campaigns</option>
        </select></label>
      </div>
      <ActivityRows items={visibleActivity} />
    </section>}

    {tab === 'requests' && <section className="dt-panel dt-queues">
      <div className="dt-panel-heading"><div><h3>Requests & proof review</h3><p>Review partner submissions and outstanding requests. Proof photos use expiring private signed URLs.</p></div></div>
      {!queues ? <p className="dt-loading"><LoaderCircle size={16} className="dt-spin" /> Loading review queues…</p> : <>
        <div className="dt-queue-section"><h4>Proof submissions <span>{queues.proofs.length}</span></h4>
          {queues.proofs.length ? queues.proofs.map((proof) => <article className="dt-proof-card" key={proof.id}>
            <img src={proof.photoUrl} alt={`Private proof submitted by ${proof.partnerName}`} loading="lazy" />
            <div className="dt-proof-copy"><strong>{proof.partnerName} · {proof.campaignName}</strong><span>{proof.siteName} · {formatDate(proof.submittedAt)}</span>
              <p>{proof.note || 'No partner note supplied.'}</p>
              {proof.latitude !== null && proof.longitude !== null && <span className="dt-location"><MapPin size={14} /> {proof.latitude.toFixed(5)}, {proof.longitude.toFixed(5)}</span>}
              <span className="dt-muted">Reward on approval: {formatNumber(proof.coins)} NGA Coins</span>
              <label className="dt-field"><span>Review note</span><textarea rows={2} maxLength={500} value={proofNotes[proof.id] || ''} onChange={(event) => setProofNotes((current) => ({ ...current, [proof.id]: event.target.value }))} placeholder="Required for rejection or correction" /></label>
              {canEdit && <div className="dt-actions">
                <button type="button" className="dt-button dt-button--primary" disabled={actionBusy} onClick={() => void reviewProof(proof.id, 'approved')}><BadgeCheck size={15} /> Approve</button>
                <button type="button" className="dt-button dt-button--quiet" disabled={actionBusy} onClick={() => void reviewProof(proof.id, 'needs_correction')}>Needs correction</button>
                <button type="button" className="dt-button dt-button--danger" disabled={actionBusy} onClick={() => void reviewProof(proof.id, 'rejected')}>Reject</button>
              </div>}
            </div>
          </article>) : <p className="dt-empty">No proofs are awaiting review.</p>}
        </div>
        <div className="dt-queue-section"><h4>Campaign requests <span>{queues.campaignRequests.length}</span></h4>
          {queues.campaignRequests.length ? queues.campaignRequests.map((item) => <article className="dt-request-row" key={item.id}>
            <div><strong>{item.partnerName} · {item.campaignName}</strong><p>{item.requestType.replaceAll('_', ' ')} — {item.details}</p><time>{formatDate(item.createdAt)}</time>
              <label className="dt-field"><span>Review reason</span><input required minLength={3} maxLength={500} value={requestNotes[item.id] || ''} onChange={(event) => setRequestNotes((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
            </div>
            {canEdit && <div className="dt-actions"><button type="button" className="dt-button dt-button--primary" disabled={actionBusy} onClick={() => {
              if (item.requestType !== 'additional_stock') {
                void reviewRequest('campaign', item.id, 'approved');
                return;
              }
              const stockInput = window.prompt('Enter the exact number of physical WildCards to issue for this approved request.');
              if (stockInput === null) return;
              const quantity = Number(stockInput);
              if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
                if (!Number.isNaN(quantity)) setError('Enter a whole-card quantity between 1 and 1,000,000.');
                return;
              }
              void reviewRequest('campaign', item.id, 'approved', { stockQuantity: quantity });
            }} title={item.requestType === 'additional_stock' ? 'Approve and issue the exact stock quantity.' : 'Approve this campaign request.'}>{item.requestType === 'additional_stock' ? 'Approve & issue' : 'Approve'}</button><button type="button" className="dt-button dt-button--danger" disabled={actionBusy} onClick={() => void reviewRequest('campaign', item.id, 'rejected')}>Reject</button></div>}
          </article>) : <p className="dt-empty">No campaign requests are awaiting review.</p>}
        </div>
        <div className="dt-queue-section"><h4>Damage reports <span>{queues.damageReports.length}</span></h4>
          {queues.damageReports.length ? queues.damageReports.map((item) => <article className="dt-request-row" key={item.id}>
            <div><strong>{item.partnerName} · {item.campaignName}</strong><p>{item.issueType} {item.cardId ? `· Card ${item.cardId}` : ''} — {item.details || 'No additional details'}</p><time>{formatDate(item.createdAt)}</time>
              <label className="dt-field"><span>Resolution/rejection reason</span><input required minLength={3} maxLength={500} value={requestNotes[item.id] || ''} onChange={(event) => setRequestNotes((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
            </div>
            {canEdit && <div className="dt-actions"><button type="button" className="dt-button dt-button--primary" disabled={actionBusy} onClick={() => void reviewRequest('damage', item.id, 'resolved')}>Resolve &amp; record</button><button type="button" className="dt-button dt-button--danger" disabled={actionBusy} onClick={() => void reviewRequest('damage', item.id, 'rejected')}>Reject</button></div>}
          </article>) : <p className="dt-empty">No damage reports are awaiting review.</p>}
        </div>
        <div className="dt-queue-section"><h4>Withdrawal requests <span>{queues.withdrawals.length}</span></h4>
          {queues.withdrawals.length ? queues.withdrawals.map((item) => <article className="dt-request-row" key={item.id}>
            <div><strong>{item.partnerName} · {formatNumber(item.amount)} NGA Coins</strong><p>Requested {formatDate(item.createdAt)}. Settling records an externally completed payout; no payment is initiated here.</p>
              <label className="dt-field"><span>Review reason</span><input required minLength={3} maxLength={500} value={requestNotes[item.id] || ''} onChange={(event) => setRequestNotes((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
              <label className="dt-field"><span>External payout reference (required to settle)</span><input value={withdrawalReference[item.id] || ''} onChange={(event) => setWithdrawalReference((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={120} /></label>
              <label className="dt-checkbox"><input type="checkbox" checked={confirmedSettlements[item.id] || false} onChange={(event) => setConfirmedSettlements((current) => ({ ...current, [item.id]: event.target.checked }))} /><span>I independently confirmed this payout was completed.</span></label>
            </div>
            {canEdit && <div className="dt-actions"><button type="button" className="dt-button dt-button--primary" disabled={actionBusy || !confirmedSettlements[item.id] || !(withdrawalReference[item.id] || '').trim()} onClick={() => void reviewRequest('withdrawal', item.id, 'settled')}>Record paid</button><button type="button" className="dt-button dt-button--danger" disabled={actionBusy} onClick={() => void reviewRequest('withdrawal', item.id, 'rejected')}>Reject</button></div>}
          </article>) : <p className="dt-empty">No withdrawal requests are awaiting review.</p>}
        </div>
      </>}
    </section>}

    {tab === 'campaigns' && <div className="dt-campaign-layout">
      <section className="dt-panel">
        <div className="dt-panel-heading"><div><h3>Campaigns & physical stock</h3><p>Existing campaign assignments and status; no partner is assigned automatically.</p></div></div>
        <div className="dt-campaign-list">{campaigns.map((campaign) => <article className="dt-campaign-card" key={campaign.id}>
          <div className="dt-campaign-card-top"><span className="dt-campaign-icon"><BriefcaseBusiness size={17} /></span><span className={`dt-status dt-status--${campaign.status}`}>{campaign.status}</span></div>
          <h4>{campaign.name}</h4><p>{campaign.area}</p>
          <dl><div><dt>Daily target</dt><dd>{formatNumber(campaign.daily_target)}</dd></div><div><dt>Reward per proof</dt><dd>{formatNumber(campaign.coins_per_proof)} NGA</dd></div><div><dt>Assigned partners</dt><dd>{formatNumber(campaign.assigned_partners)}</dd></div><div><dt>Campaign period</dt><dd>{campaign.start_date} – {campaign.end_date}</dd></div></dl>
          {canEdit && campaign.status !== 'completed' && <button type="button" className="dt-button dt-button--quiet" disabled={actionBusy} onClick={() => void runAction(`/api/admin/delivery-team/campaigns/${encodeURIComponent(campaign.id)}/status`, { status: campaign.status === 'active' ? 'paused' : 'active' }, `Campaign ${campaign.status === 'active' ? 'paused' : 'resumed'}.`)}>{campaign.status === 'active' ? 'Pause campaign' : 'Resume campaign'}</button>}
          {canEdit && campaign.status !== 'completed' && <button type="button" className="dt-button dt-button--quiet" disabled={actionBusy} onClick={() => void runAction(`/api/admin/delivery-team/campaigns/${encodeURIComponent(campaign.id)}/status`, { status: 'completed' }, 'Campaign marked complete.')}>Complete</button>}
        </article>)}
        {!campaigns.length && <p className="dt-empty">No WildCard campaigns have been created.</p>}</div>
      </section>
      {canCreate && <section className="dt-panel">
        <div className="dt-panel-heading"><div><h3>Create & assign campaign</h3><p>Creates one campaign and explicitly assigns one existing partner.</p></div></div>
        {!campaignPartners.length && !campaignPartnerSearch ? <p className="dt-empty">No active delivery partners are available to assign.</p> : <form className="dt-form" onSubmit={(event) => void createCampaign(event)}>
          <label className="dt-field"><span>Find active delivery partner</span><input value={campaignPartnerSearch} onChange={(event) => setCampaignPartnerSearch(event.target.value)} placeholder="Search name, email or partner ID" /></label>
          <label className="dt-field"><span>Delivery partner</span><select required value={campaignForm.partnerProfileId} onChange={(event) => setCampaignForm((current) => ({ ...current, partnerProfileId: event.target.value }))}><option value="">Select a partner</option>{campaignPartners.map((partner) => <option key={partner.id} value={partner.id}>{partner.full_name} · {partner.email}</option>)}</select></label>
          <label className="dt-field"><span>Campaign name</span><input required minLength={2} maxLength={120} value={campaignForm.name} onChange={(event) => setCampaignForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className="dt-field"><span>Description</span><textarea rows={2} maxLength={1000} value={campaignForm.description} onChange={(event) => setCampaignForm((current) => ({ ...current, description: event.target.value }))} /></label>
          <label className="dt-field"><span>Assigned area</span><input required minLength={2} maxLength={160} value={campaignForm.area} onChange={(event) => setCampaignForm((current) => ({ ...current, area: event.target.value }))} /></label>
          <div className="dt-two-fields"><label className="dt-field"><span>Start date</span><input type="date" required value={campaignForm.startDate} onChange={(event) => setCampaignForm((current) => ({ ...current, startDate: event.target.value }))} /></label><label className="dt-field"><span>End date</span><input type="date" required value={campaignForm.endDate} onChange={(event) => setCampaignForm((current) => ({ ...current, endDate: event.target.value }))} /></label></div>
          <div className="dt-two-fields"><label className="dt-field"><span>Daily delivery target</span><input type="number" min="1" max="1000" required value={campaignForm.dailyTarget} onChange={(event) => setCampaignForm((current) => ({ ...current, dailyTarget: event.target.value }))} /></label><label className="dt-field"><span>NGA Coins per approved proof</span><input type="number" min="1" max="1000000" required value={campaignForm.coinsPerProof} onChange={(event) => setCampaignForm((current) => ({ ...current, coinsPerProof: event.target.value }))} /></label></div>
          <label className="dt-field"><span>Initial physical stock</span><input type="number" min="0" max="1000000" required value={campaignForm.initialStock} onChange={(event) => setCampaignForm((current) => ({ ...current, initialStock: event.target.value }))} /></label>
          <div className="dt-field"><span>Shop locations</span>{campaignForm.sites.map((site, index) => <div className="dt-site-fields" key={index}><input required minLength={2} maxLength={120} aria-label={`Shop ${index + 1} name`} placeholder="Shop name" value={site.name} onChange={(event) => setCampaignForm((current) => ({ ...current, sites: current.sites.map((entry, entryIndex) => entryIndex === index ? { ...entry, name: event.target.value } : entry) }))} /><input required minLength={2} maxLength={240} aria-label={`Shop ${index + 1} address`} placeholder="Shop address" value={site.address} onChange={(event) => setCampaignForm((current) => ({ ...current, sites: current.sites.map((entry, entryIndex) => entryIndex === index ? { ...entry, address: event.target.value } : entry) }))} />{campaignForm.sites.length > 1 && <button type="button" className="dt-icon-button" aria-label={`Remove shop ${index + 1}`} onClick={() => setCampaignForm((current) => ({ ...current, sites: current.sites.filter((_, entryIndex) => entryIndex !== index) }))}><X size={15} /></button>}</div>)}
            <button type="button" className="dt-link-button" disabled={campaignForm.sites.length >= 100} onClick={() => setCampaignForm((current) => ({ ...current, sites: [...current.sites, { name: '', address: '' }] }))}>Add shop location</button>
          </div>
          <button type="submit" className="dt-button dt-button--primary" disabled={actionBusy}><BriefcaseBusiness size={16} /> Create campaign &amp; assign</button>
        </form>}
      </section>}
    </div>}

    {tab === 'settings' && <section className="dt-panel dt-settings-panel">
      <div className="dt-panel-heading"><div><h3>Delivery Team settings</h3><p>Operational thresholds; this does not change stock, rewards or withdrawal rules.</p></div></div>
      <form className="dt-form dt-settings-form" onSubmit={(event) => void saveThreshold(event)}>
        <label className="dt-field"><span>Low-stock alert threshold (physical WildCards)</span><input type="number" min="1" max="100000" required value={lowStockThreshold} onChange={(event) => setLowStockThreshold(event.target.value)} /><small>Partners at or below this available quantity are shown as Low Stock. Zero stock is shown as Out of Stock.</small></label>
        {canEdit && <button type="submit" className="dt-button dt-button--primary" disabled={actionBusy}><Settings2 size={16} /> Save threshold</button>}
      </form>
      <div className="dt-security-note"><ShieldCheck size={18} /><p>Coin and stock changes are permission-checked on the server, written through atomic database functions and preserved in their respective ledgers. The 100,000 NGA Coins withdrawal threshold is unchanged.</p></div>
    </section>}

    {selectedPartner && <Modal title={`Quick Actions · ${selectedPartner.partner.full_name}`} onClose={() => setSelectedPartner(null)}>
      <div className="dt-partner-modal-body">
        <div className="dt-partner-summary">
          <p>{selectedPartner.partner.email} · {selectedPartner.partner.mobile_number}</p>
          <span className={`dt-status dt-status--${selectedPartner.partner.status}`}>{selectedPartner.partner.status}</span>
          <small>Partner ID {selectedPartner.partner.id}</small>
        </div>
        <div className="dt-balance-cards">
          <div><span>Available NGA Coins</span><strong>{formatNumber(selectedPartner.coinSummary.balance)}</strong><small>Earned {formatNumber(selectedPartner.coinSummary.totalEarned)} · Withdrawn {formatNumber(selectedPartner.coinSummary.totalWithdrawn)}</small></div>
          <div><span>Available WildCards</span><strong>{formatNumber(selectedPartner.stockSummary.available)}</strong><small>Issued {formatNumber(selectedPartner.stockSummary.issued)} · Distributed {formatNumber(selectedPartner.stockSummary.distributed)}</small></div>
        </div>
        {canEdit && <form className="dt-adjust-form" onSubmit={(event) => void adjustCoins(event)}>
          <h3><Coins size={17} /> Adjust NGA Coins</h3>
          <p>Positive values add coins; negative values deduct. Current and resulting balances are confirmed before saving.</p>
          <div className="dt-two-fields"><label className="dt-field"><span>Adjustment (+ / −)</span><input type="number" required step="1" value={coinAmount} onChange={(event) => setCoinAmount(event.target.value)} placeholder="e.g. 500 or -250" /></label>
            <label className="dt-field"><span>Reason (required)</span><input required minLength={3} maxLength={500} value={coinReason} onChange={(event) => setCoinReason(event.target.value)} /></label></div>
          {coinAmount && Number.isSafeInteger(Number(coinAmount)) && <p className="dt-resulting-balance">Resulting balance: {formatNumber(selectedPartner.coinSummary.balance + Number(coinAmount))}</p>}
          <div className="dt-actions"><button className="dt-button dt-button--primary" type="submit" disabled={actionBusy}><ArrowUp size={15} /> Record adjustment</button><button className="dt-button dt-button--danger" type="button" disabled={actionBusy || selectedPartner.coinSummary.balance <= 0} onClick={() => void resetCoins()}><ArrowDown size={15} /> Reset available to zero</button></div>
        </form>}
        {canEdit && <form className="dt-adjust-form" onSubmit={(event) => void manageStock(event)}>
          <h3><Boxes size={17} /> Manage physical WildCard stock</h3>
          <div className="dt-two-fields"><label className="dt-field"><span>Campaign assignment</span><select required value={stockAssignmentId} onChange={(event) => setStockAssignmentId(event.target.value)}><option value="">Select campaign</option>{selectedPartner.assignments.map((assignment) => <option key={assignment.id} value={assignment.id}>{assignment.campaign_name} · {assignment.campaign_status}</option>)}</select></label>
            <label className="dt-field"><span>Movement</span><select value={stockMovement} onChange={(event) => setStockMovement(event.target.value as typeof stockMovement)}><option value="issued">Issue additional stock</option><option value="returned">Record stock returned</option><option value="adjusted">Record positive adjustment</option></select></label></div>
          <div className="dt-two-fields"><label className="dt-field"><span>{stockMovement === 'adjusted' ? 'Balance adjustment (+ / − cards)' : 'Quantity (cards)'}</span><input type="number" required min={stockMovement === 'adjusted' ? '-1000000' : '1'} max="1000000" step="1" value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} /></label><label className="dt-field"><span>Reason (required)</span><input required minLength={3} maxLength={500} value={stockReason} onChange={(event) => setStockReason(event.target.value)} /></label></div>
          <p className="dt-muted">Returns reduce partner-held stock. Adjustments can increase or decrease stock; the server rejects any operation that would create a negative balance.</p>
          <button className="dt-button dt-button--primary" type="submit" disabled={actionBusy || !stockAssignmentId}><Boxes size={15} /> Record stock movement</button>
        </form>}
        <section className="dt-history-section"><h3>Complete coin transaction history</h3>
          {selectedPartner.coinHistory.length ? <div className="dt-history-list">{selectedPartner.coinHistory.map((entry) => <article key={entry.id}><div><strong>{entry.entry_type.replace('_', ' ')}</strong><span>{entry.notes || entry.reference || entry.status} · {formatDate(entry.created_at)}</span>{entry.administrator_id && <small>Admin {entry.administrator_id} · balance {formatNumber(entry.admin_previous_balance || 0)} → {formatNumber(entry.admin_resulting_balance || 0)}</small>}</div><b className={entry.amount < 0 ? 'is-negative' : ''}>{entry.amount > 0 ? '+' : ''}{formatNumber(entry.amount)}</b></article>)}</div> : <p className="dt-empty">No coin transactions recorded.</p>}
        </section>
        <section className="dt-history-section"><h3>Complete stock transaction history</h3>
          {selectedPartner.stockHistory.length ? <div className="dt-history-list">{selectedPartner.stockHistory.map((entry) => <article key={entry.id}><div><strong>{entry.movement_type.replace('_', ' ')} · {entry.campaign_name || 'Campaign'}</strong><span>{entry.notes} · {formatDate(entry.created_at)}</span>{entry.previous_balance !== null && entry.previous_balance !== undefined && <small>Stock {entry.previous_balance} → {entry.resulting_balance}</small>}</div><b className={entry.quantity < 0 ? 'is-negative' : ''}>{entry.quantity > 0 ? '+' : ''}{formatNumber(entry.quantity)}</b></article>)}</div> : <p className="dt-empty">No stock transactions recorded.</p>}
        </section>
      </div>
    </Modal>}
  </div>;
}
