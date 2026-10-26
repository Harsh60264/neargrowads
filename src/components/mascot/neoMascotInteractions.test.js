import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMascotCursorGlanceController,
  getMascotAttentionPoint,
  getMascotIdleGaze,
  getMascotTargetGaze,
  getMascotVisibleTargetRect,
} from './neoMascotInteractions.js';

test('gaze aims right and upward using the target center', () => {
  const gaze = getMascotTargetGaze(
    { left: 620, right: 680, top: 180, bottom: 220, width: 60, height: 40 },
    300,
    500,
    200,
  );

  assert.ok(gaze.x > 0);
  assert.ok(gaze.y > 0);
});

test('gaze aims left and downward and stays neutral at the target center', () => {
  const leftDown = getMascotTargetGaze({ x: 100, y: 600 }, 300, 400, 200);
  const centered = getMascotTargetGaze({ x: 300, y: 400 }, 300, 400, 200);

  assert.ok(leftDown.x < 0);
  assert.ok(leftDown.y < 0);
  assert.deepEqual(centered, { x: 0, y: 0 });
});

test('gaze follows a stationary target from the mascot head position and compensates for roll', () => {
  const target = { x: 600, y: 300 };
  const fartherHead = getMascotTargetGaze(target, 200, 300, 200);
  const nearerHead = getMascotTargetGaze(target, 500, 300, 200);
  const rolledHead = getMascotTargetGaze(target, 500, 300, 200, Math.PI / 2);

  assert.ok(fartherHead.x > nearerHead.x);
  assert.ok(rolledHead.y < 0);
});

test('gaze uses the visible portion of a partially clipped target', () => {
  const visibleRect = getMascotVisibleTargetRect(
    { left: -40, right: 60, top: 10, bottom: 80 },
    { left: 0, top: 0, width: 50, height: 60 },
  );

  assert.deepEqual(visibleRect, { left: 0, right: 50, top: 10, bottom: 60, width: 50, height: 50 });
  assert.equal(
    getMascotVisibleTargetRect(
      { left: 60, right: 80, top: 10, bottom: 80 },
      { left: 0, top: 0, width: 50, height: 60 },
    ),
    null,
  );
});

test('pointer position overrides the keyboard-focus center and focus uses its visible center', () => {
  assert.deepEqual(
    getMascotAttentionPoint(
      { x: 140, y: 220 },
      { left: 500, right: 700, top: 100, bottom: 200, width: 200, height: 100 },
    ),
    { x: 140, y: 220 },
  );
  assert.deepEqual(
    getMascotAttentionPoint(null, { left: 500, right: 700, top: 100, bottom: 200, width: 200, height: 100 }),
    { x: 600, y: 150 },
  );
  assert.equal(getMascotAttentionPoint(null, null), null);
});

test('idle gaze stays forward between deliberate cursor glances', () => {
  assert.deepEqual(getMascotIdleGaze(0), { x: 0, y: 0 });
  assert.deepEqual(getMascotIdleGaze(120), { x: 0, y: 0 });
});

test('cursor glances are brief, stationary, and separated by a cooldown', () => {
  const cursor = createMascotCursorGlanceController({ random: () => 0 });
  cursor.setPointer({ x: 140, y: 220 });

  assert.equal(cursor.update(4.99), null);
  assert.deepEqual(cursor.update(0.02), { x: 140, y: 220 });

  cursor.setPointer({ x: 500, y: 600 });
  assert.deepEqual(cursor.update(0.4), { x: 140, y: 220 });
  assert.equal(cursor.update(0.5), null);
  assert.equal(cursor.update(4.49), null);
  assert.deepEqual(cursor.update(0.02), { x: 500, y: 600 });
});

test('interactive attention overrides glances and touch-only devices do not glance', () => {
  const cursor = createMascotCursorGlanceController({ random: () => 0 });
  cursor.setPointer({ x: 100, y: 100 });
  assert.deepEqual(cursor.update(5), { x: 100, y: 100 });
  cursor.setInteractive(true);
  assert.equal(cursor.update(1), null);
  cursor.setInteractive(false);
  assert.equal(cursor.update(1), null);

  const touch = createMascotCursorGlanceController({ touchOnly: true, random: () => 0 });
  touch.setPointer({ x: 100, y: 100 });
  assert.equal(touch.update(20), null);
});
