import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePartnerProfileUpdate,
  parsePartnerProofPhoto,
  summarizePartnerCoins,
} from './partnerWorkspace';

test('proof photos accept supported image data within the private-storage limit', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const parsed = parsePartnerProofPhoto(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
  assert.equal(parsed?.contentType, 'image/jpeg');
  assert.deepEqual(parsed?.bytes, jpeg);
  assert.equal(parsePartnerProofPhoto(`data:image/png;base64,${Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]).toString('base64')}`)?.contentType, 'image/png');
  assert.equal(parsePartnerProofPhoto(`data:image/webp;base64,${Buffer.from('RIFF0000WEBP').toString('base64')}`)?.contentType, 'image/webp');
  assert.equal(parsePartnerProofPhoto('data:text/plain;base64,YQ=='), undefined);
  assert.equal(parsePartnerProofPhoto('data:image/jpeg;base64,YQ==!'), undefined);
  assert.equal(parsePartnerProofPhoto(`data:image/jpeg;base64,${Buffer.from('not an image').toString('base64')}`), undefined);
  assert.equal(parsePartnerProofPhoto(`data:image/jpeg;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')}`), undefined);
});

test('partner profile edits normalize the name and phone and reject invalid values', () => {
  assert.deepEqual(normalizePartnerProfileUpdate({
    fullName: '  Harsh   Kumar ',
    mobileNumber: '+91 (98765) 43210',
  }), {
    fullName: 'Harsh Kumar',
    mobileNumber: '+919876543210',
  });
  assert.equal(normalizePartnerProfileUpdate({ fullName: 'H', mobileNumber: '123' }), undefined);
});

test('partner profile edits save optional Indian state and preferred areas without requiring legacy partners to set a state', () => {
  assert.deepEqual(normalizePartnerProfileUpdate({
    fullName: '  Harsh   Kumar ',
    mobileNumber: '+91 (98765) 43210',
  }), {
    fullName: 'Harsh Kumar',
    mobileNumber: '+919876543210',
  });
  assert.deepEqual(normalizePartnerProfileUpdate({
    fullName: 'Harsh Kumar',
    mobileNumber: '+919876543210',
    state: ' ',
    preferredDeliveryAreas: 'Tilak Nagar, Janakpuri, Tilak Nagar',
  }), {
    fullName: 'Harsh Kumar',
    mobileNumber: '+919876543210',
    state: null,
    preferredDeliveryAreas: ['Tilak Nagar', 'Janakpuri'],
  });
  assert.equal(normalizePartnerProfileUpdate({
    fullName: 'Harsh Kumar',
    mobileNumber: '+919876543210',
    state: 'California',
    preferredDeliveryAreas: '',
  }), undefined);
});

test('coin summary counts approved proof once and reserves requested withdrawals', () => {
  assert.deepEqual(summarizePartnerCoins([
    { entry_type: 'earning', amount: 1500, status: 'approved' },
    { entry_type: 'earning', amount: 500, status: 'pending' },
    { entry_type: 'earning', amount: 300, status: 'rejected' },
    { entry_type: 'withdrawal', amount: -1000, status: 'requested' },
    { entry_type: 'withdrawal', amount: -250, status: 'settled' },
  ]), {
    balance: 250,
    totalEarned: 1500,
    totalWithdrawn: 250,
    pendingApproval: 500,
  });
});

test('approved administrator adjustments change available coins without rewriting earnings', () => {
  assert.deepEqual(summarizePartnerCoins([
    { entry_type: 'earning', amount: 25_000, status: 'approved' },
    { entry_type: 'adjustment', amount: -5_000, status: 'approved' },
    { entry_type: 'adjustment', amount: 9_000, status: 'pending' },
    { entry_type: 'withdrawal', amount: -10_000, status: 'requested' },
  ]), {
    balance: 10_000,
    totalEarned: 25_000,
    totalWithdrawn: 0,
    pendingApproval: 0,
  });
});
