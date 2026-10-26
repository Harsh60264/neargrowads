import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHeroVideoSource } from './heroVideo';
import {
  DEFAULT_PUBLIC_MEDIA,
  HOME_HERO_DARK_VIDEO_ID,
  HOME_HERO_LIGHT_VIDEO_ID,
  PUBLIC_MEDIA,
} from './publicMedia';

test('registers the light video as a separate optional public media asset', () => {
  assert.equal(PUBLIC_MEDIA.find((media) => media.id === HOME_HERO_DARK_VIDEO_ID)?.kind, 'video');
  assert.equal(PUBLIC_MEDIA.find((media) => media.id === HOME_HERO_LIGHT_VIDEO_ID)?.kind, 'video');
  assert.equal(DEFAULT_PUBLIC_MEDIA[HOME_HERO_LIGHT_VIDEO_ID].url, '');
});

test('keeps the existing video selected in dark mode', () => {
  assert.deepEqual(
    resolveHeroVideoSource('dark', '/dark.mp4', '/light.mp4'),
    { url: '/dark.mp4', mode: 'dark' },
  );
});

test('selects the light video in light mode when configured', () => {
  assert.deepEqual(
    resolveHeroVideoSource('light', '/dark.mp4', '/light.mp4'),
    { url: '/light.mp4', mode: 'light' },
  );
});

test('falls back to the existing video when the light video is absent or failed', () => {
  assert.deepEqual(
    resolveHeroVideoSource('light', '/dark.mp4', ''),
    { url: '/dark.mp4', mode: 'dark' },
  );
  assert.deepEqual(
    resolveHeroVideoSource('light', '/dark.mp4', '/light.mp4', '/light.mp4'),
    { url: '/dark.mp4', mode: 'dark' },
  );
});
