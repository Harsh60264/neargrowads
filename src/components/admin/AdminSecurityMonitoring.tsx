import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, LoaderCircle, LockKeyhole, Monitor, RefreshCw, Search, ShieldAlert, ShieldCheck, Smartphone, Tablet, UsersRound } from 'lucide-react';
import { DEFAULT_SECURITY_RULES, type SecurityRuleSettings } from '../../../server/securityMonitoring';

type Severity = 'low' | 'medium' | 'high' | 'critical';
type AlertStatus = 'new' | 'investigating' | 'resolved';

interface SecurityEvent {
  id: string;
  eventType: string;
  severity: Severity;
  actorId: string | null;
  route: string | null;
  statusCode: number | null;
  details: Record<string, unknown>;
  occurredAt: string;
}

interface SecurityAlert {
  id: string;
  rule_id: string;
  severity: Severity;
  status: AlertStatus;
  title: string;
  summary: string;
  event_ids: string[];
  first_seen_at: string;
  last_seen_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

interface MonitoringData {
  page: number;
  pageSize: number;
  eventTotal: number;
  eventSeverity: Severity | 'all';
  events: SecurityEvent[];
  counters: {
    totalEvents: number;
    failedLogins: number;
    unauthorizedRequests: number;
    suspiciousAlerts: number;
    activeSessions: number;
  };
  alerts: SecurityAlert[];
  alertPage: number;
  alertTotal: number;
  alertStatus: AlertStatus | 'all';
  rules: SecurityRuleSettings;
  rulesUpdatedAt: string;
  recentAccessChanges: Array<{
    id: string;
    actorId: string | null;
    targetId: string | null;
    action: string;
    createdAt: string;
    actorIsPrimaryOwner: boolean | null;
  }>;
  timelineDaily: Array<{ date: string; count: number }>;
}

interface WebsiteActivityData {
  activeVisitors: number;
  pages: Array<{ path: string; count: number }>;
  devices: { mobile: number; desktop: number; tablet: number };
  lastActivityAt: string | null;
  generatedAt: string;
}

const panel = 'rounded-2xl border border-[#304135] bg-[#19241D] p-4 shadow-sm sm:p-5';
const input = 'min-h-10 rounded-xl border border-[#33453A] bg-[#101913] px-3 text-xs text-[#EAF1EB] outline-none focus:border-[#67D8B7]';
const severityStyle: Record<Severity, string> = {
  low: 'bg-sky-500/15 text-sky-300',
  medium: 'bg-amber-500/15 text-amber-300',
  high: 'bg-orange-500/15 text-orange-300',
  critical: 'bg-rose-500/15 text-rose-300',
};

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) {
    const message = response.status === 401
      ? 'Your admin session has expired. Sign in again to access Security Monitoring.'
      : response.status === 403
        ? 'Your account does not have permission to access this Security Monitoring action.'
        : data.message || `Security Monitoring request failed (${response.status}).`;
    throw new Error(message);
  }
  return data as T;
}

export function AdminSecurityMonitoring({
  isPrimaryOwner,
  canManageAlerts,
}: {
  isPrimaryOwner: boolean;
  canManageAlerts: boolean;
}) {
  const [data, setData] = useState<MonitoringData | null>(null);
  const [eventPage, setEventPage] = useState(1);
  const [alertPage, setAlertPage] = useState(1);
  const [alertStatus, setAlertStatus] = useState<AlertStatus | 'all'>('all');
  const [eventSeverity, setEventSeverity] = useState<Severity | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [eventSearch, setEventSearch] = useState('');
  const [rulesDraft, setRulesDraft] = useState<SecurityRuleSettings>(DEFAULT_SECURITY_RULES);
  const [loading, setLoading] = useState(true);
  const [savingRules, setSavingRules] = useState(false);
  const [busyAlert, setBusyAlert] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [websiteActivity, setWebsiteActivity] = useState<WebsiteActivityData | null>(null);
  const [websiteActivityLoading, setWebsiteActivityLoading] = useState(true);
  const [websiteActivityRefreshing, setWebsiteActivityRefreshing] = useState(false);
  const [websiteActivityError, setWebsiteActivityError] = useState('');
  const websiteActivityRequest = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({
        eventPage: String(eventPage),
        alertPage: String(alertPage),
        alertStatus,
        eventSearch,
        eventSeverity,
      });
      const result = await readResponse<MonitoringData>(await fetch(`/api/admin/security-monitoring?${query}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      }));
      setData(result);
      setRulesDraft(result.rules);
    } catch (reason) {
      setData(null);
      setError(reason instanceof Error ? reason.message : 'Security Monitoring could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [alertPage, alertStatus, eventPage, eventSearch, eventSeverity]);

  useEffect(() => { void load(); }, [load]);

  const refreshWebsiteActivity = useCallback(async () => {
    if (document.visibilityState !== 'visible' || websiteActivityRequest.current) return;
    websiteActivityRequest.current = true;
    setWebsiteActivityRefreshing(true);
    setWebsiteActivityError('');
    try {
      const result = await readResponse<WebsiteActivityData>(await fetch('/api/admin/security-monitoring/website-activity', {
        credentials: 'same-origin',
        cache: 'no-store',
      }));
      if (!Number.isSafeInteger(result.activeVisitors) || result.activeVisitors < 0 ||
        !Array.isArray(result.pages) || !result.devices ||
        !Number.isFinite(Date.parse(result.generatedAt))) {
        throw new Error('The live website activity response was incomplete.');
      }
      setWebsiteActivity(result);
    } catch (reason) {
      setWebsiteActivityError(reason instanceof Error ? reason.message : 'Live website activity could not be loaded.');
    } finally {
      websiteActivityRequest.current = false;
      setWebsiteActivityLoading(false);
      setWebsiteActivityRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshWebsiteActivity();
    const interval = window.setInterval(() => { void refreshWebsiteActivity(); }, 30_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refreshWebsiteActivity();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshWebsiteActivity]);

  const applySearch = () => {
    setEventPage(1);
    setEventSearch(searchInput.trim());
  };

  const saveRules = async () => {
    setSavingRules(true);
    setError('');
    setNotice('');
    try {
      const result = await readResponse<{ rules: SecurityRuleSettings }>(await fetch('/api/admin/security-monitoring/rules', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rulesDraft),
      }));
      setRulesDraft(result.rules);
      setNotice('Detection thresholds saved.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Detection thresholds could not be saved.');
    } finally {
      setSavingRules(false);
    }
  };

  const updateAlert = async (alert: SecurityAlert, status: 'investigating' | 'resolved') => {
    setBusyAlert(alert.id);
    setError('');
    setNotice('');
    try {
      await readResponse(await fetch(`/api/admin/security-monitoring/alerts/${encodeURIComponent(alert.id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }));
      setNotice(status === 'investigating' ? 'Alert acknowledged and marked Investigating.' : 'Alert marked Resolved.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The alert could not be updated.');
    } finally {
      setBusyAlert('');
    }
  };

  const counters = data?.counters;
  const statCards = [
    { label: 'Security events · 30 days', value: counters?.totalEvents, icon: Activity, style: 'text-sky-300' },
    { label: 'Failed logins · 30 days', value: counters?.failedLogins, icon: LockKeyhole, style: 'text-amber-300' },
    {
      label: 'Unauthorized API · 30 days',
      value: counters?.unauthorizedRequests,
      icon: ShieldAlert,
      style: 'text-orange-300',
      onClick: () => {
        setEventSearch('api.unauthorized');
        setSearchInput('api.unauthorized');
        setEventSeverity('all');
        setEventPage(1);
        window.setTimeout(() => document.getElementById('security-event-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
      },
    },
    { label: 'Open suspicious indicators', value: counters?.suspiciousAlerts, icon: AlertTriangle, style: 'text-rose-300' },
    { label: 'Active admin sessions', value: counters?.activeSessions, icon: UsersRound, style: 'text-emerald-300' },
  ];

  return (
    <section className="admin-security-monitoring space-y-4" aria-label="Security Monitoring Center">
      <div className={`${panel} flex flex-wrap items-start justify-between gap-3`}>
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-[#ECF3EE]"><ShieldCheck className="h-5 w-5 text-[#83D296]" /> Security Monitoring Center</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[#A9B8AD]">
            Live indicators from administrator authentication, authorization, access audit logs, and sessions. Alerts indicate suspicious patterns for review; they are not confirmation of an attack.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#33453A] px-3 text-xs font-semibold text-[#C8D8CA] hover:bg-white/5 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-400/30 bg-rose-950/25 px-4 py-3 text-xs text-rose-200">
        <span>{error}</span>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-rose-300/30 px-2.5 font-semibold hover:bg-rose-900/30 disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Retry
        </button>
      </div>}
      {notice && <p role="status" className="rounded-xl border border-emerald-400/25 bg-emerald-950/20 px-4 py-3 text-xs text-emerald-200">{notice}</p>}

      <section className={panel} aria-label="Live website activity" aria-live="polite">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-[#ECF3EE]"><Activity className="h-4 w-4 text-[#83D296]" /> Live website activity</h3>
            <p className="mt-1 text-[10px] leading-4 text-[#A9B8AD]">Estimated distinct browsers active within the last 5 minutes.</p>
          </div>
          <button type="button" onClick={() => void refreshWebsiteActivity()} disabled={websiteActivityRefreshing} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-[#33453A] px-3 text-[10px] font-semibold text-[#C8D8CA] hover:bg-white/5 disabled:opacity-50">
            <RefreshCw className={`h-3 w-3 ${websiteActivityRefreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
        {websiteActivityError && (
          <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-400/30 bg-rose-950/25 px-3 py-2 text-[10px] text-rose-200">
            <span>{websiteActivity ? `Stale data — refresh failed: ${websiteActivityError}` : websiteActivityError}</span>
            <button type="button" onClick={() => void refreshWebsiteActivity()} disabled={websiteActivityRefreshing} className="font-semibold underline disabled:opacity-50">Retry</button>
          </div>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-xl border border-[#304135] bg-[#121B15] p-3">
            <p className="flex items-center gap-2 text-[10px] font-semibold text-emerald-300"><UsersRound className="h-4 w-4" /> Active website visitors · 5 min</p>
            <p className="mt-2 text-2xl font-bold text-[#ECF3EE]">{websiteActivity ? websiteActivity.activeVisitors : websiteActivityLoading ? '…' : 'Unavailable'}</p>
            <p className="mt-1 text-[9px] text-[#91A195]">Distinct anonymous browsers, not identified people.</p>
          </article>
          <article className="rounded-xl border border-[#304135] bg-[#121B15] p-3 sm:col-span-1 xl:col-span-2">
            <p className="flex items-center gap-2 text-[10px] font-semibold text-sky-300"><Activity className="h-4 w-4" /> Most-viewed active pages · 5 min</p>
            {websiteActivity?.pages.length ? (
              <ol className="mt-2 space-y-1.5">
                {websiteActivity.pages.slice(0, 5).map((page) => (
                  <li key={page.path} className="flex items-center justify-between gap-3 text-[10px] text-[#C8D8CA]">
                    <span className="min-w-0 truncate" title={page.path}>{page.path}</span><span className="shrink-0 font-semibold">{page.count}</span>
                  </li>
                ))}
              </ol>
            ) : websiteActivity ? (
              <p className="mt-2 text-[10px] text-[#91A195]">No public visitors are active in this window.</p>
            ) : (
              <p className="mt-2 text-[10px] text-[#91A195]">{websiteActivityLoading ? 'Loading active pages…' : 'Active pages unavailable.'}</p>
            )}
          </article>
          <article className="rounded-xl border border-[#304135] bg-[#121B15] p-3">
            <p className="text-[10px] font-semibold text-violet-300">Active visitor devices · 5 min</p>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {([
                ['Mobile', Smartphone, websiteActivity?.devices.mobile],
                ['Desktop', Monitor, websiteActivity?.devices.desktop],
                ['Tablet', Tablet, websiteActivity?.devices.tablet],
              ] as const).map(([label, Icon, count]) => (
                <div key={label} className="text-center text-[9px] text-[#A9B8AD]">
                  <Icon className="mx-auto h-4 w-4 text-[#83D296]" />
                  <p className="mt-1 font-semibold text-[#ECF3EE]">{count ?? (websiteActivityLoading ? '…' : '—')}</p>
                  <p>{label}</p>
                </div>
              ))}
            </div>
          </article>
        </div>
        <p className="mt-3 text-[9px] text-[#91A195]">
          {websiteActivity
            ? `Last successful update: ${dateTime(websiteActivity.generatedAt)}${websiteActivity.lastActivityAt ? ` · Latest visitor activity: ${dateTime(websiteActivity.lastActivityAt)}` : ''}.`
            : websiteActivityLoading ? 'Loading live activity…' : 'Last successful update unavailable.'}
          {' '}Public page activity only; admin-panel activity is excluded.
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {statCards.map(({ label, value, icon: Icon, style, onClick }) => onClick ? (
          <button key={label} type="button" onClick={onClick} aria-label={`${label}: ${value ?? 'unavailable'}. Show matching events.`} className={`${panel} text-left transition-colors hover:border-orange-300/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-300`}>
            <p className={`flex items-center gap-2 text-[10px] font-semibold leading-4 ${style}`}><Icon className="h-4 w-4 shrink-0" />{label}</p>
            <p className="mt-2 text-2xl font-bold text-[#ECF3EE]">{loading && value === undefined ? '…' : error && !data ? 'Unavailable' : value ?? '—'}</p>
          </button>
        ) : (
          <article key={label} className={panel}>
            <p className={`flex items-center gap-2 text-[10px] font-semibold leading-4 ${style}`}><Icon className="h-4 w-4 shrink-0" />{label}</p>
            <p className="mt-2 text-2xl font-bold text-[#ECF3EE]">{loading && value === undefined ? '…' : error && !data ? 'Unavailable' : value ?? '—'}</p>
          </article>
        ))}
      </div>

      <section className={panel}>
        <div className="flex items-center justify-between gap-3">
          <div><h3 className="text-sm font-bold text-[#ECF3EE]">Security event timeline</h3><p className="mt-1 text-[10px] text-[#91A195]">Append-only events retained for 180 days; the chart shows observed events from the seven-day window.</p></div>
          <Activity className="h-4 w-4 text-[#83D296]" />
        </div>
        <div className="mt-4 flex h-28 items-end gap-2 border-b border-[#304135] px-1">
          {(data?.timelineDaily || []).map((day) => {
            const maximum = Math.max(1, ...(data?.timelineDaily || []).map((item) => item.count));
            const height = day.count ? Math.max(8, Math.round((day.count / maximum) * 100)) : 3;
            return <div key={day.date} className="flex h-full flex-1 flex-col justify-end text-center">
              <span className="mb-1 text-[9px] text-[#A9B8AD]">{day.count || ''}</span>
              <span title={`${day.date}: ${day.count} events`} className={`mx-auto w-full max-w-10 rounded-t-md ${day.count ? 'bg-[#43A663]' : 'bg-[#304135]'}`} style={{ height: `${height}%` }} />
              <span className="py-1 text-[9px] text-[#91A195]">{day.date.slice(5)}</span>
            </div>;
          })}
          {!data && !loading && error && <p className="w-full pb-4 text-center text-xs text-rose-200">Timeline unavailable. Retry after resolving the data-loading error.</p>}
          {data && data.timelineDaily.every((day) => day.count === 0) && <p className="w-full pb-4 text-center text-xs text-[#91A195]">No security events recorded in the chart window.</p>}
        </div>
      </section>

      {isPrimaryOwner && (
        <section className={panel}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="text-sm font-bold text-[#ECF3EE]">Detection rules</h3><p className="mt-1 text-[10px] text-[#91A195]">Owner-controlled thresholds. Rule matches create review indicators, not confirmed-attack verdicts.</p></div>
            <button type="button" disabled={!data || savingRules} onClick={() => setRulesDraft(DEFAULT_SECURITY_RULES)} className="text-[10px] font-semibold text-[#A9B8AD] underline disabled:opacity-40">Restore defaults</button>
          </div>
          {data ? <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {([
                ['windowMinutes', 'Detection window (minutes)', 1, 1440],
                ['failedLogins', 'Failed logins per account', 2, 100],
                ['unauthorizedRequests', 'Unauthorized requests per source', 3, 500],
                ['restrictedDenials', 'Restricted-module denials', 2, 100],
                ['bulkLeadExportRecords', 'Large export threshold (records)', 10, 100000],
              ] as const).map(([key, label, min, max]) => (
                <label key={key} className="space-y-1.5 text-[10px] font-semibold text-[#B8C7BC]">{label}
                  <input type="number" min={min} max={max} disabled={savingRules} value={rulesDraft[key]} onChange={(event) => setRulesDraft((current) => ({ ...current, [key]: Number(event.target.value) }))} className={`${input} w-full disabled:opacity-50`} />
                </label>
              ))}
              <label className="flex items-center gap-2 self-end pb-2 text-[10px] text-[#B8C7BC]">
                <input type="checkbox" disabled={savingRules} checked={rulesDraft.alertNonOwnerPrivilegeChanges} onChange={(event) => setRulesDraft((current) => ({ ...current, alertNonOwnerPrivilegeChanges: event.target.checked }))} />
                Alert on delegated privileged account changes
              </label>
            </div>
            <button type="button" onClick={() => void saveRules()} disabled={savingRules} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#286D3B] px-4 text-xs font-semibold text-white disabled:opacity-50">
              {savingRules ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Save detection rules
            </button>
          </> : <p className="mt-4 text-xs text-[#91A195]">{loading ? 'Loading saved detection rules…' : 'Saved detection rules are unavailable. Default values have not been applied.'}</p>}
        </section>
      )}

      <section className={panel}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h3 className="text-sm font-bold text-[#ECF3EE]">Suspicious activity indicators</h3><p className="mt-1 text-[10px] text-[#91A195]">Repeated failures, denied access, bulk exports, and delegated privileged changes.</p></div>
          <label className="text-[10px] font-semibold text-[#B8C7BC]">Alert status
            <select value={alertStatus} onChange={(event) => { setAlertPage(1); setAlertStatus(event.target.value as AlertStatus | 'all'); }} className={`${input} ml-2`}>
              <option value="all">All history</option><option value="new">New</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option>
            </select>
          </label>
        </div>
        <div className="mt-4 space-y-2">
          {(data?.alerts || []).map((alert) => (
            <article key={alert.id} className="rounded-xl border border-[#304135] bg-[#131D16] p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h4 className="text-xs font-bold text-[#ECF3EE]">{alert.title}</h4><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${severityStyle[alert.severity]}`}>{alert.severity}</span><span className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] text-[#B8C7BC]">{alert.status}</span></div>
                  <p className="mt-2 text-xs leading-5 text-[#B8C7BC]">{alert.summary}</p>
                  <p className="mt-1 text-[9px] text-[#91A195]">First seen {dateTime(alert.first_seen_at)} · Last seen {dateTime(alert.last_seen_at)} · {alert.event_ids.length} linked event(s)</p>
                </div>
                {canManageAlerts && alert.status !== 'resolved' && <div className="flex shrink-0 gap-2">
                  {alert.status === 'new' && <button type="button" disabled={busyAlert === alert.id} onClick={() => void updateAlert(alert, 'investigating')} className="rounded-lg border border-[#33453A] px-2.5 py-2 text-[10px] font-semibold text-[#C8D8CA] disabled:opacity-50">Acknowledge</button>}
                  <button type="button" disabled={busyAlert === alert.id} onClick={() => void updateAlert(alert, 'resolved')} className="rounded-lg border border-emerald-400/30 px-2.5 py-2 text-[10px] font-semibold text-emerald-200 disabled:opacity-50">Resolve</button>
                </div>}
              </div>
            </article>
          ))}
          {data && !data.alerts.length && <p className="rounded-xl border border-dashed border-[#304135] p-5 text-center text-xs text-[#91A195]"><CheckCircle2 className="mx-auto mb-2 h-5 w-5 text-emerald-300" />No alert indicators match this filter.</p>}
        </div>
        <div className="mt-3 flex items-center justify-between text-[10px] text-[#A9B8AD]">
          <span>{data ? `${data.alertTotal} alert history records` : loading ? 'Loading alert history…' : 'Alert history unavailable'}</span>
          <div className="flex gap-2">
            <button type="button" disabled={alertPage <= 1} onClick={() => setAlertPage((page) => page - 1)} className="rounded-lg border border-[#33453A] px-3 py-1.5 disabled:opacity-40">Previous</button>
            <button type="button" disabled={!data || alertPage * 50 >= data.alertTotal} onClick={() => setAlertPage((page) => page + 1)} className="rounded-lg border border-[#33453A] px-3 py-1.5 disabled:opacity-40">Next</button>
          </div>
        </div>
      </section>

      <section id="security-event-list" tabIndex={-1} className={`${panel} overflow-hidden scroll-mt-4`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h3 className="text-sm font-bold text-[#ECF3EE]">Security events</h3><p className="mt-1 text-[10px] text-[#91A195]">Sanitized operational events from the 180-day retention period; listing defaults to the last 30 days.</p></div>
          <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); applySearch(); }}>
            <label className="sr-only" htmlFor="security-event-search">Search event types</label>
            <span className="relative"><Search className="absolute left-3 top-3 h-3.5 w-3.5 text-[#91A195]" /><input id="security-event-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className={`${input} pl-8`} placeholder="Search event types" /></span>
            <label className="sr-only" htmlFor="security-event-severity">Filter event severity</label>
            <select id="security-event-severity" value={eventSeverity} onChange={(event) => { setEventPage(1); setEventSeverity(event.target.value as Severity | 'all'); }} className={input}>
              <option value="all">All severities</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
            </select>
            <button type="submit" className="rounded-xl border border-[#33453A] px-3 text-xs font-semibold text-[#C8D8CA]">Filter</button>
          </form>
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-[#304135]">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-[#131D16] text-[9px] uppercase tracking-wide text-[#A9B8AD]"><tr><th className="px-3 py-3">Event</th><th className="px-3 py-3">Severity</th><th className="px-3 py-3">Module / result</th><th className="px-3 py-3">Actor</th><th className="px-3 py-3">Time</th></tr></thead>
            <tbody className="divide-y divide-[#304135]">
              {(data?.events || []).map((event) => <tr key={event.id} className="text-[#D5DED7]">
                <td className="px-3 py-3 font-medium">{event.eventType.replaceAll('.', ' ')}</td>
                <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[9px] font-semibold uppercase ${severityStyle[event.severity]}`}>{event.severity}</span></td>
                <td className="px-3 py-3">{event.route || '—'}{event.statusCode ? ` · HTTP ${event.statusCode}` : ''}</td>
                <td className="px-3 py-3 font-mono text-[10px]">{event.actorId ? `${event.actorId.slice(0, 8)}…` : 'Unauthenticated'}</td>
                <td className="whitespace-nowrap px-3 py-3 text-[10px] text-[#A9B8AD]"><Clock3 className="mr-1 inline h-3 w-3" />{dateTime(event.occurredAt)}</td>
              </tr>)}
              {data && !data.events.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-xs text-[#91A195]">No security events recorded for this period and filter.</td></tr>}
              {!data && !loading && error && <tr><td colSpan={5} className="px-4 py-10 text-center text-xs text-rose-200">Security events are unavailable. Retry after resolving the data-loading error.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-[10px] text-[#A9B8AD]">
          <span>{data ? `${data.eventTotal} events match` : loading ? 'Loading event count…' : 'Event count unavailable'}</span>
          <div className="flex gap-2">
            <button type="button" disabled={eventPage <= 1} onClick={() => setEventPage((page) => page - 1)} className="rounded-lg border border-[#33453A] px-3 py-1.5 disabled:opacity-40">Previous</button>
            <button type="button" disabled={!data || eventPage * data.pageSize >= data.eventTotal} onClick={() => setEventPage((page) => page + 1)} className="rounded-lg border border-[#33453A] px-3 py-1.5 disabled:opacity-40">Next</button>
          </div>
        </div>
      </section>

      <section className={panel}>
        <div className="mb-3 flex items-center gap-2"><UsersRound className="h-4 w-4 text-[#83D296]" /><h3 className="text-sm font-bold text-[#ECF3EE]">Recent administrator access changes</h3></div>
        {data?.recentAccessChanges.length ? <ul className="divide-y divide-[#304135]">
          {data.recentAccessChanges.map((change) => <li key={change.id} className="flex flex-wrap justify-between gap-2 py-2 text-xs"><span className="text-[#D5DED7]">{change.action.replaceAll('.', ' ')} <span className="text-[#91A195]">· {change.actorIsPrimaryOwner === null ? 'Actor unavailable' : change.actorIsPrimaryOwner ? 'Primary Owner action' : 'Delegated admin action'}</span></span><span className="text-[10px] text-[#91A195]">{dateTime(change.createdAt)}</span></li>)}
        </ul> : <p className="text-xs text-[#91A195]">{loading ? 'Loading access history…' : error && !data ? 'Access history unavailable.' : 'No administrator access changes are recorded.'}</p>}
      </section>
      {loading && <p role="status" className="text-center text-[10px] text-[#91A195]"><LoaderCircle className="mr-1 inline h-3 w-3 animate-spin" />Loading security data…</p>}
      {!isPrimaryOwner && <p className="text-center text-[10px] text-[#91A195]">Detection rules are configured by the Primary Owner. Security events are view-only for this account.</p>}
    </section>
  );
}
