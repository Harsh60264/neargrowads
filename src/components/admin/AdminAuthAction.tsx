import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { NearGrowLogo } from '../brand/NearGrowLogo';
import { clearAdminAuthCallbackVerifier, readAdminAuthCallback } from './adminAuthCallback';

export function AdminAuthAction({ mode, temporaryCredential = false }: { mode: 'invite' | 'recovery'; temporaryCredential?: boolean }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [callback] = useState(() => readAdminAuthCallback(
    window.location.search,
    window.location.hash,
    window.localStorage,
    mode,
  ));
  const [sessionGate, setSessionGate] = useState<'checking' | 'signout_required' | 'ready' | 'error'>('checking');
  const [sessionGateError, setSessionGateError] = useState('');
  const [isolationBusy, setIsolationBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const attemptedAutomaticCompletion = useRef(false);
  const usesTemporaryCredential = mode === 'invite' && temporaryCredential;

  const checkInvitationBrowserSession = useCallback(async (): Promise<boolean | undefined> => {
    setSessionGate('checking');
    setSessionGateError('');
    try {
      const contextQuery = new URLSearchParams({ mode });
      const response = await fetch(`/api/admin/auth/invitation-context?${contextQuery}`, { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json() as { hasActiveAdminSession?: boolean; message?: string };
      if (!response.ok) throw new Error(data.message || `Request failed (${response.status}).`);
      const hasSession = data.hasActiveAdminSession === true;
      setSessionGate(hasSession ? 'signout_required' : 'ready');
      return hasSession;
    } catch (reason) {
      setSessionGateError(reason instanceof Error ? reason.message : 'The current browser session could not be checked securely.');
      setSessionGate('error');
      return undefined;
    }
  }, []);

  useEffect(() => {
    const safeQuery = new URLSearchParams(window.location.search);
    for (const key of [
      'access_token', 'refresh_token', 'token_type', 'expires_in', 'expires_at', 'code', 'token', 'token_hash',
      'provider_token', 'provider_refresh_token', 'state', 'error', 'error_code', 'error_description', 'type',
      'invitation_generation',
    ]) {
      safeQuery.delete(key);
    }
    const suffix = safeQuery.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${suffix ? `?${suffix}` : ''}`);
  }, []);

  useEffect(() => {
    void checkInvitationBrowserSession();
  }, [checkInvitationBrowserSession]);

  const signOutExistingBrowserSession = async () => {
    setIsolationBusy(true);
    setSessionGateError('');
    try {
      const response = await fetch('/api/admin/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await response.json() as { message?: string };
      if (!response.ok) throw new Error(data.message || `Request failed (${response.status}).`);
      setPassword('');
      setConfirmPassword('');
      setSessionGate('ready');
    } catch (reason) {
      const hasSession = await checkInvitationBrowserSession();
      if (hasSession) setSessionGateError(reason instanceof Error ? reason.message : 'The current browser session could not be signed out.');
    } finally {
      setIsolationBusy(false);
    }
  };

  const completeSetup = async () => {
    if (busy || notice || sessionGate !== 'ready') return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/auth/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...callback,
          mode,
          ...(!usesTemporaryCredential ? { password, confirmPassword } : {}),
        }),
      });
      const data = await response.json() as { message?: string };
      if (!response.ok) throw new Error(data.message || `Request failed (${response.status}).`);
      clearAdminAuthCallbackVerifier(window.localStorage, callback.codeVerifier);
      setNotice(data.message || 'Your account was updated. Sign in to continue.');
      setPassword('');
      setConfirmPassword('');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Setup could not be completed. Retry or ask the Primary Owner to resend setup.';
      setError(message);
      if (message.includes('Sign out the existing administrator session')) {
        await checkInvitationBrowserSession();
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (sessionGate !== 'ready' || !usesTemporaryCredential || callback.error || attemptedAutomaticCompletion.current ||
      (!callback.accessToken && !callback.authorizationCode && !callback.tokenHash)) return;
    attemptedAutomaticCompletion.current = true;
    void completeSetup();
  }, [sessionGate, usesTemporaryCredential, callback]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void completeSetup();
  };
  const hasCallback = Boolean(callback.accessToken || callback.authorizationCode || callback.tokenHash);

  return (
    <main className="admin-portal grid min-h-screen place-items-center px-4 py-8" data-admin-theme="dark">
      <section className="w-full max-w-md rounded-3xl border border-[#304135] bg-[#19241D] p-6 text-[#ECF3EE] shadow-2xl sm:p-8">
        <NearGrowLogo variant={document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'} size="md" />
        <div className="mt-8 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#67D8B7]/10 text-[#67D8B7]"><ShieldCheck className="h-5 w-5" /></span>
          <div><h1 className="text-xl font-bold">{mode === 'invite' ? 'Complete Admin Setup' : 'Set a new password'}</h1><p className="mt-1 text-xs text-[#A9B8AD]">Your verified Supabase identity is checked before CMS access is enabled.</p></div>
        </div>
        {sessionGate === 'checking' && <p role="status" className="mt-5 rounded-xl border border-[#304135] bg-[#101913] p-3 text-sm text-[#A9B8AD]">Checking this browser is not already signed in to an administrator account…</p>}
        {sessionGate === 'signout_required' && <div role="alert" className="mt-5 rounded-xl border border-amber-300/30 bg-amber-950/20 p-4 text-sm text-amber-100">
          <p>This browser already has an active administrator session. To prevent account crossover, sign out this browser before completing the invitation. No account details or credentials are displayed here.</p>
          {sessionGateError && <p className="mt-2 text-xs">{sessionGateError}</p>}
          <button type="button" disabled={isolationBusy} onClick={() => void signOutExistingBrowserSession()} className="mt-4 min-h-10 rounded-lg bg-[#286D3B] px-4 text-xs font-semibold text-white disabled:opacity-50">{isolationBusy ? 'Signing out…' : 'Sign out this browser and continue'}</button>
        </div>}
        {sessionGate === 'error' && <div role="alert" className="mt-5 rounded-xl border border-rose-400/30 bg-rose-950/30 p-3 text-sm text-rose-200">
          <p>{sessionGateError || 'The browser session could not be isolated. Reload this page or use a separate browser profile.'}</p>
          <button type="button" disabled={isolationBusy} onClick={() => void checkInvitationBrowserSession()} className="mt-3 min-h-9 rounded-lg border border-rose-200/30 px-3 text-xs font-semibold disabled:opacity-50">Check again</button>
        </div>}
        {callback.error && <div role="alert" className="mt-5 rounded-xl border border-rose-400/30 bg-rose-950/30 p-3 text-sm text-rose-200">{callback.error}</div>}
        {!hasCallback && !callback.error && <div role="alert" className="mt-5 rounded-xl border border-rose-400/30 bg-rose-950/30 p-3 text-sm text-rose-200">{mode === 'recovery'
          ? 'This password-reset link is missing or expired. Request a new recovery email.'
          : 'This verification link is missing or expired. Ask the Primary Owner to resend setup.'}</div>}
        {error && <div role="alert" className="mt-5 rounded-xl border border-rose-400/30 bg-rose-950/30 p-3 text-sm text-rose-200">{error}</div>}
        {notice ? <div role="status" className="mt-5 rounded-xl border border-[#67D8B7]/30 bg-[#67D8B7]/10 p-3 text-sm text-[#B8F1DC]">{notice}<a href="/admin/login" className="ml-2 underline">Go to sign in</a></div> : sessionGate === 'ready' && (
          usesTemporaryCredential ? (
            <div className="mt-6 space-y-4">
              <p className="rounded-xl border border-[#304135] bg-[#101913] p-3 text-xs leading-5 text-[#A9B8AD]">Completing the verified invitation activates only the account assigned to this email. You will be required to change your one-time password at first sign-in.</p>
              {busy && <p role="status" className="text-sm text-[#B8F1DC]">Verifying your invitation and completing setup…</p>}
              {error && hasCallback && <button type="button" onClick={() => void completeSetup()} disabled={busy} className="flex h-11 w-full items-center justify-center rounded-xl border border-[#47594C] text-sm font-semibold text-[#C8D8CA] disabled:opacity-50">Retry setup</button>}
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="block text-xs font-medium text-[#B8C7BC]">New password
                <span className="mt-1.5 flex items-center gap-2 rounded-xl border border-[#33453A] bg-[#101913] px-3.5 focus-within:border-[#67D8B7]">
                  <LockKeyhole className="h-4 w-4 text-[#91A195]" />
                  <input type="password" autoComplete="new-password" required minLength={12} className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" value={password} onChange={(event) => setPassword(event.target.value)} />
                </span>
              </label>
              <label className="block text-xs font-medium text-[#B8C7BC]">Confirm new password
                <input type="password" autoComplete="new-password" required minLength={12} className="mt-1.5 h-11 w-full rounded-xl border border-[#33453A] bg-[#101913] px-3.5 text-sm outline-none focus:border-[#67D8B7]" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              </label>
              <p className="text-[10px] leading-5 text-[#91A195]">Minimum 12 characters; include at least three of lowercase, uppercase, number, and symbol.</p>
              <button type="submit" disabled={!hasCallback || busy || password !== confirmPassword} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#286D3B] text-sm font-semibold text-white hover:bg-[#347E49] disabled:opacity-50">{busy ? 'Completing setup…' : mode === 'invite' ? 'Complete Admin Setup' : 'Set password'}</button>
            </form>
          )
        )}
      </section>
    </main>
  );
}
