import { GLOBAL_REACH_COUNTRIES } from './globalReachConfig';
import { resolveThemeImage, type PublicImageTheme, type ThemeImageSource, type ThemeImageVariants } from './themeImages';

export type PublicMediaKind = 'image' | 'video';

export const HOME_HERO_DARK_VIDEO_ID = 'home.hero.video';
export const HOME_HERO_LIGHT_VIDEO_ID = 'home.hero.lightVideo';

export interface PublicMediaDefinition {
  id: string;
  page: string;
  section: string;
  label: string;
  kind: PublicMediaKind;
  altText: string;
  fallbackUrl?: string;
  background?: {
    overlay: 'light' | 'dark';
    description: string;
  };
}

export interface ManagedMedia {
  url: string;
  altText: string;
  focalX: number;
  focalY: number;
  backgroundEnabled: boolean;
  backgroundFit: 'cover' | 'contain';
  backgroundOpacity: number;
  backgroundPositionX: number;
  backgroundPositionY: number;
  imageVariants?: ThemeImageVariants;
}

export const PUBLIC_MEDIA: PublicMediaDefinition[] = [
  { id: HOME_HERO_DARK_VIDEO_ID, page: 'Home', section: 'Hero', label: 'Hero background video', kind: 'video', altText: '' },
  { id: HOME_HERO_LIGHT_VIDEO_ID, page: 'Home', section: 'Hero', label: 'Light mode hero video', kind: 'video', altText: '' },
  { id: 'home.hero.poster', page: 'Home', section: 'Hero', label: 'Hero video thumbnail', kind: 'image', altText: 'NearGrow Ads digital growth campaign' },
  { id: 'home.service.1', page: 'Home', section: 'Services', label: 'Service image 1 · Search across markets', kind: 'image', altText: 'Search across markets', fallbackUrl: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?auto=format&fit=crop&w=760&q=85', background: { overlay: 'dark', description: 'Home Services card background; other uses of this image remain unchanged.' } },
  { id: 'home.service.2', page: 'Home', section: 'Services', label: 'Service image 2 · Audience and market strategy', kind: 'image', altText: 'Audience and market strategy', fallbackUrl: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=760&q=85', background: { overlay: 'dark', description: 'Home Services card background; other uses of this image remain unchanged.' } },
  { id: 'home.service.3', page: 'Home', section: 'Services', label: 'Service image 3 · Google Ads campaign', kind: 'image', altText: 'Google Ads campaign', fallbackUrl: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=760&q=85', background: { overlay: 'dark', description: 'Home Services card background; other uses of this image remain unchanged.' } },
  { id: 'home.service.4', page: 'Home', section: 'Services', label: 'Service image 4 · Social video content', kind: 'image', altText: 'Social video content', fallbackUrl: 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?auto=format&fit=crop&w=760&q=85', background: { overlay: 'dark', description: 'Home Services card background; other uses of this image remain unchanged.' } },
  { id: 'home.service.5', page: 'Home', section: 'Services', label: 'Service image 5 · Website analytics', kind: 'image', altText: 'Website analytics', fallbackUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=760&q=85', background: { overlay: 'dark', description: 'Home Services card background; other uses of this image remain unchanged.' } },
  { id: 'home.service.6', page: 'Home', section: 'Services', label: 'Service image 6 · Growth consulting', kind: 'image', altText: 'Growth consulting', fallbackUrl: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=760&q=85', background: { overlay: 'dark', description: 'Home Services card background; other uses of this image remain unchanged.' } },
  { id: 'home.service.7', page: 'Home', section: 'Services', label: 'Service image 7 · Content production', kind: 'image', altText: 'Content production', fallbackUrl: 'https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=760&q=85', background: { overlay: 'dark', description: 'Home Services card background; other uses of this image remain unchanged.' } },
  { id: 'home.service.8', page: 'Home', section: 'Services', label: 'Service image 8 · Marketing automation', kind: 'image', altText: 'Marketing automation', fallbackUrl: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=760&q=85', background: { overlay: 'dark', description: 'Home Services card background; other uses of this image remain unchanged.' } },
  { id: 'home.hospitality.problem', page: 'Home', section: 'Hospitality growth', label: 'Hospitality challenge image', kind: 'image', altText: 'Boutique hotel courtyard and pool at sunset', fallbackUrl: 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1400&q=90', background: { overlay: 'light', description: 'Hospitality challenge card background.' } },
  { id: 'home.hospitality.solution', page: 'Home', section: 'Hospitality growth', label: 'Hospitality solution image', kind: 'image', altText: 'Welcoming boutique hotel reception and guest spaces', fallbackUrl: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1400&q=90', background: { overlay: 'dark', description: 'Hospitality solution card background.' } },
  { id: 'home.portfolio.1', page: 'Home', section: 'Selected work', label: 'Portfolio thumbnail 1 · Retail', kind: 'image', altText: 'Local retail storefront' },
  { id: 'home.portfolio.2', page: 'Home', section: 'Selected work', label: 'Portfolio thumbnail 2 · Team', kind: 'image', altText: 'Digital marketing team planning a campaign' },
  { id: 'home.portfolio.3', page: 'Home', section: 'Selected work', label: 'Portfolio thumbnail 3 · Healthcare', kind: 'image', altText: 'Modern healthcare clinic interior' },
  { id: 'seo.home.ogImage', page: 'Home', section: 'Search & social preview', label: 'Home social sharing image', kind: 'image', altText: 'NearGrow Ads home page social preview' },
  { id: 'seo.services.ogImage', page: 'Services', section: 'Search & social preview', label: 'Services social sharing image', kind: 'image', altText: 'NearGrow Ads services page social preview' },
  { id: 'seo.catalogue.ogImage', page: 'Catalogue', section: 'Search & social preview', label: 'Catalogue social sharing image', kind: 'image', altText: 'NearGrow Ads service catalogue social preview' },
  { id: 'seo.work.ogImage', page: 'Work', section: 'Search & social preview', label: 'Work social sharing image', kind: 'image', altText: 'NearGrow Ads work page social preview' },
  { id: 'seo.about.ogImage', page: 'About', section: 'Search & social preview', label: 'About social sharing image', kind: 'image', altText: 'NearGrow Ads about page social preview' },
  { id: 'seo.blog.ogImage', page: 'Blog', section: 'Search & social preview', label: 'Blog social sharing image', kind: 'image', altText: 'NearGrow Ads blog social preview' },
  { id: 'seo.contact.ogImage', page: 'Contact', section: 'Search & social preview', label: 'Contact social sharing image', kind: 'image', altText: 'NearGrow Ads contact page social preview' },
  ...GLOBAL_REACH_COUNTRIES.map((country) => ({
    id: `home.globalReach.${country.id}`,
    page: 'Home',
    section: 'Global reach',
    label: `Country image · ${country.name}`,
    kind: 'image' as const,
    altText: country.photoAlt,
    fallbackUrl: country.photo,
  })),
];

export const DEFAULT_PUBLIC_MEDIA: Record<string, ManagedMedia> = Object.fromEntries(
  PUBLIC_MEDIA.map(({ id, altText }) => [id, {
    url: '',
    altText,
    focalX: 50,
    focalY: 50,
    backgroundEnabled: false,
    backgroundFit: 'cover' as const,
    backgroundOpacity: 100,
    backgroundPositionX: 50,
    backgroundPositionY: 50,
  }]),
);

export function publicMedia(
  media: Record<string, ManagedMedia> | undefined,
  id: string,
  fallbackUrl = '',
  theme: PublicImageTheme = 'light',
): ManagedMedia {
  const { asset } = resolvePublicMedia(media, id, fallbackUrl, theme);
  return asset;
}

export function resolvePublicMedia(
  media: Record<string, ManagedMedia> | undefined,
  id: string,
  fallbackUrl = '',
  theme: PublicImageTheme = 'light',
): { asset: ManagedMedia; source: ThemeImageSource } {
  const fallback = DEFAULT_PUBLIC_MEDIA[id] ?? {
    url: '',
    altText: '',
    focalX: 50,
    focalY: 50,
    backgroundEnabled: false,
    backgroundFit: 'cover' as const,
    backgroundOpacity: 100,
    backgroundPositionX: 50,
    backgroundPositionY: 50,
  };
  const value = media?.[id];
  const base: ManagedMedia = {
    url: value?.url || fallbackUrl,
    altText: value?.altText ?? fallback.altText,
    focalX: value?.focalX ?? fallback.focalX,
    focalY: value?.focalY ?? fallback.focalY,
    backgroundEnabled: value?.backgroundEnabled ?? fallback.backgroundEnabled,
    backgroundFit: value?.backgroundFit ?? fallback.backgroundFit,
    backgroundOpacity: value?.backgroundOpacity ?? fallback.backgroundOpacity,
    backgroundPositionX: value?.backgroundPositionX ?? fallback.backgroundPositionX,
    backgroundPositionY: value?.backgroundPositionY ?? fallback.backgroundPositionY,
    imageVariants: value?.imageVariants,
  };
  const resolved = resolveThemeImage(base, value?.imageVariants, theme);
  return {
    asset: { ...resolved.image, imageVariants: value?.imageVariants },
    source: resolved.source,
  };
}
