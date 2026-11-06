import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MASCOT_FRAME_INTERVAL_MS,
  mascotFrameInterval,
  REDUCED_MOTION_FRAME_INTERVAL_MS,
  shouldRenderMascotFrame,
} from './animationTiming.js';

test('caps mascot rendering at 30 frames per second and lowers it for reduced motion', () => {
  assert.equal(mascotFrameInterval(false), MASCOT_FRAME_INTERVAL_MS);
  assert.equal(mascotFrameInterval(true), REDUCED_MOTION_FRAME_INTERVAL_MS);
  assert.equal(MASCOT_FRAME_INTERVAL_MS, 1000 / 30);
  assert.equal(REDUCED_MOTION_FRAME_INTERVAL_MS, 1000 / 12);
});

test('presents mascot frames only after the selected interval', () => {
  assert.equal(shouldRenderMascotFrame(MASCOT_FRAME_INTERVAL_MS - 0.01, 0, false), false);
  assert.equal(shouldRenderMascotFrame(MASCOT_FRAME_INTERVAL_MS, 0, false), true);
  assert.equal(shouldRenderMascotFrame(REDUCED_MOTION_FRAME_INTERVAL_MS - 0.01, 0, true), false);
  assert.equal(shouldRenderMascotFrame(REDUCED_MOTION_FRAME_INTERVAL_MS, 0, true), true);
});
