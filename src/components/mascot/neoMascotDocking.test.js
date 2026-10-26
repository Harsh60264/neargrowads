import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMascotDockTarget } from './neoMascotDocking.js';

test('desktop docking stays beside the measured panel at the saved mascot size', () => {
  const panel = { left: 618, right: 1008, top: 80, bottom: 700 };
  const dock = calculateMascotDockTarget(panel, 1024, 768, 215);

  assert.equal(dock.size, 215);
  assert.ok(dock.x + dock.size * 0.34 + 8 <= panel.left);
  assert.ok(dock.y + dock.size * 0.68 + 8 <= 768);
});

test('mobile docking respects small, baseline, and maximum size settings', () => {
  const panel = { left: 84, right: 362, top: 160, bottom: 760 };
  for (const mascotSize of [84, 140, 210]) {
    const dock = calculateMascotDockTarget(panel, 390, 844, mascotSize);
    assert.ok(dock.size <= mascotSize);
    assert.ok(dock.x - dock.size * 0.34 >= 0);
    assert.ok(dock.x + dock.size * 0.34 + 8 <= panel.left);
    assert.ok(dock.y - dock.size * 0.32 >= 0);
    assert.ok(dock.y + dock.size * 0.68 + 8 <= 844);
  }
});

test('docking accounts for the visual viewport offset and height', () => {
  const panel = { left: 104, right: 380, top: 250, bottom: 610 };
  const dock = calculateMascotDockTarget(panel, 390, 844, 140, 100, 500);

  assert.ok(dock.y - dock.size * 0.32 >= 100);
  assert.ok(dock.y + dock.size * 0.68 + 8 <= 600);
});
