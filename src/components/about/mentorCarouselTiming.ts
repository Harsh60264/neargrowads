export const MENTOR_AUTOPLAY_DWELL_MS = 5000;

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
