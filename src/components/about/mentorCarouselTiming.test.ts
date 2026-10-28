import assert from 'node:assert/strict';
import test from 'node:test';
import { MENTOR_AUTOPLAY_DWELL_MS, shouldRunMentorAutoplay } from './mentorCarouselTiming';

test('uses a stable 4.5 second mentor dwell and does not pause for hover', () => {
  assert.equal(MENTOR_AUTOPLAY_DWELL_MS, 4500);
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
