import assert from 'node:assert/strict';
import test from 'node:test';
import { blogAuthorDisplayName } from './blogData';

test('uses saved author names and labels missing or blank authors as not assigned', () => {
  assert.equal(blogAuthorDisplayName({ name: '  Jane Editor  ' }), 'Jane Editor');
  assert.equal(blogAuthorDisplayName({ name: '' }), 'Not assigned');
  assert.equal(blogAuthorDisplayName({ name: '   ' }), 'Not assigned');
  assert.equal(blogAuthorDisplayName(undefined), 'Not assigned');
});
