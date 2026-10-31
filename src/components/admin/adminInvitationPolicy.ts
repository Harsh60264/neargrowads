export interface AdminInvitationCancellationActor {
  status: 'pending' | 'active' | 'disabled';
  isPrimaryOwner: boolean;
}

export interface AdminInvitationCancellationTarget {
  status: 'pending' | 'active' | 'disabled';
  isPrimaryOwner: boolean;
  archivedAt?: string | null;
}

export function canCancelAdminInvitation(
  actor: AdminInvitationCancellationActor | undefined,
  target: AdminInvitationCancellationTarget,
): boolean {
  return actor?.status === 'active' &&
    actor.isPrimaryOwner &&
    target.status === 'pending' &&
    !target.isPrimaryOwner &&
    !target.archivedAt;
}
