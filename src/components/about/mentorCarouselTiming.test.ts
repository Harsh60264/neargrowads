import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { canAdvanceMentor, MENTOR_AUTOPLAY_DWELL_MS, MENTOR_MIN_GAP_MS, shouldRunMentorAutoplay } from './mentorCarouselTiming';

test('uses a stable 5 second mentor dwell and does not pause for hover', () => {
  assert.equal(MENTOR_AUTOPLAY_DWELL_MS, 5000);
  assert.equal(shouldRunMentorAutoplay({
    isStack: true,
    documentVisible: true,
    carouselVisible: true,
    reducedMotion: false,
    mentorCount: 4,
  }), true);
});

test('pauses mentor autoplay only when visibility, motion, or carousel readiness requires it', () => {
  const base = {
    isStack: true,
    documentVisible: true,
    carouselVisible: true,
    reducedMotion: false,
    mentorCount: 4,
  };
  assert.equal(shouldRunMentorAutoplay({ ...base, documentVisible: false }), false);
  assert.equal(shouldRunMentorAutoplay({ ...base, carouselVisible: false }), false);
  assert.equal(shouldRunMentorAutoplay({ ...base, reducedMotion: true }), false);
  assert.equal(shouldRunMentorAutoplay({ ...base, mentorCount: 1 }), false);
});

test('keeps one interval advancing while visibility remains true', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const changes: number[] = [];
    const timer = setInterval(() => changes.push(changes.length + 1), MENTOR_AUTOPLAY_DWELL_MS);

    mock.timers.tick(MENTOR_AUTOPLAY_DWELL_MS * 3);

    assert.deepEqual(changes, [1, 2, 3]);
    clearInterval(timer);
  } finally {
    mock.timers.reset();
  }
});

test('rejects repeated mentor changes inside the minimum transition gap', () => {
  assert.equal(canAdvanceMentor(10_000, 10_000 - MENTOR_MIN_GAP_MS), true);
  assert.equal(canAdvanceMentor(10_001, 10_000), false);
});
