import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync(new URL('./index.css', import.meta.url), 'utf8');

test('keeps targeted public content headers transparent in light mode', () => {
  assert.match(styles, /\.ng-global-reach-header\s*\{[^}]*background-color:\s*transparent\s*!important/s);
  assert.match(styles, /\.about-leadership-section > div > header\s*\{[^}]*background-color:\s*transparent\s*!important/s);
});
