import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, Headset, LoaderCircle, Megaphone, UserRound } from 'lucide-react';
import { NearGrowLogo } from '../brand/NearGrowLogo';
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
        setNotice('Email confirmed. You can now sign in to your NearGrow WildCard partner account.');
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
        onNavigate('/partners/dashboard');
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

  const isLoginRoute = (window.location.pathname.replace(/\/+$/, '') || '/') === '/partners/login';

  if (profile && !isLoginRoute) {
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
    <section className="partner-auth-page">
      <div className="partner-auth-layout">
        <section className="partner-auth-intro" aria-labelledby="partner-login-title">
          <div className="partner-auth-illustration" aria-hidden="true">
            <svg viewBox="0 0 520 250" role="presentation">
              <ellipse cx="260" cy="214" rx="165" ry="15" fill="currentColor" opacity=".09" />
              <path d="M92 207C69 169 73 120 103 83M420 212c22-37 18-88-12-123" fill="none" stroke="#7BAA68" strokeWidth="3" strokeLinecap="round" />
              <g fill="#78A95E">
                <ellipse cx="85" cy="155" rx="22" ry="10" transform="rotate(-38 85 155)" />
                <ellipse cx="108" cy="126" rx="23" ry="10" transform="rotate(24 108 126)" />
                <ellipse cx="105" cy="91" rx="22" ry="10" transform="rotate(-35 105 91)" />
                <ellipse cx="434" cy="164" rx="22" ry="10" transform="rotate(38 434 164)" />
                <ellipse cx="411" cy="135" rx="23" ry="10" transform="rotate(-24 411 135)" />
                <ellipse cx="414" cy="100" rx="22" ry="10" transform="rotate(35 414 100)" />
              </g>
              <g transform="rotate(-7 260 143)">
                <rect x="142" y="91" width="236" height="117" rx="17" fill="#FCFFF8" stroke="#BDD0B6" strokeWidth="3" />
                <path d="M143 174c61-6 97 12 141 31 30 13 61 10 94-7v-17H143z" fill="#1C7048" />
                <path d="M142 188c49-13 81-2 111 14H158c-8-2-13-7-16-14z" fill="#378A50" />
                <g transform="translate(220 110)">
                  <path d="M15 24C5 12 8 4 15 1c7 5 7 15 0 23zm8-1c0-14 8-20 15-17 1 9-5 16-15 17zm-12 2C-1 25-4 18 0 12c8 2 12 7 11 13z" fill="#57A947" />
                  <text x="19" y="43" textAnchor="middle" fill="#163A2A" fontSize="12" fontWeight="700">NearGrow</text>
                  <text x="19" y="61" textAnchor="middle" fill="#163A2A" fontSize="19" fontWeight="800">WildCard</text>
                </g>
              </g>
              <path d="m193 57 7-20m13 24 11-17m4 27 16-10" fill="none" stroke="#73A35F" strokeWidth="4" strokeLinecap="round" />
            </svg>
          </div>
          <p className="partner-auth-eyebrow">NearGrow WildCard</p>
          <h1 id="partner-login-title">Welcome to<br />NearGrow <span>WildCard</span></h1>
          <p className="partner-auth-subtitle">Your partner workspace starts here.</p>
          <ul className="partner-auth-benefits">
            <li><UserRound aria-hidden="true" /><span>View your<br />profile</span></li>
            <li><Megaphone aria-hidden="true" /><span>Check campaign<br />updates</span></li>
            <li><Headset aria-hidden="true" /><span>Get<br />support</span></li>
          </ul>
        </section>

        <section className="partner-auth-card" aria-label="Partner account">
          <NearGrowLogo size="md" className="partner-auth-card-logo" />
          <h2>{mode === 'register' ? 'Create account' : mode === 'recovery' ? (recoveryReady ? 'Set new password' : 'Forgot password?') : 'Partner login'}</h2>
          <p className="partner-auth-card-description">
            {mode === 'register' ? 'Create your NearGrow WildCard partner account.' : mode === 'recovery' ? 'Recover access to your partner account.' : 'Sign in to your NearGrow WildCard partner workspace.'}
          </p>

          {mode !== 'recovery' && (
            <div className="partner-auth-tabs" role="tablist" aria-label="Partner account options">
              <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setError(''); setNotice(''); }}>Sign in</button>
              <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); setError(''); setNotice(''); }}>Create account</button>
            </div>
          )}

          {profile && isLoginRoute && (
            <div className="partner-auth-signed-in" role="status">
              You’re already signed in.
              <a href="/partners/dashboard" onClick={(event) => { event.preventDefault(); onNavigate('/partners/dashboard'); }}>Go to dashboard <ArrowRight aria-hidden="true" /></a>
            </div>
          )}
          {error && <div role="alert" className="partner-auth-message is-error">{error}</div>}
          {notice && <div role="status" className="partner-auth-message is-success">{notice}</div>}

          <form onSubmit={(event) => void submit(event)} className="partner-auth-form">
            {mode === 'register' && (
              <>
                <label htmlFor="partner-full-name">Full name</label>
                <input id="partner-full-name" autoComplete="name" required maxLength={80} value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} />
                <label htmlFor="partner-mobile">Mobile number</label>
                <input id="partner-mobile" type="tel" autoComplete="tel" required maxLength={24} value={form.mobileNumber} onChange={(event) => setForm((current) => ({ ...current, mobileNumber: event.target.value }))} />
              </>
            )}
            {!recoveryReady && (
              <>
                <label htmlFor="partner-email">Email address</label>
                <input id="partner-email" type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
              </>
            )}
            {(mode !== 'recovery' || recoveryReady) && (
              <>
                <label htmlFor="partner-password">{recoveryReady ? 'New password' : 'Password'}</label>
                <div className="partner-auth-password">
                  <input id="partner-password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'register' || recoveryReady ? 'new-password' : 'current-password'} required minLength={12} maxLength={200} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
                  <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
                </div>
                {(mode === 'register' || recoveryReady) && (
                  <>
                    <label htmlFor="partner-confirm-password">Confirm password</label>
                    <input id="partner-confirm-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={200} value={form.confirmPassword} onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))} />
                    {form.confirmPassword && form.confirmPassword !== form.password && <p role="alert" className="partner-auth-inline-error">Passwords do not match.</p>}
                    <p className="partner-auth-password-hint">Minimum 12 characters with at least three of lowercase, uppercase, number, and symbol.</p>
                  </>
                )}
              </>
            )}
            {mode === 'login' && (
              <button type="button" className="partner-auth-forgot" onClick={() => { setMode('recovery'); setError(''); setNotice(''); }}>Forgot password?</button>
            )}
            <button type="submit" disabled={busy || ((mode === 'register' || recoveryReady) && (!passwordStrength || form.password !== form.confirmPassword))}>
              {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : recoveryReady ? 'Update password' : mode === 'recovery' ? 'Send recovery email' : 'Sign in'}
            </button>
          </form>
          <p className="partner-auth-card-footer">
            {mode === 'recovery'
              ? <button type="button" onClick={() => { setMode('login'); setError(''); setNotice(''); }}>Back to sign in</button>
              : mode === 'register'
                ? <>Already a partner? <button type="button" onClick={() => { setMode('login'); setError(''); setNotice(''); }}>Sign in</button></>
                : <>New partner? <button type="button" onClick={() => { setMode('register'); setError(''); setNotice(''); }}>Create an account</button></>}
          </p>
        </section>
      </div>
      <footer className="partner-auth-footer">NearGrow Ads <span aria-hidden="true">·</span> <a href="mailto:info@neargrowads.in">Partner support</a></footer>
    </section>
  );
}
