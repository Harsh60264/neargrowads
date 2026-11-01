import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_MENTOR_SECTION_COPY_LENGTH,
  resolveMentorSectionContent,
  validateOptionalMentorSectionCopy,
} from './teamMentorContent';

test('legacy mentors keep their existing overview, vision, and insight content', () => {
  const resolved = resolveMentorSectionContent({
    id: 'mentor-01',
    bio: 'Legacy short bio.',
  });

  assert.equal(resolved.overview, 'Legacy short bio.');
  assert.equal(resolved.vision, 'Make cross-border growth more intentional by pairing the right channels with messaging that feels local.');
  assert.equal(resolved.insight, 'A strong expansion plan starts with understanding the audience in each market.');
});

test('new mentor copy stays independent from the compact short bio', () => {
  const resolved = resolveMentorSectionContent({
    id: 'mentor-new',
    bio: 'Compact card description.',
    overview: 'Detailed overview.',
    vision: 'Purpose statement.',
    insight: 'A distinct mentor insight.',
  });

  assert.deepEqual(resolved, {
    overview: 'Detailed overview.',
    vision: 'Purpose statement.',
    insight: 'A distinct mentor insight.',
  });
});

test('new mentors with empty section fields show no short-bio fallback', () => {
  const resolved = resolveMentorSectionContent({
    id: 'mentor-new',
    bio: 'Compact card description.',
    overview: '',
    vision: '',
    insight: '',
  });

  assert.deepEqual(resolved, { overview: '', vision: '', insight: '' });
});

test('legacy profiles without distinct custom copy do not repeat short bio in every section', () => {
  const resolved = resolveMentorSectionContent({
    id: 'mentor-custom-legacy',
    bio: 'Existing compact profile text.',
  });

  assert.deepEqual(resolved, {
    overview: 'Existing compact profile text.',
    vision: '',
    insight: '',
  });
});

test('explicit empty section copy remains empty instead of falling back to legacy text', () => {
  const resolved = resolveMentorSectionContent({
    id: 'mentor-01',
    bio: 'Short bio.',
    overview: '',
    vision: '',
    insight: '',
  });

  assert.deepEqual(resolved, { overview: '', vision: '', insight: '' });
});

test('missing, empty, trimmed, and invalid optional section fields validate safely', () => {
  assert.deepEqual(validateOptionalMentorSectionCopy(undefined), { valid: true });
  assert.deepEqual(validateOptionalMentorSectionCopy(''), { valid: true, value: '' });
  assert.deepEqual(validateOptionalMentorSectionCopy('  Separate copy  '), { valid: true, value: 'Separate copy' });
  assert.deepEqual(validateOptionalMentorSectionCopy(5), { valid: false });
  assert.deepEqual(validateOptionalMentorSectionCopy('x'.repeat(MAX_MENTOR_SECTION_COPY_LENGTH + 1)), { valid: false });
  assert.deepEqual(validateOptionalMentorSectionCopy('x'.repeat(MAX_MENTOR_SECTION_COPY_LENGTH)), {
    valid: true,
    value: 'x'.repeat(MAX_MENTOR_SECTION_COPY_LENGTH),
  });
});

test('independent section values survive the editor save/load JSON round-trip', () => {
  const submitted = {
    id: 'mentor-new',
    group: 'mentor' as const,
    name: 'Synthetic Mentor',
    role: 'Advisor',
    bio: 'Card summary.',
    overview: 'Detailed overview.',
    vision: 'Purpose copy.',
    insight: 'Insight copy.',
    imageUrl: '',
    socialUrl: '',
    order: 1,
    visible: true,
  };

  const reopened = JSON.parse(JSON.stringify(submitted)) as typeof submitted;

  assert.deepEqual(
    resolveMentorSectionContent(reopened),
    { overview: submitted.overview, vision: submitted.vision, insight: submitted.insight },
  );
  assert.equal(reopened.bio, 'Card summary.');
});
