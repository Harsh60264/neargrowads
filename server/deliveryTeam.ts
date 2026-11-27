import type { AdminPermissions } from '../shared/adminPermissions';

export type DeliveryTeamAction = 'view' | 'create' | 'edit';

export function uniqueNonEmptyIds(values: readonly (string | null | undefined)[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export interface DeliveryTeamAdministrator {
  role: string;
  status: string;
  permissions: AdminPermissions;
}

export interface DeliveryTeamCoinEntry {
  entry_type: 'earning' | 'withdrawal' | 'adjustment';
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'requested' | 'settled';
}

export interface DeliveryTeamStockMovement {
  movement_type: 'issued' | 'distributed' | 'adjusted' | 'returned';
  quantity: number;
}

export function canAccessDeliveryTeam(
  administrator: DeliveryTeamAdministrator,
  action: DeliveryTeamAction,
): boolean {
  if (administrator.status !== 'active') return false;
  if (administrator.role === 'owner') return true;
  const permissions = administrator.permissions.deliveryTeam;
  if (action !== 'view' && permissions?.view !== true) return false;
  return permissions?.[action] === true;
}

export function calculateAvailableCoins(entries: readonly DeliveryTeamCoinEntry[]): number {
  return entries.reduce((balance, entry) => {
    if (!Number.isSafeInteger(entry.amount)) return balance;
    if (entry.entry_type === 'earning' && (entry.status === 'approved' || entry.status === 'settled')) {
      return balance + entry.amount;
    }
    if (entry.entry_type === 'adjustment' && entry.status === 'approved') {
      return balance + entry.amount;
    }
    if (entry.entry_type === 'withdrawal' &&
      (entry.status === 'requested' || entry.status === 'settled')) {
      return balance + entry.amount;
    }
    return balance;
  }, 0);
}

export function calculatePartnerStock(movements: readonly DeliveryTeamStockMovement[]): {
  available: number;
  issued: number;
  distributed: number;
  returned: number;
  adjusted: number;
} {
  return movements.reduce((totals, movement) => {
    if (!Number.isSafeInteger(movement.quantity)) return totals;
    totals.available += movement.quantity;
    if (movement.movement_type === 'issued' && movement.quantity > 0) totals.issued += movement.quantity;
    if (movement.movement_type === 'distributed' && movement.quantity < 0) totals.distributed += -movement.quantity;
    if (movement.movement_type === 'returned' && movement.quantity < 0) totals.returned += -movement.quantity;
    if (movement.movement_type === 'adjusted') totals.adjusted += movement.quantity;
    return totals;
  }, { available: 0, issued: 0, distributed: 0, returned: 0, adjusted: 0 });
}

export function validateManualCoinAdjustment(value: unknown): {
  amount: number;
  reason: string;
  idempotencyKey: string;
} | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const amount = input.amount;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount === 0 ||
    Math.abs(amount) > 100_000_000 || reason.length < 3 || reason.length > 500 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    return undefined;
  }
  return { amount, reason, idempotencyKey };
}

export function parseDeliveryTeamPagination(searchParams: URLSearchParams): {
  search: string;
  status: 'all' | 'active' | 'pending' | 'disabled';
  page: number;
  pageSize: number;
} {
  const rawPage = Number(searchParams.get('page') || 1);
  const rawPageSize = Number(searchParams.get('pageSize') || 20);
  const rawStatus = searchParams.get('status');
  const status = rawStatus === 'active' || rawStatus === 'pending' || rawStatus === 'disabled'
    ? rawStatus : 'all';
  return {
    search: (searchParams.get('search') || '').trim().slice(0, 100),
    status,
    page: Number.isSafeInteger(rawPage) ? Math.min(100_000, Math.max(1, rawPage)) : 1,
    pageSize: Number.isSafeInteger(rawPageSize) ? Math.min(100, Math.max(1, rawPageSize)) : 20,
  };
}
