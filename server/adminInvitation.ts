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
