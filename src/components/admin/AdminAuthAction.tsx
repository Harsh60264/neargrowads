import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { NearGrowLogo } from '../brand/NearGrowLogo';
import { readAdminAuthCallback } from './adminAuthCallback';

export function AdminAuthAction({ mode, temporaryCredential = false }: { mode: 'invite' | 'recovery'; temporaryCredential?: boolean }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [callback] = useState(() => readAdminAuthCallback(window.location.search, window.location.hash, window.localStorage));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const attemptedAutomaticCompletion = useRef(false);
  const usesTemporaryCredential = mode === 'invite' && temporaryCredential;

  useEffect(() => {
    const safeQuery = new URLSearchParams(window.location.search);
    for (const key of [
      'access_token', 'refresh_token', 'token_type', 'expires_in', 'expires_at', 'code', 'token', 'token_hash',
      'provider_token', 'provider_refresh_token', 'state', 'error', 'error_code', 'error_description', 'type',
    ]) {
      safeQuery.delete(key);
    }
    const suffix = safeQuery.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${suffix ? `?${suffix}` : ''}`);
  }, []);

  const completeSetup = async () => {
    if (busy || notice) return;
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
      setNotice(data.message || 'Your account was updated. Sign in to continue.');
      setPassword('');
      setConfirmPassword('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Setup could not be completed. Retry or ask the Primary Owner to resend setup.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!usesTemporaryCredential || callback.error || attemptedAutomaticCompletion.current ||
      (!callback.accessToken && !callback.authorizationCode && !callback.tokenHash)) return;
    attemptedAutomaticCompletion.current = true;
    void completeSetup();
  }, [usesTemporaryCredential, callback]);

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
        {callback.error && <div role="alert" className="mt-5 rounded-xl border border-rose-400/30 bg-rose-950/30 p-3 text-sm text-rose-200">{callback.error}</div>}
        {!hasCallback && !callback.error && <div role="alert" className="mt-5 rounded-xl border border-rose-400/30 bg-rose-950/30 p-3 text-sm text-rose-200">This verification link is missing or expired. Ask the Primary Owner to resend setup.</div>}
        {error && <div role="alert" className="mt-5 rounded-xl border border-rose-400/30 bg-rose-950/30 p-3 text-sm text-rose-200">{error}</div>}
        {notice ? <div role="status" className="mt-5 rounded-xl border border-[#67D8B7]/30 bg-[#67D8B7]/10 p-3 text-sm text-[#B8F1DC]">{notice}<a href="/admin/login" className="ml-2 underline">Go to sign in</a></div> : (
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
