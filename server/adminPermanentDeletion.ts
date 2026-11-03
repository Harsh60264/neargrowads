export interface AdminPermanentDeletionTarget {
  id: string;
  role: string;
  status: string;
  isPrimaryOwner: boolean;
  archivedAt?: string | null;
  wasRemoved: boolean;
  ownershipTransferCount: number;
}

export interface AdminPermanentDeletionActor {
  id: string;
  isPrimaryOwner: boolean;
}

export interface AdminAuthIdentity {
  id: string;
  email: string;
}

export type AdminAuthCleanupDecision = 'delete-auth-user' | 'finalize' | 'identity-conflict';

export function canPermanentlyDeleteAdmin(
  actor: AdminPermanentDeletionActor,
  target: AdminPermanentDeletionTarget,
): boolean {
  const recoverableState = Boolean(target.archivedAt) || target.wasRemoved;
  return actor.isPrimaryOwner &&
    actor.id !== target.id &&
    target.role !== 'owner' &&
    !target.isPrimaryOwner &&
    target.status === 'disabled' &&
    recoverableState &&
    target.ownershipTransferCount === 0;
}

export function isPermanentDeletionConfirmationValid(
  targetEmail: string,
  typedEmail: unknown,
  confirmation: unknown,
): boolean {
  return typeof typedEmail === 'string' &&
    typedEmail.trim().toLowerCase() === targetEmail.toLowerCase() &&
    confirmation === 'DELETE';
}

export function decideAdminAuthCleanup(
  targetId: string,
  targetEmail: string,
  identityById: AdminAuthIdentity | undefined,
  identityByEmail: AdminAuthIdentity | undefined,
): AdminAuthCleanupDecision {
  const normalizedEmail = targetEmail.toLowerCase();
  if (identityByEmail && identityByEmail.id !== targetId) return 'identity-conflict';
  if (identityById && (identityById.id !== targetId || identityById.email.toLowerCase() !== normalizedEmail)) {
    return 'identity-conflict';
  }
  if (identityById) return 'delete-auth-user';
  if (identityByEmail) return 'identity-conflict';
  return 'finalize';
}
