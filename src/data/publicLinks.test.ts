import assert from 'node:assert/strict';
import test from 'node:test';
import { isSafePublicDestination } from './publicLinks';

test('allows the public GMB Audit route as an internal CMS destination', () => {
  assert.equal(isSafePublicDestination('/gmb-audit'), true);
  assert.equal(isSafePublicDestination('/gmb-audit?email=private@example.com'), true);
});
