import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, Headset, LoaderCircle, Megaphone, UserRound } from 'lucide-react';
import { NearGrowLogo } from '../brand/NearGrowLogo';
import type { PartnerProfile } from './partnerTypes';
import { PartnerLocationCapture } from './PartnerLocationCapture';
import { INDIAN_STATES_AND_UNION_TERRITORIES } from '../../../shared/indianStates';
import type { PartnerLocationSubmission } from '../../../shared/partnerLocation';

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
  const [registrationLocation, setRegistrationLocation] = useState<PartnerLocationSubmission | null>(null);
  const [locationResetKey, setLocationResetKey] = useState(0);
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    mobileNumber: '',
    state: '',
    preferredDeliveryAreas: '',
    password: '',
    confirmPassword: '',
  });

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
        body = { ...form, registrationLocation };
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
        setForm((current) => ({
          ...current,
          fullName: '',
          mobileNumber: '',
          state: '',
          preferredDeliveryAreas: '',
          password: '',
          confirmPassword: '',
        }));
        setRegistrationLocation(null);
        setLocationResetKey((current) => current + 1);
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
  const showCardDescription = Boolean((profile && isLoginRoute) || mode === 'register' || mode === 'recovery');

  return (
    <section className="partner-auth-page">
      <div className="wc-login-stage">
        <div className="wc-login-grid">
        <section className="wc-login-intro" aria-labelledby="partner-login-title">
          <img className="wc-login-art" src="/images/wildcard/partner-card.webp" alt="" width={397} height={264} />
          <h1 id="partner-login-title">Welcome to<br />NearGrow <span>WildCard</span></h1>
          <p className="partner-auth-subtitle">Your partner workspace starts here.</p>
          <ul className="partner-auth-benefits">
            <li><UserRound aria-hidden="true" /><span>View your<br />profile</span></li>
            <li><Megaphone aria-hidden="true" /><span>Track your<br />deliveries</span></li>
            <li><Headset aria-hidden="true" /><span>Get<br />support</span></li>
          </ul>
        </section>

        <section className="wc-login-card" aria-label="Partner account">
          <NearGrowLogo size="lg" className="partner-auth-card-logo" />
          <h2 className={showCardDescription ? 'has-description' : undefined}>{mode === 'register' ? 'Create account' : mode === 'recovery' ? (recoveryReady ? 'Set new password' : 'Forgot password?') : 'Partner login'}</h2>
          {showCardDescription && (
            <p className={`partner-auth-card-description${profile && isLoginRoute ? ' is-signed-in' : ''}`} role={profile && isLoginRoute ? 'status' : undefined}>
              {profile && isLoginRoute ? (
                <a href="/partners/dashboard" onClick={(event) => { event.preventDefault(); onNavigate('/partners/dashboard'); }}>Go to dashboard <ArrowRight aria-hidden="true" /></a>
              ) : mode === 'register' ? 'Create your NearGrow WildCard partner account.' : 'Recover access to your partner account.'}
            </p>
          )}

          {mode !== 'recovery' && (
            <div className="partner-auth-tabs" role="tablist" aria-label="Partner account options">
              <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setError(''); setNotice(''); }}>Sign in</button>
              <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); setError(''); setNotice(''); }}>Create account</button>
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
                <label htmlFor="partner-state">State / Union Territory</label>
                <select id="partner-state" autoComplete="address-level1" required value={form.state}
                  onChange={(event) => setForm((current) => ({ ...current, state: event.target.value }))}>
                  <option value="">Select your state or union territory</option>
                  {INDIAN_STATES_AND_UNION_TERRITORIES.map((state) => <option key={state} value={state}>{state}</option>)}
                </select>
                <PartnerLocationCapture
                  key={locationResetKey}
                  idPrefix="partner-registration-location"
                  title="Registration location (optional)"
                  endpoint="/api/partners/registration-reverse-geocode"
                  value={registrationLocation}
                  onChange={setRegistrationLocation}
                  consentRequired
                  onDetectedState={(detectedState) => setForm((current) => ({ ...current, state: detectedState }))}
                />
                <label htmlFor="partner-preferred-delivery-areas">Preferred delivery areas (optional)</label>
                <input id="partner-preferred-delivery-areas" maxLength={2000}
                  value={form.preferredDeliveryAreas}
                  onChange={(event) => setForm((current) => ({ ...current, preferredDeliveryAreas: event.target.value }))}
                  placeholder="e.g. Tilak Nagar, Janakpuri, Uttam Nagar" />
                <small className="partner-auth-field-hint">You can update your preferred delivery areas anytime from your profile.</small>
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
      </div>
      <footer className="partner-auth-footer">NearGrow Ads <span aria-hidden="true">·</span> <a href="mailto:info@neargrowads.in">Partner support</a></footer>
    </section>
  );
}
