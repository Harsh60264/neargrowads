import { resolveThemeImage, type PublicImageTheme, type ThemeImageFields, type ThemeImageVariants } from './themeImages';

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
  backgroundEnabled: boolean;
  backgroundFit: 'cover' | 'contain';
  backgroundOpacity: number;
  backgroundPositionX: number;
  backgroundPositionY: number;
}

export function resolveWebsiteServiceImage(service: WebsiteService, theme: PublicImageTheme): WebsiteServiceImage {
  const resolved = resolveThemeImage(
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
  ).image;
  return {
    url: resolved.url ?? '',
    altText: resolved.altText ?? '',
    backgroundEnabled: resolved.backgroundEnabled ?? service.backgroundEnabled,
    backgroundFit: resolved.backgroundFit ?? service.backgroundFit,
    backgroundOpacity: resolved.backgroundOpacity ?? service.backgroundOpacity,
    backgroundPositionX: resolved.backgroundPositionX ?? service.backgroundPositionX,
    backgroundPositionY: resolved.backgroundPositionY ?? service.backgroundPositionY,
  };
}
