import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateMascotGeometry,
  DEFAULT_MASCOT_SETTINGS,
  normalizeMascotSettings,
  resolveMascotMultiplier,
} from './mascotSizing';

test('legacy content without mascot settings keeps the current size baseline', () => {
  assert.deepEqual(normalizeMascotSettings(undefined), DEFAULT_MASCOT_SETTINGS);
  assert.deepEqual(normalizeMascotSettings({ renderer: '3d' }), DEFAULT_MASCOT_SETTINGS);
});

test('normalizes saved mascot scales to supported percentages', () => {
  assert.deepEqual(normalizeMascotSettings({
    desktopScalePercent: 175,
    mobileScalePercent: 65.4,
  }), {
    renderer: '3d',
    desktopScalePercent: 150,
    mobileScalePercent: 65,
  });
  assert.equal(normalizeMascotSettings({ desktopScalePercent: '120' }).desktopScalePercent, 100);
});

test('preserves a selected 2D renderer and the existing size settings', () => {
  assert.deepEqual(normalizeMascotSettings({
    renderer: '2d',
    desktopScalePercent: 125,
    mobileScalePercent: 75,
  }), {
    renderer: '2d',
    desktopScalePercent: 125,
    mobileScalePercent: 75,
  });
  assert.equal(normalizeMascotSettings({ renderer: 'future' }).renderer, '3d');
  assert.equal(DEFAULT_MASCOT_SETTINGS.renderer, '3d');
});

test('chooses the independent mobile scale below the existing breakpoint', () => {
  const settings = { desktopScalePercent: 125, mobileScalePercent: 75 };
  assert.equal(resolveMascotMultiplier(settings, 699), 0.75);
  assert.equal(resolveMascotMultiplier(settings, 700), 1.25);
});

test('scales the renderer, hit area, and roaming bounds together', () => {
  const baseline = calculateMascotGeometry(1280, 800, 168, 1, true);
  const enlarged = calculateMascotGeometry(1280, 800, 168, 1.5, true);

  assert.equal(baseline.size, 168);
  assert.equal(enlarged.size, 252);
  assert.ok(Math.abs(enlarged.hitWidth / baseline.hitWidth - 1.5) < 1e-10);
  assert.ok(Math.abs(enlarged.hitHeight / baseline.hitHeight - 1.5) < 1e-10);
  assert.ok(Math.abs(enlarged.minX / baseline.minX - 1.5) < 1e-10);
  assert.ok(Math.abs(enlarged.maxX - (1280 - (1280 - baseline.maxX) * 1.5)) < 1e-10);
  assert.ok(enlarged.maxY < baseline.maxY);
});

test('keeps the complete mascot inside narrow viewports and contains preview bounds', () => {
  const mobile = calculateMascotGeometry(320, 568, 140, 1.5, true);
  const preview = calculateMascotGeometry(240, 240, 240, 1.5, false);

  assert.ok(mobile.size <= Math.min(320, 568) * 0.94);
  assert.ok(mobile.maxX <= 320);
  assert.ok(mobile.maxY <= 568);
  assert.equal(preview.size, 240 * 0.94);
  assert.equal(preview.minX, 120);
  assert.equal(preview.maxX, 120);
  assert.equal(preview.minY, 120);
  assert.equal(preview.maxY, 120);
});
