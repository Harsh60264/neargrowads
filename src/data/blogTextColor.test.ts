import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBlogTextColor } from '../utils/blogRichText';

test('normalizes supported HEX text colors', () => {
  assert.equal(normalizeBlogTextColor('#abc'), '#AABBCC');
  assert.equal(normalizeBlogTextColor('#12aBcF'), '#12ABCF');
  assert.equal(normalizeBlogTextColor('  #2563eb  '), '#2563EB');
  assert.equal(normalizeBlogTextColor('rgb(37, 99, 235)'), '#2563EB');
});

test('rejects non-HEX and unsafe text color values', () => {
  for (const value of [
    'red',
    '#12',
    '#1234',
    '#12345678',
    'transparent',
    'rgba(0, 0, 0, 0.5)',
    'rgb(256, 0, 0)',
    'url(javascript:alert(1))',
    '#fff; background-image:url(https://example.com)',
  ]) {
    assert.equal(normalizeBlogTextColor(value), null, `expected ${value} to be rejected`);
  }
});
