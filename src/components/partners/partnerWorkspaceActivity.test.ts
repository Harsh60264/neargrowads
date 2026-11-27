import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPartnerWorkspaceActivity } from './partnerWorkspaceActivity';

test('partner activity merges proof, stock, request, damage, and ledger records by latest timestamp', () => {
  const activity = buildPartnerWorkspaceActivity({
    campaigns: [{
      assignmentId: 'assignment-1',
      campaign: { id: 'campaign-1', name: 'Local Signage' },
      sites: [{ id: 'site-1', name: 'GreenCart Mart' }],
    }],
    proofs: [{
      id: 'proof-1', campaign_id: 'campaign-1', site_id: 'site-1',
      business_name: 'GreenCart Mart', delivery_address: '12 Main Road, Noida',
      status: 'pending', submitted_at: '2026-03-05T10:00:00Z',
    }],
    stockHistory: [{
      id: 'stock-1', assignment_id: 'assignment-1', movement_type: 'stock_issued',
      quantity: 12, notes: 'Approved allocation', created_at: '2026-03-02T10:00:00Z',
    }],
    requests: [{
      id: 'request-1', assignment_id: 'assignment-1', request_type: 'additional_stock', details: 'Need more cards',
      status: 'pending', created_at: '2026-03-04T10:00:00Z',
    }],
    damageReports: [{
      id: 'damage-1', assignment_id: 'assignment-1', issue_type: 'unusable', details: 'Chip is unreadable',
      status: 'resolved', created_at: '2026-03-03T10:00:00Z',
    }],
    ledger: [{
      id: 'ledger-1', campaign_id: 'campaign-1', entry_type: 'earning', amount: 150,
      status: 'approved', reference: '', notes: '', created_at: '2026-03-01T10:00:00Z',
    }],
  });

  assert.deepEqual(activity.map(({ type }) => type), [
    'Proof submission',
    'additional stock',
    'Damage report',
    'stock issued',
    'NGA Coins · earning',
  ]);
  assert.equal(activity[0].details, 'GreenCart Mart · 12 Main Road, Noida');
  assert.equal(activity[1].details, 'Local Signage · Need more cards');
  assert.equal(activity[3].details, 'Local Signage · +12 WildCards · Approved allocation');
  assert.equal(activity[4].details, '+150 coins · Local Signage');
});

test('independent delivery and damage records do not require campaign assignments', () => {
  const activity = buildPartnerWorkspaceActivity({
    campaigns: [],
    proofs: [{
      id: 'proof-independent', campaign_id: null, site_id: null,
      business_name: 'Independent Shop', delivery_address: 'Market Street, Noida',
      status: 'pending', submitted_at: '2026-03-05T10:00:00Z',
    }],
    stockHistory: [],
    requests: [],
    damageReports: [{
      id: 'damage-independent', assignment_id: null, issue_type: 'damaged',
      details: 'Card was bent', status: 'pending', created_at: '2026-03-05T11:00:00Z',
    }],
    ledger: [],
  });

  assert.equal(activity[0].details, 'Independent distribution · damaged · Card was bent');
  assert.equal(activity[1].details, 'Independent Shop · Market Street, Noida');
});
