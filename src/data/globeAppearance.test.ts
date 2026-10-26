import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeGlobeLightAppearance,
  resolveGlobeAppearance,
} from './globeAppearance';
import { DEFAULT_SITE_CONTENT } from './siteContent';

test('uses the reference light appearance when older content has no light profile', () => {
  const settings = {
    ...DEFAULT_SITE_CONTENT.animations,
    globeLightAppearance: normalizeGlobeLightAppearance(undefined)!,
  };

  assert.equal(settings.globeLightAppearance.oceanColor, '#EEF0DF');
  assert.equal(resolveGlobeAppearance('light', settings).landColor, '#346B47');
});

test('keeps legacy dark appearance settings separate from the light profile', () => {
  const settings = {
    ...DEFAULT_SITE_CONTENT.animations,
    globeLandColor: '#123456',
    globeHighlightColor: '#ABCDEF',
    globeHighlightGlowColor: '#FEDCBA',
  };

  assert.equal(resolveGlobeAppearance('dark', settings).landColor, '#123456');
  assert.equal(resolveGlobeAppearance('dark', settings).selectionOutlineColor, '#ABCDEF');
  assert.equal(resolveGlobeAppearance('dark', settings).selectionGlowColor, '#FEDCBA');
  assert.equal(resolveGlobeAppearance('light', settings).landColor, '#346B47');
});

test('preserves saved light overrides and safely fills missing profile fields', () => {
  const appearance = normalizeGlobeLightAppearance({
    landColor: '#456789',
    routeOpacity: 0.31,
  });

  assert.equal(appearance?.landColor, '#456789');
  assert.equal(appearance?.routeOpacity, 0.31);
  assert.equal(appearance?.oceanColor, '#EEF0DF');
  assert.equal(normalizeGlobeLightAppearance({ routeOpacity: 2 }), undefined);
});
