import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminPageSource = readFileSync(new URL('./components/admin/AdminPage.tsx', import.meta.url), 'utf8');

test('desktop sidebar stays sticky and scrolls independently from the main content', () => {
  assert.match(adminPageSource, /lg:sticky[\s\S]*lg:top-0[\s\S]*lg:max-h-\[100dvh\][\s\S]*lg:overflow-y-auto/);
  assert.match(adminPageSource, /nav aria-label="Admin navigation"[\s\S]*lg:flex-1[\s\S]*lg:overflow-y-auto/);
});

test('lead refreshes are throttled inside a single refresh window', () => {
  assert.match(adminPageSource, /shouldRefreshLeads\s*\(/);
  assert.match(adminPageSource, /now - lastFetchedAt >= refreshIntervalMs/);
  assert.match(adminPageSource, /window.setInterval\(refreshLeads, LEADS_REFRESH_INTERVAL_MS\)/);
  assert.match(adminPageSource, /section !== 'leads'/);
});
