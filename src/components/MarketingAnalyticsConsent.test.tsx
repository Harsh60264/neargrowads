import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarketingAnalyticsConsent } from './MarketingAnalyticsConsent';

function renderConsent(
  consent: 'accepted' | 'rejected' | null,
  settingsOpen = false,
  pathname = '/contact',
): string {
  return renderToStaticMarkup(
    <MarketingAnalyticsConsent
      consent={consent}
      enabled
      onConsentChange={() => undefined}
      onCloseSettings={() => undefined}
      pathname={pathname}
      settingsOpen={settingsOpen}
    />,
  );
}

test('shows choices only when consent has not been selected', () => {
  const markup = renderConsent(null);
  assert.match(markup, /Your privacy choices/);
  assert.match(markup, /Accept analytics/);
  assert.match(markup, /Reject optional analytics/);
  assert.doesNotMatch(markup, /Optional analytics (?:enabled|disabled)/);
  assert.equal(renderConsent('accepted'), '');
  assert.equal(renderConsent('rejected'), '');
});

test('allows visitors to reopen and change a saved choice through Cookie Settings', () => {
  const acceptedSettings = renderConsent('accepted', true);
  assert.match(acceptedSettings, /Cookie Settings/);
  assert.match(acceptedSettings, /Current choice: accepted/);
  assert.match(acceptedSettings, /Withdraw analytics consent/);
  const rejectedSettings = renderConsent('rejected', true);
  assert.match(rejectedSettings, /Current choice: rejected/);
  assert.match(rejectedSettings, /Accept analytics/);
});

test('does not show consent controls on private routes or when analytics UI is disabled', () => {
  assert.equal(renderConsent(null, false, '/partners/dashboard'), '');
  assert.equal(renderConsent(null, false, '/admin'), '');
});
