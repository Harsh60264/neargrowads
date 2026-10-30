export interface AdminInvitationIdentity {
  id: string;
  email: string;
  role: 'owner' | 'super_admin' | 'custom_admin';
  status: 'pending' | 'active' | 'disabled';
  isPrimaryOwner: boolean;
  mustChangePassword?: boolean;
}

export interface VerifiedAdminAuthUser {
  id?: string;
  email?: string;
  email_confirmed_at?: string;
}

export type AdminInvitationCompletionDecision = 'complete' | 'already_accepted' | 'reject';
export type AdminInvitationRecoveryMethod = 'signup' | 'password_recovery' | 'reject';

export function decideAdminInvitationRecovery(
  identity: AdminInvitationIdentity | undefined,
  authUser: VerifiedAdminAuthUser,
): AdminInvitationRecoveryMethod {
  if (!identity || !authUser.id || !authUser.email ||
    identity.id !== authUser.id || identity.email !== authUser.email.toLowerCase() ||
    identity.isPrimaryOwner || (identity.status !== 'pending' && identity.status !== 'disabled')) {
    return 'reject';
  }
  return authUser.email_confirmed_at ? 'password_recovery' : 'signup';
}

export function buildAdminInvitationRedirect(
  siteUrl: string,
  mode: 'invite' | 'recovery',
  generation: string,
  temporaryCredential = false,
): string {
  const redirect = new URL('/admin/accept-invite', siteUrl);
  redirect.searchParams.set('mode', mode);
  redirect.searchParams.set('invitation_generation', generation);
  if (temporaryCredential) redirect.searchParams.set('setup', 'temporary');
  return redirect.toString();
}

export function buildAdminPasswordResetRedirect(siteUrl: string): string {
  const redirect = new URL('/admin/password-reset', siteUrl);
  redirect.searchParams.set('mode', 'recovery');
  return redirect.toString();
}

export function decideAdminInvitationCompletion(
  identity: AdminInvitationIdentity | undefined,
  authUser: VerifiedAdminAuthUser,
  acceptedEventExists = false,
): AdminInvitationCompletionDecision {
  if (!identity || !authUser.id || !authUser.email || !authUser.email_confirmed_at ||
    identity.id !== authUser.id || identity.email !== authUser.email.toLowerCase() ||
    identity.isPrimaryOwner) return 'reject';
  if (identity.status === 'pending') return 'complete';
  if (identity.status === 'active' && acceptedEventExists) return 'already_accepted';
  return 'reject';
}
