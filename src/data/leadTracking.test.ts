import assert from 'node:assert/strict';
import test from 'node:test';
import { captureFirstTouchCampaign, getLeadTracking } from './leadTracking';

test('keeps first-touch campaign values available after internal navigation', () => {
  const values = new Map<string, string>();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    },
  });

  try {
    captureFirstTouchCampaign('?utm_source=campaign&utm_medium=email&utm_campaign=autumn');
    captureFirstTouchCampaign('?utm_source=later');
    assert.deepEqual(getLeadTracking('/contact', ''), {
      sourcePage: '/contact',
      utmSource: 'campaign',
      utmMedium: 'email',
      utmCampaign: 'autumn',
    });
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
