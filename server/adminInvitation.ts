export interface AdminInvitationIdentity {
  id: string;
  email: string;
  role: 'owner' | 'super_admin' | 'custom_admin';
  status: 'pending' | 'active' | 'disabled';
  isPrimaryOwner: boolean;
  mustChangePassword?: boolean;
  archivedAt?: string | null;
}

export interface VerifiedAdminAuthUser {
  id?: string;
  email?: string;
  email_confirmed_at?: string;
}

export type AdminInvitationCompletionDecision = 'complete' | 'already_accepted' | 'reject';
export type AdminInvitationRecoveryMethod = 'signup' | 'password_recovery' | 'reject';

export interface AdminRecoveryCompletionProof {
  accessToken?: unknown;
  authorizationCode?: unknown;
  codeVerifier?: unknown;
  tokenHash?: unknown;
  tokenType?: unknown;
}

export interface PendingAdminInvitationGeneration {
  id?: unknown;
  email?: unknown;
  invitation_generation?: unknown;
  status?: unknown;
  is_primary_owner?: unknown;
}

export interface AdminRecoveryGeneration {
  id?: unknown;
  email?: unknown;
  invitation_generation?: unknown;
  status?: unknown;
  is_primary_owner?: unknown;
  archived_at?: unknown;
}

export function hasPurposeBoundAdminRecoveryProof(proof: AdminRecoveryCompletionProof): boolean {
  return proof.accessToken === undefined &&
    proof.authorizationCode === undefined &&
    proof.codeVerifier === undefined &&
    typeof proof.tokenHash === 'string' &&
    proof.tokenHash.length >= 20 &&
    proof.tokenHash.length <= 2_000 &&
    proof.tokenType === 'recovery';
}

export function isValidAdminInvitationGeneration(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isCurrentPendingAdminInvitation(
  invitation: PendingAdminInvitationGeneration | undefined,
  generation: string,
): invitation is PendingAdminInvitationGeneration & {
  id: string;
  email: string;
  invitation_generation: string;
  status: 'pending';
  is_primary_owner: false;
} {
  return Boolean(invitation &&
    typeof invitation.id === 'string' &&
    invitation.id.length > 0 &&
    typeof invitation.email === 'string' &&
    invitation.email.trim().length > 0 &&
    invitation.invitation_generation === generation &&
    invitation.status === 'pending' &&
    invitation.is_primary_owner === false);
}

export function isCurrentAdminRecoveryGeneration(
  recovery: AdminRecoveryGeneration | undefined,
  generation: string,
): recovery is AdminRecoveryGeneration & {
  id: string;
  email: string;
  invitation_generation: string;
  status: 'pending' | 'active';
  is_primary_owner: boolean;
  archived_at: null;
} {
  return Boolean(recovery &&
    typeof recovery.id === 'string' &&
    recovery.id.length > 0 &&
    typeof recovery.email === 'string' &&
    recovery.email.trim().length > 0 &&
    recovery.invitation_generation === generation &&
    (recovery.status === 'pending' || recovery.status === 'active') &&
    typeof recovery.is_primary_owner === 'boolean' &&
    recovery.archived_at === null &&
    (recovery.status !== 'pending' || recovery.is_primary_owner === false));
}

export function canCompleteAdminPasswordRecovery(
  identity: AdminInvitationIdentity | undefined,
  authUser: VerifiedAdminAuthUser,
  recoveryGeneration?: AdminRecoveryGeneration,
  invitationGeneration?: string,
): boolean {
  if (!identity || !authUser.id || !authUser.email || !authUser.email_confirmed_at ||
    identity.id !== authUser.id || identity.email !== authUser.email.toLowerCase() ||
    identity.status === 'disabled' || identity.archivedAt) {
    return false;
  }
  if (!isValidAdminInvitationGeneration(invitationGeneration) ||
    !isCurrentAdminRecoveryGeneration(recoveryGeneration, invitationGeneration) ||
    recoveryGeneration.id !== identity.id ||
    recoveryGeneration.email.toLowerCase() !== identity.email.toLowerCase() ||
    recoveryGeneration.status !== identity.status ||
    recoveryGeneration.is_primary_owner !== identity.isPrimaryOwner) {
    return false;
  }
  if (identity.status === 'active') return true;
  if (identity.status !== 'pending' || identity.isPrimaryOwner ||
    !isValidAdminInvitationGeneration(invitationGeneration) ||
    recoveryGeneration.status !== 'pending') {
    return false;
  }
  return true;
}

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

export function buildAdminPasswordResetRedirect(siteUrl: string, generation: string): string {
  const redirect = new URL('/admin/password-reset', siteUrl);
  redirect.searchParams.set('mode', 'recovery');
  redirect.searchParams.set('invitation_generation', generation);
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
