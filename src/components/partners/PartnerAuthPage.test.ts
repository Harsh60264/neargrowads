import assert from 'node:assert/strict';
import test from 'node:test';
import { getPartnerAuthInitialMode } from './PartnerAuthPage';

test('selects the partner auth mode from a direct route', () => {
  assert.equal(getPartnerAuthInitialMode('/partners/register'), 'register');
  assert.equal(getPartnerAuthInitialMode('/partners/register/'), 'register');
  assert.equal(getPartnerAuthInitialMode('/partners/recovery'), 'recovery');
  assert.equal(getPartnerAuthInitialMode('/partners/login'), 'login');
  assert.equal(getPartnerAuthInitialMode('/partners/dashboard'), 'login');
  assert.equal(getPartnerAuthInitialMode('/partners/portal-preview'), 'login');
});
