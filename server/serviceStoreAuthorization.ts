import type { AdminAction, AdminPermissions } from '../shared/adminPermissions.ts';

export function serviceStoreAdminAction(pathName: string, method: string): AdminAction | undefined {
  if (pathName === '/orders' && method === 'GET') return 'view';
  if (/^\/orders\/[^/]+\/fulfillment$/.test(pathName) && method === 'PATCH') return 'edit';
  if (/^\/payment-settings(?:\/(?:history|verify|gateway|cashfree|settlement-change))?$/.test(pathName)) {
    return method === 'GET' ? 'view' : 'edit';
  }
  return undefined;
}

export function canAccessServiceStoreAction(
  role: string,
  permissions: AdminPermissions,
  action: AdminAction,
): boolean {
  if (role === 'owner') return true;
  if (action !== 'view' && permissions.serviceStore?.view !== true) return false;
  return permissions.serviceStore?.[action] === true;
}
