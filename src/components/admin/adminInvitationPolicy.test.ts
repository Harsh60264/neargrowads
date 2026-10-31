import assert from 'node:assert/strict';
import test from 'node:test';
import { canCancelAdminInvitation } from './adminInvitationPolicy';

const activePrimaryOwner = { status: 'active' as const, isPrimaryOwner: true };
const activeDelegatedOwner = { status: 'active' as const, isPrimaryOwner: false };
const pendingDelegatedInvitation = { status: 'pending' as const, isPrimaryOwner: false };

test('active Primary Owner can see cancellation for an eligible pending delegated invitation', () => {
  assert.equal(canCancelAdminInvitation(activePrimaryOwner, pendingDelegatedInvitation), true);
});

test('delegated Co-Owner cannot see invitation cancellation', () => {
  assert.equal(canCancelAdminInvitation(activeDelegatedOwner, pendingDelegatedInvitation), false);
});

test('invitation cancellation is hidden for inactive actors and ineligible targets', () => {
  assert.equal(canCancelAdminInvitation(
    { status: 'disabled', isPrimaryOwner: true },
    pendingDelegatedInvitation,
  ), false);
  assert.equal(canCancelAdminInvitation(activePrimaryOwner, {
    status: 'active',
    isPrimaryOwner: false,
  }), false);
  assert.equal(canCancelAdminInvitation(activePrimaryOwner, {
    status: 'pending',
    isPrimaryOwner: true,
  }), false);
  assert.equal(canCancelAdminInvitation(activePrimaryOwner, {
    status: 'pending',
    isPrimaryOwner: false,
    archivedAt: '2026-10-31T00:00:00.000Z',
  }), false);
});
