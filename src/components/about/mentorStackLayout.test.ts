import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cycleMentorIds, getMentorStackLayer, MAX_VISIBLE_MENTOR_STACK_LAYERS, promoteMentor } from './mentorStackLayout';

const sectionSource = readFileSync(new URL('./LeadershipTeamSection.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

for (const count of [1, 4, 5, 6, 8, 12]) {
  test(`keeps all ${count} mentor cards in the four bounded stack layers`, () => {
    const layers = Array.from({ length: count }, (_, index) => getMentorStackLayer(index));

    assert.equal(layers.length, count);
    assert.ok(layers.every((layer) => layer >= 0 && layer < MAX_VISIBLE_MENTOR_STACK_LAYERS));
    assert.deepEqual(layers.slice(0, 4), Array.from({ length: Math.min(count, 4) }, (_, index) => index));
  });
}

test('promotes a selected mentor to the front without dropping or reordering other mentors', () => {
  const original = ['a', 'b', 'c', 'd', 'e'];

  assert.deepEqual(promoteMentor(original, 'e'), ['e', 'a', 'b', 'c', 'd']);
  assert.deepEqual(promoteMentor(original, 'c'), ['c', 'a', 'b', 'd', 'e']);
  assert.equal(promoteMentor(original, 'a'), original);
  assert.equal(promoteMentor(original, 'missing'), original);
});

for (const count of [1, 4, 5, 6, 8]) {
  test(`card cycling reaches every mentor with ${count} profiles`, () => {
    const mentorIds = Array.from({ length: count }, (_, index) => `mentor-${index + 1}`);
    const visited = new Set<string>();
    let order = mentorIds;

    for (let index = 0; index < count; index += 1) {
      visited.add(order[0]);
      order = cycleMentorIds(order, 1);
    }

    assert.deepEqual(visited, new Set(mentorIds));
    assert.deepEqual(order, mentorIds);
  });
}

test('cycles backward and does not change a single-mentor stack', () => {
  assert.deepEqual(cycleMentorIds(['a', 'b', 'c'], -1), ['c', 'a', 'b']);
  const onlyMentor = ['a'];
  assert.equal(cycleMentorIds(onlyMentor, 1), onlyMentor);
});

test('reserves normal-flow height for the stack before the Core Team section', () => {
  assert.match(styles, /\.ng-mentor-stack-stage\.is-stack\s*\{[^}]*height:\s*640px/s);
  assert.match(styles, /\.ng-mentor-carousel\.is-stack\s*\{[^}]*height:\s*100%/s);
  assert.ok(sectionSource.indexOf('ng-mentor-stack-stage') < sectionSource.indexOf('ng-core-section'));
});

test('uses card-only navigation without dropdown or numbered controls', () => {
  assert.match(styles, /\.ng-mentor-carousel\.is-stack\s*>\s*li\[data-stack-position="3"\]\s*~\s*li\[data-stack-position="3"\]\s*\{[^}]*opacity:\s*0/s);
  assert.match(sectionSource, /getMentorStackLayer\(index\)/);
  assert.match(sectionSource, /MAX_VISIBLE_MENTOR_STACK_LAYERS/);
  assert.doesNotMatch(sectionSource, /ng-mentor-stack-picker/);
  assert.doesNotMatch(sectionSource, /ng-mentor-accessible-picker|Choose mentor|<select/);
  assert.doesNotMatch(styles, /ng-mentor-stack-picker/);
  assert.match(sectionSource, /onClick=\{\(event\) => \{[\s\S]*?activateMentor\(m\.id\);/);
  assert.match(sectionSource, /onKeyDown=\{handleMentorKeyDown\}/);
  assert.match(sectionSource, /const cycleMentors = \(direction: 1 \| -1, manual = false\): boolean => \{[\s\S]*?!manual && !canAdvanceMentor/s);
  assert.match(sectionSource, /cycleMentors\(1, true\)/);
  assert.match(sectionSource, /cycleMentors\(direction, true\)/);
  assert.match(sectionSource, /left or right arrow keys to browse all mentors/);
  assert.match(sectionSource, /id="ng-mentor-details-title" aria-live="polite" aria-atomic="true"/);
  assert.doesNotMatch(styles, /ng-mentor-accessible-picker/);
});

test('uses a narrower card-stack origin at tablet widths to stay inside the stage', () => {
  assert.match(styles, /\.ng-mentor-carousel\.is-stack\s*>\s*li\s*\{[^}]*left:\s*36%/s);
  assert.match(styles, /@media\s*\(min-width:\s*1024px\)\s*and\s*\(max-width:\s*1199px\)\s*\{[^}]*left:\s*44%/s);
});
