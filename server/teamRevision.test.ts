import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesTeamRevision, teamContentRevision, teamRevisionConflictStatus } from './teamRevision';

const originalMember = {
  id: 'member-one',
  group: 'core',
  name: 'Synthetic Member',
  role: 'Designer',
  bio: 'A synthetic profile for revision tests.',
  imageUrl: 'https://example.test/member.webp',
  socialUrl: 'https://www.linkedin.com/in/synthetic',
  order: 1,
  visible: true,
};

function jsonbLikeRoundTrip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonbLikeRoundTrip);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([key, item]) => [key, jsonbLikeRoundTrip(item)]),
  );
}

test('a saved revision remains valid after JSONB changes object-key order', () => {
  const savedMembers = [{ ...originalMember, bio: 'Updated bio.' }];
  const revisionFromSaveResponse = teamContentRevision(savedMembers);
  const nextRequestRead = jsonbLikeRoundTrip(savedMembers);

  assert.equal(matchesTeamRevision(revisionFromSaveResponse, nextRequestRead), true);
});

test('consecutive saves accept the latest revision and reject the previous one', () => {
  const firstSave = [{
    ...originalMember,
    role: 'Lead Designer',
    overview: 'Detailed overview.',
    vision: 'Purpose copy.',
    insight: 'Mentor insight.',
  }];
  const firstRevision = teamContentRevision(firstSave);
  const secondSave = [{ ...firstSave[0], insight: 'Revised mentor insight.', visible: false }];
  const secondRevision = teamContentRevision(secondSave);

  assert.equal(matchesTeamRevision(firstRevision, firstSave), true);
  assert.equal(matchesTeamRevision(secondRevision, secondSave), true);
  assert.equal(matchesTeamRevision(firstRevision, secondSave), false);
  assert.equal(teamRevisionConflictStatus(secondRevision, secondSave), undefined);
  assert.equal(teamRevisionConflictStatus(firstRevision, secondSave), 409);
});

test('a missing revision is rejected without weakening optimistic concurrency', () => {
  assert.equal(teamRevisionConflictStatus(undefined, [originalMember]), 428);
});

test('revision hashing preserves team-member ordering', () => {
  const secondMember = { ...originalMember, id: 'member-two', order: 2 };

  assert.notEqual(teamContentRevision([originalMember, secondMember]), teamContentRevision([secondMember, originalMember]));
});

test('the first concurrent administrator save wins and a stale administrator cannot overwrite it', () => {
  const initialRevision = teamContentRevision([originalMember]);
  const firstAdminSave = [{ ...originalMember, name: 'First Admin Edit' }];
  const latestRevision = teamContentRevision(firstAdminSave);
  const staleAdminSave = [{ ...originalMember, name: 'Stale Admin Edit' }];

  assert.equal(matchesTeamRevision(initialRevision, [originalMember]), true);
  assert.equal(matchesTeamRevision(initialRevision, firstAdminSave), false);
  assert.equal(matchesTeamRevision(latestRevision, firstAdminSave), true);
  assert.equal(matchesTeamRevision(initialRevision, staleAdminSave), false);
});
