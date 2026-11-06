import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'OptionalLocationPicker.tsx'), 'utf8');

test('requests browser location only from the explicit button and supports removal', () => {
  assert.match(source, /onClick=\{requestLocation\}/);
  assert.match(source, /getCurrentPosition/);
  assert.match(source, /onChange\(undefined\)/);
  assert.match(source, /PERMISSION_DENIED/);
  assert.match(source, /timeout: 10_000/);
  assert.doesNotMatch(source, /useEffect/);
});
