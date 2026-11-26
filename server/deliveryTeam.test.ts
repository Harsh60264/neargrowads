import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  calculateAvailableCoins,
  calculatePartnerStock,
  canAccessDeliveryTeam,
  parseDeliveryTeamPagination,
  validateManualCoinAdjustment,
} from './deliveryTeam';

test('Delivery Team view and mutation permissions require active explicit grants for non-owners', () => {
  const limitedAdmin = {
    role: 'custom_admin',
    status: 'active',
    permissions: { deliveryTeam: { view: true, edit: true } },
  };
  assert.equal(canAccessDeliveryTeam(limitedAdmin, 'view'), true);
  assert.equal(canAccessDeliveryTeam(limitedAdmin, 'edit'), true);
  assert.equal(canAccessDeliveryTeam(limitedAdmin, 'create'), false);
  assert.equal(canAccessDeliveryTeam({ ...limitedAdmin, status: 'disabled' }, 'view'), false);
  assert.equal(canAccessDeliveryTeam({
    role: 'custom_admin', status: 'active', permissions: { deliveryTeam: { edit: true } },
  }, 'edit'), false);
  assert.equal(canAccessDeliveryTeam({
    role: 'owner', status: 'active', permissions: {},
  }, 'create'), true);
});

test('available NGA Coins include approved manual adjustments and preserve withdrawal reservations', () => {
  assert.equal(calculateAvailableCoins([
    { entry_type: 'earning', amount: 150_000, status: 'approved' },
    { entry_type: 'earning', amount: 4_000, status: 'pending' },
    { entry_type: 'adjustment', amount: -20_000, status: 'approved' },
    { entry_type: 'withdrawal', amount: -100_000, status: 'requested' },
    { entry_type: 'withdrawal', amount: -5_000, status: 'rejected' },
  ]), 30_000);
});

test('physical stock totals distinguish issued, distributed, returned and adjusted movements', () => {
  assert.deepEqual(calculatePartnerStock([
    { movement_type: 'issued', quantity: 40 },
    { movement_type: 'distributed', quantity: -7 },
    { movement_type: 'returned', quantity: -3 },
    { movement_type: 'adjusted', quantity: -2 },
  ]), {
    available: 28,
    issued: 40,
    distributed: 7,
    returned: 3,
    adjusted: -2,
  });
});

test('manual coin adjustments require a reason, nonzero bounded integer and UUID idempotency key', () => {
  const valid = {
    amount: -250,
    reason: 'Correcting a verified ledger entry',
    idempotencyKey: '32f18176-7157-43dd-9a9d-b23090aa8b73',
  };
  assert.deepEqual(validateManualCoinAdjustment(valid), valid);
  assert.equal(validateManualCoinAdjustment({ ...valid, amount: 0 }), undefined);
  assert.equal(validateManualCoinAdjustment({ ...valid, reason: '  ' }), undefined);
  assert.equal(validateManualCoinAdjustment({ ...valid, idempotencyKey: 'not-a-uuid' }), undefined);
  assert.equal(validateManualCoinAdjustment({ ...valid, amount: Number.MAX_SAFE_INTEGER }), undefined);
});

test('partner list pagination is bounded and malformed parameters fall back safely', () => {
  const parsed = parseDeliveryTeamPagination(new URLSearchParams({
    search: '  WildCard ',
    status: 'disabled',
    page: '-2',
    pageSize: '999',
  }));
  assert.deepEqual(parsed, { search: 'WildCard', status: 'disabled', page: 1, pageSize: 100 });
  assert.deepEqual(parseDeliveryTeamPagination(new URLSearchParams({
    status: 'root', page: 'invalid', pageSize: '0',
  })), { search: '', status: 'all', page: 1, pageSize: 1 });
});

test('Delivery Team migration keeps partner tables private and makes administrative writes atomic and auditable', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261127120000_admin_delivery_team_management.sql', import.meta.url), 'utf8');
  assert.match(migration, /alter table public\.delivery_team_activity enable row level security/i);
  assert.match(migration, /revoke all on public\.delivery_team_activity from public, anon, authenticated/i);
  assert.match(migration, /create or replace function public\.admin_adjust_partner_coins[\s\S]*?for update[\s\S]*?idempotency_key[\s\S]*?admin_previous_balance[\s\S]*?admin_resulting_balance/i);
  assert.match(migration, /create or replace function public\.admin_manage_partner_stock[\s\S]*?for update[\s\S]*?resulting_balance < 0/i);
  assert.match(migration, /create or replace function public\.assert_delivery_team_admin[\s\S]*?a\.permissions -> 'deliveryTeam' ->> 'view' = 'true'/i);
  assert.match(migration, /revoke all on function public\.admin_adjust_partner_coins[\s\S]*?from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.admin_adjust_partner_coins[\s\S]*?to service_role/i);
  assert.match(migration, /p_amount < 100000[\s\S]*?The minimum withdrawal is 100000 NGA Coins/i);
});
