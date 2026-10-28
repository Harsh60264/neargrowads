import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NearGrowLogo } from '../brand/NearGrowLogo';
import { AdminBlogManager } from './AdminBlogManager';
import { AdminTeamManager } from './AdminTeamManager';
import { AdminContentManager } from './AdminContentManager';
import { AdminBlogCategories } from './AdminBlogCategories';
import { AdminServiceStore } from './AdminServiceStore';
import { AdminSettings } from './AdminSettings';
import { AdminCaseStudies } from './AdminCaseStudies';
import { AdminServicesManagement } from './AdminServicesManagement';
import { AdminMascotSettings } from './AdminMascotSettings';
import { AdminLeadExport } from './AdminLeadExport';
import { AdminSecurityMonitoring } from './AdminSecurityMonitoring';
import type { SiteContent } from '../../data/siteContent';
import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  Inbox,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  ShieldAlert,
  ShoppingBag,
  UsersRound,
  X,
  BookOpen,
  Headset,
  PanelLeftClose,
  PanelLeftOpen,
  Tag,
  Wrench,
  Moon,
  Sun,
} from 'lucide-react';

type LeadStatus = 'new' | 'reviewed' | 'contacted';

interface AdminLead {
  id: string;
  name: string;
  businessName: string;
  email: string;
  phone?: string;
  websiteUrl?: string;
  serviceInterest: string;
  budgetRange?: string;
  message: string;
  preferredContactMethod?: string;
  notificationStatus?: 'pending' | 'not_configured' | 'delivered' | 'failed';
  sourcePage: string;
  createdAt: string;
  status: LeadStatus;
}

interface AdminSession {
  configured: boolean;
  authenticated: boolean;
  configurationIssues?: string[];
  user?: {
    id: string;
    email: string;
    role: 'owner' | 'super_admin' | 'custom_admin';
    status: 'pending' | 'active' | 'disabled';
    permissions: Partial<Record<'dashboard' | 'leads' | 'serviceStore' | 'content' | 'mascot' | 'caseStudies' | 'servicesManagement' | 'blogs' | 'team' | 'categories' | 'securityMonitoring' | 'settings', Partial<Record<'view' | 'create' | 'edit' | 'delete' | 'publish' | 'export', boolean>>>>;
    isPrimaryOwner: boolean;
    username?: string;
    mustChangePassword?: boolean;
  };
}

type LeadStorage = 'memory' | 'supabase';

const LEADS_REFRESH_INTERVAL_MS = 30_000;
const SESSION_ACTIVITY_REPORT_INTERVAL_MS = 15_000;
const SESSION_ACTIVITY_STORAGE_KEY = 'neargrow-admin-activity-report';
const SESSION_EVENT_STORAGE_KEY = 'neargrow-admin-session-event';
const SESSION_CHANNEL_NAME = 'neargrow-admin-session';

type AdminSessionEvent = 'logout' | 'expired';

const statusLabels: Record<LeadStatus, string> = {
  new: 'New',
  reviewed: 'Reviewed',
  contacted: 'Contacted',
};

const formatDate = (date: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));

const formatDateTime = (date: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date));

async function responseMessage(response: Response): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { message?: string };
  return data.message || `Request failed (${response.status}).`;
}

async function adminSessionFromResponse(response: Response): Promise<AdminSession> {
  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  if (!contentType.includes('application/json')) {
    throw new Error('The admin API is not connected to this site. The frontend is deployed, but the Express API must also be hosted and configured to handle /api/* requests.');
  }
  if (!response.ok) throw new Error(await responseMessage(response));
  return await response.json() as AdminSession;
}

function requestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return 'Could not reach the admin API. Check that the Express server is running and that /api/* requests are routed to it, then try again.';
  }
  return error instanceof Error ? error.message : fallback;
}

function broadcastAdminSessionEvent(type: AdminSessionEvent): void {
  const event = { type, timestamp: Date.now() };
  try {
    const channel = new BroadcastChannel(SESSION_CHANNEL_NAME);
    channel.postMessage(event);
    channel.close();
  } catch {
    // The storage event below is the compatibility fallback.
  }
  try {
    localStorage.setItem(SESSION_EVENT_STORAGE_KEY, JSON.stringify(event));
  } catch {
    // Cross-tab notification is best-effort when browser storage is unavailable.
  }
}

export function AdminPage({ section, blogMode, isNewBlog = false, onNavigate, onSiteContentSaved, theme = 'dark', onToggleTheme = () => {} }: {
  section?: 'blog' | 'team' | 'content' | 'mascot' | 'caseStudies' | 'servicesManagement' | 'leads' | 'categories' | 'securityMonitoring' | 'settings' | 'serviceStore';
  blogMode?: 'list' | 'editor';
  isNewBlog?: boolean;
  onNavigate?: (path: string) => void;
  onSiteContentSaved?: (content: SiteContent) => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}) {
  const themeToggle = (
    <button
      type="button"
      onClick={onToggleTheme}
      className="admin-theme-toggle inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
  const [session, setSession] = useState<AdminSession | null>(null);
  const [initialSessionCheckFailed, setInitialSessionCheckFailed] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [leads, setLeads] = useState<AdminLead[]>([]);
  const [storage, setStorage] = useState<LeadStorage | null>(null);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | LeadStatus>('all');
  const [leadPage, setLeadPage] = useState(1);
  const [leadTotal, setLeadTotal] = useState(0);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [copiedContact, setCopiedContact] = useState('');
  const [selectedLead, setSelectedLead] = useState<AdminLead | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [firstPasswordValues, setFirstPasswordValues] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showFirstPassword, setShowFirstPassword] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sessionAuthenticated = useRef(false);
  const lastLeadsFetchedAt = useRef(0);
  const lastSessionValidatedAt = useRef(0);
  const lastActivityReportAt = useRef(0);
  const activityRequest = useRef<Promise<void> | null>(null);
  const leadsRequest = useRef<Promise<void> | null>(null);
  const navigate = onNavigate || ((path: string) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); });
  sessionAuthenticated.current = Boolean(session?.authenticated);

  const loadLeads = useCallback(async () => {
    if (leadsRequest.current) return leadsRequest.current;
    setLoadingLeads(true);
    setError('');
    const request = (async () => {
      try {
        const params = new URLSearchParams({
          page: String(leadPage),
          status: statusFilter,
          search,
        });
        const response = await fetch(`/api/admin/leads?${params}`, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(await responseMessage(response));
        const data = (await response.json()) as { leads: AdminLead[]; storage: LeadStorage; total: number };
        setLeads(data.leads);
        setStorage(data.storage);
        setLeadTotal(data.total);
        lastLeadsFetchedAt.current = Date.now();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load leads.');
      } finally {
        setLoadingLeads(false);
        leadsRequest.current = null;
      }
    })();
    leadsRequest.current = request;
    return request;
  }, [leadPage, search, statusFilter]);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/session', { credentials: 'same-origin' })
      .then(adminSessionFromResponse)
      .then((data) => {
        if (active) {
          lastSessionValidatedAt.current = Date.now();
          setInitialSessionCheckFailed(false);
          setError('');
          setSession(data);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(requestErrorMessage(err, 'Could not verify the admin session.'));
          setInitialSessionCheckFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleSessionEvent = (event: AdminSessionEvent) => {
      if (event === 'logout') {
        setLeads([]);
        lastLeadsFetchedAt.current = 0;
        setSession({ configured: true, authenticated: false });
        setSessionExpired(false);
      } else if (sessionAuthenticated.current) {
        setSessionExpired(true);
      }
    };
    const channel = typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(SESSION_CHANNEL_NAME);
    if (channel) {
      channel.onmessage = (message: MessageEvent<{ type?: string }>) => {
        if (message.data.type === 'logout' || message.data.type === 'expired') {
          handleSessionEvent(message.data.type);
        }
      };
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== SESSION_EVENT_STORAGE_KEY || !event.newValue) return;
      try {
        const message = JSON.parse(event.newValue) as { type?: string };
        if (message.type === 'logout' || message.type === 'expired') {
          handleSessionEvent(message.type);
        }
      } catch {
        setError('A session change from another tab could not be verified.');
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      channel?.close();
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const canViewLeads = Boolean(session?.user && (
    session.user.role === 'owner' ||
    session.user.permissions.leads?.view
  ));

  useEffect(() => {
    if (!session?.authenticated || !canViewLeads || (section && section !== 'leads')) return;
    if (Date.now() - lastLeadsFetchedAt.current >= LEADS_REFRESH_INTERVAL_MS) void loadLeads();
  }, [session?.authenticated, canViewLeads, section, loadLeads]);

  useEffect(() => {
    if (!session?.authenticated || !canViewLeads || (section && section !== 'leads')) return;
    lastLeadsFetchedAt.current = 0;
    void loadLeads();
  }, [search, statusFilter, leadPage]);

  useEffect(() => {
    if (!session?.authenticated || !canViewLeads || section !== 'leads') return;
    const timer = window.setInterval(() => { void loadLeads(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [session?.authenticated, canViewLeads, section, loadLeads]);

  useEffect(() => {
    if (!session?.authenticated) return;
    let active = true;
    let requestPending = false;
    const revalidateSession = async () => {
      if (requestPending) return;
      requestPending = true;
      try {
        const response = await fetch('/api/admin/session', { credentials: 'same-origin' });
        if (!response.ok) {
          const message = await responseMessage(response);
          if (response.status === 401) {
            setSessionExpired(true);
            broadcastAdminSessionEvent('expired');
          } else {
            setError(message);
          }
          return;
        }
        const latest = await adminSessionFromResponse(response);
        if (!active) return;
        lastSessionValidatedAt.current = Date.now();
        if (!latest.authenticated) {
          setSessionExpired(true);
          broadcastAdminSessionEvent('expired');
        } else {
          setSession(latest);
          setSessionExpired(false);
        }
      } catch (err) {
        if (active) setError(requestErrorMessage(err, 'Could not verify the admin session.'));
      } finally {
        requestPending = false;
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void revalidateSession();
    };
    const handlePageShow = () => void revalidateSession();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [session?.authenticated]);

  useEffect(() => {
    if (!session?.authenticated || sessionExpired) return;
    let active = true;
    const reportActivity = (event: Event) => {
      if (!event.isTrusted || activityRequest.current) return;
      const now = Date.now();
      let lastReportedAt = lastActivityReportAt.current;
      try {
        const sharedLastReport = Number(localStorage.getItem(SESSION_ACTIVITY_STORAGE_KEY));
        if (Number.isFinite(sharedLastReport)) lastReportedAt = Math.max(lastReportedAt, sharedLastReport);
      } catch {
        // Fall back to per-tab throttling when browser storage is unavailable.
      }
      if (now - lastReportedAt < SESSION_ACTIVITY_REPORT_INTERVAL_MS) return;
      lastActivityReportAt.current = now;
      try {
        localStorage.setItem(SESSION_ACTIVITY_STORAGE_KEY, String(now));
      } catch {
        // Session activity is still reported; storage is only used to coordinate tabs.
      }
      const request = (async () => {
        try {
          const response = await fetch('/api/admin/activity', {
            method: 'POST',
            credentials: 'same-origin',
            keepalive: true,
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          if (!response.ok) {
            const message = await responseMessage(response);
            if (active && response.status === 401) {
              setSessionExpired(true);
              broadcastAdminSessionEvent('expired');
            } else if (active) {
              setError(message);
            }
          }
        } catch (err) {
          if (active) setError(requestErrorMessage(err, 'Could not refresh the admin session.'));
        } finally {
          activityRequest.current = null;
        }
      })();
      activityRequest.current = request;
    };
    const eventNames: Array<keyof WindowEventMap> = [
      'pointerdown',
      'touchstart',
      'keydown',
      'input',
      'change',
      'wheel',
      'popstate',
    ];
    for (const eventName of eventNames) {
      window.addEventListener(eventName, reportActivity, { passive: true });
    }
    return () => {
      active = false;
      for (const eventName of eventNames) {
        window.removeEventListener(eventName, reportActivity);
      }
    };
  }, [session?.authenticated, sessionExpired]);

  const filteredLeads = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return leads.filter((lead) => {
      const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;
      const matchesSearch =
        !normalizedSearch ||
        [lead.name, lead.businessName, lead.email, lead.serviceInterest, lead.phone || '', lead.sourcePage]
          .some((value) => value.toLowerCase().includes(normalizedSearch));
      return matchesStatus && matchesSearch;
    });
  }, [leads, search, statusFilter]);

  const copyLeadContact = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedContact(key);
      window.setTimeout(() => setCopiedContact(''), 1800);
    } catch {
      setError('Could not copy contact information. Check browser clipboard permissions and try again.');
    }
  };

  const updateStatus = async (lead: AdminLead, status: LeadStatus) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/leads/${encodeURIComponent(lead.id)}/status`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setLeads((current) => current.map((item) => (item.id === lead.id ? { ...item, status } : item)));
      setSelectedLead((current) => (current?.id === lead.id ? { ...current, status } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this lead.');
    } finally {
      setBusy(false);
    }
  };

  const retryLeadNotification = async (lead: AdminLead) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/leads/${encodeURIComponent(lead.id)}/notification/retry`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const result = await response.json() as {
        saved?: boolean;
        notificationStatus?: AdminLead['notificationStatus'];
        message?: string;
      };
      if (result.saved && result.notificationStatus) {
        const updated = { ...lead, notificationStatus: result.notificationStatus };
        setLeads((current) => current.map((item) => item.id === lead.id ? updated : item));
        setSelectedLead((current) => current?.id === lead.id ? updated : current);
      }
      if (!response.ok) throw new Error(result.message || `Notification retry failed (${response.status}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The notification could not be retried.');
    } finally {
      setBusy(false);
    }
  };

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const returningToWorkspace = sessionExpired;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const data = await response.json() as { user: NonNullable<AdminSession['user']> };
      setPassword('');
      lastSessionValidatedAt.current = Date.now();
      setSession({ configured: true, authenticated: true, user: data.user });
      setSessionExpired(false);
      setInitialSessionCheckFailed(false);
      if (!returningToWorkspace) navigate('/admin');
    } catch (err) {
      setError(requestErrorMessage(err, 'Sign-in failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const changeTemporaryPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/auth/first-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(firstPasswordValues),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setFirstPasswordValues({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setSession((current) => current?.user
        ? { ...current, user: { ...current.user, mustChangePassword: false } }
        : current);
    } catch (reason) {
      try {
        const sessionResponse = await fetch('/api/admin/session', { credentials: 'same-origin' });
        if (sessionResponse.ok) {
          const latest = await sessionResponse.json() as AdminSession;
          if (latest.authenticated && latest.user && !latest.user.mustChangePassword) {
            setFirstPasswordValues({ currentPassword: '', newPassword: '', confirmPassword: '' });
            setSession(latest);
            return;
          }
        }
      } catch {
        // Preserve the original password-change error when session refresh also fails.
      }
      setError(requestErrorMessage(reason, 'The temporary password could not be changed.'));
    } finally {
      setBusy(false);
    }
  };

  const recoverPassword = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(identifier.trim())) {
      setError('Enter your verified email address to request a recovery link.');
      return;
    }
    setRecovering(true);
    setError('');
    try {
      const response = await fetch('/api/admin/auth/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: identifier }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setError('If this verified address has an administrator account, a secure recovery email has been sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password recovery could not be requested.');
    } finally {
      setRecovering(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setLeads([]);
      lastLeadsFetchedAt.current = 0;
      setSession({ configured: true, authenticated: false });
      setSessionExpired(false);
      broadcastAdminSessionEvent('logout');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out.');
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <main className="min-h-screen grid place-items-center bg-[#F2F5F1] px-4">
        {initialSessionCheckFailed ? (
          <section className="w-full max-w-md rounded-2xl border border-[#DDE5DD] bg-white p-6 shadow-lg">
            <h1 className="text-lg font-semibold text-[#26372A]">Could not verify your admin session</h1>
            <p role="alert" className="mt-2 text-sm leading-6 text-[#657168]">{error}</p>
            <button type="button" onClick={() => {
              setInitialSessionCheckFailed(false);
              setError('');
              fetch('/api/admin/session', { credentials: 'same-origin' })
                .then(async (response) => {
                  const data = await adminSessionFromResponse(response);
                  setError('');
                  setSession(data);
                })
                .catch((err: unknown) => {
                  setError(requestErrorMessage(err, 'Could not verify the admin session.'));
                  setInitialSessionCheckFailed(true);
                });
            }} className="mt-5 rounded-lg bg-[#286D3B] px-4 py-2.5 text-sm font-semibold text-white">
              Retry session check
            </button>
          </section>
        ) : (
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#D7E4D9] border-t-[#3EA259]" aria-label="Loading admin portal" />
        )}
      </main>
    );
  }

  if (!session.authenticated && !sessionExpired) {
    return (
      <main className="admin-portal admin-login relative isolate grid min-h-screen overflow-hidden px-4 py-6" data-admin-theme="dark">
        <div className="admin-login-glow admin-login-glow-top pointer-events-none absolute -right-32 -top-40 h-[34rem] w-[34rem] rounded-full opacity-45 blur-3xl" />
        <div className="admin-login-glow admin-login-glow-bottom pointer-events-none absolute -bottom-64 -left-28 h-[34rem] w-[34rem] rounded-full opacity-45 blur-3xl" />
        <div className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
          <a
            href="/"
            className="admin-login-back flex items-center gap-2 text-sm font-semibold transition"
          >
            <ArrowLeft className="h-4 w-4" /> Back to website
          </a>
          {themeToggle}
        </div>

        <div className="relative z-10 mx-auto grid w-full max-w-5xl items-center gap-8 py-8 sm:gap-12 sm:py-12 lg:min-h-[calc(100vh-7rem)] lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="hidden lg:block">
            <div className="admin-login-workspace mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold">
              <span className="h-2 w-2 rounded-full bg-[#3EA259]" /> NearGrow Ads workspace
            </div>
            <h1 className="max-w-xl text-5xl font-bold leading-[1.12] tracking-tight">
              Good work starts with a <span className="text-[#45A849]">clear view.</span>
            </h1>
            <p className="admin-login-intro mt-5 max-w-lg text-base leading-7">
              Sign in to manage enquiries, keep conversations moving, and stay close to every business we help grow.
            </p>
            <div className="mt-10 grid max-w-lg grid-cols-2 gap-3">
              <div className="admin-login-feature rounded-2xl border p-4 shadow-sm">
                <Inbox className="mb-5 h-5 w-5 text-[#3EA259]" />
                <p className="font-semibold">Enquiries, together</p>
                <p className="admin-login-feature-copy mt-1 text-xs leading-5">Every new conversation in one workspace.</p>
              </div>
              <div className="admin-login-feature rounded-2xl border p-4 shadow-sm">
                <ShieldCheck className="mb-5 h-5 w-5 text-[#3EA259]" />
                <p className="font-semibold">Private by design</p>
                <p className="admin-login-feature-copy mt-1 text-xs leading-5">Protected access for your team.</p>
              </div>
            </div>
          </section>

          <section className="admin-login-card mx-auto w-full max-w-md rounded-[28px] border p-6 shadow-[0_24px_80px_-36px_rgba(0,0,0,0.72)] sm:p-9">
            <div className="mb-8 flex items-center justify-between gap-3">
              <NearGrowLogo variant={theme === 'dark' ? 'dark' : 'light'} size="md" />
              <span className="admin-login-badge rounded-full px-3 py-1 text-[11px] font-semibold">CMS Management</span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
            <p className="admin-login-muted mt-2 text-sm">Sign in to continue to your workspace.</p>

            {!session.configured && (
              <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                <p>CMS authentication is not configured. Add the following settings to the server&rsquo;s root <code>.env</code> file, then restart Express:</p>
                {session.configurationIssues?.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {session.configurationIssues.map((issue) => <li key={issue}>{issue}</li>)}
                  </ul>
                ) : (
                  <p className="mt-2">Configure Supabase Auth, apply the admin migration, and set the verified Owner account UUID and server-only Supabase keys.</p>
                )}
              </div>
            )}
            {error && (
              <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm leading-5 text-rose-800">
                {error}
              </div>
            )}

            <form onSubmit={signIn} className="mt-7 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-[#ebf2ed]">Email or username</span>
                <span className="admin-login-field flex items-center gap-3 rounded-xl border px-3.5 focus-within:border-[#64AE75] focus-within:ring-4 focus-within:ring-[#3EA259]/10">
                  <Mail className="admin-login-field-icon h-4 w-4 shrink-0" />
                  <input
                    type="text"
                    autoComplete="username"
                    required
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder="Email address or username"
                    className="admin-login-input h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </span>
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-[#ebf2ed]">Password</span>
                <span className="admin-login-field flex items-center gap-3 rounded-xl border px-3.5 focus-within:border-[#64AE75] focus-within:ring-4 focus-within:ring-[#3EA259]/10">
                  <LockKeyhole className="admin-login-field-icon h-4 w-4 shrink-0" />
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    className="admin-login-input h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </span>
              </label>
              <button
                type="submit"
                disabled={busy || !session.configured}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#286D3B] text-sm font-semibold text-white shadow-sm transition hover:bg-[#205C31] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Signing in…' : 'Sign in securely'}
                {!busy && <ArrowUpRight className="h-4 w-4" />}
              </button>
            </form>
            <button type="button" onClick={() => void recoverPassword()} disabled={recovering || !identifier} className="mt-4 w-full text-center text-xs font-semibold text-[#9ADDBB] underline-offset-4 hover:underline disabled:opacity-50">
              {recovering ? 'Sending recovery email…' : 'Forgot password? Send a secure recovery email'}
            </button>
            <p className="admin-login-muted mt-6 text-center text-xs">
              <ShieldCheck className="mr-1 inline h-3.5 w-3.5 align-[-2px]" /> Your workspace is for authorised team members only.
            </p>
          </section>
        </div>
      </main>
    );
  }

  if (session.user?.mustChangePassword) {
    const strength = [
      firstPasswordValues.newPassword.length >= 12,
      /[a-z]/.test(firstPasswordValues.newPassword),
      /[A-Z]/.test(firstPasswordValues.newPassword),
      /\d/.test(firstPasswordValues.newPassword),
      /[^A-Za-z0-9]/.test(firstPasswordValues.newPassword),
    ].filter(Boolean).length;
    return (
      <main className="admin-portal grid min-h-screen place-items-center px-4 py-8" data-admin-theme="dark">
        <section className="w-full max-w-md rounded-3xl border border-[#304135] bg-[#19241D] p-6 text-[#ECF3EE] shadow-2xl sm:p-8">
          <NearGrowLogo variant={theme === 'dark' ? 'dark' : 'light'} size="md" />
          <h1 className="mt-8 text-xl font-bold">Complete password setup</h1>
          <p className="mt-2 text-sm leading-6 text-[#A9B8AD]">This delegated account must set a private password before accessing the CMS. Enter the temporary password provided by the Owner, or your current password if you are completing a reset.</p>
          {error && <div role="alert" className="mt-5 rounded-xl border border-rose-400/30 bg-rose-950/30 p-3 text-sm text-rose-200">{error}</div>}
          <form onSubmit={(event) => void changeTemporaryPassword(event)} className="mt-6 space-y-4">
            {([
              ['currentPassword', 'Current or temporary password', 'current-password'],
              ['newPassword', 'New password', 'new-password'],
              ['confirmPassword', 'Confirm new password', 'new-password'],
            ] as const).map(([key, label, autocomplete]) => (
              <label key={key} className="block text-xs font-medium text-[#B8C7BC]">{label}
                <span className="mt-1.5 flex items-center gap-2 rounded-xl border border-[#33453A] bg-[#101913] px-3 focus-within:border-[#67D8B7]">
                  <input className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" type={showFirstPassword ? 'text' : 'password'} autoComplete={autocomplete} required minLength={key === 'currentPassword' ? 1 : 12} maxLength={200} value={firstPasswordValues[key]} onChange={(event) => setFirstPasswordValues((current) => ({ ...current, [key]: event.target.value }))} />
                  {key === 'newPassword' && <button type="button" aria-label={showFirstPassword ? 'Hide passwords' : 'Show passwords'} onClick={() => setShowFirstPassword((shown) => !shown)} className="text-[#91A195]">{showFirstPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>}
                </span>
              </label>
            ))}
            <p className="text-[10px] text-[#91A195]">Strength: {strength}/5 — use 12+ characters and at least three character types.</p>
            {firstPasswordValues.newPassword !== firstPasswordValues.confirmPassword && <p role="alert" className="text-xs text-rose-200">New passwords do not match.</p>}
            <button type="submit" className="flex h-11 w-full items-center justify-center rounded-xl bg-[#286D3B] text-sm font-semibold text-white hover:bg-[#347E49] disabled:opacity-50" disabled={busy || strength < 4 || firstPasswordValues.newPassword !== firstPasswordValues.confirmPassword}>
              {busy ? 'Updating password…' : 'Change password and continue'}
            </button>
          </form>
          <button type="button" onClick={() => void signOut()} disabled={busy} className="mt-4 w-full text-center text-xs text-[#A9B8AD] underline">Sign out</button>
        </section>
      </main>
    );
  }

  const hasView = (key: keyof NonNullable<AdminSession['user']>['permissions']) => {
    const user = session.user;
    return Boolean(user && (user.role === 'owner' || user.permissions[key]?.view));
  };
  const hasAction = (key: keyof NonNullable<AdminSession['user']>['permissions'], action: 'view' | 'create' | 'edit' | 'delete' | 'publish' | 'export') => {
    const user = session.user;
    return Boolean(user && (user.role === 'owner' || user.permissions[key]?.[action]));
  };
  const canViewSecurityMonitoring = session.user?.isPrimaryOwner === true || session.user?.permissions.securityMonitoring?.view === true;
  const canEditSecurityMonitoring = session.user?.isPrimaryOwner === true || (
    session.user?.permissions.securityMonitoring?.view === true &&
    session.user.permissions.securityMonitoring.edit === true
  );
  const moduleContent = section === 'team'
    ? <AdminTeamManager onBack={() => navigate('/admin')} canCreate={hasAction('team', 'create')} canEdit={hasAction('team', 'edit')} canDelete={hasAction('team', 'delete')} />
    : section === 'serviceStore'
      ? <AdminServiceStore onBack={() => navigate('/admin')} canCreate={hasAction('serviceStore', 'create')} canEdit={hasAction('serviceStore', 'edit')} canDelete={hasAction('serviceStore', 'delete')} canPublish={hasAction('serviceStore', 'publish')} isPrimaryOwner={session.user?.isPrimaryOwner === true} />
    : section === 'blog'
      ? <AdminBlogManager mode={blogMode || 'list'} onBack={() => navigate('/admin')} onNavigate={navigate} canCreate={hasAction('blogs', 'create')} canEdit={hasAction('blogs', 'edit')} canDelete={hasAction('blogs', 'delete')} canPublish={hasAction('blogs', 'publish')} canViewCategories={hasView('categories')} />
      : section === 'content'
        ? <AdminContentManager onBack={() => navigate('/admin')} onSaved={onSiteContentSaved || (() => undefined)} embedded canEdit={hasAction('content', 'edit')} canPublish={hasAction('content', 'publish')} />
        : section === 'mascot'
          ? hasView('mascot')
            ? <AdminMascotSettings canEdit={hasAction('mascot', 'edit')} canPublish={hasAction('mascot', 'publish')} />
            : <div role="alert" className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-5 text-sm text-rose-200">You do not have permission to view Mascot settings.</div>
        : section === 'caseStudies'
          ? <AdminCaseStudies canCreate={hasAction('caseStudies', 'create')} canEdit={hasAction('caseStudies', 'edit')} canDelete={hasAction('caseStudies', 'delete')} canPublish={hasAction('caseStudies', 'publish')} theme={theme} />
          : section === 'servicesManagement'
            ? <AdminServicesManagement canCreate={hasAction('servicesManagement', 'create')} canEdit={hasAction('servicesManagement', 'edit')} canDelete={hasAction('servicesManagement', 'delete')} canPublish={hasAction('servicesManagement', 'publish')} />
          : section === 'categories'
          ? <AdminBlogCategories onNavigate={navigate} embedded canCreate={hasAction('categories', 'create')} canEdit={hasAction('categories', 'edit')} canDelete={hasAction('categories', 'delete')} canCreateBlog={hasAction('blogs', 'create')} />
          : section === 'securityMonitoring'
            ? <AdminSecurityMonitoring isPrimaryOwner={session.user?.isPrimaryOwner === true} canManageAlerts={canEditSecurityMonitoring} />
          : section === 'settings'
            ? <AdminSettings onNavigate={navigate} />
            : null;
  const activeSection = section === 'leads' ? 'leads'
    : section === 'serviceStore' ? 'serviceStore'
    : section === 'team' ? 'team'
      : section === 'blog' ? 'blogs'
        : section === 'content' ? 'content'
          : section === 'mascot' ? 'mascot'
          : section === 'caseStudies' ? 'caseStudies'
            : section === 'servicesManagement' ? 'servicesManagement'
            : section === 'categories' ? 'categories'
            : section === 'securityMonitoring' ? 'securityMonitoring'
            : section === 'settings' ? 'settings'
              : 'dashboard';
  const sectionAllowed = (activeSection === 'securityMonitoring' ? canViewSecurityMonitoring : hasView(activeSection)) &&
    !(section === 'blog' && blogMode === 'editor' && !(isNewBlog ? hasAction('blogs', 'create') : hasAction('blogs', 'edit')));

  const newCount = leads.filter((lead) => lead.status === 'new').length;
  const reviewedCount = leads.filter((lead) => lead.status === 'reviewed').length;
  const contactedCount = leads.filter((lead) => lead.status === 'contacted').length;

  return (
    <main className="admin-portal min-h-screen" data-admin-theme="dark" data-admin-ready="true">
      <div className="min-h-screen lg:flex" inert={sessionExpired}>
        <aside className={`admin-sidebar flex shrink-0 flex-col bg-[#14251A] px-5 py-4 text-white sm:px-6 lg:sticky lg:top-0 lg:h-screen lg:px-4 lg:py-5 transition-[width] duration-200 ${sidebarCollapsed ? 'lg:w-[84px]' : 'lg:w-[260px]'}`}>
          <a href="/" aria-label="NearGrow Ads home" className={`flex items-center gap-3 px-2 py-2 ${sidebarCollapsed ? 'lg:justify-center' : ''}`}>
            <NearGrowLogo variant={sidebarCollapsed ? 'icon-only' : theme === 'dark' ? 'dark' : 'light'} size="sm" />
            {!sidebarCollapsed && <span className="hidden text-[10px] font-medium tracking-[0.16em] text-[#9DB1A2] lg:block">WEBSITE CMS</span>}
          </a>

          <p className={`mt-8 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#91A899] ${sidebarCollapsed ? 'lg:sr-only' : ''}`}>CMS MANAGEMENT</p>
          <nav aria-label="Admin navigation" className="mt-3 flex gap-2 overflow-x-auto lg:flex-col">
            {hasView('dashboard') && <button type="button" onClick={() => navigate('/admin')} title="Dashboard" aria-current={activeSection === 'dashboard' ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${activeSection === 'dashboard' ? 'bg-white/10 text-white' : 'text-[#B7C8BA] hover:bg-white/5 hover:text-white'} ${sidebarCollapsed ? 'lg:justify-center' : ''}`}>
              <LayoutDashboard className="h-4 w-4 shrink-0 text-[#84D095]" /><span className={sidebarCollapsed ? 'lg:sr-only' : ''}>Dashboard</span>
            </button>}
            {hasView('leads') && <button type="button" onClick={() => navigate('/admin/leads')} title="Leads & Inquiries" aria-current={activeSection === 'leads' ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${activeSection === 'leads' ? 'bg-white/10 text-white' : 'text-[#B7C8BA] hover:bg-white/5 hover:text-white'} ${sidebarCollapsed ? 'lg:justify-center' : ''}`}>
              <Inbox className="h-4 w-4 shrink-0" /><span className={sidebarCollapsed ? 'lg:sr-only' : ''}>Leads &amp; Inquiries</span>
              {!sidebarCollapsed && <span className="ml-auto rounded-full bg-[#3EA259]/25 px-2 py-0.5 text-[10px] text-[#A7E1B3]">{leads.length}</span>}
            </button>}
            {hasView('serviceStore') && <button type="button" onClick={() => navigate('/admin/service-store')} title="Service Store" aria-current={activeSection === 'serviceStore' ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${activeSection === 'serviceStore' ? 'bg-white/10 text-white' : 'text-[#B7C8BA] hover:bg-white/5 hover:text-white'} ${sidebarCollapsed ? 'lg:justify-center' : ''}`}><ShoppingBag className="h-4 w-4 shrink-0" /><span className={sidebarCollapsed ? 'lg:sr-only' : ''}>Service Store</span></button>}
            {hasView('content') && <button type="button" onClick={() => navigate('/admin/content')} title="Page Content Manager" aria-current={activeSection === 'content' ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${activeSection === 'content' ? 'bg-white/10 text-white' : 'text-[#B7C8BA] hover:bg-white/5 hover:text-white'} ${sidebarCollapsed ? 'lg:justify-center' : ''}`}><Settings className="h-4 w-4 shrink-0" /><span className={sidebarCollapsed ? 'lg:sr-only' : ''}>Page Content Manager</span></button>}
            {hasView('mascot') && <button type="button" onClick={() => navigate('/admin/mascot')} title="Mascot" aria-current={activeSection === 'mascot' ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${activeSection === 'mascot' ? 'bg-white/10 text-white' : 'text-[#B7C8BA] hover:bg-white/5 hover:text-white'} ${sidebarCollapsed ? 'lg:justify-center' : ''}`}><Bot className="h-4 w-4 shrink-0" /><span className={sidebarCollapsed ? 'lg:sr-only' : ''}>Mascot</span></button>}
            {hasView('caseStudies') && <button type="button" onClick={() => navigate('/admin/case-studies')} title="Case Studies" aria-current={activeSection === 'caseStudies' ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${activeSection === 'caseStudies' ? 'bg-white/10 text-white' : 'text-[#B7C8BA] hover:bg-white/5 hover:text-white'} ${sidebarCollapsed ? 'lg:justify-center' : ''}`}><BriefcaseBusiness className="h-4 w-4 shrink-0" /><span className={sidebarCollapsed ? 'lg:sr-only' : ''}>Case Studies</span></button>}
            {hasView('servicesManagement') && <button type="button" onClick={() => navigate('/admin/services')} title="Services Management" aria-current={activeSection === 'servicesManagement' ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${activeSection === 'servicesManagement' ? 'bg-white/10 text-white' : 'text-[#B7C8BA] hover:bg-white/5 hover:text-white'} ${sidebarCollapsed ? 'lg:justify-center' : ''}`}><Wrench className="h-4 w-4 shrink-0" /><span className={sidebarCollapsed ? 'lg:sr-only' : ''}>Services Management</span></button>}
            {hasView('blogs') && <button type="button" onClick={() => navigate('/admin/blog')} title="Blog Management" aria-current={activeSection === 'blogs' ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${activeSection === 'blogs' ? 'bg-white/10 text-white' : 'text-[#B7C8BA] hover:bg-white/5 hover:text-white'} ${sidebarCollapsed ? 'lg:justify-center' : ''}`}><BookOpen className="h-4 w-4 shrink-0" /><span className={sidebarCollapsed ? 'lg:sr-only' : ''}>Blog Management</span></button>}
            {hasView('team') && <button type="button" onClick={() => navigate('/admin/team')} title="Team &amp; Mentors" aria-current={activeSection === 'team' ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${activeSection === 'team' ? 'bg-white/10 text-white' : 'text-[#B7C8BA] hover:bg-white/5 hover:text-white'} ${sidebarCollapsed ? 'lg:justify-center' : ''}`}><UsersRound className="h-4 w-4 shrink-0" /><span className={sidebarCollapsed ? 'lg:sr-only' : ''}>Team &amp; Mentors</span></button>}
            {hasView('categories') && <button type="button" onClick={() => navigate('/admin/categories')} title="Categories" aria-current={activeSection === 'categories' ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${activeSection === 'categories' ? 'bg-white/10 text-white' : 'text-[#B7C8BA] hover:bg-white/5 hover:text-white'} ${sidebarCollapsed ? 'lg:justify-center' : ''}`}><Tag className="h-4 w-4 shrink-0" /><span className={sidebarCollapsed ? 'lg:sr-only' : ''}>Categories</span></button>}
            {canViewSecurityMonitoring && <button type="button" onClick={() => navigate('/admin/security-monitoring')} title="Security Monitoring" aria-current={activeSection === 'securityMonitoring' ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${activeSection === 'securityMonitoring' ? 'bg-white/10 text-white' : 'text-[#B7C8BA] hover:bg-white/5 hover:text-white'} ${sidebarCollapsed ? 'lg:justify-center' : ''}`}><ShieldAlert className="h-4 w-4 shrink-0 text-[#84D095]" /><span className={sidebarCollapsed ? 'lg:sr-only' : ''}>Security Monitoring</span></button>}
            {hasView('settings') && <button type="button" onClick={() => navigate('/admin/settings')} title="Settings" aria-current={activeSection === 'settings' ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${activeSection === 'settings' ? 'bg-white/10 text-white' : 'text-[#B7C8BA] hover:bg-white/5 hover:text-white'} ${sidebarCollapsed ? 'lg:justify-center' : ''}`}><ShieldCheck className="h-4 w-4 shrink-0" /><span className={sidebarCollapsed ? 'lg:sr-only' : ''}>Settings</span></button>}
          </nav>

          {!sidebarCollapsed && <div className="admin-workspace-status mt-8 hidden rounded-2xl border-white/10 bg-white/[0.04] p-4 lg:block">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#D7E3D9]"><ShieldCheck className="h-4 w-4 text-[#7DCC8F]" /> Workspace status</div>
            <p className="mt-2 text-[11px] leading-5 text-[#9DB1A2]">{storage === 'supabase' ? 'Protected cloud storage is connected.' : 'Connected to this server session.'}</p>
          </div>}

          <div className="mt-6 border-t border-white/10 pt-5 lg:mt-auto lg:block">
            {!sidebarCollapsed && <a href="mailto:support@neargrowads.com" className="admin-support-panel mb-3 block rounded-xl bg-white/[0.05] p-3 text-xs text-[#B7C8BA]">
              <span className="flex items-center gap-2 font-semibold text-white"><Headset className="h-4 w-4" /> 24/7 Support</span>
              <span className="mt-1 block leading-5 text-[#9DB1A2]">Need technical assistance?</span>
              <span className="mt-2 block font-semibold text-[#84D095]">Contact Team</span>
            </a>}
            <button type="button" onClick={() => setSidebarCollapsed((collapsed) => !collapsed)} aria-label={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[#B7C8BA] transition hover:bg-white/5 hover:text-white">
              {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" /> Collapse Sidebar</>}
            </button>
            <a href="/" className="mt-1 flex items-center gap-2 px-3 py-2 text-xs text-[#B7C8BA] transition hover:text-white"><ArrowLeft className="h-4 w-4" />{!sidebarCollapsed && ' Back to website'}</a>
            <button type="button" onClick={() => void signOut()} disabled={busy} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[#B7C8BA] transition hover:bg-white/5 hover:text-white disabled:opacity-50"><LogOut className="h-4 w-4" />{!sidebarCollapsed && ' Sign out'}</button>
          </div>
        </aside>

        <section className={`min-w-0 flex-1 px-4 py-6 transition-[margin] duration-200 sm:px-7 lg:px-10 lg:py-9 xl:px-12 ${sidebarCollapsed ? 'lg:ml-0' : ''}`}>
          <header className="admin-workspace-header flex flex-wrap items-center justify-between gap-4 border-b border-[#E4E9E3] pb-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#78907D]">NearGrow Ads · CMS</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{section === 'leads' ? 'Leads & Inquiries' : section === 'serviceStore' ? 'Service Store' : section === 'team' ? 'Team & Mentors' : section === 'blog' ? 'Blog Management' : section === 'content' ? 'Page Content Manager' : section === 'mascot' ? 'NEO Mascot' : section === 'caseStudies' ? 'Case Studies' : section === 'servicesManagement' ? 'Services Management' : section === 'categories' ? 'Categories' : section === 'securityMonitoring' ? 'Security Monitoring' : section === 'settings' ? 'Settings' : 'Overview'}</h1>
              <p className="mt-1 text-sm text-[#778178]">{section === 'leads' ? 'Review consultation requests, contact submissions, and new business inquiries.' : section === 'serviceStore' ? 'Create and manage the service packages shown in the public Catalogue.' : section === 'mascot' ? 'Manage NEO’s appearance and size across your website.' : section ? 'Manage this section in your NearGrow Ads workspace.' : 'Manage your website and keep up with new enquiries.'}</p>
            </div>
            <div className="flex items-center gap-2">
              {themeToggle}
              {(!section || section === 'leads') && canViewLeads && <button type="button" onClick={() => void loadLeads()} disabled={loadingLeads} className="inline-flex h-10 items-center gap-2 rounded-xl border-[#DFE6DF] bg-white px-3 text-xs font-semibold text-[#546258] shadow-sm transition hover:border-[#B7CCBA] disabled:opacity-50">
                <RefreshCw className={`h-3.5 w-3.5 ${loadingLeads ? 'animate-spin' : ''}`} /> Refresh
              </button>}
              <button type="button" onClick={() => void signOut()} disabled={busy} className="hidden h-10 items-center gap-2 rounded-xl border-[#DFE6DF] bg-white px-3 text-xs font-semibold text-[#546258] shadow-sm lg:inline-flex"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
              <div title={session.user?.email} className="hidden h-10 w-10 place-items-center rounded-full bg-[#DDEFE0] text-sm font-bold text-[#286D3B] sm:grid">{session.user?.email.slice(0, 2).toUpperCase() || 'NG'}</div>
            </div>
          </header>

          {!sectionAllowed ? (
            <div role="alert" className="mt-8 rounded-2xl border border-rose-300/20 bg-rose-950/20 p-5 text-sm text-rose-200">Your administrator role does not include permission to view this section.</div>
          ) : moduleContent ? (
            <div className="mt-6 min-w-0">{moduleContent}</div>
          ) : <>
          {!section && <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <section aria-labelledby="cms-welcome-title" className="admin-dashboard-welcome relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#13271B] via-[#1F5933] to-[#328148] p-6 text-white shadow-lg sm:p-8">
              <div className="pointer-events-none absolute -right-12 -top-24 h-64 w-64 rounded-full border-white/10" />
              <div className="pointer-events-none absolute -right-4 -top-16 h-48 w-48 rounded-full border-white/10" />
              <div className="relative z-10 max-w-2xl">
                <span className="inline-flex items-center gap-2 rounded-full border-white/20 bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-white/80"><LayoutDashboard className="h-3.5 w-3.5" /> Admin Dashboard</span>
                <h1 id="cms-welcome-title" className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">Welcome to NearGrow CMS</h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-white/75">Manage your website content, leads, services and categories from one central dashboard.</p>
                <div className="mt-6 flex-wrap gap-3">
                  <button type="button" onClick={() => navigate('/admin/content')} className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-xs font-bold text-[#205C31] shadow-sm transition hover:bg-[#EEF5EF]"><FolderOpen className="h-4 w-4" /> Manage Website Content</button>
                  <button type="button" onClick={() => void loadLeads()} disabled={loadingLeads} className="inline-flex h-10 items-center gap-2 rounded-xl border-white/30 bg-white/10 px-4 text-xs font-semibold text-white transition hover:bg-white/15 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loadingLeads ? 'animate-spin' : ''}`} /> Refresh Data</button>
                </div>
              </div>
            </section>

            <aside className="admin-dashboard-status rounded-3xl border-[#E4E9E3] bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#EAF5EB] text-[#318148]"><ShieldCheck className="h-5 w-5" /></span>
                <div><p className="text-xs font-semibold uppercase tracking-wide text-[#849087]">System Status</p><p className="mt-0.5 text-sm font-bold">All Systems Operational</p></div>
              </div>
              <div className="mt-5 space-y-3 border-t border-[#EDF0EC] pt-4">
                <div className="flex items-center justify-between text-xs"><span className="text-[#778178]">Server status</span><span className="inline-flex items-center gap-1.5 font-semibold text-[#328148]"><span className="h-2 w-2 rounded-full bg-[#43A35D]" /> Online</span></div>
                <div className="flex items-center justify-between text-xs"><span className="text-[#778178]">Storage</span><span className="font-semibold text-[#39473C]">{storage === 'supabase' ? 'Connected' : 'Session memory'}</span></div>
                <div className="flex items-center justify-between text-xs"><span className="text-[#778178]">Security</span><span className="font-semibold text-[#39473C]">Protected</span></div>
              </div>
            </aside>
          </div>}
          {error && (
            <div role="alert" className="mt-6 flex items-start justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <span>{error}</span>
              {error.includes('session') && <button type="button" onClick={() => setSession({ configured: true, authenticated: false })} className="shrink-0 font-semibold underline">Sign in</button>}
            </div>
          )}

          {storage === 'memory' && (
            <div role="status" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
              <strong>Temporary lead storage:</strong> enquiries are currently held in server memory and will clear when the server restarts. Configure both Supabase variables on the server for persistent records.
            </div>
          )}

          <div className="mt-7 grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <MetricCard icon={UsersRound} label="Enquiries loaded" value={leads.length} note="Current page · up to 100 records" accent="green" />
            <MetricCard icon={Inbox} label="New enquiries" value={newCount} note="Ready for a first look" accent="blue" />
            <MetricCard icon={Clock3} label="In review" value={reviewedCount} note="Being followed up" accent="amber" />
            <MetricCard icon={Check} label="Contacted" value={contactedCount} note="Team has reached out" accent="purple" />
          </div>

          <section id="lead-inbox" className="admin-dashboard-lead-inbox mt-8 overflow-hidden rounded-2xl border border-[#E1E7E0] bg-white shadow-[0_8px_30px_-20px_rgba(28,59,35,0.22)]">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#EDF0EC] px-5 py-5 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#EAF5EB] text-[#328148]"><Inbox className="h-5 w-5" /></div>
                <div>
                  <h2 className="font-bold">{section === 'leads' ? 'Leads & Inquiries' : 'Lead inbox'}</h2>
                  <p className="mt-0.5 text-xs text-[#879188]">{leadTotal} {leadTotal === 1 ? 'enquiry' : 'enquiries'}{statusFilter !== 'all' ? ` · ${statusLabels[statusFilter]}` : ''}{section === 'leads' ? ' · refreshes every 30 seconds' : ''}</p>
                </div>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#E3E9E2] px-3 sm:w-56 sm:flex-none">
                  <Search className="h-4 w-4 shrink-0 text-[#929D93]" />
                  <input
                    value={search}
                    onChange={(event) => { setLeadPage(1); setSearch(event.target.value); }}
                    placeholder="Search enquiries"
                    className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[#A0AAA1]"
                    aria-label="Search leads"
                  />
                </label>
                <label className={`admin-lead-filter relative flex h-10 items-center gap-2 rounded-lg border border-[#E3E9E2] px-3 ${statusFilter !== 'all' ? 'admin-lead-filter-active' : ''}`}>
                  <span className="sr-only">Filter by status</span>
                  <select
                    value={statusFilter}
                    onChange={(event) => { setLeadPage(1); setStatusFilter(event.target.value as 'all' | LeadStatus); }}
                    className="appearance-none bg-transparent pr-5 text-xs font-medium text-[#59665B] outline-none"
                  >
                    <option value="all">All statuses</option>
                    <option value="new">New</option>
                    <option value="reviewed">Reviewed</option>
                    <option value="contacted">Contacted</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-[#929D93]" />
                </label>
                {hasAction('leads', 'export') && <AdminLeadExport
                  search={search}
                  statusFilter={statusFilter}
                  selectedIds={selectedLeadIds}
                />}
              </div>
            </div>

            {loadingLeads && leads.length === 0 ? (
              <div className="grid min-h-56 place-items-center text-sm text-[#819084]"><RefreshCw className="mr-2 inline h-4 w-4 animate-spin" /> Loading enquiries…</div>
            ) : filteredLeads.length === 0 ? (
              <div className="grid min-h-64 place-items-center px-6 py-12 text-center">
                <div>
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#F1F5F0] text-[#819084]"><Inbox className="h-5 w-5" /></div>
                  <p className="mt-4 font-semibold">{leads.length === 0 ? 'No enquiries yet' : 'No matching enquiries'}</p>
                  <p className="mt-1 text-sm text-[#879188]">{leads.length === 0 ? 'New website enquiries will appear here.' : 'Try another search or status filter.'}</p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead className="bg-[#FAFBF9] text-[10px] font-semibold uppercase tracking-[0.11em] text-[#859087]">
                    <tr>
                      {hasAction('leads', 'export') && <th className="w-10 px-3 py-3.5">
                        <input
                          type="checkbox"
                          aria-label="Select all leads on this page"
                          checked={filteredLeads.length > 0 && filteredLeads.every((lead) => selectedLeadIds.includes(lead.id))}
                          onChange={(event) => setSelectedLeadIds((current) => event.target.checked
                            ? [...new Set([...current, ...filteredLeads.map((lead) => lead.id)])]
                            : current.filter((id) => !filteredLeads.some((lead) => lead.id === id)))}
                        />
                      </th>}
                      <th className="px-6 py-3.5">Business / contact</th>
                      <th className="px-4 py-3.5">Interested in</th>
                      <th className="px-4 py-3.5">Received</th>
                      <th className="px-4 py-3.5">Status</th>
                      <th className="px-4 py-3.5"><span className="sr-only">Open lead</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0F2EF]">
                    {filteredLeads.map((lead) => (
                      <tr key={lead.id} className="group transition hover:bg-[#FCFDFC]">
                        {hasAction('leads', 'export') && <td className="px-3 py-4 align-top">
                          <input
                            type="checkbox"
                            aria-label={`Select ${lead.businessName || lead.name} lead`}
                            checked={selectedLeadIds.includes(lead.id)}
                            onChange={(event) => setSelectedLeadIds((current) => event.target.checked
                              ? [...new Set([...current, lead.id])]
                              : current.filter((id) => id !== lead.id))}
                          />
                        </td>}
                        <td className="max-w-[360px] px-6 py-4">
                          <button type="button" onClick={() => setSelectedLead(lead)} className="text-left">
                            <span className="block break-words text-sm font-semibold text-[#29372C] group-hover:text-[#286D3B]">{lead.businessName || lead.name}</span>
                            {lead.businessName && <span className="mt-0.5 block break-words text-[11px] text-[#89938A]">{lead.name}</span>}
                          </button>
                          <div className="mt-2 flex flex-col gap-1.5 text-xs">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <Mail className="h-3.5 w-3.5 shrink-0 text-[#829084]" />
                              {lead.email
                                ? <><a href={`mailto:${lead.email}`} className="min-w-0 break-all text-[#526A56] hover:text-[#286D3B] hover:underline">{lead.email}</a><button type="button" onClick={() => void copyLeadContact(lead.email, `${lead.id}-email`)} aria-label={`Copy email for ${lead.businessName || lead.name}`} title="Copy email" className="rounded p-1 text-[#829084] hover:bg-[#EEF6EF] hover:text-[#286D3B]"><Copy className="h-3 w-3" /></button>{copiedContact === `${lead.id}-email` && <span className="text-[10px] text-[#328148]">Copied</span>}</>
                                : <span className="text-[#A0AAA1]">—</span>}
                            </div>
                            <div className="flex min-w-0 items-center gap-1.5">
                              <Phone className="h-3.5 w-3.5 shrink-0 text-[#829084]" />
                              {lead.phone
                                ? <><a href={`tel:${lead.phone}`} className="min-w-0 break-all text-[#526A56] hover:text-[#286D3B] hover:underline">{lead.phone}</a><button type="button" onClick={() => void copyLeadContact(lead.phone || '', `${lead.id}-phone`)} aria-label={`Copy phone for ${lead.businessName || lead.name}`} title="Copy phone number" className="rounded p-1 text-[#829084] hover:bg-[#EEF6EF] hover:text-[#286D3B]"><Copy className="h-3 w-3" /></button>{copiedContact === `${lead.id}-phone` && <span className="text-[10px] text-[#328148]">Copied</span>}</>
                                : <span className="text-[#A0AAA1]">—</span>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-[#F1F5F0] px-2 py-1 text-[11px] font-medium text-[#5C6D5F]"><BriefcaseBusiness className="h-3 w-3" />{lead.serviceInterest}</span>
                        </td>
                        <td className="px-4 py-4 text-xs text-[#788379]">{formatDate(lead.createdAt)}</td>
                        <td className="px-4 py-4">
                          <label className="relative inline-flex">
                            <span className="sr-only">Change status for {lead.businessName}</span>
                            <select
                              value={lead.status}
                              disabled={busy || !hasAction('leads', 'edit')}
                              onChange={(event) => void updateStatus(lead, event.target.value as LeadStatus)}
                              className={`admin-lead-status admin-lead-status-${lead.status} appearance-none rounded-full border py-1.5 pl-2.5 pr-7 text-[10px] font-semibold outline-none disabled:opacity-60 ${
                                lead.status === 'new' ? 'border-[#CDE7D1] bg-[#EFF9F0] text-[#327646]' :
                                  lead.status === 'reviewed' ? 'border-[#F0DCA7] bg-[#FFF8E8] text-[#987222]' :
                                    'border-[#D6DDF4] bg-[#F2F4FD] text-[#5E6B9D]'
                              }`}
                            >
                              <option value="new">New</option>
                              <option value="reviewed">Reviewed</option>
                              <option value="contacted">Contacted</option>
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2" />
                          </label>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <button type="button" onClick={() => setSelectedLead(lead)} aria-label={`View ${lead.businessName} enquiry`} className="rounded-lg p-2 text-[#91A094] transition hover:bg-[#EEF6EF] hover:text-[#286D3B]"><ArrowUpRight className="h-4 w-4" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-[#EDF0EC] px-5 py-3 text-xs text-[#6D796F] sm:px-6">
              <span>
                {leadTotal === 0 ? 'No records' : `Page ${leadPage} of ${Math.max(1, Math.ceil(leadTotal / 100))}`}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setLeadPage((current) => Math.max(1, current - 1))}
                  disabled={leadPage <= 1 || loadingLeads}
                  className="rounded-lg border border-[#DCE4DC] px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setLeadPage((current) => current + 1)}
                  disabled={leadPage >= Math.max(1, Math.ceil(leadTotal / 100)) || loadingLeads}
                  className="rounded-lg border border-[#DCE4DC] px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </section>

          <footer className="flex flex-wrap items-center justify-between gap-2 py-5 text-[11px] text-[#89938A]">
            <span>NearGrow Ads · Lead workspace</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#54AE69]" /> Secure admin session</span>
          </footer>
          </>}
        </section>
      </div>

      {sessionExpired && (
        <div className="admin-overlay fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-[#101B13]/75 p-4 backdrop-blur-sm" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="session-expired-title" className="w-full max-w-md rounded-3xl border border-[#304135] bg-[#19241D] p-6 text-[#ECF3EE] shadow-2xl sm:p-8">
            <NearGrowLogo variant={theme === 'dark' ? 'dark' : 'light'} size="md" />
            <h2 id="session-expired-title" className="mt-7 text-xl font-bold">Sign in to resume</h2>
            <p className="mt-2 text-sm leading-6 text-[#A9B8AD]">
              Your admin session is no longer valid. This workspace is being kept open in this tab; sign in again to resume.
            </p>
            {error && <p role="alert" className="mt-4 rounded-xl border border-rose-400/30 bg-rose-950/30 p-3 text-sm text-rose-200">{error}</p>}
            <form onSubmit={signIn} className="mt-6 space-y-4">
              <label className="block text-xs font-medium text-[#B8C7BC]">
                Email or username
                <input
                  type="text"
                  autoComplete="username"
                  required
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-[#33453A] bg-[#101913] px-3 text-sm outline-none focus:border-[#67D8B7]"
                />
              </label>
              <label className="block text-xs font-medium text-[#B8C7BC]">
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-[#33453A] bg-[#101913] px-3 text-sm outline-none focus:border-[#67D8B7]"
                />
              </label>
              <button type="submit" disabled={busy} className="flex min-h-11 w-full items-center justify-center rounded-xl bg-[#286D3B] px-4 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? 'Signing in…' : 'Sign in and resume'}
              </button>
            </form>
            <button type="button" disabled={busy} onClick={() => void signOut()} className="mt-4 min-h-10 w-full text-sm font-semibold text-[#A9B8AD] underline underline-offset-4 disabled:opacity-50">
              Sign out instead
            </button>
          </section>
        </div>
      )}

      {selectedLead && (
        <div className="admin-overlay fixed inset-0 z-50 flex items-end justify-center bg-[#101B13]/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedLead(null);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="lead-detail-title" className="admin-lead-detail max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#819084]">Enquiry details</p>
                <h2 id="lead-detail-title" className="mt-1 text-2xl font-bold">{selectedLead.businessName || selectedLead.name}</h2>
                <p className="mt-1 text-sm text-[#758078]">From {selectedLead.name}</p>
              </div>
              <button type="button" onClick={() => setSelectedLead(null)} aria-label="Close enquiry details" className="rounded-lg p-2 text-[#7B877D] hover:bg-[#F1F5F0]"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Detail icon={Mail} label="Email" value={selectedLead.email || 'Not provided'} href={selectedLead.email ? `mailto:${selectedLead.email}` : undefined} />
              <Detail icon={MessageCircle} label="Phone" value={selectedLead.phone || 'Not provided'} href={selectedLead.phone ? `tel:${selectedLead.phone}` : undefined} />
              <Detail icon={BriefcaseBusiness} label="Service" value={selectedLead.serviceInterest} />
              <Detail icon={CalendarDays} label="Received" value={formatDateTime(selectedLead.createdAt)} />
            </div>
            {selectedLead.websiteUrl && <p className="mt-4 text-sm"><span className="font-semibold">Website: </span><a href={selectedLead.websiteUrl} target="_blank" rel="noreferrer" className="text-[#328148] underline">{selectedLead.websiteUrl}</a></p>}
            {selectedLead.budgetRange && <p className="mt-3 text-sm"><span className="font-semibold">Budget: </span>{selectedLead.budgetRange}</p>}
            <div className="mt-5 rounded-2xl bg-[#F5F7F4] p-4">
              <p className="text-xs font-semibold text-[#617064]">Message</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#465349]">{selectedLead.message}</p>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#DCE4DC] bg-[#FAFBF9] px-4 py-3">
              <p className="text-xs text-[#465349]" role="status">
                Lead saved. Notification: {
                  selectedLead.notificationStatus === 'delivered' ? 'delivered' :
                    selectedLead.notificationStatus === 'failed' ? 'not delivered' :
                      selectedLead.notificationStatus === 'pending' ? 'pending' : 'not configured'
                }.
              </p>
              {selectedLead.notificationStatus !== 'delivered' && hasAction('leads', 'edit') && (
                <button
                  type="button"
                  onClick={() => void retryLeadNotification(selectedLead)}
                  disabled={busy}
                  className="rounded-lg border border-[#B9D4BE] px-3 py-2 text-xs font-semibold text-[#216F3D] disabled:opacity-50"
                >
                  {busy ? 'Retrying…' : 'Retry notification'}
                </button>
              )}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[#819084]">Source: {selectedLead.sourcePage}</p>
              <label className="relative inline-flex items-center gap-2 text-xs font-semibold">
                Update status
                <select value={selectedLead.status} disabled={busy || !hasAction('leads', 'edit')} onChange={(event) => void updateStatus(selectedLead, event.target.value as LeadStatus)} className={`admin-lead-status admin-lead-status-${selectedLead.status} appearance-none rounded-lg border border-[#DDE5DD] bg-white py-2 pl-3 pr-8 text-xs outline-none`}>
                  <option value="new">New</option><option value="reviewed">Reviewed</option><option value="contacted">Contacted</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3" />
              </label>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
  accent,
}: {
  icon: typeof UsersRound;
  label: string;
  value: number;
  note: string;
  accent: 'green' | 'blue' | 'amber' | 'purple';
}) {
  const colors = {
    green: 'bg-[#EAF5EB] text-[#318148]',
    blue: 'bg-[#EBF3FA] text-[#4D7D9E]',
    amber: 'bg-[#FBF3E2] text-[#AD862F]',
    purple: 'bg-[#F0EFFA] text-[#7770A8]',
  };
  return (
    <article className="admin-dashboard-metric rounded-2xl border border-[#E2E8E1] bg-white p-5 shadow-[0_8px_30px_-22px_rgba(28,59,35,0.2)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-[#7C887E]">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
        </div>
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${colors[accent]}`}><Icon className="h-5 w-5" /></span>
      </div>
      <p className="mt-3 text-[11px] text-[#929C93]">{note}</p>
    </article>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-xl border border-[#E9EDE8] p-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#5D9D6B]" />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#89948B]">{label}</p>
        {href ? <a href={href} className="mt-1 block break-all text-sm font-medium text-[#286D3B] hover:underline">{value}</a> : <p className="mt-1 break-words text-sm font-medium">{value}</p>}
      </div>
    </div>
  );
}
