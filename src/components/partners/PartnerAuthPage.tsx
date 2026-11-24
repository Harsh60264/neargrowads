import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Eye, EyeOff, LoaderCircle, Mail } from 'lucide-react';
import type { PartnerProfile } from './partnerTypes';

const PartnerWorkspace = lazy(() => import('./PartnerWorkspace').then((module) => ({ default: module.PartnerWorkspace })));

type AuthMode = 'login' | 'register' | 'recovery';

export function getPartnerAuthInitialMode(pathname: string): AuthMode {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/partners/register') return 'register';
  if (normalizedPath === '/partners/recovery') return 'recovery';
  return 'login';
}

export function PartnerAuthPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [mode, setMode] = useState<AuthMode>(() => getPartnerAuthInitialMode(window.location.pathname));
  const [profile, setProfile] = useState<PartnerProfile | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryAccessToken, setRecoveryAccessToken] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryCodeVerifier, setRecoveryCodeVerifier] = useState('');
  const [recoveryTokenHash, setRecoveryTokenHash] = useState('');
  const [recoveryTokenType, setRecoveryTokenType] = useState('');
  const [signupConfirming, setSignupConfirming] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '', mobileNumber: '', password: '', confirmPassword: '' });

  useEffect(() => {
    let active = true;
    void fetch('/api/partners/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json() as { authenticated?: boolean; user?: PartnerProfile };
        if (!active) return;
        setProfile(data.authenticated ? data.user ?? null : null);
      })
      .catch(() => {
        if (active) setProfile(null);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('mode') === 'signup' && query.get('confirmed') === '1') {
      window.history.replaceState(window.history.state, '', window.location.pathname);
      const tokenHash = query.get('token_hash');
      const tokenType = query.get('type');
      if (tokenHash && tokenType === 'signup') {
        setSignupConfirming(true);
        void fetch('/api/partners/auth/confirm-signup', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tokenHash, tokenType }),
        })
          .then(async (response) => {
            const data = await response.json() as { message?: string };
            if (!response.ok) throw new Error(data.message || 'Email confirmation could not be completed.');
            setNotice(data.message || 'Email confirmed. You can now sign in.');
          })
          .catch((reason) => {
            setError(reason instanceof Error ? reason.message : 'Email confirmation could not be completed.');
          })
          .finally(() => setSignupConfirming(false));
      } else {
        setNotice('Email confirmed. You can now sign in to your LocalDrop partner account.');
      }
      return;
    }
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = fragment.get('access_token');
    if (accessToken) {
      window.history.replaceState(window.history.state, '', window.location.pathname);
      setRecoveryAccessToken(accessToken);
      setMode('recovery');
      return;
    }
    const searchQuery = new URLSearchParams(window.location.search);
    const recoveryHash = searchQuery.get('token_hash');
    const recoveryType = searchQuery.get('type');
    if (recoveryHash && recoveryType === 'recovery') {
      setRecoveryTokenHash(recoveryHash);
      setRecoveryTokenType(recoveryType);
      setMode('recovery');
      window.history.replaceState(window.history.state, '', window.location.pathname);
      return;
    }
    const code = searchQuery.get('code');
    if (!code) return;
    const verifiers: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith('sb-') || !key.endsWith('-auth-token-code-verifier')) continue;
      const verifier = window.localStorage.getItem(key);
      if (verifier) verifiers.push(verifier);
    }
    const distinct = [...new Set(verifiers)];
    if (distinct.length !== 1) return;
    window.history.replaceState(window.history.state, '', window.location.pathname);
    setRecoveryCode(code);
    setRecoveryCodeVerifier(distinct[0]);
    setMode('recovery');
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let endpoint = '/api/partners/login';
      let body: Record<string, unknown> = { email: form.email, password: form.password };
      if (mode === 'register') {
        endpoint = '/api/partners/register';
        body = form;
      } else if (mode === 'recovery') {
        if (recoveryAccessToken) {
          endpoint = '/api/partners/auth/complete';
          body = {
            accessToken: recoveryAccessToken,
            password: form.password,
            confirmPassword: form.confirmPassword,
          };
        } else if (recoveryTokenHash && recoveryTokenType === 'recovery') {
          endpoint = '/api/partners/auth/complete';
          body = {
            tokenHash: recoveryTokenHash,
            tokenType: recoveryTokenType,
            password: form.password,
            confirmPassword: form.confirmPassword,
          };
        } else if (recoveryCode && recoveryCodeVerifier) {
          endpoint = '/api/partners/auth/complete';
          body = {
            authorizationCode: recoveryCode,
            codeVerifier: recoveryCodeVerifier,
            password: form.password,
            confirmPassword: form.confirmPassword,
          };
        } else {
          endpoint = '/api/partners/auth/recovery';
          body = { email: form.email };
        }
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json() as { authenticated?: boolean; user?: PartnerProfile; message?: string };
      if (!response.ok) throw new Error(data.message || 'The request could not be completed.');
      if (mode === 'login' && data.authenticated) {
        setProfile(data.user ?? null);
      } else if (mode === 'register') {
        setNotice(data.message || 'Account registered. Verify your email before signing in.');
        setMode('login');
        setForm((current) => ({ ...current, password: '', confirmPassword: '' }));
      } else {
        setNotice(data.message || 'If this is a registered partner account, a recovery email has been sent.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The request could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    setError('');
    try {
      await fetch('/api/partners/logout', { method: 'POST', credentials: 'same-origin' });
      setProfile(null);
      setMode('login');
      onNavigate('/partners/portal-preview');
    } catch {
      setError('Sign-out could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return <section className="grid min-h-[60vh] place-items-center"><LoaderCircle className="h-6 w-6 animate-spin" aria-label="Checking partner session" /></section>;
  }

  if (profile) {
    return (
      <Suspense fallback={<section className="grid min-h-[60vh] place-items-center"><LoaderCircle className="h-6 w-6 animate-spin" aria-label="Loading partner workspace" /></section>}>
        <PartnerWorkspace profile={profile} logoutError={error} onLogout={() => void logout()} busy={busy} />
      </Suspense>
    );
  }

  const passwordStrength = form.password.length >= 12 &&
    [/[a-z]/.test(form.password), /[A-Z]/.test(form.password), /\d/.test(form.password), /[^A-Za-z0-9]/.test(form.password)].filter(Boolean).length >= 3;
  const recoveryReady = Boolean(recoveryAccessToken || (recoveryCode && recoveryCodeVerifier) || (recoveryTokenHash && recoveryTokenType === 'recovery'));

  return (
    <section className="grid min-h-[70vh] place-items-center px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-[#DCE3DA] bg-white p-6 shadow-xl sm:p-8">
        <button type="button" onClick={() => onNavigate('/partners/localdrop')} className="inline-flex items-center gap-2 text-xs font-semibold text-[#23734B]"><ArrowLeft className="h-4 w-4" />Back to LocalDrop</button>
        <h1 className="mt-6 text-2xl font-bold">{mode === 'register' ? 'Register as a delivery partner' : mode === 'recovery' ? 'Recover partner password' : 'Partner Login'}</h1>
        <p className="mt-2 text-sm leading-6 text-[#626A63]">{mode === 'register' ? 'Create an email/password partner account.' : mode === 'recovery' ? 'Request a password-reset email.' : 'Sign in to your LocalDrop partner workspace.'}</p>
        {error && <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
        {notice && <div role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
        <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4">
          {mode === 'register' && (
            <>
              <label className="block text-xs font-semibold text-[#626A63]" htmlFor="partner-full-name">Full name</label>
              <input id="partner-full-name" autoComplete="name" required maxLength={80} value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} className="min-h-11 w-full rounded-lg border border-[#DCE3DA] px-3 text-sm" />
              <label className="block text-xs font-semibold text-[#626A63]" htmlFor="partner-mobile">Mobile number</label>
              <input id="partner-mobile" type="tel" autoComplete="tel" required maxLength={24} value={form.mobileNumber} onChange={(event) => setForm((current) => ({ ...current, mobileNumber: event.target.value }))} className="min-h-11 w-full rounded-lg border border-[#DCE3DA] px-3 text-sm" placeholder="+91 98765 43210" />
            </>
          )}
          {!recoveryReady && (
            <>
              <label className="block text-xs font-semibold text-[#626A63]" htmlFor="partner-email">Email address</label>
              <div className="flex items-center gap-2 rounded-lg border border-[#DCE3DA] px-3 focus-within:border-[#23734B]"><Mail className="h-4 w-4 text-[#626A63]" /><input id="partner-email" type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className="min-h-11 min-w-0 flex-1 text-sm outline-none" /></div>
            </>
          )}
          {(mode !== 'recovery' || recoveryReady) && (
            <>
              <label className="block text-xs font-semibold text-[#626A63]" htmlFor="partner-password">{recoveryReady ? 'New password' : 'Password'}</label>
              <div className="flex items-center gap-2 rounded-lg border border-[#DCE3DA] px-3 focus-within:border-[#23734B]"><input id="partner-password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={12} maxLength={200} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} className="min-h-11 min-w-0 flex-1 text-sm outline-none" /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((shown) => !shown)} className="rounded p-1 text-[#626A63]">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
              {(mode === 'register' || recoveryReady) && <>
                <label className="block text-xs font-semibold text-[#626A63]" htmlFor="partner-confirm-password">Confirm password</label>
                <input id="partner-confirm-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={200} value={form.confirmPassword} onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))} className="min-h-11 w-full rounded-lg border border-[#DCE3DA] px-3 text-sm" />
                {form.confirmPassword && form.confirmPassword !== form.password && <p role="alert" className="text-xs text-rose-700">Passwords do not match.</p>}
                <p className="text-[10px] leading-5 text-[#626A63]">Minimum 12 characters with at least three of lowercase, uppercase, number, and symbol.</p>
              </>}
            </>
          )}
          <button type="submit" disabled={busy || ((mode === 'register' || recoveryReady) && (!passwordStrength || form.password !== form.confirmPassword))} className="flex min-h-11 w-full items-center justify-center rounded-xl bg-[#23734B] text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Please wait…' : mode === 'register' ? 'Create partner account' : recoveryReady ? 'Update password' : mode === 'recovery' ? 'Send recovery email' : 'Sign in'}</button>
        </form>
        <div className="mt-5 flex flex-wrap justify-between gap-3 text-xs">
          {mode === 'login' ? <button type="button" onClick={() => setMode('register')} className="font-semibold text-[#23734B]">Register</button> : <button type="button" onClick={() => setMode('login')} className="font-semibold text-[#23734B]">Back to login</button>}
          {mode !== 'recovery' && <button type="button" onClick={() => setMode('recovery')} className="text-[#626A63] underline">Forgot password?</button>}
        </div>
      </section>
    </section>
  );
}
