import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMascotRendererVariant } from './neoMascotRendererSelection.js';

test('selects the supplied SVG renderer for the 2D preference', () => {
  assert.equal(resolveMascotRendererVariant('2d'), 'reference2d');
});

test('keeps the existing 3D renderer as the default path', () => {
  assert.equal(resolveMascotRendererVariant('3d'), 'current3d');
  assert.equal(resolveMascotRendererVariant(undefined), 'current3d');
});

test('uses Canvas only as a runtime fallback when WebGL initialization fails', () => {
  assert.equal(resolveMascotRendererVariant('2d', true), 'canvasFallback');
  assert.equal(resolveMascotRendererVariant('3d', true), 'canvasFallback');
});
