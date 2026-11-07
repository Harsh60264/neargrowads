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

const panel = 'smc-panel';
const input = 'smc-control';
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
    { label: 'Active Visitors', detail: 'Public site · last 5 min', value: websiteActivity?.activeVisitors, icon: UsersRound, tone: 'green', waiting: websiteActivityLoading, unavailable: Boolean(websiteActivityError && !websiteActivity) },
    { label: 'Security Events', detail: 'Last 30 days', value: counters?.totalEvents, icon: Activity, tone: 'blue', waiting: loading, unavailable: Boolean(error && !data) },
    { label: 'Failed Logins', detail: 'Last 30 days', value: counters?.failedLogins, icon: LockKeyhole, tone: 'amber', waiting: loading, unavailable: Boolean(error && !data) },
    {
      label: 'Unauthorized API',
      detail: 'Last 30 days',
      value: counters?.unauthorizedRequests,
      icon: ShieldAlert,
      tone: 'orange',
      waiting: loading,
      unavailable: Boolean(error && !data),
      onClick: () => {
        setEventSearch('api.unauthorized');
        setSearchInput('api.unauthorized');
        setEventSeverity('all');
        setEventPage(1);
        window.setTimeout(() => document.getElementById('security-event-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
      },
    },
    { label: 'Suspicious Indicators', detail: 'Open for review', value: counters?.suspiciousAlerts, icon: AlertTriangle, tone: 'rose', waiting: loading, unavailable: Boolean(error && !data) },
    { label: 'Active Admin Sessions', detail: 'Currently active', value: counters?.activeSessions, icon: UsersRound, tone: 'green', waiting: loading, unavailable: Boolean(error && !data) },
  ];
  const devices = [
    { label: 'Mobile', icon: Smartphone, count: websiteActivity?.devices.mobile },
    { label: 'Desktop', icon: Monitor, count: websiteActivity?.devices.desktop },
    { label: 'Tablet', icon: Tablet, count: websiteActivity?.devices.tablet },
  ];
  const pages = websiteActivity?.pages.slice(0, 5) ?? [];
  const highestPageCount = Math.max(0, ...pages.map((page) => page.count));
  const timeline = data?.timelineDaily ?? [];
  const timelineMaximum = Math.max(0, ...timeline.map((day) => day.count));
  const timelineScaleMaximum = Math.max(1, timelineMaximum);
  const timelineHasEvents = timeline.some((day) => day.count > 0);

  return (
    <section className="admin-security-monitoring smc-dashboard" aria-label="Security Monitoring Center">
      <header className="smc-hero">
        <div className="smc-hero-copy">
          <span className="smc-hero-mark" aria-hidden="true"><ShieldCheck /></span>
          <div>
            <p className="smc-eyebrow">NearGrow Ads · Admin</p>
            <h2>Security Monitoring Center</h2>
            <p>Live indicators from administrator authentication, authorization, access audit logs, and sessions. Suspicious patterns are for review, not confirmation of an attack.</p>
          </div>
        </div>
        <button type="button" onClick={() => { void load(); void refreshWebsiteActivity(); }} disabled={loading || websiteActivityRefreshing} className="smc-button smc-button--hero">
          <RefreshCw className={loading || websiteActivityRefreshing ? 'animate-spin' : ''} /> Refresh
        </button>
        <ShieldCheck className="smc-hero-watermark" aria-hidden="true" />
      </header>
      {error && <div role="alert" className="smc-inline-error smc-data-error">
        <span>{error}</span>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-rose-300/30 px-2.5 font-semibold hover:bg-rose-900/30 disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Retry
        </button>
      </div>}
      {notice && <p role="status" className="smc-notice">{notice}</p>}

      <div className="smc-metric-grid" aria-live="polite">
        {statCards.map(({ label, detail, value, icon: Icon, tone, waiting, unavailable, onClick }) => {
          const metric = waiting && value === undefined ? '…' : unavailable ? 'Unavailable' : value ?? '—';
          const content = <>
            <span className={`smc-metric-icon smc-tone-${tone}`}><Icon aria-hidden="true" /></span>
            <span className="smc-metric-copy">
              <span className="smc-metric-label">{label}</span>
              <span className="smc-metric-value">{metric}</span>
              <span className="smc-muted smc-metric-detail">{detail}</span>
            </span>
          </>;
          return onClick ? (
            <button key={label} type="button" onClick={onClick} aria-label={`${label}: ${metric}. Show matching events.`} className="smc-metric-card smc-metric-card--action">
              {content}
            </button>
          ) : (
            <article key={label} className="smc-metric-card">{content}</article>
          );
        })}
      </div>

      <div className="smc-overview-grid">
        <section className={`${panel} smc-timeline-panel`}>
          <div className="smc-section-heading">
            <div><h3 className="smc-title">Security Event Timeline</h3><p className="smc-muted">Observed security events · last 7 days</p></div>
            <span className="smc-section-icon"><Activity aria-hidden="true" /></span>
          </div>
          <div className="smc-timeline-chart" role="img" aria-label={`Daily security event counts for the last seven days: ${timeline.map((day) => `${day.date}, ${day.count}`).join('; ') || 'unavailable'}`}>
            <div className="smc-timeline-scale" aria-hidden="true">
              <span>{timelineMaximum}</span>
              <span>{Math.ceil(timelineMaximum / 2)}</span>
              <span>0</span>
            </div>
            {timeline.map((day) => {
              const height = day.count ? (day.count / timelineScaleMaximum) * 100 : 0;
              return <div key={day.date} className="smc-timeline-day">
                <span className="smc-timeline-count">{day.count}</span>
                <span title={`${day.date}: ${day.count} events`} className={`smc-timeline-bar${day.count ? ' is-active' : ''}`} style={{ height: `${height}%` }} />
                <span className="smc-timeline-date">{day.date.slice(5)}</span>
              </div>;
            })}
            {!data && !loading && error && <p className="smc-empty-state">Timeline unavailable. Retry after resolving the data-loading error.</p>}
            {!data && loading && <p className="smc-empty-state">Loading timeline…</p>}
            {data && !timelineHasEvents && <p className="smc-empty-state">No security events recorded in the chart window.</p>}
          </div>
        </section>

        <section className="smc-activity-grid" aria-label="Live website activity" aria-live="polite">
          <article className={panel}>
            <div className="smc-section-heading">
              <div><h3 className="smc-title">Most-Viewed Active Pages</h3><p className="smc-muted">Public pages with activity in the last 5 minutes</p></div>
              <span className="smc-section-icon"><Activity aria-hidden="true" /></span>
            </div>
            {pages.length ? (
              <ol className="smc-page-list">
                {pages.map((page, index) => (
                  <li key={page.path} className="smc-page-row">
                    <span className="smc-page-rank">{index + 1}</span>
                    <span className="smc-page-details">
                      <span className="smc-page-path" title={page.path}>{page.path}</span>
                      <span className="smc-page-track"><span style={{ width: `${highestPageCount ? (page.count / highestPageCount) * 100 : 0}%` }} /></span>
                    </span>
                    <span className="smc-page-count">{page.count}</span>
                  </li>
                ))}
              </ol>
            ) : websiteActivity ? (
              <p className="smc-empty-state">No public visitors are active in this window.</p>
            ) : (
              <p className="smc-empty-state">{websiteActivityLoading ? 'Loading active pages…' : 'Active pages unavailable.'}</p>
            )}
          </article>

          <article className={panel}>
            <div className="smc-section-heading">
              <div><h3 className="smc-title">Active Visitor Devices</h3><p className="smc-muted">Estimated devices in the last 5 minutes</p></div>
              <button type="button" onClick={() => void refreshWebsiteActivity()} disabled={websiteActivityRefreshing} className="smc-button smc-button--subtle" aria-label="Refresh visitor activity">
                <RefreshCw className={websiteActivityRefreshing ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
            {websiteActivityError && (
              <div role="alert" className="smc-inline-error">
                <span>{websiteActivity ? `Stale data — refresh failed: ${websiteActivityError}` : websiteActivityError}</span>
                <button type="button" onClick={() => void refreshWebsiteActivity()} disabled={websiteActivityRefreshing}>Retry</button>
              </div>
            )}
            <div className="smc-device-grid">
              {devices.map(({ label, icon: Icon, count }) => (
                <div key={label} className="smc-device-card">
                  <span className="smc-device-icon"><Icon aria-hidden="true" /></span>
                  <span className="smc-device-name">{label}</span>
                  <span className="smc-device-count">{count ?? (websiteActivityLoading ? '…' : '—')}</span>
                </div>
              ))}
            </div>
            <p className="smc-muted smc-activity-footnote">
              {websiteActivity
                ? `Distinct anonymous browsers, not identified people. Last update: ${dateTime(websiteActivity.generatedAt)}${websiteActivity.lastActivityAt ? ` · Latest activity: ${dateTime(websiteActivity.lastActivityAt)}` : ''}.`
                : websiteActivityLoading ? 'Loading live activity…' : 'Last successful update unavailable.'}
              {' '}Admin-panel activity is excluded.
            </p>
          </article>
        </section>
      </div>

      {isPrimaryOwner && (
        <section className={`${panel} smc-rules-panel`}>
          <div className="smc-section-heading">
            <div><h3 className="smc-title">Detection Rules</h3><p className="smc-muted">Owner-controlled thresholds · indicators are for review, not confirmed-attack verdicts</p></div>
            <button type="button" disabled={!data || savingRules} onClick={() => setRulesDraft(DEFAULT_SECURITY_RULES)} className="smc-button smc-button--subtle">Restore Defaults</button>
          </div>
          {data ? <>
            <div className="smc-rules-grid">
              {([
                ['windowMinutes', 'Detection window (minutes)', 1, 1440],
                ['failedLogins', 'Failed logins per account', 2, 100],
                ['unauthorizedRequests', 'Unauthorized requests per source', 3, 500],
                ['restrictedDenials', 'Restricted-module denials', 2, 100],
                ['bulkLeadExportRecords', 'Large export threshold (records)', 10, 100000],
              ] as const).map(([key, label, min, max]) => (
                <label key={key} className="smc-field">{label}
                  <input type="number" min={min} max={max} disabled={savingRules} value={rulesDraft[key]} onChange={(event) => setRulesDraft((current) => ({ ...current, [key]: Number(event.target.value) }))} className={`${input} w-full disabled:opacity-50`} />
                </label>
              ))}
              <label className="smc-checkbox-field">
                <input type="checkbox" disabled={savingRules} checked={rulesDraft.alertNonOwnerPrivilegeChanges} onChange={(event) => setRulesDraft((current) => ({ ...current, alertNonOwnerPrivilegeChanges: event.target.checked }))} />
                Alert on delegated privileged account changes
              </label>
            </div>
            <button type="button" onClick={() => void saveRules()} disabled={savingRules} className="smc-button smc-button--primary smc-save-button">
              {savingRules ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Save detection rules
            </button>
          </> : <p className="smc-empty-state">{loading ? 'Loading saved detection rules…' : 'Saved detection rules are unavailable. Default values have not been applied.'}</p>}
        </section>
      )}

      <section className={`${panel} smc-alerts-panel`}>
        <div className="smc-section-heading">
          <div><h3 className="smc-title">Suspicious Activity Indicators</h3><p className="smc-muted">Repeated failures, denied access, bulk exports, and delegated privileged changes</p></div>
          <label className="smc-filter-field">Alert status
            <select value={alertStatus} onChange={(event) => { setAlertPage(1); setAlertStatus(event.target.value as AlertStatus | 'all'); }} className={input}>
              <option value="all">All history</option><option value="new">New</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option>
            </select>
          </label>
        </div>
        <div className="smc-alert-list">
          {(data?.alerts || []).map((alert) => (
            <article key={alert.id} className="smc-alert-card">
              <div className="smc-alert-copy">
                <div className="smc-alert-heading"><h4 className="smc-title">{alert.title}</h4><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${severityStyle[alert.severity]}`}>{alert.severity}</span><span className="smc-status-pill">{alert.status}</span></div>
                <p className="smc-alert-summary">{alert.summary}</p>
                <p className="smc-muted smc-alert-meta">First seen {dateTime(alert.first_seen_at)} · Last seen {dateTime(alert.last_seen_at)} · {alert.event_ids.length} linked event(s)</p>
              </div>
              {canManageAlerts && alert.status !== 'resolved' && <div className="smc-alert-actions">
                {alert.status === 'new' && <button type="button" disabled={busyAlert === alert.id} onClick={() => void updateAlert(alert, 'investigating')} className="smc-button smc-button--subtle">Acknowledge</button>}
                <button type="button" disabled={busyAlert === alert.id} onClick={() => void updateAlert(alert, 'resolved')} className="smc-button smc-button--resolve">Resolve</button>
              </div>}
            </article>
          ))}
          {data && !data.alerts.length && <p className="smc-empty-state"><CheckCircle2 aria-hidden="true" />No alert indicators match this filter.</p>}
          {!data && !loading && error && <p className="smc-empty-state">Suspicious activity indicators are unavailable. Retry after resolving the data-loading error.</p>}
        </div>
        <div className="smc-pagination">
          <span>{data ? `${data.alertTotal} alert history records` : loading ? 'Loading alert history…' : 'Alert history unavailable'}</span>
          <div>
            <button type="button" disabled={alertPage <= 1} onClick={() => setAlertPage((page) => page - 1)} className="smc-button smc-button--subtle">Previous</button>
            <button type="button" disabled={!data || alertPage * 50 >= data.alertTotal} onClick={() => setAlertPage((page) => page + 1)} className="smc-button smc-button--subtle">Next</button>
          </div>
        </div>
      </section>

      <section id="security-event-list" tabIndex={-1} className={`${panel} smc-events-panel`}>
        <div className="smc-section-heading smc-events-heading">
          <div><h3 className="smc-title">Security Events</h3><p className="smc-muted">Sanitized operational events · 180-day retention · listing defaults to the last 30 days</p></div>
          <form className="smc-event-filters" onSubmit={(event) => { event.preventDefault(); applySearch(); }}>
            <label className="sr-only" htmlFor="security-event-search">Search event types</label>
            <span className="smc-search-field"><Search aria-hidden="true" /><input id="security-event-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className={input} placeholder="Search event types" /></span>
            <label className="sr-only" htmlFor="security-event-severity">Filter event severity</label>
            <select id="security-event-severity" value={eventSeverity} onChange={(event) => { setEventPage(1); setEventSeverity(event.target.value as Severity | 'all'); }} className={input}>
              <option value="all">All severities</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
            </select>
            <button type="submit" className="smc-button smc-button--subtle">Filter</button>
          </form>
        </div>
        <div className="smc-table-wrap">
          <table className="smc-table">
            <thead><tr><th>Event</th><th>Severity</th><th>Module / result</th><th>Actor</th><th>Time</th></tr></thead>
            <tbody>
              {(data?.events || []).map((event) => <tr key={event.id}>
                <td className="smc-event-name">{event.eventType.replaceAll('.', ' ')}</td>
                <td><span className={`rounded-full px-2 py-1 text-[9px] font-semibold uppercase ${severityStyle[event.severity]}`}>{event.severity}</span></td>
                <td>{event.route || '—'}{event.statusCode ? ` · HTTP ${event.statusCode}` : ''}</td>
                <td className="smc-actor">{event.actorId ? `${event.actorId.slice(0, 8)}…` : 'Unauthenticated'}</td>
                <td className="smc-event-time"><Clock3 aria-hidden="true" />{dateTime(event.occurredAt)}</td>
              </tr>)}
              {data && !data.events.length && <tr><td colSpan={5} className="smc-table-empty">No security events recorded for this period and filter.</td></tr>}
              {!data && !loading && error && <tr><td colSpan={5} className="smc-table-empty">Security events are unavailable. Retry after resolving the data-loading error.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="smc-pagination">
          <span>{data ? `${data.eventTotal} events match` : loading ? 'Loading event count…' : 'Event count unavailable'}</span>
          <div>
            <button type="button" disabled={eventPage <= 1} onClick={() => setEventPage((page) => page - 1)} className="smc-button smc-button--subtle">Previous</button>
            <button type="button" disabled={!data || eventPage * data.pageSize >= data.eventTotal} onClick={() => setEventPage((page) => page + 1)} className="smc-button smc-button--subtle">Next</button>
          </div>
        </div>
      </section>

      <section className={`${panel} smc-access-panel`}>
        <div className="smc-section-heading"><div><h3 className="smc-title">Recent Administrator Access Changes</h3><p className="smc-muted">Recent changes to administrator access and permissions</p></div><span className="smc-section-icon"><UsersRound aria-hidden="true" /></span></div>
        {data?.recentAccessChanges.length ? <ul className="smc-access-list">
          {data.recentAccessChanges.map((change) => <li key={change.id}><span>{change.action.replaceAll('.', ' ')} <span className="smc-muted">· {change.actorIsPrimaryOwner === null ? 'Actor unavailable' : change.actorIsPrimaryOwner ? 'Primary Owner action' : 'Delegated admin action'}</span></span><time className="smc-muted">{dateTime(change.createdAt)}</time></li>)}
        </ul> : <p className="smc-empty-state">{loading ? 'Loading access history…' : error && !data ? 'Access history unavailable.' : 'No administrator access changes are recorded.'}</p>}
      </section>
      {loading && <p role="status" className="smc-loading"><LoaderCircle aria-hidden="true" />Loading security data…</p>}
      {!isPrimaryOwner && <p className="smc-muted smc-view-only">Detection rules are configured by the Primary Owner. Security events are view-only for this account.</p>}
    </section>
  );
}
