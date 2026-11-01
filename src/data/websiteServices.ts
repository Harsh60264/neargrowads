import { resolveThemeImage, type PublicImageTheme, type ThemeImageFields, type ThemeImageSource, type ThemeImageVariants } from './themeImages';

export interface WebsiteService {
  id: string;
  slug: string;
  title: string;
  badge: string;
  shortDescription: string;
  icon: string;
  deliverables: string[];
  primaryCtaLabel: string;
  primaryCtaLink: string;
  secondaryCtaLabel: string;
  secondaryCtaLink: string;
  backgroundImageUrl: string;
  backgroundImageVariants?: ThemeImageVariants;
  backgroundEnabled: boolean;
  backgroundFit: 'cover' | 'contain';
  backgroundOpacity: number;
  backgroundPositionX: number;
  backgroundPositionY: number;
  displayOrder: number;
  status: 'draft' | 'published' | 'archived';
  hasUnpublishedChanges?: boolean;
}

export interface WebsiteServiceImage extends ThemeImageFields {
  url: string;
  source: ThemeImageSource;
  backgroundEnabled: boolean;
  backgroundFit: 'cover' | 'contain';
  backgroundOpacity: number;
  backgroundPositionX: number;
  backgroundPositionY: number;
}

type WebsiteServiceImageSource = Pick<
  WebsiteService,
  'backgroundImageUrl' | 'backgroundImageVariants' | 'backgroundEnabled' | 'backgroundFit' |
  'backgroundOpacity' | 'backgroundPositionX' | 'backgroundPositionY'
>;

export function resolveWebsiteServiceImage(service: WebsiteServiceImageSource, theme: PublicImageTheme): WebsiteServiceImage {
  const selected = service.backgroundImageVariants?.[theme];
  if (selected?.backgroundImageRemoved) {
    return {
      url: '',
      altText: selected.altText ?? '',
      source: 'empty',
      backgroundEnabled: false,
      backgroundFit: selected.backgroundFit ?? service.backgroundFit,
      backgroundOpacity: selected.backgroundOpacity ?? service.backgroundOpacity,
      backgroundPositionX: selected.backgroundPositionX ?? service.backgroundPositionX,
      backgroundPositionY: selected.backgroundPositionY ?? service.backgroundPositionY,
    };
  }
  const resolution = resolveThemeImage(
    {
      url: service.backgroundImageUrl,
      altText: '',
      backgroundEnabled: service.backgroundEnabled,
      backgroundFit: service.backgroundFit,
      backgroundOpacity: service.backgroundOpacity,
      backgroundPositionX: service.backgroundPositionX,
      backgroundPositionY: service.backgroundPositionY,
    },
    service.backgroundImageVariants,
    theme,
  );
  const resolved = resolution.image;
  return {
    url: resolved.url ?? '',
    altText: resolved.altText ?? '',
    source: resolution.source,
    backgroundEnabled: resolved.backgroundEnabled ?? service.backgroundEnabled,
    backgroundFit: resolved.backgroundFit ?? service.backgroundFit,
    backgroundOpacity: resolved.backgroundOpacity ?? service.backgroundOpacity,
    backgroundPositionX: resolved.backgroundPositionX ?? service.backgroundPositionX,
    backgroundPositionY: resolved.backgroundPositionY ?? service.backgroundPositionY,
  };
}

export function removeWebsiteServiceImageVariant(
  variants: ThemeImageVariants | undefined,
  theme: PublicImageTheme,
): ThemeImageVariants {
  return {
    ...variants,
    [theme]: {
      ...variants?.[theme],
      url: '',
      backgroundEnabled: false,
      backgroundImageRemoved: true,
    },
  };
}
