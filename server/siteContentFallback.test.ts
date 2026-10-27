import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSiteContentState } from './siteContentFallback';

test('complete persisted content avoids an unnecessary legacy-store read', async () => {
  let legacyReads = 0;
  const state = await resolveSiteContentState(
    { title: 'Current draft' },
    { title: 'Published content' },
    async () => {
      legacyReads += 1;
      throw new Error('Legacy storage should not be read.');
    },
  );

  assert.deepEqual(state, {
    draft: { title: 'Current draft' },
    published: { title: 'Published content' },
  });
  assert.equal(legacyReads, 0);
});

test('incomplete persisted content still uses the legacy store for missing values', async () => {
  let legacyReads = 0;
  const state = await resolveSiteContentState(
    { title: 'Current draft' },
    undefined,
    async () => {
      legacyReads += 1;
      return { title: 'Legacy content' };
    },
  );

  assert.deepEqual(state, {
    draft: { title: 'Current draft' },
    published: { title: 'Legacy content' },
  });
  assert.equal(legacyReads, 1);
});
