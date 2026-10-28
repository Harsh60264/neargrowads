import { useEffect, useState, type FormEvent } from 'react';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { NearGrowLogo } from '../brand/NearGrowLogo';

export function AdminAuthAction({ mode, temporaryCredential = false }: { mode: 'invite' | 'recovery'; temporaryCredential?: boolean }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accessToken] = useState(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    return hash.get('access_token') || '';
  });
  useEffect(() => {
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const usesTemporaryCredential = mode === 'invite' && temporaryCredential;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/auth/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken,
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
      setError(reason instanceof Error ? reason.message : 'The account action could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-portal grid min-h-screen place-items-center px-4 py-8" data-admin-theme="dark">
      <section className="w-full max-w-md rounded-3xl border border-[#304135] bg-[#19241D] p-6 text-[#ECF3EE] shadow-2xl sm:p-8">
        <NearGrowLogo variant={document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'} size="md" />
        <div className="mt-8 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#67D8B7]/10 text-[#67D8B7]"><ShieldCheck className="h-5 w-5" /></span>
          <div><h1 className="text-xl font-bold">{mode === 'invite' ? 'Accept administrator invitation' : 'Set a new password'}</h1><p className="mt-1 text-xs text-[#A9B8AD]">Use your verified email link to finish securely.</p></div>
        </div>
        {!accessToken && <div role="alert" className="mt-5 rounded-xl border border-rose-400/30 bg-rose-950/30 p-3 text-sm text-rose-200">This verification link is missing or expired. Ask an Owner to resend your invitation or request a new recovery email.</div>}
        {error && <div role="alert" className="mt-5 rounded-xl border border-rose-400/30 bg-rose-950/30 p-3 text-sm text-rose-200">{error}</div>}
        {notice ? <div role="status" className="mt-5 rounded-xl border border-[#67D8B7]/30 bg-[#67D8B7]/10 p-3 text-sm text-[#B8F1DC]">{notice}<a href="/admin/login" className="ml-2 underline">Go to sign in</a></div> : (
          <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4">
            {usesTemporaryCredential ? (
              <p className="rounded-xl border border-[#304135] bg-[#101913] p-3 text-xs leading-5 text-[#A9B8AD]">The Owner set a one-time password for this account. Continue to verify your email; you will be required to change that temporary password when you first sign in.</p>
            ) : (
              <>
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
              </>
            )}
            <button type="submit" disabled={!accessToken || busy || (!usesTemporaryCredential && password !== confirmPassword)} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#286D3B] text-sm font-semibold text-white hover:bg-[#347E49] disabled:opacity-50">{busy ? 'Updating…' : usesTemporaryCredential ? 'Verify email' : 'Set password'}</button>
          </form>
        )}
      </section>
    </main>
  );
}
