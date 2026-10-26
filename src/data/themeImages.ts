export type PublicImageTheme = 'light' | 'dark';

export interface ThemeImageFields {
  url?: string;
  altText?: string;
  focalX?: number;
  focalY?: number;
  backgroundEnabled?: boolean;
  backgroundFit?: 'cover' | 'contain';
  backgroundOpacity?: number;
  backgroundPositionX?: number;
  backgroundPositionY?: number;
  imagePositionX?: number;
  imagePositionY?: number;
  imageSize?: 'cover' | 'contain';
  imageOpacity?: number;
}

export type ThemeImageVariants<T extends ThemeImageFields = ThemeImageFields> =
  Partial<Record<PublicImageTheme, Partial<T>>>;

export type ThemeImageSource = 'dedicated' | 'legacy' | 'other-theme' | 'empty';

export function resolveThemeImage<T extends ThemeImageFields>(
  legacy: T,
  variants: ThemeImageVariants | undefined,
  theme: PublicImageTheme,
): { image: T; source: ThemeImageSource } {
  const selected = variants?.[theme];
  const other = variants?.[theme === 'light' ? 'dark' : 'light'];
  const selectedUrl = selected?.url?.trim() ?? '';
  const legacyUrl = legacy.url?.trim() ?? '';
  const otherUrl = other?.url?.trim() ?? '';

  if (selectedUrl) {
    return {
      image: { ...legacy, ...selected, url: selectedUrl },
      source: 'dedicated',
    };
  }
  if (legacyUrl) {
    return {
      image: { ...legacy, ...selected, url: legacyUrl },
      source: 'legacy',
    };
  }
  if (otherUrl) {
    return {
      image: { ...legacy, ...other, ...selected, url: otherUrl },
      source: 'other-theme',
    };
  }
  return {
    image: { ...legacy, ...selected, url: '' },
    source: 'empty',
  };
}
