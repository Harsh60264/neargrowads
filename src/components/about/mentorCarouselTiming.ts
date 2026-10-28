export const MENTOR_AUTOPLAY_DWELL_MS = 5000;
export const MENTOR_MIN_GAP_MS = 4000;

export function canAdvanceMentor(now: number, lastTransitionAt: number): boolean {
  return now - lastTransitionAt >= MENTOR_MIN_GAP_MS;
}

export function shouldRunMentorAutoplay(options: {
  isStack: boolean;
  documentVisible: boolean;
  carouselVisible: boolean;
  reducedMotion: boolean;
  mentorCount: number;
}): boolean {
  return options.isStack &&
    options.documentVisible &&
    options.carouselVisible &&
    !options.reducedMotion &&
    options.mentorCount > 1;
}
