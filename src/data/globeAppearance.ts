import {
  DEFAULT_GLOBE_LIGHT_APPEARANCE,
  type AnimationSettings,
  type GlobeLightAppearance,
} from './siteContent';

export type GlobeAppearanceTheme = 'light' | 'dark';

export interface ResolvedGlobeAppearance {
  oceanColor: string;
  landColor: string;
  countryBorderColor: string;
  countryBorderOpacity: number;
  gridEnabled: boolean;
  gridOpacity: number;
  routeColor: string;
  routeOpacity: number;
  markerColor: string;
  selectionOutlineColor: string;
  selectionGlowColor: string;
  selectionGlowIntensity: number;
  atmosphereIntensity: number;
}

export const DARK_GLOBE_APPEARANCE: ResolvedGlobeAppearance = {
  oceanColor: '#172534',
  landColor: '#53697d',
  countryBorderColor: '#BECFDA',
  countryBorderOpacity: 0.18,
  gridEnabled: true,
  gridOpacity: 0.08,
  routeColor: '#348D3C',
  routeOpacity: 0.34,
  markerColor: '#9BCF68',
  selectionOutlineColor: '#70c442',
  selectionGlowColor: '#70c442',
  selectionGlowIntensity: 0.2,
  atmosphereIntensity: 0.1,
};

export function normalizeGlobeLightAppearance(value: unknown): GlobeLightAppearance | undefined {
  if (value === undefined) return { ...DEFAULT_GLOBE_LIGHT_APPEARANCE };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const color = (key: keyof GlobeLightAppearance) => {
    const candidate = input[key] === undefined ? DEFAULT_GLOBE_LIGHT_APPEARANCE[key] : input[key];
    return typeof candidate === 'string' && /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : undefined;
  };
  const opacity = (key: keyof GlobeLightAppearance, maximum = 1) => {
    const candidate = input[key] === undefined ? DEFAULT_GLOBE_LIGHT_APPEARANCE[key] : input[key];
    return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 && candidate <= maximum
      ? candidate
      : undefined;
  };
  const gridEnabled = input.gridEnabled === undefined
    ? DEFAULT_GLOBE_LIGHT_APPEARANCE.gridEnabled
    : input.gridEnabled;
  const oceanColor = color('oceanColor');
  const landColor = color('landColor');
  const countryBorderColor = color('countryBorderColor');
  const countryBorderOpacity = opacity('countryBorderOpacity');
  const gridOpacity = opacity('gridOpacity');
  const routeColor = color('routeColor');
  const routeOpacity = opacity('routeOpacity');
  const markerColor = color('markerColor');
  const selectionOutlineColor = color('selectionOutlineColor');
  const selectionGlowColor = color('selectionGlowColor');
  const selectionGlowIntensity = opacity('selectionGlowIntensity');
  const atmosphereIntensity = opacity('atmosphereIntensity', 0.5);
  if (
    !oceanColor ||
    !landColor ||
    !countryBorderColor ||
    countryBorderOpacity === undefined ||
    typeof gridEnabled !== 'boolean' ||
    gridOpacity === undefined ||
    !routeColor ||
    routeOpacity === undefined ||
    !markerColor ||
    !selectionOutlineColor ||
    !selectionGlowColor ||
    selectionGlowIntensity === undefined ||
    atmosphereIntensity === undefined
  ) return undefined;
  return {
    oceanColor,
    landColor,
    countryBorderColor,
    countryBorderOpacity,
    gridEnabled,
    gridOpacity,
    routeColor,
    routeOpacity,
    markerColor,
    selectionOutlineColor,
    selectionGlowColor,
    selectionGlowIntensity,
    atmosphereIntensity,
  };
}

export function resolveGlobeAppearance(
  theme: GlobeAppearanceTheme,
  settings: AnimationSettings,
): ResolvedGlobeAppearance {
  if (theme === 'light') return settings.globeLightAppearance;

  return {
    ...DARK_GLOBE_APPEARANCE,
    landColor: settings.globeLandColor,
    selectionOutlineColor: settings.globeHighlightColor,
    selectionGlowColor: settings.globeHighlightGlowColor,
  };
}
