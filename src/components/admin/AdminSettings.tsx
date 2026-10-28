import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Download, Eye, EyeOff, LoaderCircle, RefreshCw, Save, ShieldCheck, UserPlus, X } from 'lucide-react';

type AdminRole = 'owner' | 'super_admin' | 'custom_admin';
type AdminStatus = 'pending' | 'active' | 'disabled';
type AdminHistoryStatus = AdminStatus | 'cancelled' | 'removed';
type AdminAction = 'view' | 'create' | 'edit' | 'delete' | 'publish' | 'export';
type AdminSection = 'dashboard' | 'leads' | 'serviceStore' | 'content' | 'mascot' | 'caseStudies' | 'servicesManagement' | 'blogs' | 'team' | 'categories' | 'securityMonitoring' | 'settings';
type Permissions = Partial<Record<AdminSection, Partial<Record<AdminAction, boolean>>>>;

interface AdminUser {
  id: string;
  email: string;
  username?: string | null;
  role: AdminRole;
  status: AdminStatus;
  permissions: Permissions;
  isPrimaryOwner: boolean;
  mustChangePassword?: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
  lastPasswordResetAt?: string | null;
  authIdentityExists?: boolean;
  emailVerified?: boolean;
  emailVerifiedAt?: string | null;
  confirmationSentAt?: string | null;
  invitedAt?: string | null;
  authLastSignInAt?: string | null;
  authBannedUntil?: string | null;
  invitedBy?: string | null;
  invitedByEmail?: string | null;
  updatedAt?: string;
}

interface SessionRecord {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  user_agent: string;
  current?: boolean;
  admin_users?: { email?: string; role?: AdminRole };
}

interface AuditRecord {
  id: string;
  action: string;
  section: string;
  details: Record<string, unknown>;
  created_at: string;
  actor?: { email?: string };
  target?: { email?: string };
  target_id?: string | null;
  actor_id?: string | null;
}

interface Identity {
  id: string;
  email: string;
  username?: string;
  role: AdminRole;
  status: AdminStatus;
  isPrimaryOwner: boolean;
  mustChangePassword?: boolean;
}

interface AuditExportWritable {
  write(data: ArrayBuffer): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

declare global {
  interface Window {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<{ createWritable: () => Promise<AuditExportWritable> }>;
  }
}

const sectionLabels: Record<AdminSection, string> = {
  dashboard: 'Dashboard',
  leads: 'Leads Database',
  serviceStore: 'Service Store',
  content: 'Page Content',
  mascot: 'Mascot',
  caseStudies: 'Case Studies',
  servicesManagement: 'Services Management',
  blogs: 'Blog Management',
  team: 'Team & Mentors',
  categories: 'Categories',
  securityMonitoring: 'Security Monitoring',
  settings: 'Settings',
};

const sectionActions: Record<AdminSection, AdminAction[]> = {
  dashboard: ['view'],
  leads: ['view', 'edit', 'export'],
  serviceStore: ['view', 'create', 'edit', 'delete', 'publish'],
  content: ['view', 'edit'],
  mascot: ['view', 'edit', 'publish'],
  caseStudies: ['view', 'create', 'edit', 'delete', 'publish'],
  servicesManagement: ['view', 'create', 'edit', 'delete', 'publish'],
  blogs: ['view', 'create', 'edit', 'delete', 'publish'],
  team: ['view', 'create', 'edit', 'delete'],
  categories: ['view', 'create', 'edit', 'delete'],
  securityMonitoring: ['view', 'edit'],
  settings: ['view'],
};

const initialPermissions: Permissions = {};

const fullSuperAdminPermissions: Permissions = {
  dashboard: { view: true },
  leads: { view: true, edit: true, export: true },
  serviceStore: { view: true, create: true, edit: true, delete: true, publish: true },
  content: { view: true, edit: true },
  mascot: { view: true, edit: true, publish: true },
  caseStudies: { view: true, create: true, edit: true, delete: true, publish: true },
  servicesManagement: { view: true, create: true, edit: true, delete: true, publish: true },
  blogs: { view: true, create: true, edit: true, delete: true, publish: true },
  team: { view: true, create: true, edit: true, delete: true },
  categories: { view: true, create: true, edit: true, delete: true },
  settings: { view: true },
};

const inputClass = 'min-h-11 w-full rounded-xl border border-[#33453A] bg-[#101913] px-3.5 py-2.5 text-sm text-[#EAF1EB] outline-none placeholder:text-[#76867B] focus:border-[#67D8B7] focus:ring-2 focus:ring-[#67D8B7]/15';
const buttonClass = 'admin-settings-primary inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#286D3B] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#347E49] disabled:cursor-not-allowed disabled:opacity-50';

class SettingsApiError extends Error {
  constructor(message: string, readonly details: Record<string, unknown>) {
    super(message);
    this.name = 'SettingsApiError';
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  let body: Record<string, unknown> = {};
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    throw new Error(`The settings API returned a non-JSON response (${response.status}).`);
  }
  if (!response.ok) {
    throw new SettingsApiError(typeof body.message === 'string' ? body.message : `Request failed (${response.status}).`, body);
  }
  return body as T;
}

function Panel({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="admin-settings-panel rounded-2xl border border-[#304135] bg-[#19241D] p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#ECF3EE]">{title}</h2>
          {description && <p className="mt-1 text-xs leading-5 text-[#A9B8AD]">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function AdminSettings({ onNavigate: _onNavigate }: { onNavigate: (path: string) => void }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [logs, setLogs] = useState<AuditRecord[]>([]);
  const [transfers, setTransfers] = useState<Array<Record<string, unknown>>>([]);
  const [owners, setOwners] = useState<Array<{ id: string; email: string; is_primary_owner: boolean }>>([]);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<AdminRole>('custom_admin');
  const [permissions, setPermissions] = useState<Permissions>(initialPermissions);
  const [showCreateAdmin, setShowCreateAdmin] = useState(false);
  const [initialPassword, setInitialPassword] = useState('');
  const [confirmInitialPassword, setConfirmInitialPassword] = useState('');
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  const [passwordResetUser, setPasswordResetUser] = useState<AdminUser | null>(null);
  const [resetPasswordValues, setResetPasswordValues] = useState({ newPassword: '', confirmPassword: '' });
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [passwordValues, setPasswordValues] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPasswords, setShowPasswords] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adminTab, setAdminTab] = useState<'create' | 'accounts' | 'history'>('create');
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<'all' | AdminHistoryStatus>('all');
  const [historyTargetId, setHistoryTargetId] = useState<string | null>(null);
  const [existingAccountId, setExistingAccountId] = useState<string | null>(null);
  const [auditExportOpen, setAuditExportOpen] = useState(false);
  const [auditExportFormat, setAuditExportFormat] = useState<'json' | 'csv'>('json');
  const [auditExportScope, setAuditExportScope] = useState<'all' | 'date_range'>('all');
  const [auditExportFrom, setAuditExportFrom] = useState('');
  const [auditExportTo, setAuditExportTo] = useState('');
  const [auditExporting, setAuditExporting] = useState(false);
  const [auditExportError, setAuditExportError] = useState('');
  const [auditExportStatus, setAuditExportStatus] = useState('');
  const auditExportAbortRef = useRef<AbortController | null>(null);
  const auditExportLockRef = useRef(false);

  const isOwner = identity?.role === 'owner';
  const isPrimaryOwner = identity?.isPrimaryOwner === true;
  const activeOwners = useMemo(() => owners.filter((owner) => owner.id !== identity?.id), [owners, identity?.id]);

  const passwordStrength = (value: string) => [
    value.length >= 12,
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ].filter(Boolean).length;

  const toggleCreateAdmin = () => {
    if (showCreateAdmin) {
      setInitialPassword('');
      setConfirmInitialPassword('');
      setShowInitialPassword(false);
    }
    setShowCreateAdmin((show) => !show);
  };

  const generateStrongPassword = () => {
    const groups = ['abcdefghjkmnpqrstuvwxyz', 'ABCDEFGHJKMNPQRSTUVWXYZ', '23456789', '!@#$%^&*-_=+'];
    const allCharacters = groups.join('');
    const random = new Uint32Array(20);
    window.crypto.getRandomValues(random);
    const chars = groups.map((group, index) => group[random[index] % group.length]);
    for (let index = groups.length; index < random.length; index += 1) {
      chars.push(allCharacters[random[index] % allCharacters.length]);
    }
    for (let index = chars.length - 1; index > 0; index -= 1) {
      const swapIndex = random[index] % (index + 1);
      [chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]];
    }
    return chars.join('');
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const session = await api<{ authenticated: boolean; user?: Identity }>('/api/admin/session');
      if (!session.authenticated || !session.user) throw new Error('Your administrator session has expired. Sign in again.');
      setIdentity(session.user);
      const [ownSessions] = await Promise.all([
        api<{ sessions: SessionRecord[] }>('/api/admin/sessions/mine'),
      ]);
      setSessions(ownSessions.sessions || []);
      if (session.user.isPrimaryOwner) {
        const [userData, auditData, ownershipData, allSessions] = await Promise.all([
          api<{ users: AdminUser[] }>('/api/admin/users'),
          api<{ logs: AuditRecord[] }>('/api/admin/audit-logs'),
          api<{ transfers: Array<Record<string, unknown>>; owners: Array<{ id: string; email: string; is_primary_owner: boolean }> }>('/api/admin/ownership'),
          api<{ sessions: SessionRecord[] }>('/api/admin/sessions'),
        ]);
        setUsers(userData.users);
        setLogs(auditData.logs);
        setTransfers(ownershipData.transfers);
        setOwners(ownershipData.owners);
        setSessions(allSessions.sessions || ownSessions.sessions || []);
      } else if (session.user.role === 'owner') {
        setUsers([]);
        setLogs([]);
        setSessions(ownSessions.sessions || []);
        const ownershipData = await api<{ transfers: Array<Record<string, unknown>>; owners: Array<{ id: string; email: string; is_primary_owner: boolean }> }>('/api/admin/ownership');
        setTransfers(ownershipData.transfers);
        setOwners(ownershipData.owners);
      } else {
        setUsers([]);
        setLogs([]);
        setTransfers([]);
        setOwners([]);
        setSessions(ownSessions.sessions || []);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load account settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const runAction = async (action: () => Promise<string>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setNotice(await action());
      setReauthPassword('');
      await loadData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The settings action could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const inviteAdmin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setExistingAccountId(null);
    await runAction(async () => {
      let result: { message: string };
      try {
        result = await api<{ message: string }>('/api/admin/users/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            username,
            role,
            permissions,
            newPassword: initialPassword,
            confirmPassword: confirmInitialPassword,
            currentPassword: reauthPassword,
          }),
        });
      } catch (reason) {
        if (reason instanceof SettingsApiError && reason.details.existingUser &&
          typeof reason.details.existingUser === 'object') {
          const existing = reason.details.existingUser as Record<string, unknown>;
          if (typeof existing.id === 'string') setExistingAccountId(existing.id);
        }
        throw reason;
      }
      setEmail('');
      setUsername('');
      setInitialPassword('');
      setConfirmInitialPassword('');
      setShowInitialPassword(false);
      setShowCreateAdmin(false);
      return result.message;
    });
  };

  const saveUser = async (user: AdminUser) => {
    if (user.status === 'disabled' && !window.confirm(`Disable ${user.email}? Their active CMS sessions will be revoked.`)) return;
    await runAction(async () => {
      const result = await api<{ message: string }>(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: user.role,
          status: user.status,
          username: user.username || '',
          permissions: user.permissions,
          currentPassword: reauthPassword,
        }),
      });
      return result.message;
    });
  };

  const requestReset = async (user: AdminUser) => {
    if (!window.confirm(`Send a secure password setup/reset link to ${user.email} and revoke their active sessions?`)) return;
    await runAction(async () => {
      const result = await api<{ message: string }>(`/api/admin/users/${encodeURIComponent(user.id)}/recovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: reauthPassword }),
      });
      return result.message;
    });
  };

  const submitTemporaryPasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const user = passwordResetUser;
    if (!user) return;
    await runAction(async () => {
      const result = await api<{ message: string }>(`/api/admin/users/${encodeURIComponent(user.id)}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newPassword: resetPasswordValues.newPassword,
          confirmPassword: resetPasswordValues.confirmPassword,
          currentPassword: reauthPassword,
        }),
      });
      setResetPasswordValues({ newPassword: '', confirmPassword: '' });
      setPasswordResetUser(null);
      return result.message;
    });
  };

  const revokeUserSessions = async (user: AdminUser) => {
    if (!window.confirm(`Revoke all active sessions for ${user.email}?`)) return;
    await runAction(async () => {
      const result = await api<{ message: string }>(`/api/admin/users/${encodeURIComponent(user.id)}/sessions/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: reauthPassword }),
      });
      return result.message;
    });
  };

  const toggleUserStatus = async (user: AdminUser) => {
    const status: AdminStatus = user.status === 'disabled' ? 'active' : 'disabled';
    if (status === 'disabled' && !window.confirm(`Disable ${user.email}? Their active CMS sessions will be revoked.`)) return;
    await runAction(async () => {
      const result = await api<{ message: string }>(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: user.role,
          status,
          username: user.username || '',
          permissions: user.permissions,
          currentPassword: reauthPassword,
        }),
      });
      return result.message;
    });
  };

  const deleteUser = async (user: AdminUser) => {
    if (!window.confirm(`Remove CMS access for ${user.email}? This revokes sessions and permissions, clears the username alias, and preserves the Supabase Auth identity and audit history to avoid affecting other application features.`)) return;
    await runAction(async () => {
      const result = await api<{ message: string }>(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: reauthPassword }),
      });
      return result.message;
    });
  };

  const cancelInvitation = async (user: AdminUser) => {
    if (!window.confirm(`Cancel the pending invitation for ${user.email}? CMS access will be revoked and the Supabase Auth identity will be retained.`)) return;
    await runAction(async () => {
      const result = await api<{ message: string }>(`/api/admin/users/${encodeURIComponent(user.id)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: reauthPassword }),
      });
      return result.message;
    });
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ message: string }>('/api/admin/profile/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(passwordValues),
      });
      setPasswordValues({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setNotice(result.message);
      window.location.assign('/admin/login');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The password could not be changed.');
    } finally {
      setBusy(false);
    }
  };

  const inviteCoOwner = async () => {
    await runAction(async () => {
      const result = await api<{ message: string }>('/api/admin/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'owner', currentPassword: reauthPassword }),
      });
      setEmail('');
      return result.message;
    });
  };

  const startTransfer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await runAction(async () => {
      const result = await api<{ message: string }>('/api/admin/ownership/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientId, currentPassword: reauthPassword }),
      });
      return result.message;
    });
  };

  const changeUser = (id: string, update: Partial<AdminUser>) => {
    setUsers((current) => current.map((user) => user.id === id ? { ...user, ...update } : user));
  };

  const changeUserRole = (user: AdminUser, nextRole: AdminRole) => {
    changeUser(user.id, {
      role: nextRole,
      permissions: nextRole === 'super_admin' ? fullSuperAdminPermissions : initialPermissions,
    });
  };

  const focusUserSetting = (userId: string, setting: 'username' | 'role' | 'permissions') => {
    setAdminTab('accounts');
    const target = document.getElementById(`admin-${setting}-${userId}`);
    window.setTimeout(() => {
      const currentTarget = document.getElementById(`admin-${setting}-${userId}`);
      (currentTarget || target)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (currentTarget instanceof HTMLElement && setting !== 'permissions') currentTarget.focus();
    }, 0);
  };

  const changePermission = (user: AdminUser, section: AdminSection, action: AdminAction, enabled: boolean) => {
    const currentActions = { ...user.permissions[section], [action]: enabled };
    if (action === 'view' && !enabled) {
      for (const item of sectionActions[section]) currentActions[item] = false;
    } else if (action !== 'view' && enabled) {
      currentActions.view = true;
    }
    const next = { ...user.permissions, [section]: currentActions };
    changeUser(user.id, { permissions: next });
  };

  const toggleInvitePermission = (section: AdminSection, action: AdminAction, enabled: boolean) => {
    setPermissions((current) => {
      const currentActions = { ...current[section], [action]: enabled };
      if (action === 'view' && !enabled) {
        for (const item of sectionActions[section]) currentActions[item] = false;
      } else if (action !== 'view' && enabled) {
        currentActions.view = true;
      }
      return { ...current, [section]: currentActions };
    });
  };

  const revokeSession = async (sessionId: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ message: string; currentSession: boolean }>(`/api/admin/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      if (result.currentSession) {
        window.location.assign('/admin/login');
        return;
      }
      setNotice(result.message);
      await loadData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The session could not be revoked.');
    } finally {
      setBusy(false);
    }
  };

  const acceptTransfer = async (transferId: string) => {
    await runAction(async () => {
      const result = await api<{ message: string }>('/api/admin/ownership/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferId, currentPassword: reauthPassword }),
      });
      return result.message;
    });
  };

  const cancelTransfer = async (transferId: string) => {
    await runAction(async () => {
      const result = await api<{ message: string }>('/api/admin/ownership/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferId, currentPassword: reauthPassword }),
      });
      return result.message;
    });
  };

  const closeAuditExport = () => {
    if (auditExportLockRef.current) {
      auditExportAbortRef.current?.abort();
      setAuditExportStatus('Export canceled.');
    }
    setAuditExportOpen(false);
    setAuditExportError('');
  };

  const exportAuditLogs = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (auditExportLockRef.current) return;
    auditExportLockRef.current = true;
    const controller = new AbortController();
    auditExportAbortRef.current = controller;
    let fileWriter: AuditExportWritable | null = null;
    setAuditExporting(true);
    setAuditExportError('');
    setAuditExportStatus('Preparing secure export…');
    try {
      const query = new URLSearchParams({ format: auditExportFormat, scope: auditExportScope });
      if (auditExportScope === 'date_range') {
        query.set('from', auditExportFrom);
        query.set('to', auditExportTo);
      }
      const exportUrl = '/api/admin/audit-logs/export';
      const getResponseError = async (response: Response, fallback: string) => {
        try {
          const body = await response.json() as { message?: string };
          return typeof body.message === 'string' ? body.message : fallback;
        } catch {
          return fallback;
        }
      };
      const suggestedName = `neargrowads-security-audit-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}Z.${auditExportFormat}`;
      if (window.showSaveFilePicker) {
        const fileHandle = await window.showSaveFilePicker({
          suggestedName,
          types: [{
            description: auditExportFormat === 'json' ? 'JSON audit export' : 'CSV audit export',
            accept: { [auditExportFormat === 'json' ? 'application/json' : 'text/csv']: [`.${auditExportFormat}`] },
          }],
        });
        fileWriter = await fileHandle.createWritable();
      } else {
        const previewQuery = new URLSearchParams(query);
        previewQuery.set('preview', '1');
        const previewResponse = await fetch(`${exportUrl}?${previewQuery}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!previewResponse.ok) {
          throw new Error(await getResponseError(previewResponse, `Audit-log export failed (${previewResponse.status}).`));
        }
        const preview = await previewResponse.json() as { recordCount?: number; snapshotCutoff?: string };
        if (typeof preview.recordCount !== 'number' || !Number.isSafeInteger(preview.recordCount) || preview.recordCount < 0 ||
          typeof preview.snapshotCutoff !== 'string') {
          throw new Error('The server did not provide valid export snapshot information. Retry the export.');
        }
        if (preview.recordCount === 0) {
          setAuditExportStatus('No audit logs matched the selected scope. No file was downloaded.');
          return;
        }
        query.set('cutoff', preview.snapshotCutoff);
        const anchor = document.createElement('a');
        anchor.href = `${exportUrl}?${query}`;
        anchor.download = '';
        anchor.click();
        setAuditExportStatus(
          `Browser-managed download started for ${preview.recordCount.toLocaleString()} events. Check the browser download manager for progress, completion, or cancellation.`,
        );
        return;
      }
      const response = await fetch(`${exportUrl}?${query}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(await getResponseError(response, `Audit-log export failed (${response.status}).`));
      }
      const expectedCount = Number(response.headers.get('X-Export-Expected-Records'));
      if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
        throw new Error('The server did not provide a valid export record count. Retry the export.');
      }
      if (expectedCount === 0) {
        await response.body?.cancel();
        if (fileWriter) {
          await fileWriter.abort();
          fileWriter = null;
        }
        setAuditExportStatus('No audit logs matched the selected scope. No file was downloaded.');
        return;
      }
      if (!response.body) throw new Error('The export stream was unavailable. Retry the export.');

      const reader = response.body.getReader();
      if (!fileWriter) throw new Error('The secure file writer could not be initialized. Retry the export.');
      let receivedBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value.slice();
        receivedBytes += chunk.byteLength;
        await fileWriter.write(chunk.buffer as ArrayBuffer);
        setAuditExportStatus(`Receiving export… ${Math.ceil(receivedBytes / 1024)} KB`);
      }
      if (controller.signal.aborted) throw new DOMException('Export canceled.', 'AbortError');
      await fileWriter.close();
      fileWriter = null;
      setAuditExportStatus(`Downloaded ${expectedCount.toLocaleString()} audit ${expectedCount === 1 ? 'event' : 'events'}.`);
    } catch (reason) {
      if (fileWriter) {
        await fileWriter.abort().catch((abortError: unknown) => {
          console.error('[NearGrow Ads] The incomplete audit export file could not be removed.', abortError);
        });
        fileWriter = null;
      }
      if (reason instanceof DOMException && reason.name === 'AbortError') {
        setAuditExportStatus('Export canceled.');
      } else {
        setAuditExportError(reason instanceof Error ? reason.message : 'The audit-log export failed. Retry the export.');
        setAuditExportStatus('');
      }
    } finally {
      auditExportAbortRef.current = null;
      auditExportLockRef.current = false;
      setAuditExporting(false);
    }
  };

  if (loading) return <div className="grid min-h-60 place-items-center text-[#A9B8AD]"><LoaderCircle className="h-6 w-6 animate-spin" aria-label="Loading settings" /></div>;

  const ownerPasswordStrength = passwordStrength(passwordValues.newPassword);
  const initialPasswordStrength = passwordStrength(initialPassword);
  const resetPasswordStrength = passwordStrength(resetPasswordValues.newPassword);
  const delegatedUsers = users.filter((user) => !user.isPrimaryOwner);
  const activeDelegatedUsers = delegatedUsers.filter((user) => user.status === 'active' || user.status === 'pending');
  const latestUserActivity = (userId: string) => logs.find((log) => log.target_id === userId);
  const historyStatus = (user: AdminUser): AdminHistoryStatus => {
    const lastAction = latestUserActivity(user.id)?.action;
    if (user.status === 'disabled' && lastAction === 'admin.invitation.cancelled') return 'cancelled';
    if (user.status === 'disabled' && lastAction === 'admin.removed') return 'removed';
    return user.status;
  };
  const historyStatusLabel = (user: AdminUser): string => {
    const status = historyStatus(user);
    if (status === 'pending') {
      if (user.emailVerified && user.mustChangePassword) return 'Pending Setup';
      if (!user.emailVerified && latestInvitationActivity(user)) return 'Invitation Sent · Email Not Verified';
      if (!user.emailVerified) return 'Created · Email Not Verified';
      return 'Pending';
    }
    if (status === 'active') return user.mustChangePassword ? 'Active · password change required' : 'Active';
    if (status === 'cancelled') return 'Cancelled';
    if (status === 'removed') return 'Removed · Auth retained';
    return 'Disabled';
  };
  const filteredHistoryUsers = delegatedUsers.filter((user) => {
    const term = historyQuery.trim().toLowerCase();
    const matchesQuery = !term || [user.email, user.username || '', user.role, user.invitedByEmail || '']
      .some((value) => value.toLowerCase().includes(term));
    return matchesQuery && (historyStatusFilter === 'all' || historyStatus(user) === historyStatusFilter);
  });
  const latestInvitationActivity = (user: AdminUser) => logs.find((log) =>
    log.target_id === user.id && [
      'admin.invitation.dispatch_initiated',
      'admin.invitation.reissued',
      'admin.invitation.resent',
      'admin.invitation.setup_link_resent',
      'admin.invitation.reissued',
      'admin.invited',
    ].includes(log.action),
  );
  const invitationCounts = {
    pending: delegatedUsers.filter((user) => user.status === 'pending').length,
    active: delegatedUsers.filter((user) => user.status === 'active').length,
    expired: 0,
    cancelled: delegatedUsers.filter((user) => historyStatus(user) === 'cancelled').length,
    disabled: delegatedUsers.filter((user) => user.status === 'disabled' && historyStatus(user) !== 'cancelled' && historyStatus(user) !== 'removed').length,
  };
  const totalInvitationHistory = invitationCounts.pending + invitationCounts.active + invitationCounts.cancelled;

  return (
    <div className="admin-settings space-y-5 text-[#ECF3EE]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#67D8B7]">Account &amp; Governance</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-[#A9B8AD]">Manage your profile, security, and administrator access.</p>
        </div>
        <button type="button" onClick={() => void loadData()} className={buttonClass}><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
      </header>
      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-400/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
        <span>{error}</span>
        {existingAccountId && <button type="button" className="min-h-9 rounded-lg border border-rose-200/30 px-3 text-xs font-semibold hover:bg-white/5" onClick={() => {
          setAdminTab('accounts');
          window.setTimeout(() => document.getElementById(`admin-account-${existingAccountId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
        }}>View Existing Account</button>}
      </div>}
      {notice && <div role="status" className="rounded-xl border border-[#67D8B7]/30 bg-[#67D8B7]/10 px-4 py-3 text-sm text-[#B8F1DC]">{notice}</div>}

      <Panel title="My Profile" description="Your identity comes from the verified Supabase Auth account.">
        <div className="grid gap-4 sm:grid-cols-3">
          <div><p className="text-[10px] uppercase tracking-wide text-[#819286]">Verified email</p><p className="mt-1 text-sm font-medium">{identity?.email}</p></div>
          <div><p className="text-[10px] uppercase tracking-wide text-[#819286]">Username</p><p className="mt-1 text-sm font-medium">{identity?.username || 'No username alias'}</p></div>
          <div><p className="text-[10px] uppercase tracking-wide text-[#819286]">Role</p><p className="mt-1 text-sm font-medium capitalize">{identity?.role.replace('_', ' ')}</p></div>
          <div><p className="text-[10px] uppercase tracking-wide text-[#819286]">Status</p><p className="mt-1 text-sm font-medium capitalize">{identity?.isPrimaryOwner ? 'Primary Owner' : identity?.status}</p></div>
        </div>
      </Panel>

      {isPrimaryOwner && (
        <>
          <Panel title="Admin Users & Permissions" description="Roles and section-level permissions are checked by the server for every protected API request.">
            <div className="admin-settings-alternative-login mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#304135] bg-[#131D16] p-4">
              <div>
                <h3 className="text-sm font-semibold text-[#ECF3EE]">Alternative Login Accounts</h3>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-[#A9B8AD]">Create an independent Supabase Auth identity for each delegated admin. Username login is an alias for that account's verified email; it never reuses the Primary Owner identity or credentials.</p>
              </div>
              <button type="button" className={buttonClass} onClick={() => {
                setAdminTab('create');
                if (!showCreateAdmin) setShowCreateAdmin(true);
                else toggleCreateAdmin();
              }}>
                <UserPlus className="h-4 w-4" /> {showCreateAdmin ? 'Close' : 'Create Alternative Login'}
              </button>
            </div>
            <div className="mb-5 flex flex-wrap gap-2 border-b border-[#304135] pb-3" role="tablist" aria-label="Administrator management">
              {([
                ['create', 'Create Admin'],
                ['accounts', 'Admin Accounts'],
                ['history', 'Invitations & Admin History'],
              ] as const).map(([tab, label]) => <button key={tab} type="button" role="tab" aria-selected={adminTab === tab} onClick={() => setAdminTab(tab)} className={`min-h-10 rounded-xl px-4 text-xs font-semibold transition ${adminTab === tab ? 'bg-[#286D3B] text-white' : 'border border-[#33453A] text-[#C8D4CB] hover:bg-white/5'}`}>{label}</button>)}
            </div>
            <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_180px]">
              <label className="text-xs text-[#B8C7BC]">Owner re-authentication password
                <input type="password" autoComplete="current-password" className={`${inputClass} mt-1.5`} value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} />
              </label>
            </div>
            {adminTab === 'create' && !showCreateAdmin && <div className="rounded-xl border border-[#304135] bg-[#131D16] p-4">
              <p className="text-sm font-semibold text-[#ECF3EE]">Create a delegated administrator</p>
              <p className="mt-1 text-xs text-[#A9B8AD]">Enter the Owner’s current password above, then start a new admin invitation.</p>
              <button type="button" className={`${buttonClass} mt-3`} onClick={() => setShowCreateAdmin(true)}><UserPlus className="h-4 w-4" /> Create Admin</button>
            </div>}
            {existingAccountId && <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/25 bg-amber-950/20 p-4 text-xs text-amber-100">
              <span>This email belongs to an existing administrator. No duplicate was created.</span>
              <button type="button" className="min-h-9 rounded-lg border border-amber-200/30 px-3 font-semibold hover:bg-white/5" onClick={() => {
                setAdminTab('accounts');
                window.setTimeout(() => document.getElementById(`admin-account-${existingAccountId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
              }}>View Existing Account</button>
            </div>}
            {adminTab === 'create' && showCreateAdmin && <form onSubmit={inviteAdmin} className="grid gap-3 rounded-xl border border-[#304135] bg-[#131D16] p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_190px_auto] xl:items-end">
              <label className="text-xs font-medium text-[#B8C7BC]">Recipient email (must be verified)
                <input className={`${inputClass} mt-1.5`} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" />
              </label>
              <label className="text-xs font-medium text-[#B8C7BC]">Unique username
                <input className={`${inputClass} mt-1.5`} autoComplete="off" minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="admin.username" />
                <span className="mt-1 block text-[10px] text-[#819286]">3–32 letters, numbers, dots, underscores or hyphens.</span>
              </label>
              <div className="col-span-full grid gap-3 rounded-xl border border-[#304135] bg-[#101913] p-4 sm:grid-cols-2">
                <p className="col-span-full text-[11px] leading-5 text-[#A9B8AD]">New or unverified Auth identities remain pending until email verification. Existing Auth identities are reused without changing their current password; verified identities receive a fresh password-setup link. CMS access stays pending until onboarding completes.</p>
                <label className="text-xs font-medium text-[#B8C7BC]">New Password
                  <span className="mt-1.5 flex items-center gap-2 rounded-xl border border-[#33453A] bg-[#101913] px-3 focus-within:border-[#67D8B7]">
                    <input className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" type={showInitialPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={200} required value={initialPassword} onChange={(event) => setInitialPassword(event.target.value)} />
                    <button type="button" aria-label={showInitialPassword ? 'Hide new password' : 'Show new password'} onClick={() => setShowInitialPassword((visible) => !visible)} className="text-[#91A195]">{showInitialPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                  </span>
                </label>
                <label className="text-xs font-medium text-[#B8C7BC]">Confirm New Password
                  <input className={`${inputClass} mt-1.5`} type={showInitialPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={200} required value={confirmInitialPassword} onChange={(event) => setConfirmInitialPassword(event.target.value)} />
                </label>
                <div className="col-span-full flex flex-wrap items-center gap-3">
                  <button type="button" className="min-h-9 rounded-lg border border-[#47594C] px-3 text-xs text-[#C8D8CA] hover:bg-white/5" onClick={() => {
                    const generated = generateStrongPassword();
                    setInitialPassword(generated);
                    setConfirmInitialPassword(generated);
                    setShowInitialPassword(true);
                  }}>Generate strong password</button>
                  <span className="text-[10px] text-[#91A195]">Strength: {initialPasswordStrength}/5; use 12+ characters and at least three character types.</span>
                  {initialPassword && initialPassword !== confirmInitialPassword && <span role="alert" className="text-[10px] text-rose-200">Passwords do not match.</span>}
                </div>
              </div>
              <label className="text-xs font-medium text-[#B8C7BC]">Role
                <select className={`${inputClass} mt-1.5`} value={role} onChange={(event) => {
                  const nextRole = event.target.value as AdminRole;
                  setRole(nextRole);
                  setPermissions(nextRole === 'super_admin' ? fullSuperAdminPermissions : initialPermissions);
                }}>
                  <option value="custom_admin">Custom Admin</option><option value="super_admin">Super Admin</option>
                </select>
              </label>
              <button className={buttonClass} disabled={busy || !reauthPassword || initialPasswordStrength < 4 || initialPassword !== confirmInitialPassword}><UserPlus className="h-4 w-4" /> Create Admin</button>
              {(role === 'custom_admin' || role === 'super_admin') && (
                <div className="col-span-full grid gap-3 pt-2 sm:grid-cols-2 xl:grid-cols-4">
                  <p className="col-span-full text-[10px] text-[#91A195]">{role === 'super_admin' ? 'Super Admin starts with full operational access; adjust any permission before adding the account.' : 'Select the exact CMS sections and actions available to this Custom Admin.'}</p>
                  {Object.entries(sectionLabels).map(([section, label]) => (
                    <fieldset key={section} className="rounded-lg border border-[#304135] p-3">
                      <legend className="px-1 text-[11px] font-semibold text-[#DCE8DD]">{label}</legend>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-2">
                        {sectionActions[section as AdminSection].map((action) => (
                          <label key={action} className="flex items-center gap-1.5 text-[10px] capitalize text-[#A9B8AD]">
                            <input type="checkbox" checked={permissions[section as AdminSection]?.[action] === true} onChange={(event) => toggleInvitePermission(section as AdminSection, action, event.target.checked)} />
                            {action}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
              )}
            </form>}
            {adminTab === 'accounts' && <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-[#304135] bg-[#131D16] px-4 py-3 text-xs text-[#A9B8AD]">
                <span>Active and pending administrators are shown here. Verified email or historical Auth login does not complete CMS onboarding; only a fresh accepted invitation does. Disabled, removed, and cancelled records remain available in history.</span>
                <button type="button" className="shrink-0 rounded-lg border border-[#47594C] px-3 py-2 font-semibold text-[#C8D8CA] hover:bg-white/5" onClick={() => setAdminTab('history')}>View History</button>
              </div>
              {activeDelegatedUsers.map((user) => (
                <article id={`admin-account-${user.id}`} key={user.id} className="rounded-xl border border-[#304135] bg-[#131D16] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0"><p className="break-all text-sm font-semibold">{user.email}</p><p className="mt-1 text-[10px] capitalize text-[#91A195]">{historyStatusLabel(user)} · {user.role.replace('_', ' ')} · {user.username ? `@${user.username}` : 'No username alias'}{user.mustChangePassword ? ' · Password change required' : ''}</p><p className="mt-1 text-[10px] text-[#819286]">Allowed sections: {Object.entries(user.permissions || {}).filter(([, actions]) => actions?.view).map(([section]) => sectionLabels[section as AdminSection]).join(', ') || 'None'}</p><p className="mt-1 text-[10px] text-[#819286]">Email verification: {user.emailVerified ? 'Verified' : user.authIdentityExists ? 'Not verified' : 'Auth identity missing'} · Last login: {user.lastLoginAt || user.authLastSignInAt ? new Date(user.lastLoginAt || user.authLastSignInAt || '').toLocaleString() : 'Never'} · Last password reset: {user.lastPasswordResetAt ? new Date(user.lastPasswordResetAt).toLocaleString() : 'Not recorded'}</p></div>
                    <div className="flex flex-wrap gap-2">
                      <select id={`admin-role-${user.id}`} aria-label={`Role for ${user.email}`} className="rounded-lg border border-[#33453A] bg-[#101913] px-2 py-2 text-xs text-[#ECF3EE]" disabled={user.isPrimaryOwner} value={user.role} onChange={(event) => changeUserRole(user, event.target.value as AdminRole)}>
                        {user.role === 'owner' && <option value="owner">Owner</option>}<option value="custom_admin">Custom Admin</option><option value="super_admin">Super Admin</option>
                      </select>
                      <button type="button" className={buttonClass} disabled={busy || !reauthPassword} title={!reauthPassword ? 'Enter the Owner re-authentication password above first.' : undefined} onClick={() => void saveUser(user)}><Save className="h-3.5 w-3.5" /> Save access</button>
                      {!user.isPrimaryOwner && <details className="relative">
                        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center rounded-xl border border-[#47594C] px-3 text-xs text-[#C8D8CA] hover:bg-white/5">Actions</summary>
                        <div className="absolute right-0 z-20 mt-2 flex min-w-60 flex-col rounded-xl border border-[#304135] bg-[#19241D] p-1.5 shadow-xl">
                          <button type="button" className="rounded-lg px-3 py-2 text-left text-xs text-[#C8D8CA] hover:bg-white/5" onClick={() => focusUserSetting(user.id, 'username')}>Edit Account</button>
                          <button type="button" className="rounded-lg px-3 py-2 text-left text-xs text-[#C8D8CA] hover:bg-white/5" onClick={() => focusUserSetting(user.id, 'username')}>Change Username</button>
                          <button type="button" className="rounded-lg px-3 py-2 text-left text-xs text-[#C8D8CA] hover:bg-white/5" onClick={() => focusUserSetting(user.id, 'role')}>Change Role</button>
                          <button type="button" className="rounded-lg px-3 py-2 text-left text-xs text-[#C8D8CA] hover:bg-white/5" onClick={() => focusUserSetting(user.id, 'permissions')}>Edit Permissions</button>
                          <button type="button" disabled={busy || !reauthPassword || user.status !== 'active' || user.role === 'owner'} title={!reauthPassword ? 'Enter the Owner re-authentication password above first.' : user.status !== 'active' ? 'Temporary passwords are only available for active delegated accounts.' : user.role === 'owner' ? 'Co-Owner passwords are independent and cannot be set here.' : undefined} className="rounded-lg px-3 py-2 text-left text-xs text-[#C8D8CA] hover:bg-white/5 disabled:opacity-50" onClick={() => {
                            setPasswordResetUser(user);
                            setResetPasswordValues({ newPassword: '', confirmPassword: '' });
                            setShowResetPassword(false);
                          }}>Set New Temporary Password</button>
                          <button type="button" disabled={busy || !reauthPassword || !user.authIdentityExists} title={!reauthPassword ? 'Enter the Owner re-authentication password above first.' : !user.authIdentityExists ? 'The matching Supabase Auth identity is missing; do not create a replacement automatically.' : undefined} className="rounded-lg px-3 py-2 text-left text-xs text-[#C8D8CA] hover:bg-white/5 disabled:opacity-50" onClick={() => void requestReset(user)}>{user.status === 'pending' ? 'Resend Verification / Setup Link' : 'Reset Password by Email'}</button>
                          <button type="button" disabled={busy || !reauthPassword} className="rounded-lg px-3 py-2 text-left text-xs text-[#C8D8CA] hover:bg-white/5 disabled:opacity-50" onClick={() => void revokeUserSessions(user)}>Revoke Sessions</button>
                          {user.status === 'active' && <button type="button" disabled={busy || !reauthPassword} title={!reauthPassword ? 'Enter the Owner re-authentication password above first.' : undefined} className="rounded-lg px-3 py-2 text-left text-xs text-rose-200 hover:bg-rose-950/30 disabled:opacity-50" onClick={() => void toggleUserStatus(user)}>Disable Admin</button>}
                          {user.status === 'pending' && user.role !== 'owner' && <button type="button" disabled={busy || !reauthPassword} title={!reauthPassword ? 'Enter the Owner re-authentication password above first.' : undefined} className="rounded-lg px-3 py-2 text-left text-xs text-rose-200 hover:bg-rose-950/30 disabled:opacity-50" onClick={() => void cancelInvitation(user)}>Cancel Pending Invitation</button>}
                          {user.role !== 'owner' && <button type="button" disabled={busy || !reauthPassword} title={!reauthPassword ? 'Enter the Owner re-authentication password above first.' : undefined} className="rounded-lg px-3 py-2 text-left text-xs text-rose-200 hover:bg-rose-950/30 disabled:opacity-50" onClick={() => void deleteUser(user)}>Remove CMS Access</button>}
                        </div>
                      </details>}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 border-t border-[#304135] pt-3 sm:grid-cols-[1fr_auto]">
                    <label className="text-[10px] font-medium text-[#A9B8AD]">Unique username
                      <input id={`admin-username-${user.id}`} className={`${inputClass} mt-1.5`} autoComplete="off" minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" value={user.username || ''} disabled={user.isPrimaryOwner} onChange={(event) => changeUser(user.id, { username: event.target.value || null })} placeholder="Optional unique login alias" />
                    </label>
                  </div>
                  {(user.role === 'custom_admin' || user.role === 'super_admin') && (
                    <div id={`admin-permissions-${user.id}`} className="mt-4 grid gap-3 border-t border-[#304135] pt-3 sm:grid-cols-2 xl:grid-cols-4">
                      <p className="col-span-full text-[10px] text-[#91A195]">Allowed sections and actions for this {user.role === 'super_admin' ? 'Super Admin' : 'Custom Admin'}.</p>
                      {Object.entries(sectionLabels).map(([section, label]) => (
                        <fieldset key={section} className="rounded-lg border border-[#304135] p-3">
                          <legend className="px-1 text-[11px] font-semibold text-[#DCE8DD]">{label}</legend>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-2">
                            {sectionActions[section as AdminSection].map((action) => (
                              <label key={action} className="flex items-center gap-1.5 text-[10px] capitalize text-[#A9B8AD]">
                                <input type="checkbox" checked={user.permissions?.[section as AdminSection]?.[action] === true} onChange={(event) => changePermission(user, section as AdminSection, action, event.target.checked)} />
                                {action}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      ))}
                    </div>
                  )}
                </article>
              ))}
              {!delegatedUsers.length && <p className="text-sm text-[#A9B8AD]">No delegated alternative login accounts yet. Create one above.</p>}
            </div>}
            {adminTab === 'history' && <div className="mt-5 space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                {([
                  ['Total invitations', totalInvitationHistory],
                  ['Pending', invitationCounts.pending],
                  ['Accepted / active', invitationCounts.active],
                  ['Expired', invitationCounts.expired],
                  ['Cancelled', invitationCounts.cancelled],
                  ['Disabled / removed', invitationCounts.disabled + delegatedUsers.filter((user) => historyStatus(user) === 'removed').length],
                ] as const).map(([label, count]) => <div key={label} className="rounded-xl border border-[#304135] bg-[#131D16] p-3">
                  <p className="text-xl font-bold text-[#B8F1DC]">{count}</p><p className="mt-1 text-[10px] text-[#91A195]">{label}</p>
                </div>)}
              </div>
              <div className="rounded-xl border border-amber-300/20 bg-amber-950/15 p-3 text-[10px] leading-5 text-amber-100">
                Expired invitations are not counted because Supabase does not expose a reliable per-invitation expiry value here. Dispatch status means Supabase Auth accepted the request; it does not confirm inbox delivery. Historical acceptance times are shown only where an audit event was recorded.
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
                <label className="text-xs font-medium text-[#B8C7BC]">Search administrators
                  <input className={`${inputClass} mt-1.5`} type="search" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="Email, username, role or inviter" />
                </label>
                <label className="text-xs font-medium text-[#B8C7BC]">Account status
                  <select className={`${inputClass} mt-1.5`} value={historyStatusFilter} onChange={(event) => setHistoryStatusFilter(event.target.value as typeof historyStatusFilter)}>
                    <option value="all">All statuses</option><option value="pending">Pending</option><option value="active">Active</option><option value="disabled">Disabled</option><option value="cancelled">Cancelled</option><option value="removed">Removed</option>
                  </select>
                </label>
              </div>
              <div className="overflow-x-auto rounded-xl border border-[#304135]">
                <table className="min-w-[1120px] w-full text-left text-xs">
                  <thead className="bg-[#101913] text-[#A9B8AD]"><tr>
                    {['Recipient / username', 'Role / status', 'Email verification', 'Invitation dispatch', 'Created / expiry', 'Accepted / last login', 'Invited by', 'Permissions', 'Actions'].map((label) => <th key={label} className="px-3 py-3 font-semibold">{label}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-[#304135]">
                    {filteredHistoryUsers.map((user) => {
                      const inviteActivity = latestInvitationActivity(user);
                      const deliveryInitiated = Boolean(inviteActivity || user.confirmationSentAt || user.invitedAt);
                      const acceptedAt = logs.find((log) => log.target_id === user.id && log.action === 'admin.invitation.accepted')?.created_at;
                      const dispatchAt = inviteActivity?.created_at || user.confirmationSentAt || user.invitedAt;
                      const permissionSummary = Object.entries(user.permissions || {})
                        .filter(([, actions]) => actions?.view)
                        .map(([section, actions]) => `${sectionLabels[section as AdminSection]}${Object.entries(actions || {}).filter(([action, enabled]) => action !== 'view' && enabled).map(([action]) => `: ${action}`).join(',')}`)
                        .join(' · ') || 'None';
                      return <tr key={user.id} id={`admin-history-${user.id}`} className="align-top text-[#C8D8CA]">
                        <td className="px-3 py-3"><p className="break-all font-semibold">{user.email}</p><p className="mt-1 text-[10px] text-[#91A195]">{user.username ? `@${user.username}` : 'No username'}</p></td>
                        <td className="px-3 py-3"><p className="capitalize">{user.role.replace('_', ' ')}</p><p className="mt-1 text-[10px] text-[#91A195]">{historyStatusLabel(user)}</p></td>
                        <td className="px-3 py-3">{user.emailVerified ? 'Verified' : user.authIdentityExists ? 'Not verified' : 'Auth identity missing'}{user.emailVerifiedAt && <time className="mt-1 block text-[10px] text-[#91A195]">{new Date(user.emailVerifiedAt).toLocaleString()}</time>}</td>
                        <td className="px-3 py-3">{deliveryInitiated ? 'Dispatch initiated' : 'Not recorded'}{dispatchAt && <time className="mt-1 block text-[10px] text-[#91A195]">{new Date(dispatchAt).toLocaleString()}</time>}<span className="mt-1 block text-[10px] text-[#819286]">Delivery unconfirmed</span></td>
                        <td className="px-3 py-3"><time>{user.createdAt ? new Date(user.createdAt).toLocaleString() : 'Unknown'}</time><span className="mt-1 block text-[10px] text-[#91A195]">Expiry: not available</span></td>
                        <td className="px-3 py-3">{acceptedAt ? new Date(acceptedAt).toLocaleString() : 'Not recorded'}<time className="mt-1 block text-[10px] text-[#91A195]">{user.lastLoginAt || user.authLastSignInAt ? `Last login ${new Date(user.lastLoginAt || user.authLastSignInAt || '').toLocaleString()}` : 'No login recorded'}</time></td>
                        <td className="px-3 py-3">{user.invitedByEmail || 'Unknown'}</td>
                        <td className="max-w-64 px-3 py-3 text-[10px] leading-5 text-[#91A195]">{permissionSummary}</td>
                        <td className="px-3 py-3"><div className="flex min-w-36 flex-col gap-1">
                          <button type="button" className="rounded-lg border border-[#47594C] px-2 py-1.5 text-left text-[10px] hover:bg-white/5" onClick={() => {
                            setAdminTab('accounts');
                            window.setTimeout(() => document.getElementById(`admin-account-${user.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
                          }}>View Details / Edit Access</button>
                          <button type="button" className="rounded-lg border border-[#47594C] px-2 py-1.5 text-left text-[10px] hover:bg-white/5" onClick={() => focusUserSetting(user.id, 'permissions')}>View Permissions</button>
                          {user.status === 'pending' && <button type="button" disabled={busy || !reauthPassword || !user.authIdentityExists} title={!reauthPassword ? 'Enter the Owner re-authentication password above first.' : !user.authIdentityExists ? 'The matching Supabase Auth identity is missing; review it before retrying.' : undefined} className="rounded-lg border border-[#47594C] px-2 py-1.5 text-left text-[10px] hover:bg-white/5 disabled:opacity-50" onClick={() => void requestReset(user)}>Resend setup link</button>}
                          {user.status === 'pending' && user.role !== 'owner' && <>
                            <button type="button" disabled={busy || !reauthPassword} title={!reauthPassword ? 'Enter the Owner re-authentication password above first.' : undefined} className="rounded-lg border border-rose-300/20 px-2 py-1.5 text-left text-[10px] text-rose-200 hover:bg-rose-950/20 disabled:opacity-50" onClick={() => void cancelInvitation(user)}>Cancel Pending Invitation</button>
                            {!reauthPassword && <span className="text-[10px] leading-4 text-amber-200/80">Enter the Primary Owner password above to enable cancellation.</span>}
                          </>}
                          {user.status === 'active' && <span className="text-[10px] leading-4 text-[#91A195]">Active account: use Remove CMS Access in Admin Accounts instead.</span>}
                          {user.status === 'disabled' && <button type="button" disabled={busy || !reauthPassword || !user.authIdentityExists || user.isPrimaryOwner} title={!reauthPassword ? 'Enter the Owner re-authentication password above first.' : !user.authIdentityExists ? 'The original Supabase Auth identity is unavailable; automatic replacement is blocked.' : user.isPrimaryOwner ? 'Primary Owner identity cannot be recovered through delegated account management.' : undefined} className="rounded-lg border border-[#67D8B7]/30 px-2 py-1.5 text-left text-[10px] text-[#B8F1DC] hover:bg-[#67D8B7]/10 disabled:opacity-50" onClick={() => void requestReset(user)}>Re-invite / Recover CMS Access</button>}
                        </div></td>
                      </tr>;
                    })}
                    {!filteredHistoryUsers.length && <tr><td colSpan={9} className="px-4 py-8 text-center text-[#91A195]">No administrator accounts match this search or status.</td></tr>}
                  </tbody>
                </table>
              </div>
              <section className="rounded-xl border border-[#304135] bg-[#131D16] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><h3 className="text-sm font-semibold text-[#ECF3EE]">Invitation activity timeline</h3><p className="mt-1 text-[10px] text-[#91A195]">Recent audit events from the existing admin_audit_logs table.</p></div>
                  <select className="rounded-lg border border-[#33453A] bg-[#101913] px-3 py-2 text-xs text-[#ECF3EE]" value={historyTargetId || ''} onChange={(event) => setHistoryTargetId(event.target.value || null)} aria-label="Choose account activity">
                    <option value="">All accounts</option>{delegatedUsers.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}
                  </select>
                </div>
                <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
                  {logs.filter((log) => {
                    const accountEvent = log.target_id && (delegatedUsers.some((user) => user.id === log.target_id) ||
                      (typeof log.details.deletedUserId === 'string' && delegatedUsers.some((user) => user.id === log.details.deletedUserId)));
                    return accountEvent && (!historyTargetId || log.target_id === historyTargetId || log.details.deletedUserId === historyTargetId);
                  }).map((log) => <article key={log.id} className="rounded-lg border border-[#304135] bg-[#101913] px-3 py-2">
                    <div className="flex flex-wrap justify-between gap-2"><span className="font-medium text-[#DCE8DD]">{log.action}</span><time className="text-[10px] text-[#91A195]">{new Date(log.created_at).toLocaleString()}</time></div>
                    <p className="mt-1 text-[10px] text-[#91A195]">{log.actor?.email || 'System'}{log.target?.email ? ` → ${log.target.email}` : ''} · {log.section}</p>
                  </article>)}
                  {!logs.some((log) => log.target_id && (!historyTargetId || log.target_id === historyTargetId)) && <p className="text-xs text-[#91A195]">No matching invitation/admin activity is recorded in the loaded audit history.</p>}
                </div>
              </section>
            </div>}
          </Panel>
        </>
      )}

      {isPrimaryOwner && passwordResetUser && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="admin-password-reset-title" className="w-full max-w-lg rounded-2xl border border-[#304135] bg-[#19241D] p-5 text-[#ECF3EE] shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="admin-password-reset-title" className="text-base font-semibold">Reset delegated admin password</h2>
                <p className="mt-1 break-all text-xs text-[#A9B8AD]">{passwordResetUser.email}</p>
              </div>
              <button type="button" aria-label="Close password reset" className="rounded-lg p-2 text-[#A9B8AD] hover:bg-white/5" onClick={() => {
                setPasswordResetUser(null);
                setResetPasswordValues({ newPassword: '', confirmPassword: '' });
              }}><X className="h-4 w-4" /></button>
            </div>
            <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-950/20 p-3 text-xs leading-5 text-amber-100">This sets a one-time password in Supabase Auth. Give it to the account holder through a secure channel, not email. Their active CMS sessions and Supabase refresh tokens will be revoked, and they must change it at next sign-in.</p>
            <form onSubmit={(event) => void submitTemporaryPasswordReset(event)} className="mt-4 space-y-3">
              <label className="block text-xs font-medium text-[#B8C7BC]">New temporary password
                <span className="mt-1.5 flex items-center gap-2 rounded-xl border border-[#33453A] bg-[#101913] px-3 focus-within:border-[#67D8B7]">
                  <input className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" type={showResetPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={200} value={resetPasswordValues.newPassword} onChange={(event) => setResetPasswordValues((current) => ({ ...current, newPassword: event.target.value }))} />
                  <button type="button" aria-label={showResetPassword ? 'Hide password' : 'Show password'} onClick={() => setShowResetPassword((visible) => !visible)} className="text-[#91A195]">{showResetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                </span>
              </label>
              <label className="block text-xs font-medium text-[#B8C7BC]">Confirm temporary password
                <input className={`${inputClass} mt-1.5`} type={showResetPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={200} value={resetPasswordValues.confirmPassword} onChange={(event) => setResetPasswordValues((current) => ({ ...current, confirmPassword: event.target.value }))} />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="min-h-9 rounded-lg border border-[#47594C] px-3 text-xs text-[#C8D8CA] hover:bg-white/5" onClick={() => {
                  const generated = generateStrongPassword();
                  setResetPasswordValues({ newPassword: generated, confirmPassword: generated });
                  setShowResetPassword(true);
                }}>Generate strong password</button>
                <span className="text-[10px] text-[#91A195]">Strength: {resetPasswordStrength}/5 — 12+ characters and three character types required.</span>
              </div>
              {resetPasswordValues.newPassword !== resetPasswordValues.confirmPassword && <p role="alert" className="text-xs text-rose-200">Passwords do not match.</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="min-h-10 rounded-xl border border-[#47594C] px-4 text-xs text-[#C8D8CA] hover:bg-white/5" onClick={() => {
                  setPasswordResetUser(null);
                  setResetPasswordValues({ newPassword: '', confirmPassword: '' });
                }}>Cancel</button>
                <button type="submit" className={buttonClass} disabled={busy || resetPasswordStrength < 4 || resetPasswordValues.newPassword !== resetPasswordValues.confirmPassword || !reauthPassword}>
                  {busy ? 'Resetting…' : 'Set temporary password'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {identity?.status === 'active' && <Panel title="Security & Password" description="My Password — change only this signed-in account's password after re-authentication. Google-only accounts must manage their password with Google.">
        <form onSubmit={changePassword} className="grid gap-3 sm:grid-cols-2">
          {(['currentPassword', 'newPassword', 'confirmPassword'] as const).map((key) => (
            <label key={key} className="text-xs font-medium capitalize text-[#B8C7BC]">{key.replace(/([A-Z])/g, ' $1')}
              <span className="mt-1.5 flex rounded-xl border border-[#33453A] bg-[#101913] pr-3 focus-within:border-[#67D8B7]">
                <input className="min-h-11 min-w-0 flex-1 bg-transparent px-3.5 text-sm text-[#EAF1EB] outline-none" type={showPasswords ? 'text' : 'password'} autoComplete={key === 'currentPassword' ? 'current-password' : 'new-password'} required value={passwordValues[key]} onChange={(event) => setPasswordValues((current) => ({ ...current, [key]: event.target.value }))} />
                <button type="button" aria-label={showPasswords ? 'Hide password' : 'Show password'} onClick={() => setShowPasswords((current) => !current)} className="text-[#91A195]">{showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </span>
            </label>
          ))}
          <div className="self-end">
            <p className="mb-2 text-[10px] text-[#91A195]">Strength: {ownerPasswordStrength}/5 — 12+ characters and three character types required.</p>
            <button className={buttonClass} disabled={busy || ownerPasswordStrength < 4 || passwordValues.newPassword !== passwordValues.confirmPassword}><ShieldCheck className="h-4 w-4" /> Update password</button>
          </div>
        </form>
        <p className="mt-3 text-[10px] leading-5 text-[#91A195]">Changing your password revokes your active CMS sessions, including this one. Passwords are never visible to other administrators.</p>
      </Panel>}

      {isOwner && (
        <Panel title="Ownership Management" description="Only the Primary Owner can invite Co-Owners or initiate governance changes. A Co-Owner can accept a transfer addressed to them.">
          <label className="mb-5 block max-w-md text-xs text-[#B8C7BC]">Re-authentication password
            <input type="password" autoComplete="current-password" className={`${inputClass} mt-1.5`} value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} />
          </label>
          {isPrimaryOwner && <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Add Co-Owner</h3>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input className={inputClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="co-owner@example.com" />
                <button type="button" className={buttonClass} disabled={busy || !email || !reauthPassword} onClick={() => void inviteCoOwner()}>Invite Co-Owner</button>
              </div>
            </div>
            <form onSubmit={startTransfer} className="space-y-3">
              <h3 className="text-sm font-semibold">Transfer Primary Ownership</h3>
              <select className={inputClass} required value={recipientId} onChange={(event) => setRecipientId(event.target.value)}>
                <option value="">Select an active Co-Owner</option>
                {activeOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.email}</option>)}
              </select>
              <button className={buttonClass} disabled={busy || !recipientId || !reauthPassword}>Request transfer</button>
            </form>
          </div>}
          {transfers.length > 0 && <div className="mt-5 space-y-2 border-t border-[#304135] pt-4">
            <h3 className="text-xs font-semibold text-[#C8D8CA]">Ownership activity</h3>
            {transfers.map((item) => (
              <div key={String(item.id)} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#131D16] px-3 py-2 text-xs">
                <span className="text-[#C8D8CA]">Transfer status: {String(item.status)} · expires {new Date(String(item.expires_at)).toLocaleDateString()}</span>
                {item.to_user_id === identity?.id && item.status === 'pending' && <button type="button" className={buttonClass} disabled={busy || !reauthPassword} onClick={() => void acceptTransfer(String(item.id))}>Accept transfer</button>}
                {item.from_user_id === identity?.id && identity.isPrimaryOwner && item.status === 'pending' && <button type="button" className="min-h-10 rounded-xl border border-[#47594C] px-3 text-xs text-[#C8D8CA] hover:bg-white/5 disabled:opacity-50" disabled={busy || !reauthPassword} onClick={() => void cancelTransfer(String(item.id))}>Cancel transfer</button>}
              </div>
            ))}
          </div>}
        </Panel>
      )}

      <Panel title="Active Sessions" description="Revoke any session immediately. Revocation is enforced by the server for every admin API call.">
        <div className="space-y-2">
          {sessions.filter((session) => !session.revoked_at && new Date(session.expires_at).getTime() > Date.now()).map((session) => (
            <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#304135] bg-[#131D16] px-4 py-3">
              <div><p className="text-xs font-medium">{session.admin_users?.email || (session.user_id === identity?.id ? identity.email : 'Administrator session')}</p>              <p className="mt-1 text-[10px] text-[#91A195]">{new Date(session.created_at).toLocaleString()} · {session.current ? 'This session · ' : ''}{session.user_agent || 'Unknown device'}</p></div>
              <button type="button" className="rounded-lg border border-[#47594C] px-3 py-2 text-[10px] text-[#C8D8CA] hover:bg-white/5" onClick={() => void revokeSession(session.id)}>Revoke</button>
            </div>
          ))}
          {!sessions.some((session) => !session.revoked_at && new Date(session.expires_at).getTime() > Date.now()) && <p className="text-xs text-[#A9B8AD]">No active sessions found.</p>}
        </div>
      </Panel>

      {isPrimaryOwner && <Panel
        title="Security Audit Logs"
        description="Recent administrator changes, sign-ins, session actions, and ownership decisions."
        actions={<button type="button" className={buttonClass} onClick={() => {
          setAuditExportError('');
          setAuditExportStatus('');
          setAuditExportOpen(true);
        }}><Download className="h-3.5 w-3.5" aria-hidden="true" />Export Logs</button>}
      >
        <div className="max-h-[28rem] space-y-2 overflow-y-auto">
          {logs.map((log) => <div key={log.id} className="rounded-lg border border-[#304135] bg-[#131D16] px-3 py-2 text-xs">
            <div className="flex flex-wrap justify-between gap-2"><span className="font-medium text-[#DCE8DD]">{log.action}</span><time className="text-[10px] text-[#91A195]">{new Date(log.created_at).toLocaleString()}</time></div>
            <p className="mt-1 text-[10px] text-[#91A195]">{log.actor?.email || 'System'}{log.target?.email ? ` → ${log.target.email}` : ''} · {log.section}</p>
            {!!Object.keys(log.details || {}).length && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[10px] text-[#A9B8AD]">{JSON.stringify(log.details, null, 2)}</pre>}
          </div>)}
          {!logs.length && <p className="text-xs text-[#A9B8AD]">No recorded activity yet.</p>}
        </div>
      </Panel>}
      {busy && <span className="sr-only" role="status">Saving administrator settings</span>}
      {auditExportOpen && <div
        className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/65 p-4"
        onMouseDown={(event) => { if (event.target === event.currentTarget) closeAuditExport(); }}
      >
        <section role="dialog" aria-modal="true" aria-labelledby="audit-export-title" className="w-full max-w-lg rounded-2xl border border-[#304135] bg-[#19241D] p-5 text-[#ECF3EE] shadow-2xl sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="audit-export-title" className="text-base font-semibold">Export Security Audit Logs</h2>
              <p className="mt-1 text-xs leading-5 text-[#A9B8AD]">Download complete authorized records, including nested event metadata.</p>
            </div>
            <button type="button" aria-label="Close export dialog" disabled={auditExporting} onClick={closeAuditExport} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#47594C] text-[#C8D8CA] hover:bg-white/5 disabled:opacity-50"><X className="h-4 w-4" /></button>
          </div>
          <form className="mt-5 space-y-4" onSubmit={(event) => void exportAuditLogs(event)}>
            <label className="block text-xs font-medium text-[#B8C7BC]">Format
              <select className={`${inputClass} mt-1.5`} value={auditExportFormat} onChange={(event) => setAuditExportFormat(event.target.value as 'json' | 'csv')} disabled={auditExporting}>
                <option value="json">JSON — Complete details</option>
                <option value="csv">CSV — Open in Excel</option>
              </select>
            </label>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-xs font-medium text-[#B8C7BC]">Scope</legend>
              <label className="flex min-h-10 items-center gap-2 rounded-lg border border-[#33453A] px-3 text-xs text-[#DCE8DD]">
                <input type="radio" name="audit-export-scope" value="all" checked={auditExportScope === 'all'} onChange={() => setAuditExportScope('all')} disabled={auditExporting} />
                All available logs
              </label>
              <label className="flex min-h-10 items-center gap-2 rounded-lg border border-[#33453A] px-3 text-xs text-[#DCE8DD]">
                <input type="radio" name="audit-export-scope" value="date_range" checked={auditExportScope === 'date_range'} onChange={() => setAuditExportScope('date_range')} disabled={auditExporting} />
                Custom date range
              </label>
            </fieldset>
            {auditExportScope === 'date_range' && <div className="rounded-xl border border-[#33453A] bg-[#131D16] p-3">
              <p className="mb-3 text-[11px] leading-5 text-[#A9B8AD]">Calendar dates use Asia/Kolkata (IST, UTC+05:30); selected start and end dates are included. Exported timestamps remain UTC.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-[#B8C7BC]">From
                  <input className={`${inputClass} mt-1.5`} type="date" required value={auditExportFrom} onChange={(event) => setAuditExportFrom(event.target.value)} disabled={auditExporting} />
                </label>
                <label className="text-xs font-medium text-[#B8C7BC]">Through
                  <input className={`${inputClass} mt-1.5`} type="date" required min={auditExportFrom || undefined} value={auditExportTo} onChange={(event) => setAuditExportTo(event.target.value)} disabled={auditExporting} />
                </label>
              </div>
            </div>}
            {auditExportError && <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-950/30 px-3 py-2.5 text-xs text-rose-200">{auditExportError}</p>}
            {auditExportStatus && <p role="status" className="rounded-lg border border-[#67D8B7]/25 bg-[#67D8B7]/10 px-3 py-2.5 text-xs text-[#B8F1DC]">{auditExportStatus}</p>}
            <div className="flex flex-col-reverse gap-2 border-t border-[#304135] pt-4 sm:flex-row sm:justify-end">
              <button type="button" className="min-h-10 rounded-xl border border-[#47594C] px-4 py-2 text-xs font-semibold text-[#C8D8CA] hover:bg-white/5" onClick={closeAuditExport} disabled={auditExporting}>Close</button>
              {auditExporting
                ? <button type="button" className="min-h-10 rounded-xl border border-rose-300/40 px-4 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-950/30" onClick={() => auditExportAbortRef.current?.abort()}>Cancel export</button>
                : <button type="submit" className={buttonClass} disabled={auditExportScope === 'date_range' && (!auditExportFrom || !auditExportTo)}>
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />Download export
                </button>}
            </div>
          </form>
        </section>
      </div>}
    </div>
  );
}
