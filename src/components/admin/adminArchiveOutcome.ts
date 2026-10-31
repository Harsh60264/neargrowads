export const ADMIN_ARCHIVE_PARTIAL_SUCCESS_MESSAGE =
  'CMS access removed. Supabase Auth global session revocation could not be confirmed';

export interface AdminArchiveResponse {
  status: 'success' | 'partial_success' | 'failure';
  cmsAccess: 'removed' | 'unchanged';
  authSessionRevocation: 'confirmed' | 'not_confirmed' | 'not_attempted';
  message: string;
}

export interface AdminArchiveOutcome {
  message: string;
  warning: boolean;
}

export function getAdminArchiveOutcome(response: AdminArchiveResponse): AdminArchiveOutcome {
  if (response.status === 'failure') {
    throw new Error(response.message);
  }

  if (response.status === 'success' &&
    response.cmsAccess === 'removed' &&
    response.authSessionRevocation === 'confirmed') {
    return { message: response.message, warning: false };
  }

  if (response.status === 'partial_success' &&
    response.cmsAccess === 'removed' &&
    response.authSessionRevocation === 'not_confirmed') {
    return { message: ADMIN_ARCHIVE_PARTIAL_SUCCESS_MESSAGE, warning: true };
  }

  throw new Error('The administrator archive result could not be confirmed. Refresh account history before retrying.');
}
