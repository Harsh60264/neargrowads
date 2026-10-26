import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveThemeImage, type ThemeImageFields, type ThemeImageVariants } from './themeImages';

test('uses a dedicated theme image and its presentation settings', () => {
  const result = resolveThemeImage(
    { url: '/legacy.jpg', altText: 'Legacy', imagePositionX: 20, imageOpacity: 80 },
    { light: { url: '/light.jpg', altText: 'Light', imagePositionX: 75, imageOpacity: 45 } },
    'light',
  );

  assert.equal(result.source, 'dedicated');
  assert.deepEqual(result.image, {
    url: '/light.jpg',
    altText: 'Light',
    imagePositionX: 75,
    imageOpacity: 45,
  });
});

test('inherits legacy image and settings until a theme variant is assigned', () => {
  const result = resolveThemeImage(
    { url: '/legacy.jpg', imagePositionX: 20, imageOpacity: 80 },
    { dark: { imagePositionX: 65 } },
    'dark',
  );

  assert.equal(result.source, 'legacy');
  assert.deepEqual(result.image, {
    url: '/legacy.jpg',
    imagePositionX: 65,
    imageOpacity: 80,
  });
});

test('uses the other theme only when no legacy image exists', () => {
  const result = resolveThemeImage(
    { url: '', imagePositionX: 40 },
    { light: { url: '/light.jpg', imagePositionX: 70 }, dark: { imageOpacity: 25 } },
    'dark',
  );

  assert.equal(result.source, 'other-theme');
  assert.deepEqual(result.image, {
    url: '/light.jpg',
    imagePositionX: 70,
    imageOpacity: 25,
  });
});

test('an empty dedicated URL falls back without mutating the other theme', () => {
  const variants: ThemeImageVariants = {
    light: { url: '', imagePositionX: 90 },
    dark: { url: '/dark.jpg', imagePositionX: 30 },
  };
  const result = resolveThemeImage<ThemeImageFields>({ url: '/legacy.jpg' }, variants, 'light');

  assert.equal(result.source, 'legacy');
  assert.equal(result.image.url, '/legacy.jpg');
  assert.equal(result.image.imagePositionX, 90);
  assert.equal(variants.dark?.url, '/dark.jpg');
});

test('reports the existing empty state when all image sources are missing', () => {
  const result = resolveThemeImage({ url: '' }, { dark: { url: '' } }, 'light');
  assert.equal(result.source, 'empty');
  assert.equal(result.image.url, '');
});
