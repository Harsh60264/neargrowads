export type HeroVideoTheme = 'light' | 'dark';

export interface HeroVideoSource {
  url: string;
  mode: 'light' | 'dark';
}

export function resolveHeroVideoSource(
  theme: HeroVideoTheme,
  darkVideoUrl: string,
  lightVideoUrl: string,
  failedLightVideoUrl = '',
): HeroVideoSource {
  if (theme === 'light' && lightVideoUrl && lightVideoUrl !== failedLightVideoUrl) {
    return { url: lightVideoUrl, mode: 'light' };
  }
  return { url: darkVideoUrl, mode: 'dark' };
}
